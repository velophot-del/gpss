import type { Connection } from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import type { SessionUser } from '../utils/policies.js'
import { getAdjustmentDeadline, getTeacherStudentLimit } from '../utils/policies.js'
import { getMajorCodeAliases, normalizeMajorCode } from '../utils/majorCodes.js'
import { getStudentMajorCode } from '../utils/topicAccess.js'
import { safeParseJson } from '../utils/json.js'
import { getTeacherGroupKey, toStudentTopicView } from '../utils/studentTopic.js'

export class AdjustmentVolunteerError extends Error {
  constructor(message: string, public statusCode = 409) { super(message) }
}

export type AdjustmentVolunteerInput = { topicId: string; motivation?: string }

async function getCurrentCycle(conn?: Connection) {
  const sql = `SELECT * FROM cycles WHERE status IN ('active','selection','review','adjustment') ORDER BY created_at DESC LIMIT 1`
  const [rows] = conn ? await conn.query<any[]>(sql) : [await query<any>(sql)]
  return rows[0] || null
}

function assertAdjustmentPhase(cycle: any, allowExpired = false) {
  if (!cycle || cycle.phase !== 'adjustment') throw new AdjustmentVolunteerError('当前不在调剂补录阶段', 409)
  const deadline = getAdjustmentDeadline(safeParseJson(cycle.phases_config, {}))
  if (!deadline) throw new AdjustmentVolunteerError('当前周期未配置有效的调剂截止时间，请联系管理员', 409)
  if (!allowExpired && Date.now() >= deadline.getTime()) throw new AdjustmentVolunteerError('调剂填报已截止', 409)
  return deadline
}

async function assertStudentEligible(conn: Connection, studentId: string, cycleId: number) {
  const [users] = await conn.query<any[]>('SELECT major_code FROM users WHERE id = ? AND role = \'student\'', [studentId])
  if (!users[0]) throw new AdjustmentVolunteerError('学生账号不存在', 404)
  const majorCode = users[0].major_code || await getStudentMajorCode(studentId)
  const [firstApplications] = await conn.query<any[]>(`
    SELECT a.id FROM applications a JOIN topics t ON t.id = a.topic_id
    WHERE a.student_id = ? AND t.cycle_id = ? LIMIT 1
  `, [studentId, cycleId])
  if (!firstApplications.length) throw new AdjustmentVolunteerError('未找到本周期首次志愿记录，暂不能参加调剂', 403)
  const [accepted] = await conn.query<any[]>(`
    SELECT a.id FROM applications a JOIN topics t ON t.id = a.topic_id
    WHERE a.student_id = ? AND t.cycle_id = ? AND a.status = 'accepted' LIMIT 1
  `, [studentId, cycleId])
  if (accepted.length) throw new AdjustmentVolunteerError('您已被本周期课题录取，不能参加调剂', 403)
  return normalizeMajorCode(majorCode)
}

async function readEligibleTopics(conn: Connection, cycleId: number, majorCode: string) {
  const [rows] = await conn.query<any[]>(`
    SELECT t.*, u.real_name AS teacher_name, u.title AS teacher_title, u.department,
           u.email AS teacher_email, u.phone AS teacher_phone, u.avatar AS teacher_avatar,
           COALESCE(ac.accepted_count, 0) AS accepted_count,
           (SELECT COUNT(DISTINCT ta.student_id) FROM applications ta
            JOIN topics tt ON tt.id = ta.topic_id
            WHERE tt.teacher_id = t.teacher_id AND tt.cycle_id = t.cycle_id
              AND ta.status = 'accepted') AS teacher_accepted_count
    FROM topics t JOIN users u ON u.id = t.teacher_id
    LEFT JOIN (
      SELECT topic_id, COUNT(DISTINCT student_id) AS accepted_count
      FROM applications WHERE status = 'accepted' GROUP BY topic_id
    ) ac ON ac.topic_id = t.id
    WHERE t.cycle_id = ? AND t.major_code IN (?) AND t.status = 'published'
      AND COALESCE(ac.accepted_count, 0) < t.max_students
    ORDER BY t.created_at DESC, t.id
  `, [cycleId, getMajorCodeAliases(majorCode)])
  const configCycle = await conn.query<any[]>('SELECT phases_config FROM cycles WHERE id = ?', [cycleId])
  const teacherStudentLimit = getTeacherStudentLimit(safeParseJson(configCycle[0][0]?.phases_config, {}))
  return rows.filter(row => teacherStudentLimit <= 0 || Number(row.teacher_accepted_count || 0) < teacherStudentLimit).map(row => toStudentTopicView({
    id: row.id, title: row.title, description: row.description, category: row.category,
    difficulty: row.difficulty, maxStudents: Number(row.max_students),
    currentCount: Number(row.accepted_count), status: row.status, cycleId: row.cycle_id,
    tags: safeParseJson(row.tags, []), requirements: row.requirements, viewCount: Number(row.view_count),
    major: row.major, majorCode: row.major_code, teacherStudentLimit,
  }, row.teacher_id))
}

export async function getEligibleAdjustmentTopics(actor: SessionUser) {
  if (actor.role !== 'student') throw new AdjustmentVolunteerError('只有学生可以查看调剂课题', 403)
  const cycle = await getCurrentCycle()
  assertAdjustmentPhase(cycle)
  const conn = await (await import('../config/database.js')).getConnection()
  try {
    const majorCode = await assertStudentEligible(conn, actor.id, Number(cycle.id))
    return { cycleId: Number(cycle.id), deadline: getAdjustmentDeadline(safeParseJson(cycle.phases_config, {}))!.toISOString(), topics: await readEligibleTopics(conn, Number(cycle.id), majorCode) }
  } finally { conn.release() }
}

export async function getMyAdjustmentVolunteers(actor: SessionUser) {
  if (actor.role !== 'student') throw new AdjustmentVolunteerError('只有学生可以查看个人调剂志愿', 403)
  const cycle = await getCurrentCycle()
  if (!cycle) return { cycleId: null, phase: null, version: 0, items: [], settlement: null }
  const items = await query<any>(`
    SELECT av.id, av.topic_id, av.priority, av.motivation, av.status, av.version,
           t.title, t.category, t.major, t.max_students, t.teacher_id
    FROM adjustment_volunteers av JOIN topics t ON t.id = av.topic_id
    WHERE av.cycle_id = ? AND av.student_id = ?
    ORDER BY av.priority
  `, [cycle.id, actor.id])
  const settlements = await query<any>('SELECT status, result_json, error_message FROM adjustment_settlements WHERE cycle_id = ?', [cycle.id])
  const submittedBatches = await query<any>(`
    SELECT COUNT(*) AS cnt FROM adjustment_batches b
    JOIN adjustment_volunteers av ON av.cycle_id = b.cycle_id AND av.topic_id = b.topic_id
    WHERE b.cycle_id = ? AND av.student_id = ? AND av.status = 'submitted' AND b.status != 'draft'
  `, [cycle.id, actor.id])
  const deadline = getAdjustmentDeadline(safeParseJson(cycle.phases_config, {}))
  const canEdit = cycle.phase === 'adjustment' && !!deadline && Date.now() < deadline.getTime()
    && !settlements[0]?.status?.match(/^(pending|running|failed|completed)$/) && Number(submittedBatches[0]?.cnt || 0) === 0
  return {
    cycleId: Number(cycle.id), phase: cycle.phase,
    version: items.length ? Math.max(...items.map(item => Number(item.version) || 0)) : 0,
    canEdit,
    frozenReason: canEdit ? null : (Number(submittedBatches[0]?.cnt || 0) ? '所填课题已有教师提交名单，志愿已冻结' : ['pending', 'running', 'failed', 'completed'].includes(settlements[0]?.status) ? '调剂统一结算已开始' : deadline && Date.now() >= deadline.getTime() ? '调剂填报已截止' : '当前不在调剂阶段'),
    items: items.map(item => ({ id: item.id, topicId: item.topic_id, title: item.title, category: item.category,
      major: item.major, priority: Number(item.priority), motivation: item.motivation || '', status: item.status, teacherGroupKey: getTeacherGroupKey(item.teacher_id) })),
    settlement: settlements[0] ? { status: settlements[0].status, result: safeParseJson(settlements[0].result_json, null) } : null,
  }
}

export async function saveMyAdjustmentVolunteers(actor: SessionUser, expectedVersion: number, items: AdjustmentVolunteerInput[]) {
  if (actor.role !== 'student') throw new AdjustmentVolunteerError('只有学生可以提交调剂志愿', 403)
  if (!Array.isArray(items) || items.length < 3 || items.length > 6) throw new AdjustmentVolunteerError('调剂志愿数量须为 3–6 个')
  if (items.some(item => !item?.topicId) || new Set(items.map(item => item.topicId)).size !== items.length) throw new AdjustmentVolunteerError('调剂志愿课题不能为空且不能重复')
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new AdjustmentVolunteerError('志愿版本无效')
  const topicIds = items.map(item => String(item.topicId))

  await transaction(async conn => {
    const cycle = await getCurrentCycle(conn)
    assertAdjustmentPhase(cycle)
    await conn.query('SELECT id FROM cycles WHERE id = ? FOR UPDATE', [cycle.id])
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [actor.id])
    const majorCode = await assertStudentEligible(conn, actor.id, Number(cycle.id))
    const [current] = await conn.query<any[]>(`SELECT version FROM adjustment_volunteers WHERE cycle_id = ? AND student_id = ? FOR UPDATE`, [cycle.id, actor.id])
    const version = current.length ? Math.max(...current.map(row => Number(row.version) || 0)) : 0
    if (version !== expectedVersion) throw new AdjustmentVolunteerError('调剂志愿已在其他页面更新，请刷新后重试', 409)
    const [settlementRows] = await conn.query<any[]>('SELECT status FROM adjustment_settlements WHERE cycle_id = ? FOR UPDATE', [cycle.id])
    if (settlementRows[0]) throw new AdjustmentVolunteerError('调剂结算已开始，志愿不可修改', 409)
    const [existingVolunteerTopics] = await conn.query<any[]>(
      'SELECT topic_id FROM adjustment_volunteers WHERE cycle_id = ? AND student_id = ? FOR UPDATE',
      [cycle.id, actor.id],
    )
    const allTopicIds = [...new Set([...existingVolunteerTopics.map(row => String(row.topic_id)), ...items.map(item => item.topicId)])]
    const topicsToLock = [...new Set([...allTopicIds, ...topicIds])].sort()
    const [topics] = await conn.query<any[]>(`
      SELECT t.id, t.status, t.cycle_id, t.major_code, t.teacher_id, t.max_students,
             COALESCE(ac.accepted_count, 0) AS accepted_count
      FROM topics t LEFT JOIN (
        SELECT topic_id, COUNT(DISTINCT student_id) AS accepted_count FROM applications WHERE status = 'accepted' GROUP BY topic_id
      ) ac ON ac.topic_id = t.id
      WHERE t.id IN (?) ORDER BY t.id FOR UPDATE
    `, [topicsToLock])
    const [lockedBatches] = await conn.query<any[]>(`
      SELECT DISTINCT b.topic_id, b.status FROM adjustment_batches b
      WHERE b.cycle_id = ? AND b.topic_id IN (?) ORDER BY b.topic_id FOR UPDATE
    `, [cycle.id, topicsToLock])
    if (lockedBatches.some(batch => batch.status !== 'draft')) throw new AdjustmentVolunteerError('您填报的课题已有教师提交名单，志愿已冻结', 409)
    const selectedTopics = topics.filter(topic => topicIds.includes(String(topic.id)))
    if (selectedTopics.length !== items.length) throw new AdjustmentVolunteerError('有课题不存在或不可填报')
    const teacherIds = new Set<string>()
    for (const topic of selectedTopics) {
      if (topic.status !== 'published' || Number(topic.cycle_id) !== Number(cycle.id)) throw new AdjustmentVolunteerError('只能填报本周期已发布课题')
      if (normalizeMajorCode(topic.major_code) !== majorCode) throw new AdjustmentVolunteerError('调剂课题须与您的专业一致')
      if (Number(topic.accepted_count) >= Number(topic.max_students)) throw new AdjustmentVolunteerError('有课题名额已满，请刷新后重选')
      if (!topic.teacher_id) throw new AdjustmentVolunteerError('所选课题未分配指导教师')
      teacherIds.add(String(topic.teacher_id))
    }
    if (teacherIds.size < 2) throw new AdjustmentVolunteerError('调剂志愿须至少覆盖两位不同教师')

    const eligibleIds = new Set((await readEligibleTopics(conn, Number(cycle.id), majorCode)).map(topic => String(topic.id)))
    if (selectedTopics.some(topic => !eligibleIds.has(String(topic.id)))) {
      throw new AdjustmentVolunteerError('有课题或教师名额已满，请刷新后重选')
    }

    await conn.query('DELETE FROM adjustment_volunteers WHERE cycle_id = ? AND student_id = ?', [cycle.id, actor.id])
    const nextVersion = version + 1
    for (const [index, item] of items.entries()) {
      await conn.query(`INSERT INTO adjustment_volunteers
        (id, cycle_id, student_id, topic_id, priority, motivation, version, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      [uuidv4(), cycle.id, actor.id, item.topicId, index + 1, String(item.motivation || '').trim(), nextVersion])
    }
  })
  return getMyAdjustmentVolunteers(actor)
}
