import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'

const router = Router()
router.use(authMiddleware)

// POST /api/shortlist - 添加到预选
router.post('/', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const { topicId } = req.body
    if (!topicId) return error(res, '请选择课题')

    const [topic] = await query<any>('SELECT * FROM topics WHERE id = ? AND status = ?', [topicId, 'published'])
    if (!topic) return error(res, '课题不存在或未开放')

    const [existing] = await query<any>('SELECT * FROM topic_shortlist WHERE student_id = ? AND topic_id = ?', [req.user!.id, topicId])
    if (existing) return error(res, '该课题已在预选列表中')

    await query('INSERT INTO topic_shortlist (id, student_id, topic_id) VALUES (?, ?, ?)', [uuidv4(), req.user!.id, topicId])

    success(res, null, '已添加到预选列表')
  } catch (err: any) {
    console.error('添加预选失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/shortlist - 获取学生的预选列表
router.get('/', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const list = await query<any>(`
      SELECT s.*, t.title, t.description, t.category, t.difficulty, t.max_students, t.teacher_id,
             (SELECT COUNT(*) FROM applications a WHERE a.topic_id = t.id AND a.status != 'withdrawn') AS apply_count,
             t.status as topic_status, u.real_name as teacher_name
      FROM topic_shortlist s
      JOIN topics t ON s.topic_id = t.id
      JOIN users u ON t.teacher_id = u.id
      WHERE s.student_id = ?
      ORDER BY s.added_at DESC
    `, [req.user!.id])

    success(res, list)
  } catch (err: any) {
    console.error('获取预选列表失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// DELETE /api/shortlist/batch - 批量移除（必须在 /:id 前面）
router.delete('/batch', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const { ids } = req.body
    if (!ids || !Array.isArray(ids) || ids.length === 0) return error(res, '请选择要移除的项目')

    await query('DELETE FROM topic_shortlist WHERE id IN (?) AND student_id = ?', [ids, req.user!.id])

    success(res, null, '批量移除成功')
  } catch (err: any) {
    console.error('批量移除预选失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// DELETE /api/shortlist/:id - 从预选列表移除
router.delete('/:id', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params

    const [item] = await query<any>('SELECT * FROM topic_shortlist WHERE id = ? AND student_id = ?', [id, req.user!.id])
    if (!item) return error(res, '记录不存在')

    await query('DELETE FROM topic_shortlist WHERE id = ?', [id])

    success(res, null, '已从预选列表移除')
  } catch (err: any) {
    console.error('移除预选失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
