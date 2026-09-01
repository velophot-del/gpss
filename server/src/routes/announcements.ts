import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error, paginated } from '../utils/response.js'

const router = Router()
router.use(authMiddleware)

// 列表：学生/教师看到已发布且面向自己的公告；管理员/教师可看到自己的草稿
router.get('/', async (req: AuthRequest, res) => {
  try {
    const { page = '1', pageSize = '10' } = req.query
    const p = Math.max(1, Number(page))
    const ps = Math.min(50, Math.max(1, Number(pageSize)))
    const offset = (p - 1) * ps

    const role = req.user!.role
    let where: string
    let params: any[]
    if (role === 'admin' || role === 'teacher') {
      // 教师/管理员额外看到自己的草稿
      where = `WHERE (a.status = 'published' AND a.scope IN ('all', ?)) OR (a.created_by = ?)`
      params = [role, req.user!.id]
    } else {
      where = `WHERE a.status = 'published' AND a.scope IN ('all', ?)`
      params = [role]
    }

    const list = await query<any>(`
      SELECT a.*, u.real_name AS author_name
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, ps, offset])

    const countRows = await query<any>(`SELECT COUNT(*) AS total FROM announcements a ${where}`, params)
    paginated(res, list, countRows[0]?.total || 0, p, ps)
  } catch (err: any) {
    console.error('获取公告失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 创建公告
router.post('/', requireRole(['admin', 'teacher']), async (req: AuthRequest, res) => {
  try {
    const { title, content, scope, status } = req.body
    if (!title || !content) return error(res, '请填写标题和内容')
    const id = uuidv4()
    await query(`
      INSERT INTO announcements (id, title, content, scope, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, title, content, scope || 'all', status || 'published', req.user!.id])
    success(res, { id }, '公告已发布')
  } catch (err: any) {
    console.error('创建公告失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 更新公告
router.put('/:id', requireRole(['admin', 'teacher']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const [row] = await query<any>('SELECT * FROM announcements WHERE id = ?', [id])
    if (!row) return error(res, '公告不存在', 404)
    if (row.created_by !== req.user!.id && req.user!.role !== 'admin') return error(res, '无权编辑此公告', 403)
    const { title, content, scope, status } = req.body
    await query(`
      UPDATE announcements SET title = ?, content = ?, scope = ?, status = ?
      WHERE id = ?
    `, [title ?? row.title, content ?? row.content, scope ?? row.scope, status ?? row.status, id])
    success(res, null, '公告已更新')
  } catch (err: any) {
    console.error('更新公告失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 删除公告
router.delete('/:id', requireRole(['admin', 'teacher']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const [row] = await query<any>('SELECT * FROM announcements WHERE id = ?', [id])
    if (!row) return error(res, '公告不存在', 404)
    if (row.created_by !== req.user!.id && req.user!.role !== 'admin') return error(res, '无权删除此公告', 403)
    await query('DELETE FROM announcements WHERE id = ?', [id])
    success(res, null, '公告已删除')
  } catch (err: any) {
    console.error('删除公告失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
