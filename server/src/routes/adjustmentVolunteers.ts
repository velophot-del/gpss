import { Router } from 'express'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { error, success } from '../utils/response.js'
import { AdjustmentVolunteerError, getEligibleAdjustmentTopics, getMyAdjustmentVolunteers, saveMyAdjustmentVolunteers } from '../services/adjustmentVolunteerService.js'
import { getAdjustmentDraft, saveAdjustmentDraft, submitAdjustmentBatch } from '../services/adjustmentDraftService.js'

const router = Router()
router.use(authMiddleware)

function handleError(res: any, cause: any) {
  if (cause instanceof AdjustmentVolunteerError) return error(res, cause.message, cause.statusCode)
  console.error('调剂志愿操作失败:', cause)
  return error(res, cause?.message || '服务器内部错误', 500)
}

router.get('/eligible-topics', requireRole(['student']), async (req: AuthRequest, res) => {
  try { success(res, await getEligibleAdjustmentTopics(req.user!)) } catch (cause) { handleError(res, cause) }
})
router.get('/mine', requireRole(['student']), async (req: AuthRequest, res) => {
  try { success(res, await getMyAdjustmentVolunteers(req.user!)) } catch (cause) { handleError(res, cause) }
})
router.put('/mine', requireRole(['student']), async (req: AuthRequest, res) => {
  try { success(res, await saveMyAdjustmentVolunteers(req.user!, Number(req.body?.version || 0), req.body?.items || []), '调剂志愿已保存') } catch (cause) { handleError(res, cause) }
})
router.get('/topics/:topicId/draft', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try { success(res, await getAdjustmentDraft(req.params.topicId, req.user!)) } catch (cause) { handleError(res, cause) }
})
router.put('/topics/:topicId/draft', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try { success(res, await saveAdjustmentDraft(req.params.topicId, req.user!, Number(req.body?.version || 0), req.body?.items || []), '调剂名单草稿已保存') } catch (cause) { handleError(res, cause) }
})
router.post('/topics/:topicId/submit', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try { success(res, await submitAdjustmentBatch(req.params.topicId, req.user!, Number(req.body?.version || 0)), '名单已提交，等待统一结算') } catch (cause) { handleError(res, cause) }
})

export default router
