import { v4 as uuidv4 } from 'uuid'
import { getConnection, query, transaction } from '../config/database.js'
import { getAdjustmentDeadline, getTeacherStudentLimit } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'
import { buildSettlementPlan } from './selectionMatcher.js'

export type AdjustmentSettlementTrigger = 'all_submitted' | 'deadline' | 'admin_retry'
export class AdjustmentSettlementError extends Error { constructor(message: string, public statusCode = 409) { super(message) } }

async function pendingTopics(cycleId: number) {
  const rows = await query<any>(`SELECT COUNT(*) cnt FROM (SELECT av.topic_id FROM adjustment_volunteers av LEFT JOIN adjustment_batches ab ON ab.cycle_id=av.cycle_id AND ab.topic_id=av.topic_id WHERE av.cycle_id=? AND av.status='submitted' GROUP BY av.topic_id,ab.status HAVING ab.status IS NULL OR ab.status='draft') x`, [cycleId])
  return Number(rows[0]?.cnt || 0)
}
async function autoSubmit(conn: any, cycleId: number) {
  const [topics] = await conn.query(`SELECT DISTINCT topic_id FROM adjustment_volunteers WHERE cycle_id=? AND status='submitted' FOR UPDATE`,[cycleId]) as [any[]]
  for (const topic of topics) await conn.query(`INSERT INTO adjustment_batches (id,cycle_id,topic_id,status,auto_submitted_at) VALUES (?,? ,?,'auto_submitted',NOW()) ON DUPLICATE KEY UPDATE status=IF(status='draft','auto_submitted',status),auto_submitted_at=IF(status='draft',NOW(),auto_submitted_at),version=IF(status='draft',version+1,version)`,[uuidv4(),cycleId,topic.topic_id])
}
export async function requestAdjustmentSettlementIfReady(cycleId: number, trigger: AdjustmentSettlementTrigger) {
  const [cycle] = await query<any>('SELECT phase,phases_config FROM cycles WHERE id=?',[cycleId])
  if (!cycle || cycle.phase !== 'adjustment') throw new AdjustmentSettlementError('当前不在调剂补录阶段')
  const deadline = getAdjustmentDeadline(safeParseJson(cycle.phases_config,{}))
  if (!deadline) throw new AdjustmentSettlementError('当前周期未配置调剂截止时间')
  const pending = await pendingTopics(cycleId)
  if (pending && Date.now() < deadline.getTime()) return { status:'waiting' as const, pendingTopics: pending }
  return { status:'completed' as const, summary: await runAdjustmentSettlement(cycleId, Date.now() >= deadline.getTime() ? 'deadline' : trigger) }
}
async function apply(conn: any, cycleId: number, trigger: AdjustmentSettlementTrigger) {
  const [cycles] = await conn.query('SELECT * FROM cycles WHERE id=? FOR UPDATE',[cycleId]) as [any[]]; const cycle=cycles[0]
  if (!cycle || cycle.phase !== 'adjustment') throw new AdjustmentSettlementError('当前不在调剂补录阶段')
  const config=safeParseJson<any>(cycle.phases_config,{})
  const deadline=getAdjustmentDeadline(config)
  if (trigger==='deadline' || (deadline && Date.now()>=deadline.getTime())) await autoSubmit(conn,cycleId)
  if (await pendingTopics(cycleId)) throw new AdjustmentSettlementError('仍有课题名单未提交')
  const [topicsRows]=await conn.query(`SELECT t.id,t.teacher_id,t.max_students,COUNT(a.id) accepted_count FROM topics t LEFT JOIN applications a ON a.topic_id=t.id AND a.status='accepted' WHERE t.cycle_id=? AND t.status IN ('published','full') GROUP BY t.id FOR UPDATE`,[cycleId]) as [any[]]
  const [candidatesRows]=await conn.query(`SELECT av.id,av.student_id,av.topic_id,av.priority,av.created_at,t.teacher_id,adi.decision,adi.decision_rank FROM adjustment_volunteers av JOIN topics t ON t.id=av.topic_id LEFT JOIN adjustment_batches ab ON ab.cycle_id=av.cycle_id AND ab.topic_id=av.topic_id LEFT JOIN adjustment_draft_items adi ON adi.batch_id=ab.id AND adi.volunteer_id=av.id WHERE av.cycle_id=? AND av.status='submitted' FOR UPDATE`,[cycleId]) as [any[]]
  const topics=topicsRows.map((row:any)=>({topicId:row.id,teacherId:row.teacher_id,capacity:Number(row.max_students)}))
  const [lockedRows]=await conn.query(`SELECT a.id,a.student_id,a.topic_id,t.teacher_id FROM applications a JOIN topics t ON t.id=a.topic_id WHERE t.cycle_id=? AND a.status='accepted' FOR UPDATE`,[cycleId]) as [any[]]
  const plan=buildSettlementPlan({topics,lockedAssignments:lockedRows.map((row:any)=>({applicationId:row.id,studentId:row.student_id,topicId:row.topic_id,teacherId:row.teacher_id})),teacherLimit:getTeacherStudentLimit(config),candidates:candidatesRows.map((row:any)=>({applicationId:row.id,studentId:row.student_id,topicId:row.topic_id,teacherId:row.teacher_id,priority:Number(row.priority),decision:row.decision||null,decisionRank:row.decision_rank==null?null:Number(row.decision_rank),appliedAt:new Date(row.created_at).toISOString()}))})
  const update=async(ids:string[],status:string)=>{ if(ids.length) await conn.query('UPDATE adjustment_volunteers SET status=? WHERE id IN (?)',[status,ids]) }
  await update(plan.acceptedApplicationIds,'accepted'); await update(plan.withdrawnApplicationIds,'withdrawn'); await update(plan.rejectedApplicationIds,'rejected')
  const candidateById=new Map<string, any>(candidatesRows.map((row:any)=>[row.id,row]))
  for(const id of plan.acceptedApplicationIds){ const row=candidateById.get(id); await conn.query(`INSERT INTO applications (id,student_id,topic_id,priority,motivation,status,reviewed_at) VALUES (?,?,?,?,?,'accepted',NOW()) ON DUPLICATE KEY UPDATE status='accepted',reviewed_at=NOW()`,[uuidv4(),row.student_id,row.topic_id,Number(row.priority), '来自调剂志愿']) }
  for(const topic of topics) await conn.query(`UPDATE topics SET status=? WHERE id=?`,[(plan.topicAcceptedCounts[topic.topicId]||0)>=topic.capacity?'full':'published',topic.topicId])
  await conn.query(`UPDATE adjustment_batches SET status='settled',settled_at=NOW() WHERE cycle_id=?`,[cycleId])
  const summary={accepted:plan.acceptedApplicationIds.length,rejected:plan.rejectedApplicationIds.length,withdrawn:plan.withdrawnApplicationIds.length,unmatchedStudents:plan.unmatchedStudentIds.length,topicAcceptedCounts:plan.topicAcceptedCounts}
  await conn.query(`INSERT INTO operation_logs (action,target_type,target_id,detail) VALUES ('adjustment_settled','cycle',?,?)`,[String(cycleId),JSON.stringify({trigger,...summary})])
  await conn.query(`UPDATE adjustment_settlements SET status='completed',result_json=?,completed_at=NOW(),error_message=NULL WHERE cycle_id=?`,[JSON.stringify(summary),cycleId])
  return summary
}
export async function runAdjustmentSettlement(cycleId:number,trigger:AdjustmentSettlementTrigger) {
  const lock=await getConnection(); const lockName=`gpss:adjustment-settlement:${cycleId}`; let acquired=false
  try { const [locks]=await lock.query('SELECT GET_LOCK(?,0) acquired',[lockName]) as any; acquired=Number(locks[0]?.acquired)===1; if(!acquired) throw new AdjustmentSettlementError('调剂结算正在执行，请稍后刷新')
    const [old]=await lock.query('SELECT * FROM adjustment_settlements WHERE cycle_id=?',[cycleId]) as any; if(old[0]?.status==='completed') return safeParseJson(old[0].result_json,{accepted:0,rejected:0,withdrawn:0,unmatchedStudents:0,topicAcceptedCounts:{}})
    await lock.query(`INSERT INTO adjustment_settlements (id,cycle_id,status,trigger_type,started_at) VALUES (?,?,'running',?,NOW()) ON DUPLICATE KEY UPDATE status='running',trigger_type=VALUES(trigger_type),started_at=NOW(),completed_at=NULL,error_message=NULL`,[uuidv4(),cycleId,trigger])
    try{return await transaction(conn=>apply(conn,cycleId,trigger))}catch(cause:any){await lock.query(`UPDATE adjustment_settlements SET status='failed',error_message=?,completed_at=NOW() WHERE cycle_id=?`,[String(cause?.message||cause).slice(0,4000),cycleId]);throw cause}
  } finally {if(acquired) await lock.query('SELECT RELEASE_LOCK(?)',[lockName]);lock.release()}
}
