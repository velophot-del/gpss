import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getAcceptedSelection } from '../utils/processFlow.js'

const router = Router()
router.use(authMiddleware)

function parseJson(v: any): any[] {
  if (v == null) return []
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return [] } }
  return Array.isArray(v) ? v : []
}

// 新增指导记录（教师为名下学生记录，学生记录自己的指导过程）
router.post('/', requireRole(['teacher', 'student']), async (req: AuthRequest, res) => {
  try {
    const { studentId, recordDate, content, nextAction, fileUrls } = req.body

    let targetStudentId: string
    if (req.user!.role === 'student') {
      targetStudentId = req.user!.id
    } else {
      if (!studentId) return error(res, '请选择学生')
      targetStudentId = studentId
    }

    const sel = await getAcceptedSelection(targetStudentId)
    if (!sel) return error(res, '该学生尚无已录取的选题')
    if (req.user!.role === 'teacher' && sel.teacher_id !== req.user!.id) {
      return error(res, '只能为名下学生记录指导')
    }

    if (!content) return error(res, '请填写指导内容')

    const id = uuidv4()
    await query(`
      INSERT INTO guidance_records (id, student_id, teacher_id, topic_id, cycle_id, record_date, content, next_action, file_urls)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, targetStudentId, sel.teacher_id, sel.topic_id, sel.cycle_id || null,
      recordDate || new Date(), content, nextAction ?? null, JSON.stringify(fileUrls || [])])

    success(res, { id }, '指导记录已保存')
  } catch (err: any) {
    console.error('新增指导记录失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 列表
router.get('/', async (req: AuthRequest, res) => {
  try {
    let rows: any[]
    if (req.user!.role === 'student') {
      rows = await query<any>(`
        SELECT g.*, t.title AS topic_title, u.real_name AS teacher_name
        FROM guidance_records g
        JOIN topics t ON g.topic_id = t.id
        LEFT JOIN users u ON g.teacher_id = u.id
        WHERE g.student_id = ?
        ORDER BY g.record_date DESC
      `, [req.user!.id])
    } else if (req.user!.role === 'teacher') {
      rows = await query<any>(`
        SELECT g.*, t.title AS topic_title, st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major
        FROM guidance_records g
        JOIN topics t ON g.topic_id = t.id
        JOIN users st ON g.student_id = st.id
        WHERE g.teacher_id = ?
        ORDER BY g.record_date DESC
      `, [req.user!.id])
    } else {
      rows = await query<any>(`
        SELECT g.*, t.title AS topic_title, st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major, u.real_name AS teacher_name
        FROM guidance_records g
        JOIN topics t ON g.topic_id = t.id
        JOIN users st ON g.student_id = st.id
        LEFT JOIN users u ON g.teacher_id = u.id
        ORDER BY g.record_date DESC
      `)
    }
    const list = rows.map(r => { const c: any = { ...r, fileUrls: parseJson(r.file_urls) }; delete c.file_urls; return c })
    success(res, list)
  } catch (err: any) {
    console.error('获取指导记录失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 删除
router.delete('/:id', requireRole(['teacher', 'student']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const [row] = await query<any>('SELECT * FROM guidance_records WHERE id = ?', [id])
    if (!row) return error(res, '记录不存在', 404)
    if (req.user!.role === 'student' && row.student_id !== req.user!.id) return error(res, '无权删除', 403)
    if (req.user!.role === 'teacher' && row.teacher_id !== req.user!.id) return error(res, '无权删除', 403)
    await query('DELETE FROM guidance_records WHERE id = ?', [id])
    success(res, null, '指导记录已删除')
  } catch (err: any) {
    console.error('删除指导记录失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
