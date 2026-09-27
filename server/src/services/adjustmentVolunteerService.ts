import { v4 as uuidv4 } from 'uuid'
import { createHmac } from 'crypto'
import { query, transaction } from '../config/database.js'
import type { SessionUser } from '../utils/policies.js'
import { resolveJwtSecret } from '../utils/policies.js'
import { getActiveCycle } from '../utils/processFlow.js'

export class AdjustmentVolunteerError extends Error {
  constructor(message: string, public statusCode = 409) { super(message) }
}

export type AdjustmentVolunteerInput = { topicId: string; priority: number; motivation: string }

async function getAdjustmentCycle() {
  const cycle = await getActiveCycle()
  if (!cycle || cycle.phase !== 'adjustment') throw new AdjustmentVolunteerError('当前不在调剂补录阶段')
  return cycle
}

async function assertEligible(cycleId: number, studentId: string) {
  const [accepted, firstChoices] = await Promise.all([
    query<any>(`SELECT a.id FROM applications a JOIN topics t ON t.id = a.topic_id WHERE t.cycle_id = ? AND a.student_id = ? AND a.status = 'accepted' LIMIT 1`, [cycleId, studentId]),
    query<any>(`SELECT a.id FROM applications a JOIN topics t ON t.id = a.topic_id WHERE t.cycle_id = ? AND a.student_id = ? LIMIT 1`, [cycleId, studentId]),
  ])
  if (accepted.length) throw new AdjustmentVolunteerError('您已被录取，不能参加调剂补录')
  if (!firstChoices.length) throw new AdjustmentVolunteerError('尚无首次志愿记录，不能参加调剂补录')
}

function teacherGroupKey(teacherId: string) {
  return createHmac('sha256', resolveJwtSecret()).update(teacherId).digest('hex').slice(0, 24)
}

export async function getEligibleAdjustmentTopics(actor: SessionUser) {
  if (actor.role !== 'student') throw new AdjustmentVolunteerError('仅学生可查看调剂课题', 403)
  const cycle = await getAdjustmentCycle()
  await assertEligible(Number(cycle.id), actor.id)
  const [student] = await query<any>('SELECT major_code FROM users WHERE id = ?', [actor.id])
  if (!student?.major_code) throw new AdjustmentVolunteerError('未设置学生专业代码，不能参加调剂补录')
  const rows = await query<any>(`
    SELECT t.id, t.title, t.description, t.category, t.difficulty, t.max_students, t.tags, t.requirements, t.major, t.major_code, t.teacher_id,
           SUM(a.status = 'accepted') AS accepted_count
    FROM topics t LEFT JOIN applications a ON a.topic_id = t.id
    WHERE t.cycle_id = ? AND t.status = 'published' AND t.major_code = ?
    GROUP BY t.id HAVING accepted_count < t.max_students
    ORDER BY t.created_at DESC
  `, [cycle.id, student.major_code])
  return rows.map(row => ({
    id: row.id, title: row.title, description: row.description, category: row.category, difficulty: row.difficulty,
    maxStudents: Number(row.max_students), currentCount: Number(row.accepted_count || 0), tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []),
    requirements: row.requirements, major: row.major, majorCode: row.major_code, teacherGroupKey: teacherGroupKey(row.teacher_id),
  }))
}

export async function getMyAdjustmentVolunteers(actor: SessionUser) {
  if (actor.role !== 'student') throw new AdjustmentVolunteerError('仅学生可查看调剂志愿', 403)
  const cycle = await getAdjustmentCycle()
  await assertEligible(Number(cycle.id), actor.id)
  const rows = await query<any>(`
    SELECT av.*, t.title AS topic_title, t.category, t.max_students, t.teacher_id, ab.status AS batch_status,
           (SELECT COUNT(*) FROM adjustment_volunteers av2 WHERE av2.cycle_id = av.cycle_id AND av2.student_id = av.student_id) AS version
    FROM adjustment_volunteers av JOIN topics t ON t.id = av.topic_id
    LEFT JOIN adjustment_batches ab ON ab.cycle_id = av.cycle_id AND ab.topic_id = av.topic_id
    WHERE av.cycle_id = ? AND av.student_id = ? ORDER BY av.priority
  `, [cycle.id, actor.id])
  const frozen = rows.some(row => ['submitted', 'auto_submitted', 'settled'].includes(row.batch_status))
  return { cycleId: Number(cycle.id), version: Number(rows[0]?.version || 0), frozen, items: rows.map(row => ({
    id: row.id, topicId: row.topic_id, title: row.topic_title, category: row.category, priority: Number(row.priority), motivation: row.motivation,
    status: row.status, teacherGroupKey: teacherGroupKey(row.teacher_id), batchStatus: row.batch_status || 'draft',
  })) }
}

export async function saveMyAdjustmentVolunteers(actor: SessionUser, expectedVersion: number, items: AdjustmentVolunteerInput[]) {
  if (actor.role !== 'student') throw new AdjustmentVolunteerError('仅学生可提交调剂志愿', 403)
  const cycle = await getAdjustmentCycle()
  await transaction(async conn => {
    await assertEligible(Number(cycle.id), actor.id)
    if (!Array.isArray(items) || items.length < 3 || items.length > 6) throw new AdjustmentVolunteerError('调剂志愿须填写 3 至 6 个课题')
    const topicIds = items.map(item => String(item.topicId || ''))
    if (new Set(topicIds).size !== items.length || topicIds.some(id => !id)) throw new AdjustmentVolunteerError('调剂志愿不能重复')
    const priorities = items.map(item => Number(item.priority)).sort((a, b) => a - b)
    if (priorities.some((value, index) => !Number.isInteger(value) || value !== index + 1)) throw new AdjustmentVolunteerError('志愿序号必须从 1 开始连续')
    if (items.some(item => !String(item.motivation || '').trim())) throw new AdjustmentVolunteerError('请填写每个调剂志愿的申请理由')
    const [existing] = await conn.query<any[]>(`SELECT av.id, ab.status AS batch_status FROM adjustment_volunteers av LEFT JOIN adjustment_batches ab ON ab.cycle_id = av.cycle_id AND ab.topic_id = av.topic_id WHERE av.cycle_id = ? AND av.student_id = ? FOR UPDATE`, [cycle.id, actor.id])
    if (existing.some(row => ['submitted', 'auto_submitted', 'settled'].includes(row.batch_status))) throw new AdjustmentVolunteerError('涉及课题的教师名单已提交，调剂志愿不能再修改')
    if (Number(expectedVersion) !== existing.length) throw new AdjustmentVolunteerError('调剂志愿已被更新，请刷新后重试')
    const [studentRows] = await conn.query<any[]>('SELECT major_code FROM users WHERE id = ? FOR UPDATE', [actor.id])
    const [topics] = await conn.query<any[]>(`
      SELECT t.id, t.teacher_id, t.max_students, t.status, t.major_code, SUM(a.status = 'accepted') AS accepted_count
      FROM topics t LEFT JOIN applications a ON a.topic_id = t.id
      WHERE t.cycle_id = ? AND t.id IN (?) GROUP BY t.id FOR UPDATE
    `, [cycle.id, topicIds])
    if (topics.length !== items.length || topics.some(topic => topic.status !== 'published' || topic.major_code !== studentRows[0]?.major_code || Number(topic.accepted_count || 0) >= Number(topic.max_students))) {
      throw new AdjustmentVolunteerError('调剂志愿中存在不属于本专业、未发布或已满员的课题')
    }
    if (new Set(topics.map(topic => teacherGroupKey(topic.teacher_id))).size < 2) throw new AdjustmentVolunteerError('调剂志愿至少覆盖两位教师的课题')
    await conn.query('DELETE FROM adjustment_volunteers WHERE cycle_id = ? AND student_id = ?', [cycle.id, actor.id])
    for (const item of items) await conn.query(`INSERT INTO adjustment_volunteers (id, cycle_id, student_id, topic_id, priority, motivation) VALUES (?, ?, ?, ?, ?, ?)`, [uuidv4(), cycle.id, actor.id, item.topicId, item.priority, item.motivation.trim()])
  })
  return getMyAdjustmentVolunteers(actor)
}
