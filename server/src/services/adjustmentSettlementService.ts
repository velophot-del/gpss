import type { Connection } from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import { getConnection, query, transaction } from '../config/database.js'
import { safeParseJson } from '../utils/json.js'
import { getAdjustmentDeadline, getTeacherStudentLimit } from '../utils/policies.js'
import { buildSettlementPlan, type LockedAssignment, type SettlementCandidate, type SettlementTopic } from './selectionMatcher.js'

export type AdjustmentSettlementTrigger = 'all_submitted' | 'deadline' | 'admin_retry'
export type AdjustmentSettlementSummary = { accepted: number; rejected: number; withdrawn: number; unmatchedStudents: number; topicAcceptedCounts: Record<string, number> }
export type AdjustmentSettlementResult = { status: 'waiting' | 'completed'; summary?: AdjustmentSettlementSummary; pendingTopics?: number }

export class AdjustmentSettlementError extends Error {
  constructor(message: string, public statusCode = 409) { super(message) }
}

async function cycleData(cycleId: number) {
  const [rows] = await query<any>('SELECT id, phase, phases_config FROM cycles WHERE id = ?', [cycleId])
  if (!rows) throw new AdjustmentSettlementError('选题周期不存在', 404)
  if (rows.phase !== 'adjustment') throw new AdjustmentSettlementError('当前周期不在调剂补录阶段')
  const config = safeParseJson<Record<string, any>>(rows.phases_config, {})
  const deadline = getAdjustmentDeadline(config)
  if (!deadline) throw new AdjustmentSettlementError('调剂补录阶段未配置有效截止时间')
  return { cycle: rows, config, deadline }
}

async function countProgress(cycleId: number) {
  const rows = await query<any>(`
    SELECT COUNT(*) AS required_topics,
      SUM(CASE WHEN b.status IN ('submitted','auto_submitted','settled') THEN 0 ELSE 1 END) AS pending_topics
    FROM (SELECT DISTINCT topic_id FROM adjustment_volunteers WHERE cycle_id = ? AND status = 'submitted') v
    LEFT JOIN adjustment_batches b ON b.cycle_id = ? AND b.topic_id = v.topic_id
  `, [cycleId, cycleId])
  return { requiredTopics: Number(rows[0]?.required_topics || 0), pendingTopics: Number(rows[0]?.pending_topics || 0) }
}

export async function requestAdjustmentSettlementIfReady(cycleId: number, trigger: AdjustmentSettlementTrigger): Promise<AdjustmentSettlementResult> {
  const { deadline } = await cycleData(cycleId)
  const progress = await countProgress(cycleId)
  const deadlineReached = Date.now() >= deadline.getTime()
  if (!deadlineReached && (progress.requiredTopics === 0 || progress.pendingTopics > 0)) {
    return { status: 'waiting', pendingTopics: progress.pendingTopics }
  }
  return { status: 'completed', summary: await runAdjustmentSettlement(cycleId, deadlineReached ? 'deadline' : trigger) }
}

async function autoSubmitDrafts(conn: Connection, cycleId: number) {
  const [topics] = await conn.query<any[]>(`
    SELECT DISTINCT t.id FROM topics t JOIN adjustment_volunteers av ON av.topic_id = t.id
    WHERE av.cycle_id = ? AND av.status = 'submitted' ORDER BY t.id FOR UPDATE
  `, [cycleId])
  for (const topic of topics) {
    await conn.query(`INSERT INTO adjustment_batches (id, cycle_id, topic_id, status, auto_submitted_at)
      VALUES (?, ?, ?, 'auto_submitted', NOW())
      ON DUPLICATE KEY UPDATE
        auto_submitted_at = IF(status = 'draft', NOW(), auto_submitted_at),
        version = IF(status = 'draft', version + 1, version),
        status = IF(status = 'draft', 'auto_submitted', status)`, [uuidv4(), cycleId, topic.id])
  }
  if (topics.length) {
    await conn.query(`INSERT INTO operation_logs (action, target_type, target_id, detail)
      VALUES ('adjustment_batches_auto_submitted', 'cycle', ?, ?)`, [String(cycleId), JSON.stringify({ topicCount: topics.length })])
  }
}

async function notifyStudent(conn: Connection, userId: string, title: string, content: string, cycleId: number) {
  await conn.query(`INSERT INTO notifications (id, user_id, type, title, content, related_type, related_id)
    VALUES (?, ?, 'adjustment_result', ?, ?, 'cycle', ?)`, [uuidv4(), userId, title, content, String(cycleId)])
}

async function applySettlement(conn: Connection, cycleId: number, trigger: AdjustmentSettlementTrigger): Promise<AdjustmentSettlementSummary> {
  const [cycleRows] = await conn.query<any[]>('SELECT id, phase, phases_config FROM cycles WHERE id = ? FOR UPDATE', [cycleId])
  const cycle = cycleRows[0]
  if (!cycle || cycle.phase !== 'adjustment') throw new AdjustmentSettlementError('当前周期不在调剂补录阶段')
  const config = safeParseJson<Record<string, any>>(cycle.phases_config, {})
  const deadline = getAdjustmentDeadline(config)
  if (!deadline) throw new AdjustmentSettlementError('调剂补录阶段未配置有效截止时间')
  if (trigger === 'deadline' || Date.now() >= deadline.getTime()) await autoSubmitDrafts(conn, cycleId)

  const [pending] = await conn.query<any[]>(`
    SELECT DISTINCT av.topic_id FROM adjustment_volunteers av
    LEFT JOIN adjustment_batches b ON b.cycle_id = av.cycle_id AND b.topic_id = av.topic_id
    WHERE av.cycle_id = ? AND av.status = 'submitted'
      AND (b.status IS NULL OR b.status = 'draft') LIMIT 1 FOR UPDATE
  `, [cycleId])
  if (pending.length) throw new AdjustmentSettlementError('仍有课题名单未提交，暂不能统一结算')

  const [topicRows] = await conn.query<any[]>(`
    SELECT t.id, t.title, t.teacher_id, t.max_students, t.status
    FROM topics t WHERE t.cycle_id = ? AND (t.status IN ('published','full') OR EXISTS (
      SELECT 1 FROM applications a WHERE a.topic_id = t.id AND a.status = 'accepted'
    ))
    ORDER BY t.id FOR UPDATE
  `, [cycleId])
  const topics: SettlementTopic[] = topicRows.map(row => ({ topicId: row.id, teacherId: row.teacher_id, capacity: Number(row.max_students) }))
  const [acceptedRows] = await conn.query<any[]>(`
    SELECT a.id, a.student_id, a.topic_id, t.teacher_id
    FROM applications a JOIN topics t ON t.id = a.topic_id
    WHERE t.cycle_id = ? AND a.status = 'accepted' ORDER BY a.id FOR UPDATE
  `, [cycleId])
  const lockedAssignments: LockedAssignment[] = acceptedRows.map(row => ({ applicationId: row.id, studentId: row.student_id, topicId: row.topic_id, teacherId: row.teacher_id }))
  const [volunteerRows] = await conn.query<any[]>(`
    SELECT av.id, av.student_id, av.topic_id, av.priority, av.created_at, t.teacher_id,
           di.decision, di.decision_rank
    FROM adjustment_volunteers av JOIN topics t ON t.id = av.topic_id
    LEFT JOIN adjustment_batches b ON b.cycle_id = av.cycle_id AND b.topic_id = av.topic_id
    LEFT JOIN adjustment_draft_items di ON di.batch_id = b.id AND di.volunteer_id = av.id
    WHERE av.cycle_id = ? AND av.status = 'submitted'
    ORDER BY av.id FOR UPDATE
  `, [cycleId])
  const candidates: SettlementCandidate[] = volunteerRows.map(row => ({
    applicationId: row.id, studentId: row.student_id, topicId: row.topic_id, teacherId: row.teacher_id,
    priority: Number(row.priority), decision: row.decision || null,
    decisionRank: row.decision_rank == null ? null : Number(row.decision_rank), appliedAt: new Date(row.created_at).toISOString(),
  }))
  const plan = buildSettlementPlan({ candidates, topics, lockedAssignments, teacherLimit: getTeacherStudentLimit(config) })

  if (plan.acceptedApplicationIds.length) {
    const acceptedIds = plan.acceptedApplicationIds
    for (const volunteerId of acceptedIds) {
      const candidate = candidates.find(item => item.applicationId === volunteerId)!
        await conn.query(`INSERT INTO applications (id, student_id, topic_id, priority, status, motivation, teacher_comment, reviewed_by, reviewed_at)
        VALUES (?, ?, ?, ?, 'accepted', '', '调剂统一结算录取', NULL, NOW())
        ON DUPLICATE KEY UPDATE status = 'accepted', teacher_comment = '调剂统一结算录取', reviewed_by = NULL, reviewed_at = NOW()`,
      [uuidv4(), candidate.studentId, candidate.topicId, candidate.priority])
    }
  }
  if (plan.acceptedApplicationIds.length) await conn.query("UPDATE adjustment_volunteers SET status = 'accepted' WHERE id IN (?)", [plan.acceptedApplicationIds])
  if (plan.withdrawnApplicationIds.length) await conn.query("UPDATE adjustment_volunteers SET status = 'withdrawn' WHERE id IN (?)", [plan.withdrawnApplicationIds])
  if (plan.rejectedApplicationIds.length) await conn.query("UPDATE adjustment_volunteers SET status = 'rejected' WHERE id IN (?)", [plan.rejectedApplicationIds])

  for (const topic of topics) {
    const acceptedCount = plan.topicAcceptedCounts[topic.topicId] || 0
    await conn.query("UPDATE topics SET status = ? WHERE id = ? AND status IN ('published','full')", [acceptedCount >= topic.capacity ? 'full' : 'published', topic.topicId])
  }
  const acceptedByStudent = new Map(candidates.filter(item => plan.acceptedApplicationIds.includes(item.applicationId)).map(item => [item.studentId, item]))
  for (const studentId of [...new Set(candidates.map(item => item.studentId))]) {
    const accepted = acceptedByStudent.get(studentId)
    if (accepted) {
      const topicTitle = topicRows.find(topic => topic.id === accepted.topicId)?.title
      await notifyStudent(conn, studentId, '调剂结果已公布', `您已通过调剂录取至「${topicTitle || '课题'}」，请查看选题结果。`, cycleId)
    } else if (plan.unmatchedStudentIds.includes(studentId)) {
      await notifyStudent(conn, studentId, '调剂结果已公布', '本轮调剂暂未匹配成功，请关注后续安排。', cycleId)
    }
  }
  const teacherIds = [...new Set(topics.map(topic => topic.teacherId))]
  for (const teacherId of teacherIds) {
    const acceptedCount = candidates.filter(item => item.teacherId === teacherId && plan.acceptedApplicationIds.includes(item.applicationId)).length
    await conn.query(`INSERT INTO notifications (id, user_id, type, title, content, related_type, related_id)
      VALUES (?, ?, 'adjustment_settlement', '调剂统一结算已完成', ?, 'cycle', ?)`,
    [uuidv4(), teacherId, `您的课题本轮调剂录取 ${acceptedCount} 名学生。`, String(cycleId)])
  }

  const summary: AdjustmentSettlementSummary = {
    accepted: plan.acceptedApplicationIds.length, rejected: plan.rejectedApplicationIds.length,
    withdrawn: plan.withdrawnApplicationIds.length, unmatchedStudents: plan.unmatchedStudentIds.length,
    topicAcceptedCounts: plan.topicAcceptedCounts,
  }
  await conn.query("UPDATE adjustment_batches SET status = 'settled', settled_at = NOW() WHERE cycle_id = ?", [cycleId])
  await conn.query(`INSERT INTO operation_logs (action, target_type, target_id, detail)
    VALUES ('adjustment_settled', 'cycle', ?, ?)`, [String(cycleId), JSON.stringify({ trigger, ...summary })])
  await conn.query(`UPDATE adjustment_settlements SET status = 'completed', result_json = ?, error_message = NULL, completed_at = NOW() WHERE cycle_id = ?`, [JSON.stringify(summary), cycleId])
  return summary
}

export async function runAdjustmentSettlement(cycleId: number, trigger: AdjustmentSettlementTrigger): Promise<AdjustmentSettlementSummary> {
  const lockConnection = await getConnection()
  const lockName = `gpss:adjustment-settlement:${cycleId}`
  let acquired = false
  try {
    const [lockRows] = await lockConnection.query<any[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName])
    acquired = Number(lockRows[0]?.acquired) === 1
    if (!acquired) throw new AdjustmentSettlementError('调剂统一结算正在执行，请稍后刷新')
    const [existing] = await lockConnection.query<any[]>('SELECT status, result_json FROM adjustment_settlements WHERE cycle_id = ?', [cycleId])
    if (existing[0]?.status === 'completed') return safeParseJson<AdjustmentSettlementSummary>(existing[0].result_json, { accepted: 0, rejected: 0, withdrawn: 0, unmatchedStudents: 0, topicAcceptedCounts: {} })
    await lockConnection.query(`INSERT INTO adjustment_settlements (id, cycle_id, status, trigger_type, started_at)
      VALUES (?, ?, 'running', ?, NOW())
      ON DUPLICATE KEY UPDATE status = 'running', trigger_type = VALUES(trigger_type), error_message = NULL, started_at = NOW(), completed_at = NULL`,
    [uuidv4(), cycleId, trigger])
    try { return await transaction(conn => applySettlement(conn, cycleId, trigger)) }
    catch (cause: any) {
      await lockConnection.query("UPDATE adjustment_settlements SET status = 'failed', error_message = ?, completed_at = NOW() WHERE cycle_id = ?", [String(cause?.message || cause).slice(0, 4000), cycleId])
      throw cause
    }
  } finally {
    if (acquired) await lockConnection.query('SELECT RELEASE_LOCK(?)', [lockName])
    lockConnection.release()
  }
}
