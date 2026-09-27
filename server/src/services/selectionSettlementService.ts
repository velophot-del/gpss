import type { Connection } from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import { getConnection, query, transaction } from '../config/database.js'
import { getReviewDeadline, getTeacherStudentLimit } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'
import { buildSettlementPlan, type LockedAssignment, type SettlementCandidate, type SettlementTopic } from './selectionMatcher.js'

export type SettlementTrigger = 'all_submitted' | 'deadline' | 'admin_retry'
export type SettlementSummary = { accepted: number; rejected: number; withdrawn: number; unmatchedStudents: number; topicAcceptedCounts: Record<string, number> }
export type SettlementRunResult = { status: 'waiting' | 'running' | 'completed'; summary?: SettlementSummary; pendingTopics?: number }

export class SelectionSettlementError extends Error {
  constructor(message: string, public statusCode = 409) { super(message) }
}

export async function getSelectionConfigurationError(cycleId: number, config: unknown): Promise<string | null> {
  const deadline = getReviewDeadline(config)
  if (!deadline) return '教师遴选阶段必须配置有效的审核截止时间'
  const teacherLimit = getTeacherStudentLimit(config)
  if (teacherLimit <= 0) return null
  const conflicts = await query<any>(`
    SELECT t.teacher_id, u.real_name AS teacher_name, SUM(t.max_students) AS capacity
    FROM topics t JOIN users u ON u.id = t.teacher_id
    WHERE t.cycle_id = ? AND t.status IN ('published', 'full')
    GROUP BY t.teacher_id, u.real_name
    HAVING SUM(t.max_students) > ?
    ORDER BY u.real_name
  `, [cycleId, teacherLimit])
  if (!conflicts.length) return null
  return conflicts.map(row => `${row.teacher_name || row.teacher_id}：课题名额 ${row.capacity}，指导上限 ${teacherLimit}`).join('；')
}

async function countPendingTopics(cycleId: number): Promise<number> {
  const rows = await query<any>(`
    SELECT COUNT(*) AS cnt FROM (
      SELECT t.id
      FROM topics t JOIN applications a ON a.topic_id = t.id
      LEFT JOIN selection_batches sb ON sb.cycle_id = t.cycle_id AND sb.topic_id = t.id
      WHERE t.cycle_id = ? AND a.status IN ('pending','submitted','pending_review','waitlisted')
      GROUP BY t.id, sb.status
      HAVING sb.status IS NULL OR sb.status = 'draft'
    ) pending_topics
  `, [cycleId])
  return Number(rows[0]?.cnt || 0)
}

export async function requestSettlementIfReady(cycleId: number, trigger: SettlementTrigger): Promise<SettlementRunResult> {
  const [cycle] = await query<any>('SELECT id, phase, phases_config FROM cycles WHERE id = ?', [cycleId])
  if (!cycle) throw new SelectionSettlementError('选题周期不存在', 404)
  const config = safeParseJson<Record<string, any>>(cycle.phases_config, {})
  const configurationError = await getSelectionConfigurationError(cycleId, config)
  if (configurationError) throw new SelectionSettlementError(configurationError)
  const deadline = getReviewDeadline(config)!
  const pendingTopics = await countPendingTopics(cycleId)
  const deadlineReached = Date.now() >= deadline.getTime()
  if (pendingTopics > 0 && !deadlineReached) return { status: 'waiting', pendingTopics }
  return { status: 'completed', summary: await runSelectionSettlement(cycleId, deadlineReached ? 'deadline' : trigger) }
}

async function autoSubmitPendingBatches(conn: Connection, cycleId: number) {
  const [topics] = await conn.query<any[]>(`
    SELECT DISTINCT t.id FROM topics t JOIN applications a ON a.topic_id = t.id
    WHERE t.cycle_id = ? AND a.status IN ('pending','submitted','pending_review','waitlisted')
    ORDER BY t.id FOR UPDATE
  `, [cycleId])
  for (const topic of topics) {
    await conn.query(`
      INSERT INTO selection_batches (id, cycle_id, topic_id, status, auto_submitted_at)
      VALUES (?, ?, ?, 'auto_submitted', NOW())
      ON DUPLICATE KEY UPDATE
        auto_submitted_at = IF(status = 'draft', NOW(), auto_submitted_at),
        version = IF(status = 'draft', version + 1, version),
        status = IF(status = 'draft', 'auto_submitted', status)
    `, [uuidv4(), cycleId, topic.id])
  }
  if (topics.length) {
    await conn.query(`INSERT INTO operation_logs (action, target_type, target_id, detail)
      VALUES ('selection_batches_auto_submitted', 'cycle', ?, ?)`, [String(cycleId), JSON.stringify({ topicCount: topics.length })])
  }
}

async function updateApplications(conn: Connection, ids: string[], status: 'accepted' | 'withdrawn' | 'rejected') {
  if (!ids.length) return
  const comment = status === 'rejected' ? '统一录取结算未匹配' : null
  await conn.query(
    'UPDATE applications SET status = ?, teacher_comment = COALESCE(?, teacher_comment), reviewed_at = NOW() WHERE id IN (?)',
    [status, comment, ids],
  )
}

async function insertNotification(conn: Connection, userId: string, type: string, title: string, content: string, cycleId: number) {
  await conn.query(`
    INSERT INTO notifications (id, user_id, type, title, content, related_type, related_id)
    VALUES (?, ?, ?, ?, ?, 'cycle', ?)
  `, [uuidv4(), userId, type, title, content, String(cycleId)])
}

async function applySettlement(conn: Connection, cycleId: number, trigger: SettlementTrigger): Promise<SettlementSummary> {
  const [cycles] = await conn.query<any[]>('SELECT id, phase, phases_config FROM cycles WHERE id = ? FOR UPDATE', [cycleId])
  const cycle = cycles[0]
  if (!cycle) throw new SelectionSettlementError('选题周期不存在', 404)
  if (cycle.phase !== 'teacher_review') throw new SelectionSettlementError('当前周期不在教师遴选阶段')
  const config = safeParseJson<Record<string, any>>(cycle.phases_config, {})
  const deadline = getReviewDeadline(config)
  if (trigger === 'deadline' || (deadline && Date.now() >= deadline.getTime())) await autoSubmitPendingBatches(conn, cycleId)

  const [unsubmitted] = await conn.query<any[]>(`
    SELECT DISTINCT t.id FROM topics t JOIN applications a ON a.topic_id = t.id
    LEFT JOIN selection_batches sb ON sb.cycle_id = t.cycle_id AND sb.topic_id = t.id
    WHERE t.cycle_id = ? AND a.status IN ('pending','submitted','pending_review','waitlisted')
      AND (sb.status IS NULL OR sb.status = 'draft') LIMIT 1
  `, [cycleId])
  if (unsubmitted.length) throw new SelectionSettlementError('仍有课题名单未提交，暂不能统一结算')

  const [topicRows] = await conn.query<any[]>(`
    SELECT DISTINCT t.id, t.teacher_id, t.max_students, t.status
    FROM topics t JOIN applications a ON a.topic_id = t.id
    WHERE t.cycle_id = ? ORDER BY t.id FOR UPDATE
  `, [cycleId])
  const invalidTopics = topicRows.filter(row => !['published', 'full'].includes(row.status))
  if (invalidTopics.length) {
    throw new SelectionSettlementError(`存在 ${invalidTopics.length} 个未开放课题仍有申请，无法统一结算`)
  }
  const topics: SettlementTopic[] = topicRows.map(row => ({ topicId: row.id, teacherId: row.teacher_id, capacity: Number(row.max_students) }))
  const teacherLimit = getTeacherStudentLimit(config)
  if (teacherLimit > 0) {
    const capacityByTeacher = new Map<string, number>()
    for (const topic of topics) capacityByTeacher.set(topic.teacherId, (capacityByTeacher.get(topic.teacherId) || 0) + topic.capacity)
    for (const [teacherId, capacity] of capacityByTeacher) {
      if (capacity > teacherLimit) throw new SelectionSettlementError(`教师 ${teacherId} 的课题名额 ${capacity} 人，超过指导上限 ${teacherLimit} 人`)
    }
  }

  const [lockedRows] = await conn.query<any[]>(`
    SELECT a.id, a.student_id, a.topic_id, t.teacher_id
    FROM applications a JOIN topics t ON t.id = a.topic_id
    WHERE t.cycle_id = ? AND a.status = 'accepted' ORDER BY a.id FOR UPDATE
  `, [cycleId])
  const lockedAssignments: LockedAssignment[] = lockedRows.map(row => ({ applicationId: row.id, studentId: row.student_id, topicId: row.topic_id, teacherId: row.teacher_id }))

  const [candidateRows] = await conn.query<any[]>(`
    SELECT a.id, a.student_id, a.topic_id, a.priority, a.created_at, t.teacher_id,
           sdi.decision, sdi.decision_rank
    FROM applications a
    JOIN topics t ON t.id = a.topic_id
    LEFT JOIN selection_batches sb ON sb.cycle_id = t.cycle_id AND sb.topic_id = t.id
    LEFT JOIN selection_draft_items sdi ON sdi.batch_id = sb.id AND sdi.application_id = a.id
    WHERE t.cycle_id = ? AND a.status IN ('pending','submitted','pending_review','waitlisted')
    ORDER BY a.id FOR UPDATE
  `, [cycleId])
  const candidates: SettlementCandidate[] = candidateRows.map(row => ({
    applicationId: row.id, studentId: row.student_id, topicId: row.topic_id, teacherId: row.teacher_id,
    priority: Number(row.priority), decision: row.decision || null,
    decisionRank: row.decision_rank == null ? null : Number(row.decision_rank), appliedAt: new Date(row.created_at).toISOString(),
  }))
  const plan = buildSettlementPlan({ candidates, topics, lockedAssignments, teacherLimit })
  await updateApplications(conn, plan.acceptedApplicationIds, 'accepted')
  await updateApplications(conn, plan.withdrawnApplicationIds, 'withdrawn')
  await updateApplications(conn, plan.rejectedApplicationIds, 'rejected')

  for (const topic of topics) {
    const status = (plan.topicAcceptedCounts[topic.topicId] || 0) >= topic.capacity ? 'full' : 'published'
    await conn.query("UPDATE topics SET status = ? WHERE id = ? AND status IN ('published','full')", [status, topic.topicId])
  }

  const acceptedByStudent = new Map(candidates.filter(item => plan.acceptedApplicationIds.includes(item.applicationId)).map(item => [item.studentId, item]))
  const allStudentIds = [...new Set(candidates.map(item => item.studentId))]
  for (const studentId of allStudentIds) {
    const accepted = acceptedByStudent.get(studentId)
    if (accepted) await insertNotification(conn, studentId, 'selection_accepted', '统一录取已完成', `您已被第 ${accepted.priority} 志愿录取，请到选课结果页查看。`, cycleId)
    else if (plan.unmatchedStudentIds.includes(studentId)) await insertNotification(conn, studentId, 'selection_unmatched', '统一录取已完成', '本轮志愿暂未录取，请关注调剂安排。', cycleId)
  }
  const teacherIds = [...new Set(topics.map(topic => topic.teacherId))]
  for (const teacherId of teacherIds) {
    const acceptedCount = topics.filter(topic => topic.teacherId === teacherId).reduce((sum, topic) => sum + (plan.topicAcceptedCounts[topic.topicId] || 0), 0)
    await insertNotification(conn, teacherId, 'selection_settled', '选题统一录取已完成', `您的课题本轮共录取 ${acceptedCount} 名学生。`, cycleId)
  }

  const summary: SettlementSummary = {
    accepted: plan.acceptedApplicationIds.length,
    rejected: plan.rejectedApplicationIds.length,
    withdrawn: plan.withdrawnApplicationIds.length,
    unmatchedStudents: plan.unmatchedStudentIds.length,
    topicAcceptedCounts: plan.topicAcceptedCounts,
  }
  await conn.query("UPDATE selection_batches SET status = 'settled', settled_at = NOW() WHERE cycle_id = ?", [cycleId])
  await conn.query(`INSERT INTO operation_logs (action, target_type, target_id, detail)
    VALUES ('selection_settled', 'cycle', ?, ?)`, [String(cycleId), JSON.stringify({ trigger, ...summary })])
  await conn.query(`UPDATE selection_settlements SET status = 'completed', result_json = ?, error_message = NULL, completed_at = NOW() WHERE cycle_id = ?`, [JSON.stringify(summary), cycleId])
  return summary
}

export async function runSelectionSettlement(cycleId: number, trigger: SettlementTrigger): Promise<SettlementSummary> {
  const lockConnection = await getConnection()
  const lockName = `gpss:selection-settlement:${cycleId}`
  let acquired = false
  try {
    const [lockRows] = await lockConnection.query<any[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName])
    acquired = Number(lockRows[0]?.acquired) === 1
    if (!acquired) throw new SelectionSettlementError('统一录取正在执行，请稍后刷新')

    const [existing] = await lockConnection.query<any[]>('SELECT status, result_json FROM selection_settlements WHERE cycle_id = ?', [cycleId])
    if (existing[0]?.status === 'completed') return safeParseJson<SettlementSummary>(existing[0].result_json, { accepted: 0, rejected: 0, withdrawn: 0, unmatchedStudents: 0, topicAcceptedCounts: {} })
    await lockConnection.query(`
      INSERT INTO selection_settlements (id, cycle_id, status, trigger_type, started_at)
      VALUES (?, ?, 'running', ?, NOW())
      ON DUPLICATE KEY UPDATE status = 'running', trigger_type = VALUES(trigger_type), error_message = NULL, started_at = NOW(), completed_at = NULL
    `, [uuidv4(), cycleId, trigger])

    try {
      return await transaction(conn => applySettlement(conn, cycleId, trigger))
    } catch (cause: any) {
      await lockConnection.query("UPDATE selection_settlements SET status = 'failed', error_message = ?, completed_at = NOW() WHERE cycle_id = ?", [String(cause?.message || cause).slice(0, 4000), cycleId])
      throw cause
    }
  } finally {
    if (acquired) await lockConnection.query('SELECT RELEASE_LOCK(?)', [lockName])
    lockConnection.release()
  }
}
