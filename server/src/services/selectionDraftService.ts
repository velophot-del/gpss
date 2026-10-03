import type { Connection } from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import type { SessionUser } from '../utils/policies.js'
import { getReviewDeadline, getTeacherStudentLimit } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'
import type { SelectionDecision } from './selectionMatcher.js'
import { buildPriorityBlocks, type PriorityDecisionCandidate } from './selectionPriorityService.js'
import { requestSettlementIfReady } from './selectionSettlementService.js'

export class SelectionDraftError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message)
  }
}

export interface DraftItemInput {
  applicationId: string
  decision: SelectionDecision
  decisionRank?: number | null
  comment?: string | null
}

export interface SelectionDraftView {
  topic: { id: string; title: string; maxStudents: number; teacherId: string; cycleId: number }
  batch: { id: string | null; status: 'draft' | 'submitted' | 'auto_submitted' | 'settled'; version: number; submittedAt: string | null; autoSubmittedAt: string | null }
  applications: any[]
  deadline: string
  teacherStudentLimit: number
  teacherAcceptedCount: number
  teacherProposedCount: number
  settlementWarning?: string
}

async function loadTopicContext(conn: Connection, topicId: string, lock = false) {
  const [rows] = await conn.query<any[]>(`
    SELECT t.id, t.title, t.teacher_id, t.cycle_id, t.max_students, t.status AS topic_status,
           c.status AS cycle_status, c.phase, c.phases_config
    FROM topics t JOIN cycles c ON c.id = t.cycle_id
    WHERE t.id = ? ${lock ? 'FOR UPDATE' : ''}
  `, [topicId])
  const topic = rows[0]
  if (!topic) throw new SelectionDraftError('课题不存在或未关联选题周期', 404)
  return topic
}

function assertReadable(topic: any, actor: SessionUser) {
  if (actor.role === 'teacher' && topic.teacher_id !== actor.id) throw new SelectionDraftError('无权查看此课题遴选名单', 403)
  if (!['teacher', 'admin'].includes(actor.role)) throw new SelectionDraftError('权限不足', 403)
}

function assertWritable(topic: any, actor: SessionUser) {
  if (actor.role !== 'teacher' || topic.teacher_id !== actor.id) throw new SelectionDraftError('只有课题指导教师可以编辑遴选名单', 403)
  if (!['published', 'full'].includes(topic.topic_status)) throw new SelectionDraftError('当前课题未开放，不能编辑遴选名单', 409)
  if (topic.phase !== 'teacher_review') throw new SelectionDraftError('当前不在教师遴选阶段', 409)
  const deadline = getReviewDeadline(safeParseJson(topic.phases_config, {}))
  if (!deadline) throw new SelectionDraftError('当前周期未配置教师遴选截止时间，请联系管理员', 409)
  if (Date.now() >= deadline.getTime()) throw new SelectionDraftError('教师遴选已截止，名单将由系统自动提交', 409)
  return deadline
}

function validateRanks(items: DraftItemInput[]) {
  const seenApplications = new Set<string>()
  for (const item of items) {
    if (!item.applicationId || seenApplications.has(item.applicationId)) throw new SelectionDraftError('草稿中存在重复申请')
    if (!['proposed', 'reserve', 'reject'].includes(item.decision)) throw new SelectionDraftError('草稿决定无效')
    seenApplications.add(item.applicationId)
  }
  for (const decision of ['proposed', 'reserve'] as const) {
    const ranks = items.filter(item => item.decision === decision).map(item => Number(item.decisionRank)).sort((a, b) => a - b)
    if (ranks.some((rank, index) => !Number.isSafeInteger(rank) || rank < 1 || (index > 0 && rank === ranks[index - 1]))) {
      throw new SelectionDraftError(`${decision === 'proposed' ? '拟录取' : '候补'}顺序必须是互不重复的正整数`)
    }
  }
}

async function loadPriorityCandidates(conn: Connection, cycleId: number): Promise<PriorityDecisionCandidate[]> {
  const [rows] = await conn.query<any[]>(`
    SELECT a.id AS application_id, a.student_id, a.topic_id, a.priority, t.title AS topic_title, t.teacher_id, sdi.decision
    FROM applications a JOIN topics t ON t.id = a.topic_id
    LEFT JOIN selection_batches sb ON sb.cycle_id = t.cycle_id AND sb.topic_id = t.id
    LEFT JOIN selection_draft_items sdi ON sdi.batch_id = sb.id AND sdi.application_id = a.id
    WHERE t.cycle_id = ?
  `, [cycleId])
  return rows.map(row => ({ applicationId: row.application_id, studentId: row.student_id, topicId: row.topic_id,
    priority: Number(row.priority), decision: row.decision || null, topicTitle: row.topic_title, teacherId: row.teacher_id }))
}

function withCurrentDraft(candidates: PriorityDecisionCandidate[], topicId: string, items: DraftItemInput[]) {
  const itemById = new Map(items.map(item => [item.applicationId, item]))
  return candidates.map(candidate => candidate.topicId !== topicId ? candidate : { ...candidate, decision: itemById.get(candidate.applicationId)?.decision || null })
}

async function validateDraftCapacity(conn: Connection, topic: any, items: DraftItemInput[]) {
  validateRanks(items)
  if (items.length) {
    const [applications] = await conn.query<any[]>(
      `SELECT id FROM applications
       WHERE topic_id = ? AND id IN (?) AND status IN ('pending', 'submitted', 'pending_review')`,
      [topic.id, items.map(item => item.applicationId)],
    )
    if (applications.length !== items.length) throw new SelectionDraftError('草稿包含不属于本课题或不可处理的申请')
  }

  const [acceptedRows] = await conn.query<any[]>(
    "SELECT COUNT(DISTINCT student_id) AS cnt FROM applications WHERE topic_id = ? AND status = 'accepted'",
    [topic.id],
  )
  const topicAccepted = Number(acceptedRows[0]?.cnt || 0)
  const candidates = withCurrentDraft(await loadPriorityCandidates(conn, Number(topic.cycle_id)), topic.id, items)
  const blocks = buildPriorityBlocks(candidates)
  const proposed = items.filter(item => item.decision === 'proposed' && !blocks.has(item.applicationId)).length
  if (topicAccepted + proposed > Number(topic.max_students)) throw new SelectionDraftError(`拟录取人数超过课题名额（${topic.max_students}人）`)

  const config = safeParseJson<Record<string, any>>(topic.phases_config, {})
  const teacherLimit = getTeacherStudentLimit(config)
  if (teacherLimit > 0) {
    const effectiveProposed = candidates.filter(candidate => candidate.teacherId === topic.teacher_id && candidate.decision === 'proposed' && !blocks.has(candidate.applicationId)).length
    const total = topicAccepted + effectiveProposed
    if (total > teacherLimit) throw new SelectionDraftError(`该教师拟录取总人数 ${total} 人，超过指导上限 ${teacherLimit} 人`)
  }
}

export async function getSelectionDraft(topicId: string, actor: SessionUser): Promise<SelectionDraftView> {
  const topicRows = await query<any>(`
    SELECT t.id, t.title, t.teacher_id, t.cycle_id, t.max_students, c.phases_config
    FROM topics t LEFT JOIN cycles c ON c.id = t.cycle_id WHERE t.id = ?
  `, [topicId])
  const topic = topicRows[0]
  if (!topic) throw new SelectionDraftError('课题不存在或未关联选题周期', 404)
  assertReadable(topic, actor)
  const deadline = getReviewDeadline(safeParseJson(topic.phases_config, {}))

  const batchRows = topic.cycle_id
    ? await query<any>('SELECT * FROM selection_batches WHERE cycle_id = ? AND topic_id = ?', [topic.cycle_id, topic.id])
    : []
  const batch = batchRows[0]
  const applications = await query<any>(`
    SELECT a.id, a.student_id, a.priority, a.status, a.motivation, a.created_at,
           u.real_name AS student_name, u.student_id AS student_code, u.class_name, u.major,
           sp.gpa, sdi.decision, sdi.decision_rank, sdi.comment
    FROM applications a
    JOIN users u ON u.id = a.student_id
    LEFT JOIN student_profiles sp ON sp.user_id = a.student_id
    LEFT JOIN selection_draft_items sdi ON sdi.application_id = a.id AND sdi.batch_id = ?
    WHERE a.topic_id = ?
    ORDER BY a.priority, a.created_at, a.id
  `, [batch?.id || '', topic.id])
  const priorityRows = await query<any>(`
    SELECT a.id AS application_id, a.student_id, a.priority, t.title AS topic_title, sdi.decision
    FROM applications a JOIN topics t ON t.id = a.topic_id
    LEFT JOIN selection_batches sb ON sb.cycle_id = t.cycle_id AND sb.topic_id = t.id
    LEFT JOIN selection_draft_items sdi ON sdi.batch_id = sb.id AND sdi.application_id = a.id
    WHERE t.cycle_id = ?
  `, [topic.cycle_id])
  const priorityBlocks = buildPriorityBlocks(priorityRows.map(row => ({ applicationId: row.application_id, studentId: row.student_id,
    priority: Number(row.priority), decision: row.decision || null, topicTitle: row.topic_title })))
  const config = safeParseJson<Record<string, any>>(topic.phases_config, {})
  const [counts] = await query<any>(`
    SELECT
      (SELECT COUNT(DISTINCT a.student_id) FROM applications a JOIN topics t ON t.id = a.topic_id
       WHERE t.teacher_id = ? AND t.cycle_id = ? AND a.status = 'accepted') AS accepted_count,
      (SELECT COUNT(*) FROM selection_draft_items sdi JOIN selection_batches sb ON sb.id = sdi.batch_id
       JOIN topics t ON t.id = sb.topic_id
       WHERE t.teacher_id = ? AND sb.cycle_id = ? AND sdi.decision = 'proposed') AS proposed_count
  `, [topic.teacher_id, topic.cycle_id, topic.teacher_id, topic.cycle_id])

  return {
    topic: { id: topic.id, title: topic.title, maxStudents: Number(topic.max_students), teacherId: topic.teacher_id, cycleId: Number(topic.cycle_id) },
    batch: {
      id: batch?.id || null,
      status: batch?.status || 'draft',
      version: Number(batch?.version || 0),
      submittedAt: batch?.submitted_at || null,
      autoSubmittedAt: batch?.auto_submitted_at || null,
    },
    applications: applications.map(item => {
      const block = priorityBlocks.get(item.id)
      return {
      id: item.id, studentId: item.student_id, studentName: item.student_name, studentCode: item.student_code,
      className: item.class_name, major: item.major, priority: Number(item.priority), status: item.status,
      motivation: item.motivation, gpa: item.gpa, appliedAt: item.created_at, decision: item.decision || null,
      decisionRank: item.decision_rank == null ? null : Number(item.decision_rank), comment: item.comment || '',
      effectiveDecision: block ? null : item.decision || null,
      blockedByHigherPriority: Boolean(block), blockingPriority: block?.blockingPriority || null,
      blockingDecision: block?.blockingDecision || null, blockingTopicTitle: block?.blockingTopicTitle || null,
    }}),
    deadline: deadline?.toISOString() || '',
    teacherStudentLimit: getTeacherStudentLimit(config),
    teacherAcceptedCount: Number(counts?.accepted_count || 0),
    teacherProposedCount: Number(counts?.proposed_count || 0),
  }
}

export async function saveSelectionDraft(topicId: string, actor: SessionUser, expectedVersion: number, items: DraftItemInput[]): Promise<SelectionDraftView> {
  await transaction(async conn => {
    const topic = await loadTopicContext(conn, topicId, true)
    assertWritable(topic, actor)
    const [batches] = await conn.query<any[]>('SELECT * FROM selection_batches WHERE cycle_id = ? AND topic_id = ? FOR UPDATE', [topic.cycle_id, topic.id])
    let batch = batches[0]
    if (!batch) {
      if (expectedVersion !== 0) throw new SelectionDraftError('草稿版本已变化，请刷新后重试', 409)
      batch = { id: uuidv4(), version: 0, status: 'draft' }
      await conn.query("INSERT INTO selection_batches (id, cycle_id, topic_id, status, version) VALUES (?, ?, ?, 'draft', 0)", [batch.id, topic.cycle_id, topic.id])
    }
    if (batch.status !== 'draft') throw new SelectionDraftError('名单已提交，需由管理员退回后才能修改', 409)
    if (Number(batch.version) !== Number(expectedVersion)) throw new SelectionDraftError('草稿已被其他页面更新，请刷新后重试', 409)
    const [existingRows] = await conn.query<any[]>('SELECT application_id, decision, decision_rank, comment FROM selection_draft_items WHERE batch_id = ?', [batch.id])
    const blocks = buildPriorityBlocks(withCurrentDraft(await loadPriorityCandidates(conn, Number(topic.cycle_id)), topic.id, items))
    const existingById = new Map(existingRows.map(row => [row.application_id, row]))
    const nextById = new Map(items.map(item => [item.applicationId, item]))
    for (const [applicationId] of blocks) {
      const existing = existingById.get(applicationId)
      const next = nextById.get(applicationId)
      if (String(existing?.decision || '') !== String(next?.decision || '') || Number(existing?.decision_rank || 0) !== Number(next?.decisionRank || 0) || String(existing?.comment || '') !== String(next?.comment || '')) {
        throw new SelectionDraftError('该学生已被更高志愿拟录取或候补，当前志愿结果暂停生效，不能修改', 409)
      }
    }
    await validateDraftCapacity(conn, topic, items)
    await conn.query('DELETE FROM selection_draft_items WHERE batch_id = ?', [batch.id])
    for (const item of items) {
      await conn.query(`
        INSERT INTO selection_draft_items (id, batch_id, application_id, decision, decision_rank, comment, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [uuidv4(), batch.id, item.applicationId, item.decision, item.decision === 'reject' ? null : item.decisionRank, item.comment || null, actor.id])
    }
    await conn.query('UPDATE selection_batches SET version = version + 1 WHERE id = ?', [batch.id])
    await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail)
      VALUES (?, 'selection_draft_saved', 'topic', ?, ?)`, [actor.id, topic.id, JSON.stringify({ version: expectedVersion + 1, itemCount: items.length })])
  })
  return getSelectionDraft(topicId, actor)
}

export async function submitSelectionBatch(topicId: string, actor: SessionUser, expectedVersion: number): Promise<SelectionDraftView> {
  const cycleId = await transaction(async conn => {
    const topic = await loadTopicContext(conn, topicId, true)
    assertWritable(topic, actor)
    const [batches] = await conn.query<any[]>('SELECT * FROM selection_batches WHERE cycle_id = ? AND topic_id = ? FOR UPDATE', [topic.cycle_id, topic.id])
    let batch = batches[0]
    if (!batch) {
      if (expectedVersion !== 0) throw new SelectionDraftError('草稿版本已变化，请刷新后重试', 409)
      batch = { id: uuidv4(), version: 0, status: 'draft' }
      await conn.query("INSERT INTO selection_batches (id, cycle_id, topic_id, status, version) VALUES (?, ?, ?, 'draft', 0)", [batch.id, topic.cycle_id, topic.id])
    }
    if (batch.status !== 'draft') throw new SelectionDraftError('该课题名单已经提交', 409)
    if (Number(batch.version) !== Number(expectedVersion)) throw new SelectionDraftError('草稿已被其他页面更新，请刷新后重试', 409)
    const [draftRows] = await conn.query<any[]>('SELECT application_id, decision, decision_rank, comment FROM selection_draft_items WHERE batch_id = ?', [batch.id])
    await validateDraftCapacity(conn, topic, draftRows.map(row => ({ applicationId: row.application_id, decision: row.decision, decisionRank: row.decision_rank, comment: row.comment })))
    await conn.query(`UPDATE selection_batches SET status = 'submitted', version = version + 1, submitted_by = ?, submitted_at = NOW() WHERE id = ?`, [actor.id, batch.id])
    await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail)
      VALUES (?, 'selection_batch_submitted', 'topic', ?, ?)`, [actor.id, topic.id, JSON.stringify({ version: expectedVersion + 1 })])
    return Number(topic.cycle_id)
  })
  let settlementWarning: string | undefined
  try {
    await requestSettlementIfReady(cycleId, 'all_submitted')
  } catch (cause) {
    console.error('名单已提交，但统一结算未完成:', cause)
    settlementWarning = '名单已提交，但统一结算暂未完成，请联系管理员检查结算状态。'
  }
  const view = await getSelectionDraft(topicId, actor)
  if (settlementWarning) view.settlementWarning = settlementWarning
  return view
}
