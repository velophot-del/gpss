import type { Connection } from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import { getConnection, query, transaction } from '../config/database.js'
import type { SessionUser } from '../utils/policies.js'
import { getTeacherStudentLimit } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'

export class AcceptedResultAdjustmentError extends Error {
  constructor(message: string, public statusCode = 409) { super(message) }
}

type AdjustmentApplication = {
  id: string
  studentId: string
  topicId: string
  cycleId: number
  priority: number
  status: string
}

type AdjustmentTopic = {
  id: string
  teacherId: string
  cycleId: number
  status: string
  maxStudents: number
  title?: string
  teacherName?: string
}

type AdjustmentPlanInput = {
  cycleId: number
  studentId: string
  currentApplicationId: string
  targetApplicationId: string | null
  reason: string
  selectionSettlementStatus: string | null
  adjustmentSettlementStatus: string | null
  teacherLimit: number
  applications: AdjustmentApplication[]
  topics: AdjustmentTopic[]
  acceptedByTopic: Record<string, number>
  acceptedByTeacher: Record<string, number>
}

export function buildAcceptedResultAdjustmentPlan(input: AdjustmentPlanInput) {
  const reason = String(input.reason || '').trim()
  if (!reason) throw new AcceptedResultAdjustmentError('请填写录取调整原因', 400)
  if (input.selectionSettlementStatus === 'running' || input.adjustmentSettlementStatus === 'running') {
    throw new AcceptedResultAdjustmentError('录取结算正在运行，请稍后重试')
  }

  const studentApplications = input.applications.filter(application =>
    application.studentId === input.studentId && Number(application.cycleId) === Number(input.cycleId),
  )
  const accepted = studentApplications.filter(application => application.status === 'accepted')
  if (accepted.length !== 1 || accepted[0].id !== input.currentApplicationId) {
    throw new AcceptedResultAdjustmentError('该生当前录取结果已变化，请刷新后重试')
  }
  const current = accepted[0]
  const currentTopic = input.topics.find(topic => topic.id === current.topicId)
  if (!currentTopic || Number(currentTopic.cycleId) !== Number(input.cycleId)) {
    throw new AcceptedResultAdjustmentError('当前录取课题不属于本周期')
  }

  let target: AdjustmentApplication | null = null
  let targetTopic: AdjustmentTopic | null = null
  if (input.targetApplicationId !== null) {
    target = studentApplications.find(application => application.id === input.targetApplicationId) || null
    if (!target || target.id === current.id || target.status === 'accepted' || target.status === 'cancelled') {
      throw new AcceptedResultAdjustmentError('目标志愿无效或已不属于该生本周期志愿')
    }
    targetTopic = input.topics.find(topic => topic.id === target!.topicId) || null
    if (!targetTopic || Number(targetTopic.cycleId) !== Number(input.cycleId)) {
      throw new AcceptedResultAdjustmentError('目标课题不属于本周期')
    }
    if (!['published', 'full'].includes(targetTopic.status)) {
      throw new AcceptedResultAdjustmentError('目标课题当前未开放录取')
    }
    const topicCount = Number(input.acceptedByTopic[targetTopic.id] || 0) - (current.topicId === targetTopic.id ? 1 : 0)
    if (topicCount >= Number(targetTopic.maxStudents)) {
      throw new AcceptedResultAdjustmentError('目标课题名额已满')
    }
    const teacherCount = Number(input.acceptedByTeacher[targetTopic.teacherId] || 0)
      - (currentTopic.teacherId === targetTopic.teacherId ? 1 : 0)
    if (input.teacherLimit > 0 && teacherCount >= input.teacherLimit) {
      throw new AcceptedResultAdjustmentError(`目标课题教师本周期指导学生已达上限（${input.teacherLimit}人）`)
    }
  }

  const deltas: Record<string, number> = { [current.topicId]: -1 }
  if (target) deltas[target.topicId] = (deltas[target.topicId] || 0) + 1
  const topicStatuses: Record<string, string> = {}
  for (const [topicId, delta] of Object.entries(deltas)) {
    const topic = input.topics.find(item => item.id === topicId)
    if (!topic || !['published', 'full'].includes(topic.status)) continue
    topicStatuses[topicId] = Number(input.acceptedByTopic[topicId] || 0) + delta >= Number(topic.maxStudents)
      ? 'full'
      : 'published'
  }

  const affectedTeacherIds = [...new Set([currentTopic.teacherId, ...(targetTopic ? [targetTopic.teacherId] : [])])].sort()
  return {
    cycleId: Number(input.cycleId),
    studentId: input.studentId,
    oldApplicationId: current.id,
    oldTopicId: current.topicId,
    oldTopicTitle: currentTopic.title || '',
    oldTeacherId: currentTopic.teacherId,
    oldTeacherName: currentTopic.teacherName || '',
    newApplicationId: target?.id || null,
    newTopicId: targetTopic?.id || null,
    newTopicTitle: targetTopic?.title || '',
    newTeacherId: targetTopic?.teacherId || null,
    newTeacherName: targetTopic?.teacherName || '',
    applicationUpdates: [
      { id: current.id, status: 'withdrawn' },
      ...(target ? [{ id: target.id, status: 'accepted' }] : []),
    ],
    topicStatuses,
    affectedTeacherIds,
  }
}

async function getActiveCycle(conn?: Connection) {
  const sql = `SELECT id, name, phase, phases_config FROM cycles
    WHERE status IN ('active','selection','review','adjustment') ORDER BY created_at DESC LIMIT 1`
  const [rows] = conn ? await conn.query<any[]>(sql) : [await query<any>(sql)]
  return rows[0] || null
}

async function loadSettlementStatuses(conn: Connection, cycleId: number, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : ''
  const [selection] = await conn.query<any[]>(`SELECT status FROM selection_settlements WHERE cycle_id = ?${suffix}`, [cycleId])
  const [adjustment] = await conn.query<any[]>(`SELECT status FROM adjustment_settlements WHERE cycle_id = ?${suffix}`, [cycleId])
  return { selection: selection[0]?.status || null, adjustment: adjustment[0]?.status || null }
}

async function readAcceptedResultRows(conn: Connection, studentId: string, cycleId: number, lock = false) {
  const [rows] = await conn.query<any[]>(`
    SELECT a.id, a.student_id, s.real_name AS student_name, a.topic_id, t.cycle_id, a.priority, a.status,
           t.teacher_id, t.status AS topic_status, t.max_students, t.title AS topic_title,
           u.real_name AS teacher_name
    FROM applications a JOIN topics t ON t.id = a.topic_id
    JOIN users s ON s.id = a.student_id
    JOIN users u ON u.id = t.teacher_id
    WHERE a.student_id = ? AND t.cycle_id = ?
    ORDER BY a.id${lock ? ' FOR UPDATE' : ''}
  `, [studentId, cycleId])
  return rows.map(row => ({
    id: String(row.id), studentId: String(row.student_id), topicId: String(row.topic_id),
    studentName: String(row.student_name || ''),
    cycleId: Number(row.cycle_id), priority: Number(row.priority), status: String(row.status),
    teacherId: String(row.teacher_id), topicStatus: String(row.topic_status),
    maxStudents: Number(row.max_students), topicTitle: String(row.topic_title || ''),
    teacherName: String(row.teacher_name || ''),
  }))
}

async function readTopicCounts(conn: Connection, cycleId: number, topicIds: string[], lock = false) {
  if (!topicIds.length) return { topics: [], byTopic: {}, byTeacher: {} }
  const [topics] = await conn.query<any[]>(
    `SELECT id, cycle_id, teacher_id, status, max_students, title FROM topics WHERE id IN (?) ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
    [topicIds],
  )
  const teacherIds = [...new Set(topics.map(topic => String(topic.teacher_id)))].sort()
  if (teacherIds.length) await conn.query(`SELECT id FROM users WHERE id IN (?) ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [teacherIds])
  const [topicCounts] = await conn.query<any[]>(`
    SELECT topic_id, COUNT(DISTINCT student_id) AS cnt FROM applications
    WHERE status = 'accepted' AND topic_id IN (?) GROUP BY topic_id
  `, [topicIds])
  const [teacherCounts] = await conn.query<any[]>(`
    SELECT t.teacher_id, COUNT(DISTINCT a.student_id) AS cnt
    FROM topics t JOIN applications a ON a.topic_id = t.id AND a.status = 'accepted'
    WHERE t.cycle_id = ? AND t.teacher_id IN (?) GROUP BY t.teacher_id
  `, [cycleId, teacherIds])
  return {
    topics,
    byTopic: Object.fromEntries(topicCounts.map(row => [String(row.topic_id), Number(row.cnt)])),
    byTeacher: Object.fromEntries(teacherCounts.map(row => [String(row.teacher_id), Number(row.cnt)])),
  }
}

function makePlanInput(cycle: any, applications: any[], topics: any[], counts: any, settlements: any, currentId: string, targetId: string | null, reason: string) {
  return {
    cycleId: Number(cycle.id), studentId: String(applications[0]?.studentId || ''),
    currentApplicationId: currentId, targetApplicationId: targetId, reason,
    selectionSettlementStatus: settlements.selection, adjustmentSettlementStatus: settlements.adjustment,
    teacherLimit: getTeacherStudentLimit(safeParseJson(cycle.phases_config, {})),
    applications: applications.map(({ id, studentId, topicId, cycleId, priority, status }) => ({ id, studentId, topicId, cycleId, priority, status })),
    topics: topics.map(topic => ({
      id: String(topic.id), teacherId: String(topic.teacher_id), cycleId: Number(topic.cycle_id),
      status: String(topic.status), maxStudents: Number(topic.max_students),
      title: String(topic.title || ''), teacherName: String(topic.teacher_name || ''),
    })),
    acceptedByTopic: counts.byTopic,
    acceptedByTeacher: counts.byTeacher,
  }
}

function activeCycleError() { return new AcceptedResultAdjustmentError('当前没有进行中的选题周期', 409) }

export async function getAcceptedResultAdjustmentOptions(actor: SessionUser, applicationId: string) {
  if (actor.role !== 'admin') throw new AcceptedResultAdjustmentError('只有管理员可以调整录取结果', 403)
  const cycle = await getActiveCycle()
  if (!cycle) throw activeCycleError()
  const currentRows = await query<any>(`
    SELECT a.student_id FROM applications a JOIN topics t ON t.id = a.topic_id
    WHERE a.id = ? AND a.status = 'accepted' AND t.cycle_id = ?
  `, [applicationId, cycle.id])
  if (!currentRows[0]) throw new AcceptedResultAdjustmentError('该录取不属于当前周期或已发生变化', 404)
  const studentId = String(currentRows[0].student_id)
  const conn = await getConnection()
  let applications: any[]
  let settlements: any
  let counts: any
  try {
    applications = await readAcceptedResultRows(conn, studentId, Number(cycle.id))
    settlements = await loadSettlementStatuses(conn, Number(cycle.id))
    const topicIds = [...new Set(applications.map(item => item.topicId))]
    counts = await readTopicCounts(conn, Number(cycle.id), topicIds)
  } finally { conn.release() }
  const current = applications.find(item => item.id === applicationId && item.status === 'accepted')
  if (!current) throw new AcceptedResultAdjustmentError('该生当前录取结果已变化，请刷新后重试')
  const topics = counts.topics.map((topic: any) => ({ ...topic, teacher_name: applications.find((item: any) => item.teacherId === String(topic.teacher_id))?.teacherName || '' }))
  const input = makePlanInput(cycle, applications, topics, counts, settlements, applicationId, null, '管理员核验可选课题')
  const limit = getTeacherStudentLimit(safeParseJson(cycle.phases_config, {}))
  const targets = applications.filter(item => item.id !== applicationId && item.status !== 'accepted' && item.status !== 'cancelled').map(item => {
    const topic = topics.find((row: any) => String(row.id) === item.topicId)
    try {
      buildAcceptedResultAdjustmentPlan({ ...input, targetApplicationId: item.id })
      return {
        applicationId: item.id, topicId: item.topicId, priority: item.priority,
        title: item.topicTitle, teacherName: item.teacherName,
        acceptedCount: counts.byTopic[item.topicId] || 0, topicLimit: Number(topic?.max_students || 0),
        teacherAcceptedCount: counts.byTeacher[item.teacherId] || 0, teacherLimit: limit, eligible: true, reason: null,
      }
    } catch (cause: any) {
      return {
        applicationId: item.id, topicId: item.topicId, priority: item.priority,
        title: item.topicTitle, teacherName: item.teacherName,
        acceptedCount: counts.byTopic[item.topicId] || 0, topicLimit: Number(topic?.max_students || 0),
        teacherAcceptedCount: counts.byTeacher[item.teacherId] || 0, teacherLimit: limit, eligible: false,
        reason: cause instanceof Error ? cause.message : '当前不可录取',
      }
    }
  })
  return {
    cycle: { id: Number(cycle.id), name: String(cycle.name || ''), phase: String(cycle.phase || '') },
    student: { id: studentId, name: current.studentName || null },
    current: {
      applicationId: current.id, topicId: current.topicId, priority: current.priority,
      title: current.topicTitle, teacherName: current.teacherName,
    },
    canCancel: settlements.selection !== 'running' && settlements.adjustment !== 'running',
    targets,
  }
}

async function insertNotice(conn: Connection, userId: string, title: string, content: string, cycleId: number) {
  await conn.query(`INSERT INTO notifications (id, user_id, type, title, content, related_type, related_id)
    VALUES (?, ?, 'accepted_result_adjusted', ?, ?, 'cycle', ?)`, [uuidv4(), userId, title, content, String(cycleId)])
}

export async function adjustAcceptedResult(
  actor: SessionUser,
  applicationId: string,
  targetApplicationId: string | null,
  reason: string,
  ipAddress: string | null,
) {
  if (actor.role !== 'admin') throw new AcceptedResultAdjustmentError('只有管理员可以调整录取结果', 403)
  if (typeof reason !== 'string' || !reason.trim()) throw new AcceptedResultAdjustmentError('请填写录取调整原因', 400)
  const lockConnection = await getConnection()
  const locks: string[] = []
  try {
    const cycle = await getActiveCycle(lockConnection)
    if (!cycle) throw activeCycleError()
    for (const lockName of [`gpss:selection-settlement:${cycle.id}`, `gpss:adjustment-settlement:${cycle.id}`]) {
      const [rows] = await lockConnection.query<any[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName])
      if (Number(rows[0]?.acquired) !== 1) throw new AcceptedResultAdjustmentError('录取结算正在运行，请稍后重试')
      locks.push(lockName)
    }
    return await transaction(async conn => {
      const [lockedCycleRows] = await conn.query<any[]>(`
        SELECT id, name, phase, phases_config FROM cycles
        WHERE id = ? AND status IN ('active','selection','review','adjustment') FOR UPDATE
      `, [cycle.id])
      const lockedCycle = lockedCycleRows[0]
      if (!lockedCycle) throw activeCycleError()
      const settlements = await loadSettlementStatuses(conn, Number(lockedCycle.id), true)
      if (settlements.selection === 'running' || settlements.adjustment === 'running') {
        throw new AcceptedResultAdjustmentError('录取结算正在运行，请稍后重试')
      }
      const [initial] = await conn.query<any[]>(`
        SELECT a.student_id FROM applications a JOIN topics t ON t.id = a.topic_id
        WHERE a.id = ? AND a.status = 'accepted' AND t.cycle_id = ?
      `, [applicationId, lockedCycle.id])
      if (!initial[0]) throw new AcceptedResultAdjustmentError('该录取不属于当前周期或已发生变化', 404)
      const studentId = String(initial[0].student_id)
      await conn.query("SELECT id FROM users WHERE id = ? AND role = 'student' FOR UPDATE", [studentId])
      const applications = await readAcceptedResultRows(conn, studentId, Number(lockedCycle.id), true)
      if (!applications.some(item => item.id === applicationId && item.status === 'accepted')) {
        throw new AcceptedResultAdjustmentError('该生当前录取结果已变化，请刷新后重试')
      }
      const topicIds = [...new Set(applications.map(item => item.topicId))].sort()
      const counts = await readTopicCounts(conn, Number(lockedCycle.id), topicIds, true)
      const topics = counts.topics.map(topic => {
        const teacherName = applications.find(item => item.teacherId === String(topic.teacher_id))?.teacherName || ''
        return { ...topic, teacher_name: teacherName }
      })
      const plan = buildAcceptedResultAdjustmentPlan(makePlanInput(
        lockedCycle, applications, topics, counts, settlements, applicationId, targetApplicationId, reason,
      ))

      for (const update of plan.applicationUpdates) {
        await conn.query(`UPDATE applications SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
          [update.status, actor.id, update.id])
      }
      const [adjustmentRows] = await conn.query<any[]>(`
        SELECT id, topic_id, status FROM adjustment_volunteers
        WHERE cycle_id = ? AND student_id = ? FOR UPDATE
      `, [plan.cycleId, studentId])
      if (adjustmentRows.some(row => String(row.topic_id) === plan.oldTopicId && ['submitted', 'accepted'].includes(String(row.status)))) {
        await conn.query(`UPDATE adjustment_volunteers SET status = 'withdrawn'
          WHERE cycle_id = ? AND student_id = ? AND topic_id = ? AND status IN ('submitted','accepted')`,
        [plan.cycleId, studentId, plan.oldTopicId])
      }
      if (plan.newTopicId && adjustmentRows.some(row => String(row.topic_id) === plan.newTopicId
        && ['submitted', 'withdrawn', 'rejected', 'accepted'].includes(String(row.status)))) {
        await conn.query(`UPDATE adjustment_volunteers SET status = 'accepted'
          WHERE cycle_id = ? AND student_id = ? AND topic_id = ? AND status IN ('submitted','withdrawn','rejected','accepted')`,
        [plan.cycleId, studentId, plan.newTopicId])
      }
      for (const [topicId, status] of Object.entries(plan.topicStatuses)) {
        await conn.query("UPDATE topics SET status = ? WHERE id = ? AND status IN ('published','full')", [status, topicId])
      }

      const oldTopic = topics.find(topic => String(topic.id) === plan.oldTopicId)
      const newTopic = plan.newTopicId ? topics.find(topic => String(topic.id) === plan.newTopicId) : null
      const logDetails = {
        cycleId: plan.cycleId, studentId,
        action: plan.newApplicationId ? 'transfer' : 'cancel', reason: reason.trim(),
        before: { applicationId: plan.oldApplicationId, topicId: plan.oldTopicId, topicTitle: plan.oldTopicTitle, status: 'accepted' },
        after: plan.newApplicationId ? { applicationId: plan.newApplicationId, topicId: plan.newTopicId, topicTitle: plan.newTopicTitle, status: 'accepted' } : null,
      }
      await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail, ip_address)
        VALUES (?, 'accepted_result_adjusted', 'student', ?, ?, ?)`,
      [actor.id, studentId, JSON.stringify(logDetails), ipAddress])
      const studentMessage = newTopic
        ? `管理员已将您的录取结果由「${plan.oldTopicTitle}」调整为「${plan.newTopicTitle}」。原因：${reason.trim()}`
        : `管理员已取消您在「${plan.oldTopicTitle}」的录取。原因：${reason.trim()}`
      await insertNotice(conn, studentId, '录取结果已调整', studentMessage, plan.cycleId)
      for (const teacherId of plan.affectedTeacherIds) {
        const isNewTeacher = teacherId === plan.newTeacherId
        const teacherTopic = isNewTeacher ? newTopic : oldTopic
        if (!teacherTopic) continue
        const content = plan.newApplicationId
          ? `管理员已调整学生录取结果：${plan.oldTopicTitle} → ${plan.newTopicTitle}。原因：${reason.trim()}`
          : `管理员已取消学生在「${plan.oldTopicTitle}」的录取。原因：${reason.trim()}`
        await insertNotice(conn, teacherId, '学生录取结果已调整', content, plan.cycleId)
      }
      return { cycleId: plan.cycleId, studentId, oldApplicationId: plan.oldApplicationId, newApplicationId: plan.newApplicationId }
    })
  } finally {
    for (const lockName of locks.reverse()) await lockConnection.query('SELECT RELEASE_LOCK(?)', [lockName])
    lockConnection.release()
  }
}
