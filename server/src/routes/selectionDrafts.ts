import { Router } from 'express'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { error, success } from '../utils/response.js'
import { getSelectionDraft, saveSelectionDraft, SelectionDraftError, submitSelectionBatch } from '../services/selectionDraftService.js'
import { SelectionSettlementError } from '../services/selectionSettlementService.js'

const router = Router()
router.use(authMiddleware)

function handleError(res: any, cause: unknown) {
  if (cause instanceof SelectionDraftError) return error(res, cause.message, cause.statusCode)
  if (cause instanceof SelectionSettlementError) return error(res, cause.message, cause.statusCode)
  console.error('遴选草稿操作失败:', cause)
  return error(res, '服务器内部错误', 500)
}

router.get('/topics/:topicId/selection-draft', requireRole(['teacher', 'admin']), async (req: AuthRequest, res) => {
  try {
    success(res, await getSelectionDraft(req.params.topicId, req.user!))
  } catch (cause) { handleError(res, cause) }
})

router.put('/topics/:topicId/selection-draft', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const version = Number(req.body?.version)
    if (!Number.isInteger(version) || version < 0 || !Array.isArray(req.body?.items)) return error(res, '草稿版本或内容无效')
    success(res, await saveSelectionDraft(req.params.topicId, req.user!, version, req.body.items), '草稿已保存')
  } catch (cause) { handleError(res, cause) }
})

router.post('/topics/:topicId/submit-selection', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const version = Number(req.body?.version)
    if (!Number.isInteger(version) || version < 0) return error(res, '草稿版本无效')
    success(res, await submitSelectionBatch(req.params.topicId, req.user!, version), '名单已提交，等待统一结算')
  } catch (cause) { handleError(res, cause) }
})

export default router
