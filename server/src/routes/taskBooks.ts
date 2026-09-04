import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getAcceptedSelection, getCurrentPhase, notify } from '../utils/processFlow.js'
import { presentSubmissionBase } from '../utils/submissionFlow.js'
import { sendOfficialDocx } from '../utils/officialDocx.js'
import { safeParseJson } from '../utils/json.js'

const router = Router()
router.use(authMiddleware)

const TASK_BOOK_PHASES = ['选题、下达任务书', '实施研究、收集资料', '开题报告', '撰写设计报告、完成初稿', '毕业设计中期检查', '完成修改、定稿', '学术不端检测', '答辩、展览']

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
    if (isSubmit && await getCurrentPhase() !== 'task_book') return error(res, '当前不在「任务书」阶段，无法提交')
    const sel = await getAcceptedSelection(req.user!.id)
    if (!sel) return error(res, '您尚未正式确定课题，无法填写任务书')

    const { content, mainContent, requirements, specificRequirements, submit } = req.body
    const schedule = parseSchedule(req.body.schedule)
    const title = String(req.body.title || '').trim() || sel.topic_title
    if (isSubmit) {
      const required = [
        ['设计目的和意义', content], ['设计主要内容', mainContent],
        ['基本要求', requirements], ['具体要求', specificRequirements], ['阶段工作计划', schedule.length === TASK_BOOK_PHASES.length && schedule.every(item => item.phase && item.month) ? 'ok' : '']
      ]
      const missing = required.find(([, value]) => !String(value || '').trim())
      if (missing) return error(res, `请填写${missing[0]}`)
    }

    const [existing] = await query<any>('SELECT * FROM task_books WHERE student_id = ? AND topic_id = ?', [req.user!.id, sel.topic_id])
    if (existing && ['confirmed', 'submitted', 'issued'].includes(existing.status)) {
      return error(res, existing.status === 'confirmed' ? '任务书已由指导教师确认，如需修改请联系教师退回' : '任务书已提交审核，暂不可修改')
    }

    const status = isSubmit ? 'submitted' : 'draft'
    const values = [title, content ?? null, mainContent ?? null, requirements ?? null,
      specificRequirements ?? null, JSON.stringify(schedule), '[]', status]
    let id: string
    if (existing) {
      id = existing.id
      await query(`UPDATE task_books SET title = ?, content = ?, main_content = ?, requirements = ?,
        specific_requirements = ?, schedule = ?, file_urls = ?, status = ?, updated_at = NOW() WHERE id = ?`, [...values, id])
    } else {
      id = uuidv4()
      await query(`INSERT INTO task_books
        (id, student_id, topic_id, cycle_id, title, content, main_content, requirements, specific_requirements, schedule, file_urls, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, req.user!.id, sel.topic_id, sel.cycle_id || null, ...values])
    }
    if (isSubmit && sel.teacher_id) {
      await notify([sel.teacher_id], 'task_book_submitted', '任务书待确认', `学生提交了任务书「${title}」`, 'task_books', id)
    }
    success(res, { id }, isSubmit ? '任务书已提交，待指导教师确认' : '任务书草稿已保存')
  } catch (err: any) {
    console.error('填写任务书失败:', err)
    error(res, '服务器内部错误', 500)
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
    success(res, rows.map(present))
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
    error(res, '导出任务书失败', 500)
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
