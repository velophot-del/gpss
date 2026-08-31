import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getAcceptedSelection, notify } from '../utils/processFlow.js'
import { computeWeightedGrade, parseOptionalScore } from '../utils/policies.js'

const router = Router()
router.use(authMiddleware)

async function defenseAvg(studentId: string): Promise<number | null> {
  const rows = await query<any>(
    'SELECT AVG(score) AS avg FROM defense_scores WHERE student_id = ?',
    [studentId]
  )
  const avg = Number(rows[0]?.avg)
  return rows[0]?.avg == null || isNaN(avg) ? null : Math.round(avg * 10) / 10
}

// 列表（按角色）
router.get('/', async (req: AuthRequest, res) => {
  try {
    let rows: any[]
    if (req.user!.role === 'student') {
      rows = await query<any>(`
        SELECT g.*, t.title AS topic_title, u.real_name AS teacher_name
        FROM grades g
        JOIN topics t ON g.topic_id = t.id
        LEFT JOIN users u ON t.teacher_id = u.id
        WHERE g.student_id = ?
        ORDER BY g.updated_at DESC
      `, [req.user!.id])
    } else if (req.user!.role === 'teacher') {
      rows = await query<any>(`
        SELECT g.*, t.title AS topic_title, st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major
        FROM grades g
        JOIN topics t ON g.topic_id = t.id
        JOIN users st ON g.student_id = st.id
        WHERE t.teacher_id = ?
        ORDER BY g.updated_at DESC
      `, [req.user!.id])
    } else {
      rows = await query<any>(`
        SELECT g.*, t.title AS topic_title, st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major, u.real_name AS teacher_name
        FROM grades g
        JOIN topics t ON g.topic_id = t.id
        JOIN users st ON g.student_id = st.id
        LEFT JOIN users u ON t.teacher_id = u.id
        ORDER BY g.updated_at DESC
      `)
    }
    const list = await Promise.all(rows.map(async r => ({
      ...r,
      defenseAvg: await defenseAvg(r.student_id)
    })))
    success(res, list)
  } catch (err: any) {
    console.error('获取成绩失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 录入/更新成绩（管理员/导师，按 student+topic upsert）
router.post('/', requireRole(['admin', 'teacher']), async (req: AuthRequest, res) => {
  try {
    const { studentId, supervisorScore, reviewScore, defenseScore, publish } = req.body
    if (!studentId) return error(res, '请选择学生')

    const sel = await getAcceptedSelection(studentId)
    if (!sel) return error(res, '该学生尚无已录取的选题')
    if (req.user!.role === 'teacher' && sel.teacher_id !== req.user!.id) return error(res, '只能为名下学生录入成绩')

    let s: number | null
    let r: number | null
    let d: number | null
    try {
      s = parseOptionalScore(supervisorScore)
      r = parseOptionalScore(reviewScore)
      d = parseOptionalScore(defenseScore)
    } catch (validationError: any) {
      return error(res, validationError.message)
    }
    const { total, level } = computeWeightedGrade(s, r, d)
    if (publish && total == null) return error(res, '至少录入一项成绩后才能发布')
    const status = publish ? 'published' : 'pending'

    const [existing] = await query<any>('SELECT id FROM grades WHERE student_id = ? AND topic_id = ?', [studentId, sel.topic_id])

    if (existing) {
      await query(`
        UPDATE grades SET supervisor_score = ?, review_score = ?, defense_score = ?,
          total_score = ?, grade_level = ?, status = ?, updated_at = NOW()
        WHERE id = ?
      `, [s, r, d, total, level, status, existing.id])
      success(res, { id: existing.id }, '成绩已更新')
    } else {
      const id = uuidv4()
      await query(`
        INSERT INTO grades (id, student_id, topic_id, cycle_id, supervisor_score, review_score, defense_score, total_score, grade_level, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, studentId, sel.topic_id, sel.cycle_id || null, s, r, d, total, level, status])
      success(res, { id }, '成绩已录入')
    }

    if (status === 'published') {
      await notify([studentId], 'grade_published', '成绩已发布', '您的毕业设计成绩已发布，请查看', 'grades', existing?.id || undefined)
    }
  } catch (err: any) {
    console.error('录入成绩失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 发布成绩
router.put('/:id/publish', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const [row] = await query<any>('SELECT * FROM grades WHERE id = ?', [id])
    if (!row) return error(res, '成绩记录不存在', 404)

    let d = row.defense_score
    if (d == null) d = await defenseAvg(row.student_id)
    const { total, level } = computeWeightedGrade(row.supervisor_score, row.review_score, d)
    if (total == null) return error(res, '至少录入一项成绩后才能发布')

    await query(`
      UPDATE grades SET defense_score = ?, total_score = ?, grade_level = ?, status = 'published',
        published_by = ?, published_at = NOW()
      WHERE id = ?
    `, [d, total, level, req.user!.id, id])

    await notify([row.student_id], 'grade_published', '成绩已发布', '您的毕业设计成绩已发布，请查看', 'grades', id)
    success(res, null, '成绩已发布')
  } catch (err: any) {
    console.error('发布成绩失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
