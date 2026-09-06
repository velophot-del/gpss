import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getCycleMajors, getCycleResearchCategories } from '../utils/majors.js'
import { getActiveCycle } from '../utils/processFlow.js'

// 个人选题库（模板层）：只存题目内容，不挂周期/报名，随时可改不锁。
// 发布：POST /api/templates/:id/offer -> 在目标周期生成一条 pending 选题（发布记录），内容为该次发布的快照。

const router = Router()
router.use(authMiddleware)

// 校验“研究方向/专业”是否属于目标周期配置（与 topics 创建规则一致；仅发布进周期时启用）
async function assertInCycleConfig(category: any, majorCode: any, cycleId?: any): Promise<string | null> {
  const targetCycleId = cycleId ?? (await getActiveCycle())?.id ?? null
  const [majors, cats] = await Promise.all([getCycleMajors(targetCycleId), getCycleResearchCategories(targetCycleId)])
  const allowedCategories = new Set<string>()
  for (const list of Object.values(cats)) list.forEach((c: string) => allowedCategories.add(c))
  if (typeof category !== 'string' || !allowedCategories.has(category)) {
    return category ? `研究方向「${category}」不在当期允许的研究方向内` : '请选择研究方向'
  }
  if (typeof majorCode !== 'string' || !majors.some(m => m.code === majorCode)) {
    const allowed = majors.map(m => `${m.name}(${m.code})`).join('、')
    return majorCode ? `专业代码「${majorCode}」不在当期配置的毕业专业内（允许：${allowed}）` : `请选择专业（当期配置：${allowed}）`
  }
  return null
}

const fmt = (t: any) => ({
  ...t,
  majorCode: t.major_code,
  maxStudentsDefault: t.max_students_default,
  offerCount: Number(t.offer_count || 0),
  acceptedTotal: Number(t.accepted_total || 0),
  lastCycleName: t.last_cycle_name || null,
  tags: typeof t.tags === 'string' ? JSON.parse(t.tags) : (t.tags || []),
  schedules: typeof t.schedules === 'string' ? JSON.parse(t.schedules) : (t.schedules || []),
  attachments: typeof t.attachments === 'string' ? JSON.parse(t.attachments) : (t.attachments || []),
  groupName: t.group_name,
  createdAt: t.created_at,
  updatedAt: t.updated_at
})

const fmtSql = `
  tp.*,
  (SELECT COUNT(*) FROM topics t WHERE t.template_id = tp.id) AS offer_count,
  (SELECT COUNT(*) FROM applications a
     JOIN topics t ON t.id = a.topic_id AND a.status = 'accepted'
   WHERE t.template_id = tp.id) AS accepted_total,
  (SELECT c.name FROM topics t JOIN cycles c ON t.cycle_id = c.id
    WHERE t.template_id = tp.id ORDER BY t.created_at DESC LIMIT 1) AS last_cycle_name
`

// GET /api/templates - 本人题库列表（含每条的发布统计）
router.get('/', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { keyword, status, group } = req.query
    let sql = `SELECT ${fmtSql} FROM topic_templates tp WHERE tp.teacher_id = ?`
    const params: any[] = [req.user!.id]
    if (status && status !== 'all') { sql += ' AND tp.status = ?'; params.push(status) }
    if (group && group !== 'all') { sql += ' AND tp.group_name = ?'; params.push(group) }
    if (keyword) { sql += ' AND tp.title LIKE ?'; params.push(`%${keyword}%`) }
    sql += ' ORDER BY tp.updated_at DESC'
    const rows = await query<any>(sql, params)
    success(res, rows.map(fmt))
  } catch (err: any) {
    console.error('获取选题库失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// POST /api/templates - 新建模板（宽松校验：库可存往年配置下的老题，发布进周期时才严格校验）
router.post('/', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { title, category, description, difficulty, maxStudents, tags, requirements, schedules, attachments, major, majorCode, groupName } = req.body
    if (!title || !category) return error(res, '标题和研究方向为必填项')
    const id = uuidv4()
    await query(`
      INSERT INTO topic_templates (id, teacher_id, title, description, category, major, major_code, difficulty,
                                   max_students_default, tags, requirements, schedules, attachments, group_name, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `, [id, req.user!.id, title, description ?? null, category, major ?? null, majorCode ?? null, difficulty || 'medium',
        maxStudents || 1, JSON.stringify(tags || []), requirements ?? '', JSON.stringify(schedules || []), JSON.stringify(attachments || []), groupName ?? null])
    success(res, { id }, '已保存到个人选题库')
  } catch (err: any) {
    console.error('新建模板失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// PUT /api/templates/:id - 编辑模板（本人，不锁）
router.put('/:id', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { title, category, description, difficulty, maxStudents, tags, requirements, schedules, attachments, major, majorCode, groupName, status } = req.body
    const [row] = await query<any>('SELECT * FROM topic_templates WHERE id = ? AND teacher_id = ?', [id, req.user!.id])
    if (!row) return error(res, '模板不存在或非本人创建', 404)
    await query(`
      UPDATE topic_templates SET title=?, description=?, category=?, major=?, major_code=?, difficulty=?,
        max_students_default=?, tags=?, requirements=?, schedules=?, attachments=?, group_name=?, status=?
      WHERE id=?
    `, [
      title ?? row.title, description ?? row.description, category ?? row.category,
      major ?? row.major ?? null, majorCode ?? row.major_code ?? null, difficulty ?? row.difficulty,
      maxStudents ?? row.max_students_default,
      JSON.stringify(tags ?? (typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []))),
      requirements ?? row.requirements ?? '',
      JSON.stringify(schedules ?? (typeof row.schedules === 'string' ? JSON.parse(row.schedules || '[]') : (row.schedules || []))),
      JSON.stringify(attachments ?? (typeof row.attachments === 'string' ? JSON.parse(row.attachments || '[]') : (row.attachments || []))),
      groupName ?? row.group_name ?? null, status ?? row.status, id
    ])
    success(res, null, '题库模板已更新')
  } catch (err: any) {
    console.error('编辑模板失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// DELETE /api/templates/:id - 删除模板（被历届发布引用时禁止删除，提示归档）
router.delete('/:id', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const [row] = await query<any>('SELECT id FROM topic_templates WHERE id = ? AND teacher_id = ?', [id, req.user!.id])
    if (!row) return error(res, '模板不存在或非本人创建', 404)
    const [cnt] = await query<any>('SELECT COUNT(*) AS n FROM topics WHERE template_id = ?', [id])
    if (Number(cnt.n) > 0) return error(res, '该模板已被历届选题引用，不能删除；如需停用请改为归档', 400)
    await query('DELETE FROM topic_templates WHERE id = ?', [id])
    success(res, null, '模板已删除')
  } catch (err: any) {
    console.error('删除模板失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// POST /api/templates/:id/duplicate - 复制一条模板副本
router.post('/:id/duplicate', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const [src] = await query<any>('SELECT * FROM topic_templates WHERE id = ? AND teacher_id = ?', [id, req.user!.id])
    if (!src) return error(res, '模板不存在或非本人创建', 404)
    const newId = uuidv4()
    await query(`
      INSERT INTO topic_templates (id, teacher_id, title, description, category, major, major_code, difficulty,
                                   max_students_default, tags, requirements, schedules, attachments, group_name, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `, [newId, req.user!.id, src.title, src.description, src.category, src.major, src.major_code, src.difficulty,
        src.max_students_default, JSON.stringify(src.tags ?? []), src.requirements ?? '', JSON.stringify(src.schedules ?? []),
        JSON.stringify(src.attachments ?? []), src.group_name ?? null])
    success(res, { id: newId }, '已复制为新的题库模板')
  } catch (err: any) {
    console.error('复制模板失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// POST /api/templates/:id/offer - 从模板提报选题到周期（生成 pending 发布记录，快照内容可被覆盖字段局部覆盖）
router.post('/:id/offer', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const [tpl] = await query<any>('SELECT * FROM topic_templates WHERE id = ? AND teacher_id = ?', [id, req.user!.id])
    if (!tpl) return error(res, '模板不存在或非本人创建', 404)
    if (tpl.status !== 'active') return error(res, '该模板已停用/归档，不能发布', 400)

    const body = req.body || {}
    const active = await getActiveCycle()
    const targetCycleId = body.cycleId != null && body.cycleId !== '' ? Number(body.cycleId) : active?.id ?? null
    if (!targetCycleId) return error(res, '当前没有进行中的选题周期，请选择目标周期后再发布', 400)

    // 内容快照 = 模板字段 + 本次覆盖项
    const snap = (v: any, d: any) => (v === undefined ? d : v)
    const category = snap(body.category, tpl.category)
    const majorCode = snap(body.majorCode, tpl.major_code)
    const cfgMsg = await assertInCycleConfig(category, majorCode, targetCycleId)
    if (cfgMsg) return error(res, cfgMsg, 400)

    const toJson = (v: any, d: any) => (typeof v === 'string' ? v : JSON.stringify(v ?? d ?? []))
    const newId = uuidv4()
    await query(`
      INSERT INTO topics (id, title, description, category, difficulty, max_students, status, teacher_id,
                          tags, requirements, schedules, attachments, cycle_id, major, major_code, template_id)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [newId, snap(body.title, tpl.title), snap(body.description, tpl.description), category,
        snap(body.difficulty, tpl.difficulty), snap(body.maxStudents, tpl.max_students_default) || 1,
        req.user!.id,
        toJson(body.tags, tpl.tags), snap(body.requirements, tpl.requirements) ?? '',
        toJson(body.schedules, tpl.schedules), toJson(body.attachments, tpl.attachments),
        targetCycleId, snap(body.major, tpl.major) ?? null, majorCode ?? null, id])
    success(res, { id: newId }, '已提交至学院审核（本周期）')
  } catch (err: any) {
    console.error('从模板发布失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
