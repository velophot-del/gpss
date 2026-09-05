import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getAcceptedSelection, getCurrentPhase, notify } from './processFlow.js'
import { sendOfficialDocx, type OfficialDocumentType } from './officialDocx.js'

/**
 * 「学生提交 → 教师审核(通过/退回/拒绝)」统一流程工厂。
 * 用于开题(proposals)、中期(midterm_reports)。
 */

interface TextField { column: string; key: string; required?: boolean; label?: string }
interface ReviewStates { pass: string; reject: string; revision: string }

export interface SubmissionConfig {
  table: string
  stagePhase: string          // 对应 cycles.phase，如 'proposal'
  label: string               // 中文名，如 '开题报告'
  titleField?: string         // 有 title 列则填 'title'
  textFields: TextField[]     // 文本字段（不含 title 与 file_urls）
  hasScore?: boolean
  initialStatus: 'not_started' | 'draft'
  submitStatus: string        // 'submitted'
  reviewStates: ReviewStates
  /** 提交本环节前需已完成的前置环节（如开题需任务书确认、中期需开题通过） */
  requiresPrevious?: {
    table: string             // 前置记录表名
    statuses: string[]        // 视为“已完成”的状态
    label: string             // 展示文案，如 '任务书确认'
  }
}

// 学生提交记录的公共展示字段（各环节在此基础上补充各自字段）
export function presentSubmissionBase(row: any) {
  const { file_urls, ...rest } = row
  return {
    ...rest,
    studentId: row.student_id,
    studentName: row.student_name,
    studentCode: row.student_code,
    className: row.class_name,
    topicId: row.topic_id,
    topicTitle: row.topic_title,
    teacherName: row.teacher_name,
    teacherComment: row.teacher_comment,
    reviewedAt: row.reviewed_at,
  }
}

function present(row: any) {
  return {
    ...presentSubmissionBase(row),
    progressSummary: row.progress_summary,
    completedWork: row.completed_work,
    nextPlan: row.next_plan,
  }
}

// 审核状态 → 中文（站内通知用）
function reviewResultLabel(cfg: SubmissionConfig, status: string): string {
  if (status === cfg.reviewStates.pass) return '通过'
  if (status === cfg.reviewStates.revision) return '退回修改'
  if (status === cfg.reviewStates.reject) return cfg.stagePhase === 'midterm' ? '不通过' : '拒绝'
  return status
}

export function createSubmissionRouter(cfg: SubmissionConfig): Router {
  const router = Router()
  router.use(authMiddleware)
  const table = cfg.table

  // 学生提交 / 保存草稿（按 student_id + topic_id 唯一约束 upsert）
  router.post('/', requireRole(['student']), async (req: AuthRequest, res) => {
    try {
      const phase = await getCurrentPhase()
      const submit = req.body.submit !== false
      if (submit && phase !== cfg.stagePhase) return error(res, `当前不在「${cfg.label}」阶段，无法提交`)

      const sel = await getAcceptedSelection(req.user!.id)
      if (!sel) return error(res, `您尚未确定选题，无法提交${cfg.label}`)

      if (submit) {
        if (cfg.titleField && !req.body.title) return error(res, '请填写标题')
        for (const f of cfg.textFields) {
          if (f.required && !req.body[f.key]) return error(res, `请填写${f.label || f.key}`)
        }
      }

      // 前置依赖：同学生同课题须已完成前一环节（如任务书确认、开题通过）才可提交
      if (submit && cfg.requiresPrevious) {
        const dep = cfg.requiresPrevious
        const placeholders = dep.statuses.map(() => '?').join(', ')
        const depRows = await query<any>(
          `SELECT id FROM ${dep.table} WHERE student_id = ? AND topic_id = ? AND status IN (${placeholders}) LIMIT 1`,
          [req.user!.id, sel.topic_id, ...dep.statuses]
        )
        if (!depRows.length) {
          return error(res, `请先完成「${dep.label}」，再提交${cfg.label}`)
        }
      }

      const [existing] = await query<any>(
        `SELECT * FROM ${table} WHERE student_id = ? AND topic_id = ?`,
        [req.user!.id, sel.topic_id]
      )

      // 已通过/拒绝后锁定，需导师退回才能修改
      if (existing && [cfg.submitStatus, cfg.reviewStates.pass, cfg.reviewStates.reject].includes(existing.status)) {
        return error(res, `当前状态「${existing.status}」不可再编辑，请联系导师退回后修改`)
      }

      const targetStatus = submit ? cfg.submitStatus : 'draft'

      const sets: string[] = []
      const params: any[] = []
      if (cfg.titleField && req.body.title !== undefined) { sets.push(`${cfg.titleField} = ?`); params.push(req.body.title) }
      for (const f of cfg.textFields) {
        if (req.body[f.key] !== undefined) { sets.push(`${f.column} = ?`); params.push(req.body[f.key]) }
      }

      let id: string
      if (existing) {
        id = existing.id
        sets.push('status = ?'); params.push(targetStatus)
        await query(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, [...params, id])
      } else {
        id = uuidv4()
        const cols = ['id', 'student_id', 'topic_id', 'cycle_id']
        if (cfg.titleField) cols.push(cfg.titleField)
        for (const f of cfg.textFields) cols.push(f.column)
        cols.push('file_urls', 'status')
        const placeholders = cols.map(() => '?').join(', ')
        const vals: any[] = [id, req.user!.id, sel.topic_id, sel.cycle_id || null]
        if (cfg.titleField) vals.push(req.body.title || '')
        for (const f of cfg.textFields) vals.push(req.body[f.key] ?? null)
        vals.push('[]')
        vals.push(targetStatus)
        await query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, vals)
      }

      if (submit && sel.teacher_id) {
        await notify([sel.teacher_id], `${table}_submitted`, `${cfg.label}待审核`, `学生提交了${cfg.label}，请及时审核`, table, id)
      }
      success(res, { id }, `${submit ? '提交' : '保存'}成功`)
    } catch (err: any) {
      console.error(`[${table}] 提交失败:`, err)
      error(res, '服务器内部错误', 500)
    }
  })

  // 教师审核
  router.put('/:id/review', requireRole(['teacher']), async (req: AuthRequest, res) => {
    try {
      const { id } = req.params
      const { status, comment, score } = req.body
      const allowed = [cfg.reviewStates.pass, cfg.reviewStates.reject, cfg.reviewStates.revision]
      if (!allowed.includes(status)) return error(res, '无效的审核状态')

      const [row] = await query<any>(
        `SELECT ${table}.*, t.teacher_id FROM ${table} JOIN topics t ON ${table}.topic_id = t.id WHERE ${table}.id = ?`,
        [id]
      )
      if (!row) return error(res, '记录不存在')
      if (row.teacher_id !== req.user!.id && req.user!.role !== 'admin') return error(res, '无权审核此记录')

      // 通过不可逆：已通过的环节不能再退回/拒绝
      if (row.status === cfg.reviewStates.pass && status !== cfg.reviewStates.pass) {
        return error(res, `${cfg.label}已通过，过程不可逆，不能再退回或拒绝`)
      }

      if (cfg.hasScore && score !== undefined) {
        await query(
          `UPDATE ${table} SET status = ?, teacher_comment = ?, score = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
          [status, comment ?? null, score, req.user!.id, id]
        )
      } else {
        await query(
          `UPDATE ${table} SET status = ?, teacher_comment = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
          [status, comment ?? null, req.user!.id, id]
        )
      }

      await notify(
        [row.student_id], `${table}_reviewed`, `${cfg.label}审核结果`,
        `您的${cfg.label}审核结果为「${reviewResultLabel(cfg, status)}」${comment ? '：' + comment : ''}`, table, id
      )

      success(res, null, '审核完成')
    } catch (err: any) {
      console.error(`[${table}] 审核失败:`, err)
      error(res, '服务器内部错误', 500)
    }
  })

  // 列表（按角色返回不同数据）
  router.get('/', async (req: AuthRequest, res) => {
    try {
      let rows: any[]
      if (req.user!.role === 'student') {
        rows = await query<any>(`
          SELECT s.*, t.title AS topic_title, t.category, u.real_name AS teacher_name,
                 st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major
          FROM ${table} s
          JOIN topics t ON s.topic_id = t.id
          LEFT JOIN users u ON t.teacher_id = u.id
          LEFT JOIN users st ON s.student_id = st.id
          WHERE s.student_id = ?
          ORDER BY s.updated_at DESC
        `, [req.user!.id])
      } else if (req.user!.role === 'teacher') {
        rows = await query<any>(`
          SELECT s.*, t.title AS topic_title, st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major
          FROM ${table} s
          JOIN topics t ON s.topic_id = t.id
          JOIN users st ON s.student_id = st.id
          WHERE t.teacher_id = ?
          ORDER BY s.updated_at DESC
        `, [req.user!.id])
      } else {
        rows = await query<any>(`
          SELECT s.*, t.title AS topic_title, st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major, u.real_name AS teacher_name
          FROM ${table} s
          JOIN topics t ON s.topic_id = t.id
          JOIN users st ON s.student_id = st.id
          LEFT JOIN users u ON t.teacher_id = u.id
          ORDER BY s.updated_at DESC
        `)
      }

      success(res, rows.map(present))
    } catch (err: any) {
      console.error(`[${table}] 列表失败:`, err)
      error(res, '服务器内部错误', 500)
    }
  })

  // 详情
  router.get('/:id/export', async (req: AuthRequest, res) => {
    try {
      if (cfg.stagePhase !== 'proposal' && cfg.stagePhase !== 'midterm') {
        return error(res, '该环节暂无正式 Word 模板', 404)
      }
      const rows = await query<any>(`
        SELECT s.*, t.title AS topic_title, t.category, t.teacher_id, u.real_name AS teacher_name,
               st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major
        FROM ${table} s
        JOIN topics t ON s.topic_id = t.id
        LEFT JOIN users u ON t.teacher_id = u.id
        LEFT JOIN users st ON s.student_id = st.id
        WHERE s.id = ?`, [req.params.id])
      if (!rows[0]) return error(res, '记录不存在', 404)
      const row = rows[0]
      if (req.user!.role === 'student' && row.student_id !== req.user!.id) return error(res, '无权导出', 403)
      if (req.user!.role === 'teacher' && row.teacher_id !== req.user!.id) return error(res, '无权导出', 403)
      const exportable = ['draft', cfg.submitStatus, cfg.reviewStates.revision, cfg.reviewStates.pass, cfg.reviewStates.reject]
      if (!exportable.includes(row.status)) return error(res, `当前状态无法导出${cfg.label}`)
      const record = present(row)
      await sendOfficialDocx(res, cfg.stagePhase as OfficialDocumentType, record, row.status, cfg.reviewStates.pass)
    } catch (err: any) {
      console.error(`[${table}] 导出失败:`, err)
      error(res, `导出${cfg.label}失败`, 500)
    }
  })

  router.get('/:id', async (req: AuthRequest, res) => {
    try {
      const { id } = req.params
      const rows = await query<any>(`
        SELECT s.*, t.title AS topic_title, t.category, t.teacher_id, u.real_name AS teacher_name,
               st.real_name AS student_name, st.student_id AS student_code, st.class_name, st.major
        FROM ${table} s
        JOIN topics t ON s.topic_id = t.id
        LEFT JOIN users u ON t.teacher_id = u.id
        LEFT JOIN users st ON s.student_id = st.id
        WHERE s.id = ?
      `, [id])
      if (!rows[0]) return error(res, '记录不存在', 404)
      const r = rows[0]

      if (req.user!.role === 'student' && r.student_id !== req.user!.id) return error(res, '无权查看', 403)
      if (req.user!.role === 'teacher' && r.teacher_id !== req.user!.id) return error(res, '无权查看', 403)

      success(res, present(r))
    } catch (err: any) {
      console.error(`[${table}] 详情失败:`, err)
      error(res, '服务器内部错误', 500)
    }
  })

  return router
}
