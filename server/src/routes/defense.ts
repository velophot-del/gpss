import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getDefenseScoreAccess, getDefenseScoreListScope, parseRequiredScore } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'

const router = Router()
router.use(authMiddleware)

function parseJsonArray(v: any): any[] {
  const parsed = safeParseJson<unknown[]>(v, [])
  return Array.isArray(parsed) ? parsed : []
}

// ===== 答辩分组 =====

// 分组列表（按角色过滤）
router.get('/groups', async (req: AuthRequest, res) => {
  try {
    let rows: any[]
    if (req.user!.role === 'student') {
      rows = await query<any>(
        `SELECT * FROM defense_groups WHERE JSON_CONTAINS(students, JSON_QUOTE(?)) ORDER BY defense_date`,
        [req.user!.id]
      )
    } else if (req.user!.role === 'teacher') {
      rows = await query<any>(
        `SELECT * FROM defense_groups WHERE JSON_CONTAINS(judges, JSON_QUOTE(?)) OR created_by = ? ORDER BY defense_date`,
        [req.user!.id, req.user!.id]
      )
    } else {
      rows = await query<any>(`SELECT * FROM defense_groups ORDER BY defense_date`)
    }

    const list = await Promise.all(rows.map(async g => {
      const judges = await query<any>(
        `SELECT id, real_name, title FROM users WHERE id IN (?)`,
        [parseJsonArray(g.judges)]
      )
      const students = await query<any>(
        `SELECT id, real_name, student_id, class_name, major FROM users WHERE id IN (?)`,
        [parseJsonArray(g.students)]
      )
      return {
        ...g,
        judges: judges,
        students: students,
        judgesJson: undefined,
        studentsJson: undefined
      }
    }))
    success(res, list)
  } catch (err: any) {
    console.error('获取答辩分组失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 创建分组（管理员）
router.post('/groups', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { name, defenseDate, location, judges, students, cycleId } = req.body
    if (!name) return error(res, '请填写分组名称')
    const id = uuidv4()
    await query(`
      INSERT INTO defense_groups (id, cycle_id, name, defense_date, location, judges, students, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, cycleId || null, name, defenseDate || null, location || null,
      JSON.stringify(judges || []), JSON.stringify(students || []), req.user!.id])
    success(res, { id }, '答辩分组已创建')
  } catch (err: any) {
    console.error('创建答辩分组失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 更新分组
router.put('/groups/:id', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const [row] = await query<any>('SELECT * FROM defense_groups WHERE id = ?', [id])
    if (!row) return error(res, '分组不存在', 404)
    const { name, defenseDate, location, judges, students, status } = req.body
    await query(`
      UPDATE defense_groups SET name = ?, defense_date = ?, location = ?, judges = ?, students = ?, status = ?
      WHERE id = ?
    `, [name ?? row.name, defenseDate ?? row.defense_date, location ?? row.location,
      judges !== undefined ? JSON.stringify(judges) : row.judges,
      students !== undefined ? JSON.stringify(students) : row.students,
      status ?? row.status, id])
    success(res, null, '分组已更新')
  } catch (err: any) {
    console.error('更新答辩分组失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 删除分组
router.delete('/groups/:id', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    await query('DELETE FROM defense_groups WHERE id = ?', [id])
    success(res, null, '分组已删除')
  } catch (err: any) {
    console.error('删除答辩分组失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// ===== 答辩评分 =====

// 提交/更新评分（评委，按 group+student+judge 唯一 upsert）
router.post('/scores', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { groupId, studentId, score, comment } = req.body
    if (!groupId || !studentId || score === undefined) return error(res, '缺少必要参数')

    const [group] = await query<any>('SELECT * FROM defense_groups WHERE id = ?', [groupId])
    if (!group) return error(res, '分组不存在')
    const judges = parseJsonArray(group.judges)
    const students = parseJsonArray(group.students)
    if (!judges.includes(req.user!.id) && req.user!.role !== 'admin') return error(res, '您不是该组的评委', 403)
    if (!students.includes(studentId)) return error(res, '该学生不在本组', 400)

    let numScore: number
    try {
      numScore = parseRequiredScore(score)
    } catch (validationError: any) {
      return error(res, validationError.message)
    }

    const [existing] = await query<any>(
      'SELECT id FROM defense_scores WHERE group_id = ? AND student_id = ? AND judge_id = ?',
      [groupId, studentId, req.user!.id]
    )

    if (existing) {
      await query(`
        UPDATE defense_scores SET score = ?, comment = ?, updated_at = NOW() WHERE id = ?
      `, [numScore, comment ?? null, existing.id])
    } else {
      await query(`
        INSERT INTO defense_scores (id, group_id, student_id, judge_id, score, comment)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [uuidv4(), groupId, studentId, req.user!.id, numScore, comment ?? null])
    }
    success(res, null, '评分已提交')
  } catch (err: any) {
    console.error('提交评分失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 查询评分：?groupId= 时返回该组全部；否则按角色返回（评委看自己打的，学生看自己被评的）
router.get('/scores', async (req: AuthRequest, res) => {
  try {
    const { groupId } = req.query
    let rows: any[]
    if (groupId) {
      const [group] = await query<any>('SELECT judges, students, created_by FROM defense_groups WHERE id = ?', [groupId])
      if (!group) return error(res, '分组不存在', 404)
      const access = getDefenseScoreAccess(req.user!, group)
      if (access === 'none') return error(res, '无权查看该组评分', 403)

      rows = await query<any>(`
        SELECT ds.*, j.real_name AS judge_name, s.real_name AS student_name, s.student_id AS student_code
        FROM defense_scores ds
        JOIN users j ON ds.judge_id = j.id
        JOIN users s ON ds.student_id = s.id
        WHERE ds.group_id = ?${access === 'self' ? ' AND ds.student_id = ?' : ''}
        ORDER BY ds.student_id, ds.judge_id
      `, access === 'self' ? [groupId, req.user!.id] : [groupId])
    } else if (getDefenseScoreListScope(req.user!) === 'student') {
      rows = await query<any>(`
        SELECT ds.*, j.real_name AS judge_name, g.name AS group_name
        FROM defense_scores ds
        JOIN users j ON ds.judge_id = j.id
        JOIN defense_groups g ON ds.group_id = g.id
        WHERE ds.student_id = ?
        ORDER BY ds.created_at DESC
      `, [req.user!.id])
    } else if (getDefenseScoreListScope(req.user!) === 'judge') {
      rows = await query<any>(`
        SELECT ds.*, j.real_name AS judge_name, s.real_name AS student_name, s.student_id AS student_code, g.name AS group_name
        FROM defense_scores ds
        JOIN users j ON ds.judge_id = j.id
        JOIN users s ON ds.student_id = s.id
        JOIN defense_groups g ON ds.group_id = g.id
        WHERE ds.judge_id = ?
        ORDER BY ds.created_at DESC
      `, [req.user!.id])
    } else {
      rows = await query<any>(`
        SELECT ds.*, j.real_name AS judge_name, s.real_name AS student_name, s.student_id AS student_code, g.name AS group_name
        FROM defense_scores ds
        JOIN users j ON ds.judge_id = j.id
        JOIN users s ON ds.student_id = s.id
        JOIN defense_groups g ON ds.group_id = g.id
        ORDER BY ds.created_at DESC
      `)
    }
    success(res, rows)
  } catch (err: any) {
    console.error('获取评分失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
