import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error, paginated } from '../utils/response.js'
import { getStudentMajorCode, getTopicAccessPolicy, isTopicVisible } from '../utils/topicAccess.js'
import { getAllowedMajorNames, getAllowedMajorOptions, getCycleMajors, getCycleResearchCategories, type MajorOption } from '../utils/majors.js'
import { getActiveCycle, isInProgressCycle } from '../utils/processFlow.js'
import { getTeacherStudentLimit } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'
import { createHmac } from 'crypto'
import { resolveJwtSecret } from '../utils/policies.js'

const router = Router()
router.use(authMiddleware)

function toStudentTopicView(topic: Record<string, any>) {
  const { teacherId, teacherName, teacherTitle, teacherDepartment, teacherEmail, teacherPhone, teacherAvatar, ...safeTopic } = topic
  return {
    ...safeTopic,
    teacherGroupKey: createHmac('sha256', resolveJwtSecret()).update(String(teacherId || '')).digest('hex').slice(0, 24),
  }
}

// 校验课题的“专业代码/研究方向”是否属于目标周期配置（未配置周期回退默认）；
// 返回错误文案或 null。category/majorCode 缺失时按“必填”对待。
async function assertInCycleConfig(category: any, majorCode: any, cycleId?: any): Promise<string | null> {
  const targetCycleId = cycleId ?? (await getActiveCycle())?.id ?? null
  const [majors, cats] = await Promise.all([getCycleMajors(targetCycleId), getCycleResearchCategories(targetCycleId)])
  const allowedCategories = new Set<string>()
  for (const list of Object.values(cats)) list.forEach((c: string) => allowedCategories.add(c))
  if (typeof category !== 'string' || !allowedCategories.has(category)) {
    return category
      ? `研究方向「${category}」不在当期允许的研究方向内`
      : '请选择研究方向'
  }
  if (typeof majorCode !== 'string' || !majors.some(m => m.code === majorCode)) {
    const allowed = majors.map(m => `${m.name}(${m.code})`).join('、')
    return majorCode
      ? `专业代码「${majorCode}」不在当期配置的毕业专业内（允许：${allowed}）`
      : `请选择专业（当期配置：${allowed}）`
  }
  return null
}

// GET /api/topics - 课题列表（学生浏览用，只返回已发布的）
router.get('/', async (req: AuthRequest, res) => {
  try {
    const { page = '1', pageSize = '12', keyword, category, difficulty } = req.query
    const p = Math.max(1, Number(page))
    const ps = Math.min(50, Math.max(1, Number(pageSize)))
    const offset = (p - 1) * ps

    let whereSql = `WHERE t.status = 'published'`
    const params: any[] = []

    // 学生专属：分页响应额外下发“该生允许浏览的专业”，前端下拉不再依赖课题是否携带专业码
    let allowedMajors: MajorOption[] | undefined
    let teacherStudentLimit = 0
    if (req.user!.role === 'student') {
      const majorCode = await getStudentMajorCode(req.user!.id)
      const active = await getActiveCycle()
      teacherStudentLimit = getTeacherStudentLimit(safeParseJson(active?.phases_config, {}))
      // 无周期时回退到默认规则（默认仅限本专业），保证下拉仍有内容
      const policy = await getTopicAccessPolicy(active?.id)
      // 周期“毕业专业列表”为可见专业过滤的权威来源（未配置回退默认 4 专业）
      const cycleMajors = await getCycleMajors(active?.id)
      allowedMajors = getAllowedMajorOptions(policy, cycleMajors, majorCode)
      const allowedCodes = allowedMajors.map(m => m.code)
      if (!active) {
        whereSql += ' AND 1 = 0'
      } else {
        // 学生只能浏览当前进行中周期的课题，避免跨周期混看
        whereSql += ' AND t.cycle_id = ?'
        params.push(active.id)
        // 可见专业范围以周期“查看选题规则”为准（默认仅限本专业）
        if (policy.mode === 'all') {
          // 允许查看全部专业课题
        } else if (allowedCodes.length) {
          // 允许专业按代码匹配；个别老课题没写 major_code 时按名称（含带方向后缀写法）兜底
          const names = getAllowedMajorNames(allowedCodes, cycleMajors)
          const conds = [`t.major_code IN (${allowedCodes.map(() => '?').join(',')})`]
          params.push(...allowedCodes)
          if (names.length) {
            conds.push(`t.major IN (${names.map(() => '?').join(',')})`)
            params.push(...names)
          }
          whereSql += ` AND (${conds.join(' OR ')})`
        } else whereSql += ' AND 1 = 0'
      }
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
             COALESCE(ac.cnt, 0) AS apply_count, COALESCE(ac.first_choice_count, 0) AS first_choice_count,
             COALESCE(ac.accepted_count, 0) AS accepted_count,
             COALESCE(tc.applicant_count, 0) AS teacher_applicant_count,
             COALESCE(tc.first_choice_count, 0) AS teacher_first_choice_count,
             COALESCE(tc.accepted_count, 0) AS teacher_accepted_count
      FROM topics t
      LEFT JOIN users u ON t.teacher_id = u.id
      LEFT JOIN (
        SELECT topic_id,
               SUM(status IN ('pending', 'submitted', 'pending_review', 'waitlisted', 'accepted')) AS cnt,
               SUM(priority = 1 AND status IN ('pending', 'submitted', 'pending_review', 'waitlisted', 'accepted')) AS first_choice_count,
               SUM(status = 'accepted') AS accepted_count
        FROM applications GROUP BY topic_id
      ) ac ON t.id = ac.topic_id
      LEFT JOIN (
        SELECT tt.teacher_id, tt.cycle_id,
               COUNT(DISTINCT CASE WHEN a.status IN ('pending', 'submitted', 'pending_review', 'waitlisted', 'accepted') THEN a.student_id END) AS applicant_count,
               COUNT(DISTINCT CASE WHEN a.priority = 1 AND a.status IN ('pending', 'submitted', 'pending_review', 'waitlisted', 'accepted') THEN a.student_id END) AS first_choice_count,
               COUNT(DISTINCT CASE WHEN a.status = 'accepted' THEN a.student_id END) AS accepted_count
        FROM topics tt LEFT JOIN applications a ON a.topic_id = tt.id
        GROUP BY tt.teacher_id, tt.cycle_id
      ) tc ON tc.teacher_id = t.teacher_id AND tc.cycle_id = t.cycle_id
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
      currentCount: Number(item.accepted_count),
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
      firstChoiceCount: Number(item.first_choice_count),
      teacherApplicantCount: Number(item.teacher_applicant_count),
      teacherFirstChoiceCount: Number(item.teacher_first_choice_count),
      teacherAcceptedCount: Number(item.teacher_accepted_count),
      teacherStudentLimit,
      schedules: typeof item.schedules === 'string' ? JSON.parse(item.schedules) : item.schedules || [],
      attachments: typeof item.attachments === 'string' ? JSON.parse(item.attachments) : item.attachments || [],
      major: item.major,
      majorCode: item.major_code,
      createdAt: item.created_at,
      updatedAt: item.updated_at
    }))

    const responseList = req.user!.role === 'student' ? formattedList.map(toStudentTopicView) : formattedList
    paginated(res, responseList, total, p, ps, '查询成功', allowedMajors ? { allowedMajors } : undefined)
  } catch (err: any) {
    console.error('获取课题列表失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// ===== 教师专用：我的课题列表（必须在 :id 之前注册，否则被 :id 误匹配） =====

// GET /api/topics/teacher/mine - 我的课题（教师）
router.get('/teacher/mine', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { keyword, status, cycleId } = req.query
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

    // 教师课题按周期查看：默认只列出当前进行中周期（兼容无周期的历史课题）；?cycleId= 可切换其它周期
    let targetCycle: number | null = null
    if (cycleId !== undefined && Number.isFinite(Number(cycleId))) {
      targetCycle = Number(cycleId)
    } else {
      const active = await getActiveCycle()
      targetCycle = active ? Number(active.id) : null
    }
    if (targetCycle != null) {
      sql += ' AND (t.cycle_id = ? OR t.cycle_id IS NULL)'
      params.push(targetCycle)
    }

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
      SELECT SUM(status IN ('pending', 'submitted', 'pending_review', 'waitlisted', 'accepted')) AS count,
             SUM(priority = 1 AND status IN ('pending', 'submitted', 'pending_review', 'waitlisted', 'accepted')) AS first_choice_count,
             SUM(status = 'accepted') AS accepted_count
      FROM applications WHERE topic_id = ?
    `, [id]) as any[]
    const applyCount = Number(applyCountRows[0]?.count || 0)

    const result = {
      id: topic.id,
      title: topic.title,
      description: topic.description,
      category: topic.category,
      difficulty: topic.difficulty,
      maxStudents: topic.max_students,
      currentCount: Number(applyCountRows[0]?.accepted_count || 0),
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
      firstChoiceCount: Number(applyCountRows[0]?.first_choice_count || 0),
      schedules: typeof topic.schedules === 'string' ? JSON.parse(topic.schedules) : topic.schedules || [],
      attachments: typeof topic.attachments === 'string' ? JSON.parse(topic.attachments) : topic.attachments || [],
      major: topic.major,
      majorCode: topic.major_code,
      createdAt: topic.created_at,
      updatedAt: topic.updated_at
    }

    success(res, req.user!.role === 'student' ? toStudentTopicView(result) : result)
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

    // 专业/研究方向必须属于目标周期（配置）内；cycleId 缺失回退当前进行中周期
    const cfgMsg = await assertInCycleConfig(category, majorCode, cycleId)
    if (cfgMsg) return error(res, cfgMsg, 400)

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

    // 已正式发布的选题锁定：教师不可再编辑（如需修改由管理员“撤回发布”后编辑）
    if (req.user!.role === 'teacher' && topic.status === 'published') {
      return error(res, '已正式发布的选题已锁定，不能编辑；如需修改请先由管理员撤回', 400)
    }

    // 仅对“被修改”的专业/研究方向做周期配置强校验；未改动（含历史自由文本课题）直接放行
    const majorChanged = majorCode !== undefined && majorCode !== topic.major_code
    const categoryChanged = category !== undefined && category !== topic.category
    if (majorChanged || categoryChanged) {
      const cfgMsg = await assertInCycleConfig(
        category !== undefined ? category : topic.category,
        majorCode !== undefined ? majorCode : topic.major_code,
        topic.cycle_id,
      )
      if (cfgMsg) return error(res, cfgMsg, 400)
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

    // 已发布的选题锁定：教师不能改状态（发布/撤回均由管理员执行）
    if (req.user!.role === 'teacher' && topic2.status === 'published' && status !== 'published') {
      return error(res, '已正式发布的选题已锁定，不能修改状态；如需撤回请联系管理员', 400)
    }

    // 教师只能把课题发布到“进行中周期”；管理员可跨周期管理
    if (status === 'published' && req.user!.role === 'teacher' && topic2.cycle_id != null) {
      const cycleRows = await query<any>(
        'SELECT status FROM cycles WHERE id = ?',
        [topic2.cycle_id]
      )
      if (cycleRows.length === 0 || !isInProgressCycle(cycleRows[0].status)) {
        return error(res, '课题所属周期不在进行中，不能发布', 400)
      }
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
    if (topic3.status === 'published') return error(res, '已正式发布的选题已锁定，不能删除；如需处理请联系管理员', 400)

    await query('DELETE FROM topics WHERE id = ?', [id])
    success(res, null, '课题已删除')
  } catch (err: any) {
    console.error('删除课题失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
