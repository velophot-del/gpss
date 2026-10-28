import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getAcceptedSelection, getCyclePhase, notify } from '../utils/processFlow.js'
import { presentSubmissionBase } from '../utils/submissionFlow.js'
import { sendOfficialDocx } from '../utils/officialDocx.js'
import { safeParseJson } from '../utils/json.js'
import { resolveMaterialTemplate, materialValues, bindMaterial, materialPresentation } from '../services/materialTemplateService.js'
import { TemplateError } from '../utils/templateContract.js'

const router = Router()
router.use(authMiddleware)

function parseSchedule(value: unknown): Array<{ phase: string; month: number | '' }> {
  const parsed = safeParseJson<Array<{ phase: string; month: number | '' }>>(value, [])
  return Array.isArray(parsed) ? parsed : []
}

function present(row: any) {
  return {
    ...presentSubmissionBase(row),
    teacherTitle: row.teacher_title || '',
    mainContent: row.main_content,
    specificRequirements: row.specific_requirements,
    schedule: parseSchedule(row.schedule),
  }
}

// 本校任务书：学生填写 → 指导教师确认。确认后仅允许教师退回修改。
router.post('/', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const isSubmit = req.body.submit !== false
    const sel = await getAcceptedSelection(req.user!.id)
    if (!sel) return error(res, '您尚未正式确定课题，无法填写任务书')
    if (isSubmit && await getCyclePhase(sel.cycle_id) !== 'task_book') return error(res, '当前不在「任务书」阶段，无法提交')

    const [existing] = await query<any>('SELECT * FROM task_books WHERE student_id = ? AND topic_id = ?', [req.user!.id, sel.topic_id])
    if (existing && ['confirmed', 'submitted', 'issued'].includes(existing.status)) {
      return error(res, existing.status === 'confirmed' ? '任务书已由指导教师确认，如需修改请联系教师退回' : '任务书已提交审核，暂不可修改')
    }
    const selected = await resolveMaterialTemplate('task_book', sel.cycle_id, existing?.id)
    if (req.body.templateId !== selected.template.id) throw new TemplateError('模板版本已变化，请刷新页面后重新保存')
    const input = materialValues(selected.template.profile, req.body.templateValues, isSubmit)
    const { content, mainContent, requirements, specificRequirements } = input
    const title = String(input.title || sel.topic_title)

    const status = isSubmit ? 'submitted' : 'draft'
    const values = [title, content ?? existing?.content ?? null, mainContent ?? existing?.main_content ?? null, requirements ?? existing?.requirements ?? null,
      specificRequirements ?? existing?.specific_requirements ?? null, existing?.schedule ?? '[]', JSON.stringify(safeParseJson(existing?.file_urls, [])), status]
    const id = existing?.id || uuidv4()
    await transaction(async conn => {
    const [locked] = await conn.query<any[]>('SELECT status FROM task_books WHERE student_id = ? AND topic_id = ? FOR UPDATE', [req.user!.id, sel.topic_id])
    if (existing && !locked.length) throw new TemplateError('任务书记录已变化，请刷新后重试')
    if (locked[0] && !['draft', 'need_revision'].includes(locked[0].status)) throw new TemplateError('任务书状态已变化，请刷新后重试')
    if (existing) {
      await conn.query(`UPDATE task_books SET title = ?, content = ?, main_content = ?, requirements = ?,
        specific_requirements = ?, schedule = ?, file_urls = ?, status = ?, updated_at = NOW() WHERE id = ?`, [...values, id])
    } else {
      await conn.query(`INSERT INTO task_books
        (id, student_id, topic_id, cycle_id, title, content, main_content, requirements, specific_requirements, schedule, file_urls, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, req.user!.id, sel.topic_id, sel.cycle_id || null, ...values])
    }
    await bindMaterial(conn, 'task_book', id, sel.cycle_id, selected, input)
    })
    if (isSubmit && sel.teacher_id) {
      await notify([sel.teacher_id], 'task_book_submitted', '任务书待确认', `学生提交了任务书「${title}」`, 'task_books', id)
    }
    success(res, { id }, isSubmit ? '任务书已提交，待指导教师确认' : '任务书草稿已保存')
  } catch (err: any) {
    console.error('填写任务书失败:', err)
    error(res, err.message || '服务器内部错误', err.status || 500)
  }
})

router.put('/:id/review', requireRole(['teacher', 'admin']), async (req: AuthRequest, res) => {
  try {
    const { status, comment } = req.body
    if (!['confirmed', 'need_revision'].includes(status)) return error(res, '无效的确认状态')
    const [row] = await query<any>(`
      SELECT tb.*, t.teacher_id FROM task_books tb JOIN topics t ON tb.topic_id = t.id WHERE tb.id = ?
    `, [req.params.id])
    if (!row) return error(res, '记录不存在', 404)
    if (req.user!.role !== 'admin' && row.teacher_id !== req.user!.id) return error(res, '无权确认此任务书', 403)
    if (row.status !== 'submitted' && row.status !== 'need_revision') return error(res, '仅可确认已提交的任务书')

    await query(`UPDATE task_books SET status = ?, teacher_comment = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ?`, [status, comment ?? null, req.user!.id, row.id])
    await notify([row.student_id], 'task_book_reviewed', '任务书确认结果',
      status === 'confirmed' ? '您的任务书已由指导教师确认' : `您的任务书需修改${comment ? '：' + comment : ''}`,
      'task_books', row.id)
    success(res, null, status === 'confirmed' ? '任务书已确认' : '已退回学生修改')
  } catch (err: any) {
    console.error('确认任务书失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

router.get('/', async (req: AuthRequest, res) => {
  try {
    let rows: any[]
    if (req.user!.role === 'student') {
      rows = await query<any>(`
        SELECT tb.*, t.title AS topic_title, u.real_name AS teacher_name
        FROM task_books tb JOIN topics t ON tb.topic_id = t.id LEFT JOIN users u ON t.teacher_id = u.id
        WHERE tb.student_id = ? ORDER BY tb.updated_at DESC`, [req.user!.id])
    } else if (req.user!.role === 'teacher') {
      rows = await query<any>(`
        SELECT tb.*, t.title AS topic_title, st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major
        FROM task_books tb JOIN topics t ON tb.topic_id = t.id JOIN users st ON tb.student_id = st.id
        WHERE t.teacher_id = ? ORDER BY tb.updated_at DESC`, [req.user!.id])
    } else {
      rows = await query<any>(`
        SELECT tb.*, t.title AS topic_title, st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major,
          u.real_name AS teacher_name
        FROM task_books tb JOIN topics t ON tb.topic_id = t.id JOIN users st ON tb.student_id = st.id
        LEFT JOIN users u ON t.teacher_id = u.id ORDER BY tb.updated_at DESC`)
    }
    success(res, await Promise.all(rows.map(async row => ({ ...present(row), ...await materialPresentation('task_book', row) }))))
  } catch (err: any) {
    console.error('获取任务书失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

router.get('/:id/export', async (req: AuthRequest, res) => {
  try {
    const [row] = await query<any>(`
      SELECT tb.*, t.title AS topic_title, t.teacher_id, t.schedules AS topic_schedules, u.real_name AS teacher_name,
        u.title AS teacher_title,
        st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major,
        c.phases_config, c.start_date AS cycle_start_date, c.end_date AS cycle_end_date
      FROM task_books tb JOIN topics t ON tb.topic_id = t.id
      LEFT JOIN users u ON t.teacher_id = u.id LEFT JOIN users st ON tb.student_id = st.id
      LEFT JOIN cycles c ON tb.cycle_id = c.id WHERE tb.id = ?`, [req.params.id])
    if (!row) return error(res, '记录不存在', 404)
    if (req.user!.role === 'student' && row.student_id !== req.user!.id) return error(res, '无权导出', 403)
    if (req.user!.role === 'teacher' && row.teacher_id !== req.user!.id) return error(res, '无权导出', 403)
    if (!['draft', 'submitted', 'need_revision', 'confirmed', 'issued'].includes(row.status)) return error(res, '当前状态无法导出任务书')
    const record = { ...present(row), topicSchedules: row.topic_schedules, phasesConfig: row.phases_config }
    await sendOfficialDocx(res, 'task-book', record, row.status, 'confirmed')
  } catch (err: any) {
    console.error('导出任务书失败:', err)
    error(res, err.message || '导出任务书失败', err.status || 500)
  }
})

router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const [row] = await query<any>(`
      SELECT tb.*, t.title AS topic_title, t.teacher_id, u.real_name AS teacher_name,
        st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major
      FROM task_books tb JOIN topics t ON tb.topic_id = t.id
      LEFT JOIN users u ON t.teacher_id = u.id LEFT JOIN users st ON tb.student_id = st.id WHERE tb.id = ?`, [req.params.id])
    if (!row) return error(res, '记录不存在', 404)
    if (req.user!.role === 'student' && row.student_id !== req.user!.id) return error(res, '无权查看', 403)
    if (req.user!.role === 'teacher' && row.teacher_id !== req.user!.id) return error(res, '无权查看', 403)
    success(res, present(row))
  } catch (err: any) {
    console.error('获取任务书详情失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
