import { Router } from 'express'
import { query, transaction } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { error, success } from '../utils/response.js'
import { getAdjustmentDeadline, getReviewDeadline } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'
import { getDeadlineWorkerStatus } from '../services/selectionDeadlineWorker.js'
import { getSelectionConfigurationError, requestSettlementIfReady, SelectionSettlementError } from '../services/selectionSettlementService.js'
import { requestAdjustmentSettlementIfReady, AdjustmentSettlementError } from '../services/adjustmentSettlementService.js'

const router = Router()
router.use(authMiddleware, requireRole(['admin']))

router.get('/selection-settlement/:cycleId', async (req: AuthRequest, res) => {
  try {
    const cycleId = Number(req.params.cycleId)
    const [cycle] = await query<any>('SELECT id, name, phase, phases_config FROM cycles WHERE id = ?', [cycleId])
    if (!cycle) return error(res, '选题周期不存在', 404)
    const config = safeParseJson<Record<string, any>>(cycle.phases_config, {})
    const deadline = getReviewDeadline(config)
    const topics = await query<any>(`
      SELECT t.id, t.title, t.teacher_id, u.real_name AS teacher_name, t.max_students,
             COUNT(DISTINCT a.id) AS application_count,
             COUNT(DISTINCT sdi.application_id) AS decided_count,
             sb.status AS batch_status, sb.version, sb.updated_at AS last_saved_at,
             sb.submitted_at, sb.auto_submitted_at
      FROM topics t JOIN users u ON u.id = t.teacher_id
      LEFT JOIN applications a ON a.topic_id = t.id AND a.status IN ('pending','submitted','pending_review','waitlisted','accepted')
      LEFT JOIN selection_batches sb ON sb.cycle_id = t.cycle_id AND sb.topic_id = t.id
      LEFT JOIN selection_draft_items sdi ON sdi.batch_id = sb.id
      WHERE t.cycle_id = ? AND t.status IN ('published','full')
      GROUP BY t.id, t.title, t.teacher_id, u.real_name, t.max_students, sb.status, sb.version, sb.updated_at, sb.submitted_at, sb.auto_submitted_at
      ORDER BY u.real_name, t.title
    `, [cycleId])
    const [settlement] = await query<any>('SELECT * FROM selection_settlements WHERE cycle_id = ?', [cycleId])
    success(res, {
      cycle: { id: cycle.id, name: cycle.name, phase: cycle.phase, deadline: deadline?.toISOString() || null },
      configurationError: await getSelectionConfigurationError(cycleId, config),
      worker: getDeadlineWorkerStatus(),
      settlement: settlement ? { ...settlement, result_json: safeParseJson(settlement.result_json, null) } : null,
      topics: topics.map(topic => ({
        ...topic,
        application_count: Number(topic.application_count),
        decided_count: Number(topic.decided_count),
        batch_status: Number(topic.application_count) === 0 ? 'not_required' : (topic.batch_status || 'draft'),
      })),
    })
  } catch (cause) {
    console.error('读取录取结算进度失败:', cause)
    error(res, '服务器内部错误', 500)
  }
})

router.post('/selection-topics/:topicId/unlock', async (req: AuthRequest, res) => {
  try {
    const reason = String(req.body?.reason || '').trim()
    if (!reason) return error(res, '请填写退回原因')
    await transaction(async conn => {
      const [batches] = await conn.query<any[]>(`
        SELECT sb.*, ss.status AS settlement_status
        FROM selection_batches sb
        LEFT JOIN selection_settlements ss ON ss.cycle_id = sb.cycle_id
        WHERE sb.topic_id = ? FOR UPDATE
      `, [req.params.topicId])
      const batch = batches[0]
      if (!batch) throw new SelectionSettlementError('该课题尚无遴选批次', 404)
      if (['running', 'completed'].includes(batch.settlement_status)) throw new SelectionSettlementError('结算已开始或已完成，不能退回')
      if (!['submitted', 'auto_submitted'].includes(batch.status)) throw new SelectionSettlementError('只有已提交名单可以退回')
      await conn.query("UPDATE selection_batches SET status = 'draft', version = version + 1, submitted_by = NULL, submitted_at = NULL, auto_submitted_at = NULL WHERE id = ?", [batch.id])
      await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail, ip_address)
        VALUES (?, 'selection_batch_unlocked', 'topic', ?, ?, ?)`, [req.user!.id, req.params.topicId, JSON.stringify({ reason, cycleId: batch.cycle_id }), req.ip || null])
    })
    success(res, null, '已退回教师修改')
  } catch (cause: any) {
    if (cause instanceof SelectionSettlementError) return error(res, cause.message, cause.statusCode)
    console.error('退回遴选名单失败:', cause)
    error(res, '服务器内部错误', 500)
  }
})

router.post('/selection-topics/:topicId/reset', async (req: AuthRequest, res) => {
  try {
    const reason = String(req.body?.reason || '').trim()
    if (req.body?.confirmation !== 'RESET') return error(res, '请确认恢复操作')
    if (!reason) return error(res, '请填写恢复原因')

    const result = await transaction(async conn => {
      const [topics] = await conn.query<any[]>(`
        SELECT t.id, t.cycle_id, t.status, c.phase, ss.status AS settlement_status
        FROM topics t JOIN cycles c ON c.id = t.cycle_id
        LEFT JOIN selection_settlements ss ON ss.cycle_id = t.cycle_id
        WHERE t.id = ? FOR UPDATE
      `, [req.params.topicId])
      const topic = topics[0]
      if (!topic) throw new SelectionSettlementError('课题不存在或未关联选题周期', 404)
      if (['running', 'completed'].includes(topic.settlement_status)) throw new SelectionSettlementError('统一结算已开始或已完成，不能恢复单个课题')
      const cycleId = Number(topic.cycle_id)
      const cycle = { phase: topic.phase }
      if (!['student_selection', 'teacher_review'].includes(cycle.phase)) {
        throw new SelectionSettlementError('仅志愿填报或教师遴选阶段可以恢复课题操作')
      }

      const [applications] = await conn.query<any[]>(`
        SELECT id, status, reviewed_at FROM applications WHERE topic_id = ? FOR UPDATE
      `, [topic.id])
      const resetIds = applications
        .filter(item => ['accepted', 'rejected', 'waitlisted'].includes(item.status) || (item.status === 'withdrawn' && item.reviewed_at))
        .map(item => item.id)
      const [draftCountRows] = await conn.query<any[]>(`
        SELECT COUNT(*) AS cnt FROM selection_draft_items sdi
        JOIN selection_batches sb ON sb.id = sdi.batch_id WHERE sb.topic_id = ?
      `, [topic.id])
      const [batches] = await conn.query<any[]>('SELECT id FROM selection_batches WHERE cycle_id = ? AND topic_id = ? FOR UPDATE', [cycleId, topic.id])

      if (resetIds.length) {
        await conn.query(`UPDATE applications
          SET status = 'pending_review', teacher_comment = NULL, reviewed_by = NULL, reviewed_at = NULL
          WHERE id IN (?)`, [resetIds])
      }
      await conn.query("UPDATE topics SET status = 'published' WHERE id = ? AND status = 'full'", [topic.id])
      await conn.query(`DELETE sdi FROM selection_draft_items sdi
        JOIN selection_batches sb ON sb.id = sdi.batch_id WHERE sb.topic_id = ?`, [topic.id])
      if (batches[0]) {
        await conn.query(`UPDATE selection_batches
          SET status = 'draft', version = version + 1, submitted_by = NULL, submitted_at = NULL, auto_submitted_at = NULL, settled_at = NULL
          WHERE id = ?`, [batches[0].id])
      }
      await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail, ip_address)
        VALUES (?, 'selection_topic_reset', 'topic', ?, ?, ?)`, [req.user!.id, topic.id, JSON.stringify({
          reason, cycleId, resetApplications: resetIds.length, deletedDraftItems: Number(draftCountRows[0]?.cnt || 0),
        }), req.ip || null])
      return { resetApplications: resetIds.length, deletedDraftItems: Number(draftCountRows[0]?.cnt || 0) }
    })
    success(res, result, '该课题教师遴选已恢复为未处理状态')
  } catch (cause: any) {
    if (cause instanceof SelectionSettlementError) return error(res, cause.message, cause.statusCode)
    console.error('恢复课题遴选失败:', cause)
    error(res, '服务器内部错误', 500)
  }
})

router.post('/selection-settlement/:cycleId/run', async (req: AuthRequest, res) => {
  try {
    const cycleId = Number(req.params.cycleId)
    const [settlement] = await query<any>('SELECT status FROM selection_settlements WHERE cycle_id = ?', [cycleId])
    const result = await requestSettlementIfReady(cycleId, settlement?.status === 'failed' ? 'admin_retry' : 'all_submitted')
    if (result.status === 'waiting') return error(res, `仍有 ${result.pendingTopics} 个课题未提交，且尚未到截止时间`, 409)
    success(res, result, '统一录取检查已完成')
  } catch (cause: any) {
    if (cause instanceof SelectionSettlementError) return error(res, cause.message, cause.statusCode)
    console.error('手动执行统一录取失败:', cause)
    error(res, cause?.message || '服务器内部错误', 500)
  }
})

router.get('/adjustment-settlement/:cycleId', async (req: AuthRequest, res) => {
  try {
    const cycleId = Number(req.params.cycleId)
    const [cycle] = await query<any>('SELECT id,name,phase,phases_config FROM cycles WHERE id=?', [cycleId])
    if (!cycle) return error(res, '选题周期不存在', 404)
    const deadline = getAdjustmentDeadline(safeParseJson(cycle.phases_config, {}))
    const [eligible] = await query<any>('SELECT COUNT(DISTINCT student_id) students, COUNT(*) volunteers FROM adjustment_volunteers WHERE cycle_id=?', [cycleId])
    const topics = await query<any>(`SELECT t.id,t.title,u.real_name teacher_name,COUNT(DISTINCT av.id) volunteer_count,COUNT(DISTINCT adi.volunteer_id) decided_count,ab.status batch_status,ab.version,ab.submitted_at FROM topics t JOIN users u ON u.id=t.teacher_id LEFT JOIN adjustment_volunteers av ON av.topic_id=t.id AND av.cycle_id=t.cycle_id AND av.status='submitted' LEFT JOIN adjustment_batches ab ON ab.cycle_id=t.cycle_id AND ab.topic_id=t.id LEFT JOIN adjustment_draft_items adi ON adi.batch_id=ab.id AND adi.volunteer_id=av.id WHERE t.cycle_id=? GROUP BY t.id,t.title,u.real_name,ab.status,ab.version,ab.submitted_at HAVING volunteer_count>0 ORDER BY u.real_name,t.title`, [cycleId])
    const [settlement] = await query<any>('SELECT * FROM adjustment_settlements WHERE cycle_id=?', [cycleId])
    success(res, { cycle: { id: cycle.id, name: cycle.name, phase: cycle.phase, deadline: deadline?.toISOString() || null }, configurationError: deadline ? null : '当前周期未配置有效的调剂截止时间', counts: { students: Number(eligible?.students || 0), volunteers: Number(eligible?.volunteers || 0) }, topics, settlement: settlement ? { ...settlement, result_json: safeParseJson(settlement.result_json, null) } : null })
  } catch (cause) { console.error('读取调剂结算进度失败:', cause); error(res, '服务器内部错误', 500) }
})

router.post('/adjustment-topics/:topicId/unlock', async (req: AuthRequest, res) => {
  try {
    const reason = String(req.body?.reason || '').trim()
    if (!reason) return error(res, '请填写退回原因')
    await transaction(async conn => {
      const [rows] = await conn.query<any[]>(`SELECT ab.*,asr.status settlement_status FROM adjustment_batches ab LEFT JOIN adjustment_settlements asr ON asr.cycle_id=ab.cycle_id WHERE ab.topic_id=? FOR UPDATE`, [req.params.topicId])
      const batch=rows[0]
      if (!batch) throw new AdjustmentSettlementError('该课题尚无调剂遴选批次',404)
      if (['running','completed'].includes(batch.settlement_status)) throw new AdjustmentSettlementError('结算已开始或完成，不能退回')
      if (!['submitted','auto_submitted'].includes(batch.status)) throw new AdjustmentSettlementError('只有已提交名单可以退回')
      await conn.query(`UPDATE adjustment_batches SET status='draft',version=version+1,submitted_by=NULL,submitted_at=NULL,auto_submitted_at=NULL WHERE id=?`,[batch.id])
      await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail, ip_address) VALUES (?, 'adjustment_batch_unlocked', 'topic', ?, ?, ?)`, [req.user!.id, req.params.topicId, JSON.stringify({ reason, cycleId: batch.cycle_id }), req.ip || null])
    })
    success(res, null, '已退回教师修改')
  } catch (cause:any) { if(cause instanceof AdjustmentSettlementError) return error(res,cause.message,cause.statusCode); error(res,cause?.message || '服务器内部错误',500) }
})

router.post('/adjustment-settlement/:cycleId/run', async (req: AuthRequest, res) => {
  try {
    const [settlement] = await query<any>('SELECT status FROM adjustment_settlements WHERE cycle_id=?',[Number(req.params.cycleId)])
    const result = await requestAdjustmentSettlementIfReady(Number(req.params.cycleId), settlement?.status === 'failed' ? 'admin_retry' : 'all_submitted')
    if (result.status === 'waiting') return error(res, `仍有 ${result.pendingTopics} 个课题未提交，且尚未到截止时间`,409)
    success(res,result,'调剂统一结算已完成')
  } catch(cause:any) { if(cause instanceof AdjustmentSettlementError) return error(res,cause.message,cause.statusCode); error(res,cause?.message || '服务器内部错误',500) }
})

export default router
