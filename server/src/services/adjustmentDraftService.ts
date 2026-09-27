import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import type { SessionUser } from '../utils/policies.js'
import { getAdjustmentDeadline, getTeacherStudentLimit } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'
import { AdjustmentVolunteerError } from './adjustmentVolunteerService.js'
import { requestAdjustmentSettlementIfReady } from './adjustmentSettlementService.js'

export type AdjustmentDraftItemInput = { volunteerId: string; decision: 'proposed' | 'reserve' | 'reject'; decisionRank?: number | null; comment?: string }

async function context(topicId: string, actor: SessionUser, lock = false) {
  const rows = await query<any>(`SELECT t.*, c.phase, c.phases_config FROM topics t JOIN cycles c ON c.id=t.cycle_id WHERE t.id=? ${lock ? 'FOR UPDATE' : ''}`, [topicId])
  const topic = rows[0]
  if (!topic) throw new AdjustmentVolunteerError('课题不存在', 404)
  if (actor.role !== 'teacher' || topic.teacher_id !== actor.id) throw new AdjustmentVolunteerError('仅课题教师可处理调剂遴选', 403)
  if (topic.phase !== 'adjustment') throw new AdjustmentVolunteerError('当前不在调剂补录阶段')
  if (topic.status !== 'published') throw new AdjustmentVolunteerError('课题未开放或已满员')
  const deadline = getAdjustmentDeadline(safeParseJson(topic.phases_config, {}))
  if (!deadline) throw new AdjustmentVolunteerError('当前周期未配置调剂截止时间')
  if (Date.now() >= deadline.getTime()) throw new AdjustmentVolunteerError('调剂补录已截止，名单将由系统自动提交')
  return topic
}
function validate(items: AdjustmentDraftItemInput[]) {
  const ids = new Set<string>()
  for (const item of items) { if (!item.volunteerId || ids.has(item.volunteerId)) throw new AdjustmentVolunteerError('草稿中存在重复调剂志愿'); ids.add(item.volunteerId) }
  for (const type of ['proposed', 'reserve'] as const) {
    const ranks = items.filter(item => item.decision === type).map(item => Number(item.decisionRank)).sort((a,b) => a-b)
    if (ranks.some((rank, index) => !Number.isInteger(rank) || rank !== index + 1)) throw new AdjustmentVolunteerError(`${type === 'proposed' ? '拟录取' : '候补'}顺序必须从 1 开始且连续`)
  }
}
export async function getAdjustmentDraft(topicId: string, actor: SessionUser) {
  const topic = await context(topicId, actor)
  const batches = await query<any>('SELECT * FROM adjustment_batches WHERE cycle_id=? AND topic_id=?', [topic.cycle_id, topic.id])
  const batch = batches[0]
  const applicants = await query<any>(`SELECT av.id, av.student_id, av.priority, av.motivation, av.created_at, u.real_name, u.student_id AS student_code, u.class_name, u.major, sp.skills, sp.interests, sp.self_intro, adi.decision, adi.decision_rank, adi.comment FROM adjustment_volunteers av JOIN users u ON u.id=av.student_id LEFT JOIN student_profiles sp ON sp.user_id=av.student_id LEFT JOIN adjustment_draft_items adi ON adi.volunteer_id=av.id AND adi.batch_id=? WHERE av.topic_id=? AND av.status='submitted' ORDER BY av.priority,av.created_at`, [batch?.id || '', topic.id])
  const tags = safeParseJson<string[]>(topic.tags, [])
  return { topic: { id: topic.id, title: topic.title, maxStudents: Number(topic.max_students) }, batch: { id: batch?.id || null, status: batch?.status || 'draft', version: Number(batch?.version || 0) }, applicants: applicants.map(row => {
    const skills = safeParseJson<string[]>(row.skills, []), interests = safeParseJson<string[]>(row.interests, [])
    const skillMatches = skills.filter(skill => tags.includes(skill)), interestMatches = interests.filter(interest => interest === topic.category)
    return { id: row.id, studentId: row.student_id, studentName: row.real_name, studentCode: row.student_code, className: row.class_name, major: row.major, priority: Number(row.priority), motivation: row.motivation, selfIntro: row.self_intro || '', skills, interests, decision: row.decision || null, decisionRank: row.decision_rank == null ? null : Number(row.decision_rank), comment: row.comment || '', match: { skillMatches, interestMatches, score: skillMatches.length * 2 + interestMatches.length } }
  }) }
}
export async function saveAdjustmentDraft(topicId: string, actor: SessionUser, version: number, items: AdjustmentDraftItemInput[]) {
  await transaction(async conn => {
    const topic = await context(topicId, actor, true); validate(items)
    const [rows] = await conn.query<any[]>('SELECT * FROM adjustment_batches WHERE cycle_id=? AND topic_id=? FOR UPDATE', [topic.cycle_id, topic.id])
    let batch = rows[0]
    if (!batch) { if (version !== 0) throw new AdjustmentVolunteerError('草稿版本已变化，请刷新'); batch = { id: uuidv4(), version: 0, status: 'draft' }; await conn.query(`INSERT INTO adjustment_batches (id,cycle_id,topic_id) VALUES (?,?,?)`, [batch.id,topic.cycle_id,topic.id]) }
    if (batch.status !== 'draft' || Number(batch.version) !== version) throw new AdjustmentVolunteerError('名单已提交或草稿已变化，请刷新')
    const [volunteers] = await conn.query<any[]>('SELECT id FROM adjustment_volunteers WHERE topic_id=? AND id IN (?) AND status="submitted"', [topic.id, items.map(item => item.volunteerId)])
    if (volunteers.length !== items.length) throw new AdjustmentVolunteerError('草稿含无效调剂志愿')
    const proposed = items.filter(item => item.decision === 'proposed').length
    const [accepted] = await conn.query<any[]>('SELECT COUNT(*) cnt FROM applications WHERE topic_id=? AND status="accepted"', [topic.id])
    if (Number(accepted[0]?.cnt || 0) + proposed > Number(topic.max_students)) throw new AdjustmentVolunteerError('拟录取人数超过课题剩余名额')
    const limit = getTeacherStudentLimit(safeParseJson(topic.phases_config, {}))
    if (limit > 0) {
      const [counts] = await conn.query<any[]>(`SELECT
        (SELECT COUNT(DISTINCT a.student_id) FROM applications a JOIN topics t ON t.id=a.topic_id WHERE t.cycle_id=? AND t.teacher_id=? AND a.status='accepted') accepted_count,
        (SELECT COUNT(*) FROM adjustment_draft_items adi JOIN adjustment_batches ab ON ab.id=adi.batch_id JOIN topics t ON t.id=ab.topic_id WHERE ab.cycle_id=? AND t.teacher_id=? AND adi.decision='proposed' AND ab.id<>?) other_proposed`, [topic.cycle_id, topic.teacher_id, topic.cycle_id, topic.teacher_id, batch.id])
      if (Number(counts[0]?.accepted_count || 0) + Number(counts[0]?.other_proposed || 0) + proposed > limit) throw new AdjustmentVolunteerError(`该教师拟录取总人数超过指导上限 ${limit} 人`)
    }
    await conn.query('DELETE FROM adjustment_draft_items WHERE batch_id=?', [batch.id])
    for (const item of items) await conn.query(`INSERT INTO adjustment_draft_items (id,batch_id,volunteer_id,decision,decision_rank,comment,updated_by) VALUES (?,?,?,?,?,?,?)`, [uuidv4(),batch.id,item.volunteerId,item.decision,item.decision === 'reject' ? null : item.decisionRank,item.comment || null,actor.id])
    await conn.query('UPDATE adjustment_batches SET version=version+1 WHERE id=?',[batch.id])
  })
  return getAdjustmentDraft(topicId, actor)
}
export async function submitAdjustmentBatch(topicId: string, actor: SessionUser, version: number) {
  const cycleId = await transaction(async conn => {
    const topic = await context(topicId, actor, true)
    const [rows] = await conn.query<any[]>('SELECT * FROM adjustment_batches WHERE cycle_id=? AND topic_id=? FOR UPDATE',[topic.cycle_id,topic.id])
    const batch=rows[0]; if (!batch || batch.status !== 'draft' || Number(batch.version)!==version) throw new AdjustmentVolunteerError('名单已提交或草稿已变化，请刷新')
    await conn.query(`UPDATE adjustment_batches SET status='submitted',version=version+1,submitted_by=?,submitted_at=NOW() WHERE id=?`,[actor.id,batch.id])
    return Number(topic.cycle_id)
  })
  await requestAdjustmentSettlementIfReady(cycleId,'all_submitted')
  return getAdjustmentDraft(topicId, actor)
}
