import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getAcceptedSelection, notify } from '../utils/processFlow.js'

const router = Router()
router.use(authMiddleware)

function parseJson(v: any): any[] {
  if (v == null) return []
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return [] } }
  return Array.isArray(v) ? v : []
}

// 教师下达任务书（按 student_id 定位其被录取的课题）
router.post('/', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { studentId, title, content, requirements, schedule, fileUrls, status } = req.body
    if (!studentId || !title) return error(res, '请选择学生并填写任务书标题')

    const sel = await getAcceptedSelection(studentId)
    if (!sel) return error(res, '该学生尚无已录取的选题')
    if (sel.teacher_id !== req.user!.id && req.user!.role !== 'admin') {
      return error(res, '只能给名下学生下达任务书')
    }

    const targetStatus = status === 'issued' ? 'issued' : 'draft'
    const [existing] = await query<any>(
      'SELECT * FROM task_books WHERE student_id = ? AND topic_id = ?',
      [studentId, sel.topic_id]
    )

    if (existing) {
      await query(`
        UPDATE task_books SET title = ?, content = ?, requirements = ?, schedule = ?,
          file_urls = ?, status = ?, issued_by = ?, issued_at = NOW(), updated_at = NOW()
        WHERE id = ?
      `, [title, content ?? null, requirements ?? null, schedule ?? null,
        JSON.stringify(fileUrls || []), targetStatus, req.user!.id, existing.id])
      await notify([studentId], 'task_book_issued', '任务书已更新', `导师更新了您的任务书「${title}」`, 'task_books', existing.id)
      return success(res, { id: existing.id }, '任务书已更新')
    }

    const id = uuidv4()
    await query(`
      INSERT INTO task_books (id, student_id, topic_id, cycle_id, title, content, requirements, schedule, file_urls, status, issued_by, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [id, studentId, sel.topic_id, sel.cycle_id || null, title, content ?? null, requirements ?? null, schedule ?? null,
      JSON.stringify(fileUrls || []), targetStatus, req.user!.id])

    await notify([studentId], 'task_book_issued', '任务书已下达', `导师为您下达了任务书「${title}」，请查看`, 'task_books', id)
    success(res, { id }, '任务书已下达')
  } catch (err: any) {
    console.error('下达任务书失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 列表
router.get('/', async (req: AuthRequest, res) => {
  try {
    let rows: any[]
    if (req.user!.role === 'student') {
      rows = await query<any>(`
        SELECT tb.*, t.title AS topic_title, t.category, u.real_name AS teacher_name
        FROM task_books tb
        JOIN topics t ON tb.topic_id = t.id
        LEFT JOIN users u ON t.teacher_id = u.id
        WHERE tb.student_id = ?
        ORDER BY tb.updated_at DESC
      `, [req.user!.id])
    } else if (req.user!.role === 'teacher') {
      rows = await query<any>(`
        SELECT tb.*, t.title AS topic_title, st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major
        FROM task_books tb
        JOIN topics t ON tb.topic_id = t.id
        JOIN users st ON tb.student_id = st.id
        WHERE t.teacher_id = ?
        ORDER BY tb.updated_at DESC
      `, [req.user!.id])
    } else {
      rows = await query<any>(`
        SELECT tb.*, t.title AS topic_title, st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major, u.real_name AS teacher_name
        FROM task_books tb
        JOIN topics t ON tb.topic_id = t.id
        JOIN users st ON tb.student_id = st.id
        LEFT JOIN users u ON t.teacher_id = u.id
        ORDER BY tb.updated_at DESC
      `)
    }
    const list = rows.map(r => { const c: any = { ...r, fileUrls: parseJson(r.file_urls) }; delete c.file_urls; return c })
    success(res, list)
  } catch (err: any) {
    console.error('获取任务书失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 详情
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const rows = await query<any>(`
      SELECT tb.*, t.title AS topic_title, t.category, t.teacher_id, u.real_name AS teacher_name,
             st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major
      FROM task_books tb
      JOIN topics t ON tb.topic_id = t.id
      LEFT JOIN users u ON t.teacher_id = u.id
      LEFT JOIN users st ON tb.student_id = st.id
      WHERE tb.id = ?
    `, [id])
    if (!rows[0]) return error(res, '记录不存在', 404)
    const r = rows[0]
    if (req.user!.role === 'student' && r.student_id !== req.user!.id) return error(res, '无权查看', 403)
    if (req.user!.role === 'teacher' && r.teacher_id !== req.user!.id) return error(res, '无权查看', 403)
    const c: any = { ...r, fileUrls: parseJson(r.file_urls) }; delete c.file_urls
    success(res, c)
  } catch (err: any) {
    console.error('获取任务书详情失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 删除（教师/管理员）
router.delete('/:id', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const rows = await query<any>(`
      SELECT tb.*, t.teacher_id FROM task_books tb JOIN topics t ON tb.topic_id = t.id WHERE tb.id = ?
    `, [id])
    if (!rows[0]) return error(res, '记录不存在', 404)
    if (rows[0].teacher_id !== req.user!.id && req.user!.role !== 'admin') return error(res, '无权删除', 403)
    await query('DELETE FROM task_books WHERE id = ?', [id])
    success(res, null, '任务书已删除')
  } catch (err: any) {
    console.error('删除任务书失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
