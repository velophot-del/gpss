import { Router } from 'express'
import { query } from '../config/database.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'

const router = Router()
router.use(authMiddleware)

// 未读数
router.get('/unread-count', async (req: AuthRequest, res) => {
  try {
    const rows = await query<any>(
      'SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0',
      [req.user!.id]
    )
    success(res, { count: Number(rows[0]?.cnt || 0) })
  } catch (err: any) {
    error(res, '服务器内部错误', 500)
  }
})

// 通知列表
router.get('/', async (req: AuthRequest, res) => {
  try {
    const { page = '1', pageSize = '20' } = req.query
    const p = Math.max(1, Number(page))
    const ps = Math.min(50, Math.max(1, Number(pageSize)))
    const offset = (p - 1) * ps

    const list = await query<any>(`
      SELECT * FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [req.user!.id, ps, offset])

    const totalRows = await query<any>(
      'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?',
      [req.user!.id]
    )

    success(res, { list, total: Number(totalRows[0]?.total || 0) })
  } catch (err: any) {
    console.error('获取通知失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 标记单条已读
router.put('/:id/read', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    await query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, req.user!.id])
    success(res, null, '已标记为已读')
  } catch (err: any) {
    error(res, '服务器内部错误', 500)
  }
})

// 全部标记已读
router.put('/read-all', async (req: AuthRequest, res) => {
  try {
    await query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user!.id])
    success(res, null, '已全部标记为已读')
  } catch (err: any) {
    error(res, '服务器内部错误', 500)
  }
})

export default router
