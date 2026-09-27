import { Router } from 'express'
import { query, transaction } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { error, success } from '../utils/response.js'
import { getReviewDeadline } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'
import { getDeadlineWorkerStatus } from '../services/selectionDeadlineWorker.js'
import { getSelectionConfigurationError, requestSettlementIfReady, SelectionSettlementError } from '../services/selectionSettlementService.js'

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

export default router
