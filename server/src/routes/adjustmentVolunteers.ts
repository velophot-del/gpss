import { Router } from 'express'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { error, success } from '../utils/response.js'
import {
  AdjustmentVolunteerError,
  getEligibleAdjustmentTopics,
  getMyAdjustmentVolunteers,
  saveMyAdjustmentVolunteers,
} from '../services/adjustmentVolunteerService.js'
import {
  AdjustmentDraftError,
  getAdjustmentDraft,
  getAdjustmentTeacherTopics,
} from '../services/adjustmentDraftService.js'
import { AdjustmentSettlementError } from '../services/adjustmentSettlementService.js'

const router = Router()
router.use(authMiddleware)

function handleError(res: any, cause: unknown) {
  if (cause instanceof AdjustmentVolunteerError) return error(res, cause.message, cause.statusCode)
  if (cause instanceof AdjustmentDraftError || cause instanceof AdjustmentSettlementError) return error(res, cause.message, cause.statusCode)
  console.error('调剂志愿操作失败:', cause)
  return error(res, '服务器内部错误', 500)
}

router.get('/eligible-topics', requireRole(['student']), async (req: AuthRequest, res) => {
  try { success(res, await getEligibleAdjustmentTopics(req.user!)) }
  catch (cause) { handleError(res, cause) }
})

router.get('/mine', requireRole(['student']), async (req: AuthRequest, res) => {
  try { success(res, await getMyAdjustmentVolunteers(req.user!)) }
  catch (cause) { handleError(res, cause) }
})

router.put('/mine', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const version = Number(req.body?.version)
    if (!Array.isArray(req.body?.items)) return error(res, '调剂志愿内容无效')
    success(res, await saveMyAdjustmentVolunteers(req.user!, version, req.body.items), '调剂志愿已保存')
  } catch (cause) { handleError(res, cause) }
})

router.get('/teacher/topics', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try { success(res, await getAdjustmentTeacherTopics(req.user!)) }
  catch (cause) { handleError(res, cause) }
})

router.get('/topics/:topicId/draft', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try { success(res, await getAdjustmentDraft(req.params.topicId, req.user!)) }
  catch (cause) { handleError(res, cause) }
})

router.put('/topics/:topicId/draft', requireRole(['teacher']), async (req: AuthRequest, res) => {
  return error(res, '调剂阶段不再由教师遴选名单，系统将在截止后自动匹配', 410)
})

router.post('/topics/:topicId/submit', requireRole(['teacher']), async (req: AuthRequest, res) => {
  return error(res, '调剂阶段不再由教师遴选名单，系统将在截止后自动匹配', 410)
})

export default router
