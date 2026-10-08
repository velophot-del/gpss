import type { Connection } from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import type { SessionUser } from '../utils/policies.js'
import { getAdjustmentDeadline, getTeacherStudentLimit } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'

export type AdjustmentDecision = 'proposed' | 'reserve' | 'reject'
export type AdjustmentDraftItemInput = { volunteerId: string; decision: AdjustmentDecision | null; decisionRank?: number | null; comment?: string | null }

export class AdjustmentDraftError extends Error {
  constructor(message: string, public statusCode = 409) { super(message) }
}

async function getTopicContext(conn: Connection, topicId: string, lock = false) {
  const [rows] = await conn.query<any[]>(`
    SELECT t.id, t.title, t.tags, t.category, t.teacher_id, t.cycle_id, t.max_students, t.status AS topic_status,
           (SELECT COUNT(DISTINCT a.student_id) FROM applications a WHERE a.topic_id = t.id AND a.status = 'accepted') AS accepted_count,
           c.phase, c.status AS cycle_status, c.phases_config
    FROM topics t JOIN cycles c ON c.id = t.cycle_id WHERE t.id = ? ${lock ? 'FOR UPDATE' : ''}
  `, [topicId])
  if (!rows[0]) throw new AdjustmentDraftError('课题不存在或未关联选题周期', 404)
  return rows[0]
}

function assertTeacher(topic: any, actor: SessionUser, writable: boolean) {
  if (actor.role !== 'teacher' || topic.teacher_id !== actor.id) throw new AdjustmentDraftError('只有课题指导教师可以操作本课题调剂名单', 403)
  if (topic.phase !== 'adjustment') throw new AdjustmentDraftError('当前不在调剂补录阶段', 409)
  if (topic.topic_status !== 'published' || Number(topic.accepted_count) >= Number(topic.max_students)) throw new AdjustmentDraftError('当前课题已满或未开放调剂', 409)
  const deadline = getAdjustmentDeadline(safeParseJson(topic.phases_config, {}))
  if (!deadline) throw new AdjustmentDraftError('当前周期未配置有效的调剂截止时间，请联系管理员', 409)
  if (writable && Date.now() >= deadline.getTime()) throw new AdjustmentDraftError('调剂遴选已截止，名单将由系统自动提交', 409)
  return deadline
}

function parseArray(value: unknown): string[] {
  const parsed = safeParseJson<unknown[]>(value, [])
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

function makeMatchHint(tags: string[], category: string, skills: string[], interests: string[]) {
  const normalized = (value: string) => value.trim().toLocaleLowerCase()
  const skillMatches = tags.filter(tag => skills.some(skill => normalized(skill) === normalized(tag)))
  const interestMatches = interests.filter(interest => normalized(interest) === normalized(category))
  const total = tags.length + (category ? 1 : 0)
  const score = total ? Math.round((skillMatches.length + interestMatches.length) / total * 100) : 0
  return { score, skillMatches, interestMatches }
}

function validateItems(items: AdjustmentDraftItemInput[]) {
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.volunteerId || seen.has(item.volunteerId)) throw new AdjustmentDraftError('名单中存在重复或无效的调剂志愿')
    if (item.decision != null && !['proposed', 'reserve', 'reject'].includes(item.decision)) throw new AdjustmentDraftError('名单决定无效')
    seen.add(item.volunteerId)
  }
  for (const decision of ['proposed', 'reserve'] as const) {
    const ranks = items.filter(item => item.decision === decision).map(item => Number(item.decisionRank)).sort((a, b) => a - b)
    if (ranks.some((rank, index) => !Number.isInteger(rank) || rank !== index + 1)) {
      throw new AdjustmentDraftError(`${decision === 'proposed' ? '拟录取' : '候补'}排序必须从 1 开始且连续`)
    }
  }
}

async function validateCapacity(conn: Connection, topic: any, batchId: string, items: AdjustmentDraftItemInput[]) {
  validateItems(items)
  const decided = items.filter(item => item.decision != null)
  if (decided.length) {
    const [volunteers] = await conn.query<any[]>(`
      SELECT id FROM adjustment_volunteers
      WHERE cycle_id = ? AND topic_id = ? AND id IN (?) AND status = 'submitted'
    `, [topic.cycle_id, topic.id, decided.map(item => item.volunteerId)])
    if (volunteers.length !== decided.length) throw new AdjustmentDraftError('名单含不属于本课题或已处理的调剂志愿')
  }
  const proposed = items.filter(item => item.decision === 'proposed').length
  const [acceptedRows] = await conn.query<any[]>(
    "SELECT COUNT(DISTINCT student_id) AS cnt FROM applications WHERE topic_id = ? AND status = 'accepted'", [topic.id],
  )
  if (Number(acceptedRows[0]?.cnt || 0) + proposed > Number(topic.max_students)) throw new AdjustmentDraftError(`拟录取人数超过课题名额（${topic.max_students}人）`)
  const config = safeParseJson<Record<string, any>>(topic.phases_config, {})
  const limit = getTeacherStudentLimit(config)
  if (limit > 0) {
    const [counts] = await conn.query<any[]>(`
      SELECT
        (SELECT COUNT(DISTINCT a.student_id) FROM applications a JOIN topics t ON t.id = a.topic_id
         WHERE t.teacher_id = ? AND t.cycle_id = ? AND a.status = 'accepted') AS accepted_count,
        (SELECT COUNT(DISTINCT av.student_id) FROM adjustment_draft_items di
         JOIN adjustment_batches b ON b.id = di.batch_id JOIN topics t ON t.id = b.topic_id
         JOIN adjustment_volunteers av ON av.id = di.volunteer_id
         WHERE t.teacher_id = ? AND b.cycle_id = ? AND di.decision = 'proposed' AND b.id != ?) AS other_proposed
    `, [topic.teacher_id, topic.cycle_id, topic.teacher_id, topic.cycle_id, batchId || ''])
    const total = Number(counts[0]?.accepted_count || 0) + Number(counts[0]?.other_proposed || 0) + proposed
    if (total > limit) throw new AdjustmentDraftError(`拟录取总人数 ${total} 人，超过教师指导上限 ${limit} 人`)
  }
}

async function readDraft(topicId: string, actor: SessionUser) {
  const conn = await (await import('../config/database.js')).getConnection()
  try {
    const topic = await getTopicContext(conn, topicId)
    const deadline = assertTeacher(topic, actor, false)
    const [batchRows] = await conn.query<any[]>('SELECT * FROM adjustment_batches WHERE cycle_id = ? AND topic_id = ?', [topic.cycle_id, topic.id])
    const batch = batchRows[0]
    const [rows] = await conn.query<any[]>(`
      SELECT av.id, av.student_id, av.priority, av.motivation, av.status AS volunteer_status,
             u.real_name AS student_name, u.student_id AS student_code, u.class_name, u.major,
             sp.skills, sp.interests, sp.self_intro,
             di.decision, di.decision_rank, di.comment
      FROM adjustment_volunteers av JOIN users u ON u.id = av.student_id
      LEFT JOIN student_profiles sp ON sp.user_id = av.student_id
      LEFT JOIN adjustment_draft_items di ON di.volunteer_id = av.id AND di.batch_id = ?
      WHERE av.cycle_id = ? AND av.topic_id = ? AND av.status = 'submitted'
      ORDER BY av.priority, av.created_at, av.id
    `, [batch?.id || '', topic.cycle_id, topic.id])
    const config = safeParseJson<Record<string, any>>(topic.phases_config, {})
    const [counts] = await conn.query<any[]>(`
      SELECT
        (SELECT COUNT(DISTINCT a.student_id) FROM applications a JOIN topics t ON t.id = a.topic_id
         WHERE t.teacher_id = ? AND t.cycle_id = ? AND a.status = 'accepted') AS accepted_count,
        (SELECT COUNT(DISTINCT av.student_id) FROM adjustment_draft_items di
         JOIN adjustment_batches b ON b.id = di.batch_id JOIN topics t ON t.id = b.topic_id
         JOIN adjustment_volunteers av ON av.id = di.volunteer_id
         WHERE t.teacher_id = ? AND b.cycle_id = ? AND di.decision = 'proposed') AS proposed_count
    `, [topic.teacher_id, topic.cycle_id, topic.teacher_id, topic.cycle_id])
    const tags = parseArray(topic.tags)
    return {
      topic: { id: topic.id, title: topic.title, category: topic.category, tags, maxStudents: Number(topic.max_students), cycleId: Number(topic.cycle_id) },
      batch: { id: batch?.id || null, status: batch?.status || 'draft', version: Number(batch?.version || 0), submittedAt: batch?.submitted_at || null, autoSubmittedAt: batch?.auto_submitted_at || null },
      deadline: deadline.toISOString(), teacherStudentLimit: getTeacherStudentLimit(config),
      teacherAcceptedCount: Number(counts[0]?.accepted_count || 0), teacherProposedCount: Number(counts[0]?.proposed_count || 0),
      volunteers: rows.map(row => {
        const skills = parseArray(row.skills), interests = parseArray(row.interests)
        return {
          id: row.id, studentId: row.student_id, studentName: row.student_name, studentCode: row.student_code,
          className: row.class_name, major: row.major, priority: Number(row.priority), motivation: row.motivation || '',
          selfIntro: row.self_intro || '', skills, interests, volunteerStatus: row.volunteer_status,
          decision: row.decision || null, decisionRank: row.decision_rank == null ? null : Number(row.decision_rank), comment: row.comment || '',
          match: makeMatchHint(tags, topic.category, skills, interests),
        }
      }),
    }
  } finally { conn.release() }
}

export async function getAdjustmentTeacherTopics(actor: SessionUser) {
  if (actor.role !== 'teacher') throw new AdjustmentDraftError('权限不足', 403)
  return query<any>(`
    SELECT t.id, t.title, t.max_students, t.status, t.cycle_id, COUNT(av.id) AS volunteer_count,
           b.status AS batch_status, b.version
    FROM topics t JOIN cycles c ON c.id = t.cycle_id
    LEFT JOIN adjustment_volunteers av ON av.topic_id = t.id AND av.cycle_id = t.cycle_id AND av.status = 'submitted'
    LEFT JOIN adjustment_batches b ON b.topic_id = t.id AND b.cycle_id = t.cycle_id
    WHERE t.teacher_id = ? AND c.phase = 'adjustment' AND t.status = 'published'
    GROUP BY t.id, t.title, t.max_students, t.status, t.cycle_id, b.status, b.version
    ORDER BY t.title
  `, [actor.id])
}

export async function getAdjustmentDraft(topicId: string, actor: SessionUser) { return readDraft(topicId, actor) }

export async function saveAdjustmentDraft(topicId: string, actor: SessionUser, expectedVersion: number, items: AdjustmentDraftItemInput[]) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || !Array.isArray(items)) throw new AdjustmentDraftError('草稿版本或内容无效')
  const cycleId = await transaction(async conn => {
    const [cycleRows] = await conn.query<any[]>('SELECT c.id FROM cycles c JOIN topics t ON t.cycle_id = c.id WHERE t.id = ? FOR UPDATE', [topicId])
    if (!cycleRows[0]) throw new AdjustmentDraftError('课题不存在或未关联选题周期', 404)
    const topic = await getTopicContext(conn, topicId, true)
    assertTeacher(topic, actor, true)
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [actor.id])
    const [batches] = await conn.query<any[]>('SELECT * FROM adjustment_batches WHERE cycle_id = ? AND topic_id = ? FOR UPDATE', [topic.cycle_id, topic.id])
    let batch = batches[0]
    if (!batch) {
      if (expectedVersion !== 0) throw new AdjustmentDraftError('草稿版本已变化，请刷新后重试', 409)
      batch = { id: uuidv4(), version: 0, status: 'draft' }
      await conn.query("INSERT INTO adjustment_batches (id, cycle_id, topic_id, status) VALUES (?, ?, ?, 'draft')", [batch.id, topic.cycle_id, topic.id])
    }
    if (batch.status !== 'draft') throw new AdjustmentDraftError('名单已提交，需由管理员退回后才能修改', 409)
    if (Number(batch.version) !== expectedVersion) throw new AdjustmentDraftError('草稿已被其他页面更新，请刷新后重试', 409)
    await validateCapacity(conn, topic, batch.id, items)
    await conn.query('DELETE FROM adjustment_draft_items WHERE batch_id = ?', [batch.id])
    for (const item of items.filter(item => item.decision != null)) {
      await conn.query(`INSERT INTO adjustment_draft_items
        (id, batch_id, volunteer_id, decision, decision_rank, comment, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), batch.id, item.volunteerId, item.decision, item.decision === 'reject' ? null : item.decisionRank, item.comment || null, actor.id])
    }
    await conn.query('UPDATE adjustment_batches SET version = version + 1 WHERE id = ?', [batch.id])
    await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail)
      VALUES (?, 'adjustment_draft_saved', 'topic', ?, ?)`, [actor.id, topic.id, JSON.stringify({ version: expectedVersion + 1, itemCount: items.length })])
    return Number(topic.cycle_id)
  })
  return readDraft(topicId, actor)
}

export async function submitAdjustmentBatch(topicId: string, actor: SessionUser, expectedVersion: number) {
  const cycleId = await transaction(async conn => {
    const [cycleRows] = await conn.query<any[]>('SELECT c.id FROM cycles c JOIN topics t ON t.cycle_id = c.id WHERE t.id = ? FOR UPDATE', [topicId])
    if (!cycleRows[0]) throw new AdjustmentDraftError('课题不存在或未关联选题周期', 404)
    const topic = await getTopicContext(conn, topicId, true)
    assertTeacher(topic, actor, true)
    const [batches] = await conn.query<any[]>('SELECT * FROM adjustment_batches WHERE cycle_id = ? AND topic_id = ? FOR UPDATE', [topic.cycle_id, topic.id])
    const batch = batches[0]
    if (!batch || batch.status !== 'draft') throw new AdjustmentDraftError('当前名单不存在或已经提交', 409)
    if (Number(batch.version) !== expectedVersion) throw new AdjustmentDraftError('草稿已被其他页面更新，请刷新后重试', 409)
    const [rows] = await conn.query<any[]>('SELECT volunteer_id, decision, decision_rank, comment FROM adjustment_draft_items WHERE batch_id = ?', [batch.id])
    await validateCapacity(conn, topic, batch.id, rows.map(row => ({ volunteerId: row.volunteer_id, decision: row.decision, decisionRank: row.decision_rank, comment: row.comment })))
    await conn.query("UPDATE adjustment_batches SET status = 'submitted', version = version + 1, submitted_by = ?, submitted_at = NOW() WHERE id = ?", [actor.id, batch.id])
    await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail)
      VALUES (?, 'adjustment_batch_submitted', 'topic', ?, ?)`, [actor.id, topic.id, JSON.stringify({ version: expectedVersion + 1 })])
    return Number(topic.cycle_id)
  })
  return readDraft(topicId, actor)
}
