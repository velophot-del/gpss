import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error, paginated } from '../utils/response.js'
import { getStudentMajorCode, getTopicAccessPolicy, isTopicVisible } from '../utils/topicAccess.js'
import { getActiveCycle } from '../utils/processFlow.js'

const router = Router()
router.use(authMiddleware)

// GET /api/topics - 课题列表（学生浏览用，只返回已发布的）
router.get('/', async (req: AuthRequest, res) => {
  try {
    const { page = '1', pageSize = '12', keyword, category, difficulty } = req.query
    const p = Math.max(1, Number(page))
    const ps = Math.min(50, Math.max(1, Number(pageSize)))
    const offset = (p - 1) * ps

    let whereSql = `WHERE t.status = 'published'`
    const params: any[] = []

    if (req.user!.role === 'student') {
      const majorCode = await getStudentMajorCode(req.user!.id)
      const active = await getActiveCycle()
      const policy = await getTopicAccessPolicy(active?.id)
      if (policy.mode === 'all') {
        // 管理员允许学生查看全部专业课题
      } else if (policy.mode === 'matrix') {
        const allowed = policy.matrix[majorCode] || []
        if (!allowed.length) whereSql += ' AND 1 = 0'
        else { whereSql += ` AND t.major_code IN (${allowed.map(() => '?').join(',')})`; params.push(...allowed) }
      } else if (majorCode) {
        whereSql += ' AND t.major_code = ?'; params.push(majorCode)
      } else whereSql += ' AND 1 = 0'
    }

    if (keyword) {
      whereSql += ` AND (t.title LIKE ? OR t.description LIKE ?)`
      params.push(`%${keyword}%`, `%${keyword}%`)
    }
    if (category) {
      whereSql += ` AND t.category = ?`
      params.push(category)
    }
    if (difficulty) {
      whereSql += ` AND t.difficulty = ?`
      params.push(difficulty)
    }
    if (req.query.major && req.user!.role !== 'student') {
      whereSql += ` AND t.major = ?`
      params.push(req.query.major)
    }

    const list = await query<any>(`
      SELECT t.*, u.real_name AS teacher_name, u.title AS teacher_title, u.department, u.email AS teacher_email, u.phone AS teacher_phone, u.avatar AS teacher_avatar,
             COALESCE(ac.cnt, 0) AS apply_count
      FROM topics t
      LEFT JOIN users u ON t.teacher_id = u.id
      LEFT JOIN (SELECT topic_id, COUNT(*) AS cnt FROM applications WHERE status != 'withdrawn' GROUP BY topic_id) ac ON t.id = ac.topic_id
      ${whereSql}
      ORDER BY t.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, ps, offset])

    const countResult = await query(`SELECT COUNT(*) as total FROM topics t ${whereSql}`, params)
    const total = (countResult as any)[0]?.total || 0

    const formattedList = list.map((item: any) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      category: item.category,
      difficulty: item.difficulty,
      maxStudents: item.max_students,
      currentCount: Number(item.apply_count),
      status: item.status,
      teacherId: item.teacher_id,
      teacherName: item.teacher_name,
      teacherTitle: item.teacher_title,
      teacherDepartment: item.department,
      teacherEmail: item.teacher_email,
      teacherPhone: item.teacher_phone,
      teacherAvatar: item.teacher_avatar,
      cycleId: item.cycle_id,
      tags: typeof item.tags === 'string' ? JSON.parse(item.tags) : item.tags || [],
      requirements: item.requirements,
      viewCount: item.view_count,
      applyCount: Number(item.apply_count),
      schedules: typeof item.schedules === 'string' ? JSON.parse(item.schedules) : item.schedules || [],
      attachments: typeof item.attachments === 'string' ? JSON.parse(item.attachments) : item.attachments || [],
      major: item.major,
      majorCode: item.major_code,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }))

    paginated(res, formattedList, total, p, ps)
  } catch (err: any) {
    console.error('获取课题列表失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// ===== 教师专用：我的课题列表（必须在 :id 之前注册，否则被 :id 误匹配） =====

// GET /api/topics/teacher/mine - 我的课题（教师）
router.get('/teacher/mine', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { keyword, status } = req.query
    let sql = `
      SELECT t.*,
             u.real_name AS teacher_name,
             u.title AS teacher_title,
             u.department AS teacher_department,
             u.email AS teacher_email,
             u.phone AS teacher_phone,
             u.avatar AS teacher_avatar,
             COALESCE(ac.apply_count, 0) AS apply_count,
             COALESCE(ac.accepted_count, 0) AS accepted_count
      FROM topics t
      LEFT JOIN users u ON t.teacher_id = u.id
      LEFT JOIN (
        SELECT topic_id,
               COUNT(*) AS apply_count,
               SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted_count
        FROM applications
        WHERE status != 'withdrawn'
        GROUP BY topic_id
      ) ac ON ac.topic_id = t.id
      WHERE t.teacher_id = ?`
    const params: any[] = [req.user!.id]

    if (status) {
      sql += ` AND status = ?`
      params.push(status)
    }
    if (keyword) {
      sql += ` AND title LIKE ?`
      params.push(`%${keyword}%`)
    }

    sql += ` ORDER BY updated_at DESC`

    const list = await query<any>(sql, params)
    
    // 字段名转换：下划线转驼峰
    const formattedList = list.map(item => ({
      ...item,
      teacherId: item.teacher_id,
      teacherName: item.teacher_name,
      teacherTitle: item.teacher_title,
      teacherDepartment: item.teacher_department,
      teacherEmail: item.teacher_email,
      teacherPhone: item.teacher_phone,
      teacherAvatar: item.teacher_avatar,
      maxStudents: item.max_students,
      applyCount: Number(item.apply_count),
      currentCount: Number(item.accepted_count),
      viewCount: item.view_count,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      cycleId: item.cycle_id,
      major: item.major,
      majorCode: item.major_code
    }))
    
    success(res, formattedList)
  } catch (err: any) {
    console.error('获取教师课题失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/topics/:id - 课题详情
router.get('/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params

    const topicRows = await query(`
      SELECT t.*, u.real_name AS teacher_name, u.title AS teacher_title, u.department,
             u.email AS teacher_email, u.phone AS teacher_phone, u.avatar AS teacher_avatar,
             c.name AS cycle_name
      FROM topics t
      LEFT JOIN users u ON t.teacher_id = u.id
      LEFT JOIN cycles c ON t.cycle_id = c.id
      WHERE t.id = ?
    `, [id]) as any[]
    const topic = topicRows[0]

    if (!topic) return error(res, '课题不存在')

    if (req.user!.role === 'student') {
      const policy = await getTopicAccessPolicy(topic.cycle_id)
      const majorCode = await getStudentMajorCode(req.user!.id)
      if (!isTopicVisible(policy, majorCode, topic.major_code)) return error(res, '您无权查看其他专业的课题', 403)
    }

    await query('UPDATE topics SET view_count = view_count + 1 WHERE id = ?', [id])
    ;(topic as any).view_count++

    const applyCountRows = await query(`
      SELECT COUNT(*) as count FROM applications WHERE topic_id = ? AND status != 'withdrawn'
    `, [id]) as any[]
    const applyCount = applyCountRows[0]?.count || 0

    const result = {
      id: topic.id,
      title: topic.title,
      description: topic.description,
      category: topic.category,
      difficulty: topic.difficulty,
      maxStudents: topic.max_students,
      currentCount: applyCount,
      status: topic.status,
      teacherId: topic.teacher_id,
      teacherName: topic.teacher_name,
      teacherTitle: topic.teacher_title,
      teacherDepartment: topic.department,
      teacherEmail: topic.teacher_email,
      teacherPhone: topic.teacher_phone,
      teacherAvatar: topic.teacher_avatar,
      cycleId: topic.cycle_id,
      cycleName: topic.cycle_name,
      tags: typeof topic.tags === 'string' ? JSON.parse(topic.tags) : topic.tags || [],
      requirements: topic.requirements,
      viewCount: topic.view_count,
      applyCount: applyCount,
      schedules: typeof topic.schedules === 'string' ? JSON.parse(topic.schedules) : topic.schedules || [],
      attachments: typeof topic.attachments === 'string' ? JSON.parse(topic.attachments) : topic.attachments || [],
      major: topic.major,
      majorCode: topic.major_code,
      createdAt: topic.created_at,
      updatedAt: topic.updated_at
    }

    success(res, result)
  } catch (err: any) {
    console.error('获取课题详情失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// POST /api/topics - 教师创建课题
router.post('/', requireRole(['teacher']), async (req: AuthRequest, res) => {
  console.log('[POST /api/topics] 用户:', req.user?.username, '角色:', req.user?.role)
  console.log('[POST /api/topics] 请求体:', JSON.stringify(req.body, null, 2))

  try {
    const { title, description, category, difficulty, maxStudents, tags, requirements, schedules, attachments, status, cycleId, major, majorCode } = req.body

    if (!title || !category) {
      console.log('[POST /api/topics] 验证失败: 标题或研究方向缺失')
      return error(res, '标题和研究方向为必填项')
    }

    const id = uuidv4()
    console.log('[POST /api/topics] 创建课题 ID:', id)

    await query(`
      INSERT INTO topics (id, title, description, category, difficulty, max_students, status, teacher_id, tags, requirements, schedules, attachments, cycle_id, major, major_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, title, description, category, difficulty || 'medium', maxStudents || 1, status || 'draft', req.user!.id, JSON.stringify(tags || []), requirements, JSON.stringify(schedules || []), JSON.stringify(attachments || []), cycleId || null, major || null, majorCode || null])

    console.log('[POST /api/topics] 课题创建成功')
    success(res, { id }, '课题创建成功')
  } catch (err: any) {
    console.error('[POST /api/topics] 创建课题失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// PUT /api/topics/:id - 教师编辑课题
router.put('/:id', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { title, description, category, difficulty, maxStudents, tags, requirements, schedules, attachments, status, major, majorCode } = req.body

    // 验证归属权
    const topicRows = await query('SELECT * FROM topics WHERE id = ?', [id]) as any[]
    const topic = topicRows[0]
    if (!topic) return error(res, '课题不存在')
    if (topic.teacher_id !== req.user!.id && req.user!.role !== 'admin') {
      return error(res, '无权操作此课题')
    }

    // 使用现有值作为缺省回退，避免部分更新覆盖为 NULL
    // 注意：topic.tags/schedules/attachments 在数据库中存储为 JSON 字符串，需要先 parse 再用
    const existingTags = typeof topic.tags === 'string' ? JSON.parse(topic.tags || '[]') : (topic.tags || [])
    const existingSchedules = typeof topic.schedules === 'string' ? JSON.parse(topic.schedules || '[]') : (topic.schedules || [])
    const existingAttachments = typeof topic.attachments === 'string' ? JSON.parse(topic.attachments || '[]') : (topic.attachments || [])

    await query(`
      UPDATE topics SET title = ?, description = ?, category = ?, difficulty = ?,
                      max_students = ?, tags = ?, requirements = ?, schedules = ?, attachments = ?, status = ?,
                      major = ?, major_code = ?
      WHERE id = ?
    `, [
      title ?? topic.title,
      description ?? topic.description,
      category ?? topic.category,
      difficulty ?? topic.difficulty,
      maxStudents ?? topic.max_students,
      JSON.stringify(tags ?? existingTags),
      requirements ?? topic.requirements,
      JSON.stringify(schedules ?? existingSchedules),
      JSON.stringify(attachments ?? existingAttachments),
      status ?? topic.status,
      major ?? topic.major ?? null,
      majorCode ?? topic.major_code ?? null,
      id
    ])

    success(res, null, '课题更新成功')
  } catch (err: any) {
    console.error('更新课题失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// PUT /api/topics/:id/status - 更新课题状态（发布/关闭等）
router.put('/:id/status', requireRole(['teacher', 'admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    const validStatuses = ['draft', 'pending', 'published', 'full', 'closed']
    if (!validStatuses.includes(status)) {
      return error(res, '无效的状态值')
    }

    const topicRows2 = await query('SELECT * FROM topics WHERE id = ?', [id]) as any[]
    const topic2 = topicRows2[0]
    if (!topic2) return error(res, '课题不存在')
    if (topic2.teacher_id !== req.user!.id && req.user!.role !== 'admin') {
      return error(res, '无权操作此课题')
    }

    await query('UPDATE topics SET status = ? WHERE id = ?', [status, id])
    success(res, null, `课题已${status === 'published' ? '发布' : status === 'closed' ? '关闭' : '更新'}`)
  } catch (err: any) {
    console.error('更新课题状态失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// DELETE /api/topics/:id - 删除课题
router.delete('/:id', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const topicRows3 = await query('SELECT * FROM topics WHERE id = ?', [id]) as any[]
    const topic3 = topicRows3[0]
    if (!topic3) return error(res, '课题不存在')
    if (topic3.teacher_id !== req.user!.id && req.user!.role !== 'admin') return error(res, '无权删除此课题')

    await query('DELETE FROM topics WHERE id = ?', [id])
    success(res, null, '课题已删除')
  } catch (err: any) {
    console.error('删除课题失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
