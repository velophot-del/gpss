import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getTeacherStudentLimit, resolveAdjustmentSource, validateAdjustmentCycle, validateAdjustmentTarget } from '../utils/policies.js'

const router = Router()
router.use(authMiddleware)

// ===== 选题申请 =====

// POST /api/applications - 学生提交选课申请
router.post('/', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const { topicId, priority = 1, motivation } = req.body
    if (!topicId) return error(res, '请选择课题')

    // 检查当前是否在志愿填报阶段
    const [activeCycle] = await query<any>(
      "SELECT phase FROM cycles WHERE status IN ('active','selection','review','adjustment') ORDER BY created_at DESC LIMIT 1"
    )
    if (!activeCycle || activeCycle.phase !== 'student_selection') {
      return error(res, '当前不在志愿填报阶段，无法提交申请')
    }

    // 检查课题是否存在且已发布
    const [topic] = await query<any>('SELECT * FROM topics WHERE id = ? AND status = ?', [topicId, 'published'])
    if (!topic) return error(res, '课题不存在或未开放选课')

    // 检查是否已申请过该课题
    const [existing] = await query<any>(
      "SELECT * FROM applications WHERE student_id = ? AND topic_id = ? AND status != 'withdrawn'",
      [req.user!.id, topicId]
    )
    if (existing) return error(res, '您已申请过此课题')

    // 检查最大申请数（默认3）
    const config = await query<any>("SELECT value FROM system_configs WHERE `key` = ?", ['max_applications_per_student'])
    const maxApps = Number(config[0]?.value || 3)
    const countResult = await query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM applications WHERE student_id = ? AND status IN ('pending', 'accepted')",
      [req.user!.id]
    )
    if (countResult[0].cnt >= maxApps) {
      return error(res, `您最多只能申请 ${maxApps} 个课题`)
    }

    await query(`
      INSERT INTO applications (id, student_id, topic_id, priority, motivation)
      VALUES (?, ?, ?, ?, ?)
    `, [uuidv4(), req.user!.id, topicId, priority, motivation])

    success(res, null, '申请提交成功')
  } catch (err: any) {
    console.error('提交申请失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/applications - 获取申请列表
router.get('/', async (req: AuthRequest, res) => {
  try {
    let sql: string
    const params: any[] = []

    if (req.user!.role === 'student') {
      sql = `
        SELECT a.*, t.title AS topic_title, t.major, t.category,
               u.real_name AS teacher_name, t.difficulty, t.status AS topic_status
        FROM applications a
        LEFT JOIN topics t ON a.topic_id = t.id
        LEFT JOIN users u ON t.teacher_id = u.id
        WHERE a.student_id = ?
        ORDER BY a.created_at DESC
      `
      params.push(req.user!.id)
    } else if (req.user!.role === 'teacher') {
      sql = `
        SELECT a.*, s.real_name AS student_name, s.student_id, s.class_name, s.major,
               t.title AS topic_title
        FROM applications a
        JOIN users s ON a.student_id = s.id
        JOIN topics t ON a.topic_id = t.id
        WHERE t.teacher_id = ?
        ORDER BY a.created_at DESC
      `
      params.push(req.user!.id)
    } else {
      sql = `
        SELECT a.*, s.real_name AS student_name, t.title AS topic_title,
               u_t.real_name AS teacher_name
        FROM applications a
        JOIN users s ON a.student_id = s.id
        JOIN topics t ON a.topic_id = t.id
        JOIN users u_t ON t.teacher_id = u_t.id
        ORDER BY a.created_at DESC
      `
    }

    const list = await query<any>(sql, params)
    const formattedList = list.map(item => ({
      ...item,
      studentId: item.student_id,
      topicId: item.topic_id,
      topicTitle: item.topic_title,
      teacherName: item.teacher_name,
      studentName: item.student_name,
      major: item.major,
      category: item.category,
      submittedAt: item.created_at || item.submitted_at,
      reviewedAt: item.reviewed_at
    }))
    success(res, formattedList)
  } catch (err: any) {
    console.error('获取申请列表失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// PUT /api/applications/:id - 教师审批申请
router.put('/:id', requireRole(['teacher']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { status, comment } = req.body

    if (!['accepted', 'rejected', 'waitlisted'].includes(status)) {
      return error(res, '无效的操作状态')
    }

    const reviewResult = await transaction(async (conn) => {
      const [applications] = await conn.query<any[]>(
        'SELECT * FROM applications WHERE id = ? FOR UPDATE',
        [id]
      )
      const app = applications[0]
      if (!app) return { error: '申请记录不存在' }

      // 锁定课题行，使同一课题的审批、名额检查与状态更新串行执行。
      const [topics] = await conn.query<any[]>(
        'SELECT id, teacher_id, max_students, status, cycle_id FROM topics WHERE id = ? FOR UPDATE',
        [app.topic_id]
      )
      const topic = topics[0]
      if (!topic) return { error: '关联课题不存在' }
      if (topic.teacher_id !== req.user!.id && req.user!.role !== 'admin') {
        return { error: '无权操作此申请' }
      }

      if (status === 'accepted') {
        // 检查课题名额是否已满
        const [selectedRows] = await conn.query<any[]>(`
          SELECT COUNT(*) as cnt FROM applications
          WHERE topic_id = ? AND status = 'accepted' AND id != ?
        `, [app.topic_id, id])
        if (Number(selectedRows[0].cnt) >= Number(topic.max_students)) {
          return { error: '该课题名额已满' }
        }

        // 检查教师指导学生数是否达到上限（如果设置了的话）
        if (topic.cycle_id) {
          const [cycles] = await conn.query<any[]>(
            'SELECT phases_config FROM cycles WHERE id = ? FOR UPDATE',
            [topic.cycle_id]
          )
          const cycle = cycles[0]
          if (cycle && cycle.phases_config) {
            const phasesConfig = typeof cycle.phases_config === 'string' 
              ? JSON.parse(cycle.phases_config) 
              : cycle.phases_config
            const teacherStudentLimit = getTeacherStudentLimit(phasesConfig)
            
            if (teacherStudentLimit > 0) {
              // 统计该教师在本周期已被接受的学生总数
              const [teacherStats] = await conn.query<any[]>(`
                SELECT COUNT(DISTINCT a.student_id) as accepted_count
                FROM applications a
                JOIN topics t ON a.topic_id = t.id
                WHERE t.teacher_id = ? AND a.status = 'accepted' AND t.cycle_id = ? AND a.id != ?
              `, [topic.teacher_id, topic.cycle_id, id])
              
              const currentAcceptedCount = Number(teacherStats[0]?.accepted_count || 0)
              if (currentAcceptedCount >= teacherStudentLimit) {
                return { error: `该教师本周期指导学生已达上限（${teacherStudentLimit}人）` }
              }
            }
          }
        }
      }

      await conn.query(
        `UPDATE applications SET status = ?, teacher_comment = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
        [status, comment, req.user!.id, id]
      )

      const [acceptedRows] = await conn.query<any[]>(`
        SELECT COUNT(*) as cnt FROM applications WHERE topic_id = ? AND status = 'accepted'
      `, [app.topic_id])
      const acceptedCount = Number(acceptedRows[0].cnt)

      // 只在选题开放/满员两个业务状态之间切换，不意外重开草稿或已关闭课题。
      if (topic.status === 'published' || topic.status === 'full') {
        const nextTopicStatus = acceptedCount >= Number(topic.max_students) ? 'full' : 'published'
        await conn.query('UPDATE topics SET status = ? WHERE id = ?', [nextTopicStatus, app.topic_id])
      }

      return { error: null }
    })

    if (reviewResult.error) return error(res, reviewResult.error)

    const statusMap: Record<string, string> = { accepted: '通过', rejected: '拒绝', waitlisted: '待定' }
    success(res, null, `申请已${statusMap[status] || status}`)
  } catch (err: any) {
    console.error('审批申请失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// DELETE /api/applications/:id - 学生撤销申请
router.delete('/:id', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params

    // 检查当前是否在志愿填报阶段
    const [activeCycle] = await query<any>(
      "SELECT phase FROM cycles WHERE status IN ('active','selection','review','adjustment') ORDER BY created_at DESC LIMIT 1"
    )
    if (!activeCycle || activeCycle.phase !== 'student_selection') {
      return error(res, '当前不在志愿填报阶段，无法撤销申请')
    }

    const [app] = await query<any>(
      'SELECT * FROM applications WHERE id = ? AND student_id = ?',
      [id, req.user!.id]
    )
    if (!app) return error(res, '申请不存在')
    if (!['pending', 'submitted', 'pending_review'].includes(app.status)) return error(res, '该申请当前状态不可撤销')

    await query("UPDATE applications SET status = 'withdrawn' WHERE id = ?", [id])

    success(res, null, '申请已撤销')
  } catch (err: any) {
    console.error('撤销申请失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// ===== 调整申请 =====

// POST /api/adjustments - 提交调整申请
router.post('/adjustments', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const { fromTopicId, toTopicId, reason } = req.body
    if (!reason) return error(res, '请填写调整原因')
    if (!toTopicId) return error(res, '请选择目标课题')

    const acceptedApplications = await query<any>(
      "SELECT topic_id FROM applications WHERE student_id = ? AND status = 'accepted'",
      [req.user!.id],
    )
    const source = resolveAdjustmentSource(acceptedApplications.map(item => item.topic_id), fromTopicId)
    if (source.error) return error(res, source.error)

    const [pendingAdjustment] = await query<any>(
      "SELECT id FROM adjustments WHERE student_id = ? AND status = 'pending' LIMIT 1",
      [req.user!.id],
    )
    if (pendingAdjustment) return error(res, '已有待处理的调整申请，请勿重复提交')

    await query(`
      INSERT INTO adjustments (id, student_id, from_topic_id, to_topic_id, reason)
      VALUES (?, ?, ?, ?, ?)
    `, [uuidv4(), req.user!.id, source.sourceTopicId, toTopicId, reason])

    success(res, null, '调整申请已提交，等待管理员审核')
  } catch (err: any) {
    console.error('提交调整申请失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/adjustments - 获取调整列表
router.get('/adjustments', async (req: AuthRequest, res) => {
  try {
    let sql: string
    const params: any[] = []

    if (req.user!.role === 'admin' || req.user!.role === 'teacher') {
      sql = `
        SELECT adj.*, s.real_name AS student_name, s.student_id,
               ft.title AS from_topic_title, tt.title AS to_topic_title
        FROM adjustments adj
        JOIN users s ON adj.student_id = s.id
        LEFT JOIN topics ft ON adj.from_topic_id = ft.id
        LEFT JOIN topics tt ON adj.to_topic_id = tt.id
        ORDER BY adj.created_at DESC
      `
    } else {
      sql = `
        SELECT adj.*,
               ft.title AS from_topic_title, tt.title AS to_topic_title
        FROM adjustments adj
        LEFT JOIN topics ft ON adj.from_topic_id = ft.id
        LEFT JOIN topics tt ON adj.to_topic_id = tt.id
        WHERE adj.student_id = ?
        ORDER BY adj.created_at DESC
      `
      params.push(req.user!.id)
    }

    const list = await query<any>(sql, params)
    success(res, list)
  } catch (err: any) {
    error(res, '服务器内部错误', 500)
  }
})

// PUT /api/adjustments/:id - 管理员审批调整
router.put('/adjustments/:id', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { status, adminComment } = req.body
    if (!['approved', 'rejected'].includes(status)) return error(res, '无效状态')

    const result = await transaction(async (conn) => {
      const [adjustments] = await conn.query<any[]>('SELECT * FROM adjustments WHERE id = ? FOR UPDATE', [id])
      const adj = adjustments[0]
      if (!adj) return { error: '记录不存在' }
      if (adj.status !== 'pending') return { error: '该调整申请已处理，不能重复审批' }

      if (status === 'rejected') {
        await conn.query(
          `UPDATE adjustments SET status = 'rejected', admin_comment = ?, processed_by = ?, processed_at = NOW() WHERE id = ?`,
          [adminComment, req.user!.id, id],
        )
        return { error: null }
      }

      if (!adj.to_topic_id) return { error: '调整申请未指定目标课题' }

      const [currentApplications] = await conn.query<any[]>(`
        SELECT id, topic_id
        FROM applications
        WHERE student_id = ? AND status = 'accepted'
        FOR UPDATE
      `, [adj.student_id])
      const source = resolveAdjustmentSource(currentApplications.map(item => item.topic_id), adj.from_topic_id)
      if (source.error) return { error: source.error }
      const currentApplication = source.sourceTopicId
        ? currentApplications.find(item => item.topic_id === source.sourceTopicId)
        : null

      const topicIds = [source.sourceTopicId || adj.to_topic_id, adj.to_topic_id].sort()
      const [lockedTopics] = await conn.query<any[]>(
        'SELECT id, status, max_students, teacher_id, cycle_id FROM topics WHERE id IN (?, ?) ORDER BY id FOR UPDATE',
        topicIds,
      )
      const currentTopic = source.sourceTopicId
        ? lockedTopics.find(topic => topic.id === source.sourceTopicId)
        : null
      const targetTopic = lockedTopics.find(topic => topic.id === adj.to_topic_id)
      if (source.sourceTopicId && !currentTopic) return { error: '学生当前录取课题不存在' }
      if (!targetTopic) return { error: '目标课题不存在' }

      const [cycles] = await conn.query<any[]>(
        'SELECT id, status, phase, phases_config FROM cycles WHERE id = ? FOR UPDATE',
        [targetTopic.cycle_id],
      )
      const cycle = cycles[0]
      const cycleError = validateAdjustmentCycle({
        currentCycleId: currentTopic?.cycle_id ?? targetTopic.cycle_id,
        targetCycleId: targetTopic.cycle_id,
        cycleStatus: cycle?.status ?? null,
        cyclePhase: cycle?.phase ?? null,
      })
      if (cycleError) return { error: cycleError }

      const [capacityRows] = await conn.query<any[]>(
        "SELECT COUNT(DISTINCT student_id) AS cnt FROM applications WHERE topic_id = ? AND status = 'accepted' AND student_id != ?",
        [targetTopic.id, adj.student_id],
      )
      const acceptedCount = Number(capacityRows[0]?.cnt || 0)
      const targetError = validateAdjustmentTarget({
        currentTopicId: currentTopic?.id ?? '',
        targetTopicId: targetTopic.id,
        targetStatus: targetTopic.status,
        acceptedCount,
        maxStudents: Number(targetTopic.max_students),
      })
      if (targetError) return { error: targetError }

      if (targetTopic.cycle_id) {
        const rawConfig = cycle?.phases_config
        const phasesConfig = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig
        const teacherStudentLimit = getTeacherStudentLimit(phasesConfig)
        if (teacherStudentLimit > 0) {
          const [teacherRows] = await conn.query<any[]>(`
            SELECT COUNT(DISTINCT a.student_id) AS cnt
            FROM applications a
            JOIN topics t ON t.id = a.topic_id
            WHERE t.teacher_id = ? AND t.cycle_id = ? AND a.status = 'accepted' AND a.student_id != ?
          `, [targetTopic.teacher_id, targetTopic.cycle_id, adj.student_id])
          if (Number(teacherRows[0]?.cnt || 0) >= teacherStudentLimit) {
            return { error: `目标课题教师本周期指导学生已达上限（${teacherStudentLimit}人）` }
          }
        }
      }

      if (currentApplication) {
        await conn.query("UPDATE applications SET status = 'withdrawn' WHERE id = ?", [currentApplication.id])
      }

      const [targetApplications] = await conn.query<any[]>(
        'SELECT id FROM applications WHERE student_id = ? AND topic_id = ? FOR UPDATE',
        [adj.student_id, targetTopic.id],
      )
      if (targetApplications[0]) {
        await conn.query(`
          UPDATE applications
          SET status = 'accepted', priority = 1, reviewed_by = ?, reviewed_at = NOW(), motivation = '来自调整申请'
          WHERE id = ?
        `, [req.user!.id, targetApplications[0].id])
      } else {
        await conn.query(`
          INSERT INTO applications (id, student_id, topic_id, priority, status, reviewed_by, reviewed_at, motivation)
          VALUES (?, ?, ?, 1, 'accepted', ?, NOW(), '来自调整申请')
        `, [uuidv4(), adj.student_id, targetTopic.id, req.user!.id])
      }

      if (currentTopic && ['published', 'full'].includes(currentTopic.status)) {
        const [oldTopicRows] = await conn.query<any[]>(
          "SELECT COUNT(DISTINCT student_id) AS cnt FROM applications WHERE topic_id = ? AND status = 'accepted'",
          [currentTopic.id],
        )
        const oldTopicStatus = Number(oldTopicRows[0]?.cnt || 0) >= Number(currentTopic.max_students) ? 'full' : 'published'
        await conn.query('UPDATE topics SET status = ? WHERE id = ?', [oldTopicStatus, currentTopic.id])
      }

      const nextTargetStatus = acceptedCount + 1 >= Number(targetTopic.max_students) ? 'full' : 'published'
      await conn.query('UPDATE topics SET status = ? WHERE id = ?', [nextTargetStatus, targetTopic.id])
      await conn.query(
        `UPDATE adjustments SET status = 'approved', admin_comment = ?, processed_by = ?, processed_at = NOW() WHERE id = ?`,
        [adminComment, req.user!.id, id],
      )

      return { error: null }
    })

    if (result.error) return error(res, result.error)

    success(res, null, `调整申请已${status === 'approved' ? '批准' : '拒绝'}`)
  } catch (err: any) {
    console.error('审批调整失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
