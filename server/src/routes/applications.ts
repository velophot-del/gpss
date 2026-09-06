import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import type { Connection } from 'mysql2/promise'
import { query, transaction } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getTeacherStudentLimit, getReviewDeadline, resolveAdjustmentSource, validateAdjustmentCycle, validateAdjustmentTarget } from '../utils/policies.js'
import { getStudentMajorCode, getTopicAccessPolicy, isTopicVisible } from '../utils/topicAccess.js'
import { getActiveCycle, isInProgressCycle, isStudentSelectionPhase, isTeacherReviewPhase, notify } from '../utils/processFlow.js'
import { safeParseJson } from '../utils/json.js'

// 每名学生填报志愿的数量区间（前端同款）
const VOLUNTEER_MIN = 3
const VOLUNTEER_MAX = 6

const router = Router()
router.use(authMiddleware)

// ===== 选题申请 =====

// POST /api/applications - 学生提交选课申请
router.post('/', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const { topicId, priority = 1, motivation } = req.body
    if (!topicId) return error(res, '请选择课题')
    const volunteerPriority = Number(priority)
    if (!Number.isInteger(volunteerPriority) || volunteerPriority < 1 || volunteerPriority > 6) {
      return error(res, '志愿序号须为 1-6 的整数')
    }

    // 检查当前是否在志愿填报阶段
    const activeCycle = await getActiveCycle()
    if (!activeCycle || !isStudentSelectionPhase(activeCycle.phase)) {
      return error(res, '当前不在志愿填报阶段，无法提交申请')
    }

    // 检查课题是否存在且已发布
    const [topic] = await query<any>('SELECT * FROM topics WHERE id = ? AND status = ?', [topicId, 'published'])
    if (!topic) return error(res, '课题不存在或未开放选课')

    // 只能申请当前进行中周期的课题，避免跨周期混投
    if (topic.cycle_id == null || Number(topic.cycle_id) !== Number(activeCycle.id)) {
      return error(res, '课题不属于当前选题周期，无法申请')
    }
    const studentMajor = await getStudentMajorCode(req.user!.id)
    const accessPolicy = await getTopicAccessPolicy(topic.cycle_id)
    if (!isTopicVisible(accessPolicy, studentMajor, topic.major_code)) return error(res, '只能申请允许查看范围内的专业课题', 403)

    // 已被本周期录取的学生不能再提交志愿（保证“一周期一录取”）
    const placedRows = await query<any>(
      `SELECT a.id FROM applications a
       JOIN topics t ON a.topic_id = t.id
       WHERE a.student_id = ? AND a.status = 'accepted' AND t.cycle_id = ? LIMIT 1`,
      [req.user!.id, topic.cycle_id]
    )
    if (placedRows.length > 0) return error(res, '您已被本周期课题录取，无需再提交申请')

    // 检查是否已申请过该课题
    const [existing] = await query<any>(
      "SELECT * FROM applications WHERE student_id = ? AND topic_id = ? AND status != 'withdrawn'",
      [req.user!.id, topicId]
    )
    if (existing) return error(res, '您已申请过此课题')

    // 志愿序号须唯一：同一学生在同周期内不能有两个申请使用同一志愿序号（否则志愿序失效）
    const rankRows = await query<any>(
      `SELECT a.id FROM applications a
       JOIN topics t ON a.topic_id = t.id
       WHERE a.student_id = ? AND t.cycle_id = ? AND a.status IN ('pending', 'submitted', 'pending_review') AND a.priority = ?
       LIMIT 1`,
      [req.user!.id, topic.cycle_id, volunteerPriority]
    )
    if (rankRows.length > 0) return error(res, `志愿序号 ${volunteerPriority} 已被占用，请改用其它序号`)

    // 检查最大志愿数（与前端 VOLUNTEER_MAX 一致，避免读旧配置导致前后端不一致）
    const countResult = await query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM applications WHERE student_id = ? AND status IN ('pending', 'accepted')",
      [req.user!.id]
    )
    if (countResult[0].cnt >= VOLUNTEER_MAX) {
      return error(res, `每名学生最多填报 ${VOLUNTEER_MAX} 个志愿`)
    }

    await query(`
      INSERT INTO applications (id, student_id, topic_id, priority, motivation)
      VALUES (?, ?, ?, ?, ?)
    `, [uuidv4(), req.user!.id, topicId, volunteerPriority, motivation])

    success(res, null, '申请提交成功')
  } catch (err: any) {
    console.error('提交申请失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// POST /api/applications/volunteers/submit - 整批提交志愿（原子：全部成功或全部失败，避免“部分提交成功却丢数据”）
router.post('/volunteers/submit', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const volunteers = req.body?.volunteers
    if (!Array.isArray(volunteers) || volunteers.length < VOLUNTEER_MIN || volunteers.length > VOLUNTEER_MAX) {
      return error(res, `志愿数量须为 ${VOLUNTEER_MIN}-${VOLUNTEER_MAX} 个`)
    }

    const activeCycle = await getActiveCycle()
    if (!activeCycle || !isStudentSelectionPhase(activeCycle.phase)) {
      return error(res, '当前不在志愿填报阶段，无法提交')
    }

    // 结构校验：序号唯一(1..MAX)、课题不重复
    const seenTopic = new Set<string>()
    const seenPriority = new Set<number>()
    const items: { topicId: string; priority: number; motivation?: string }[] = []
    for (const v of volunteers || []) {
      const tid = v?.topicId
      const p = Number(v?.priority)
      if (!tid) return error(res, '存在缺少课题的志愿')
      if (!Number.isInteger(p) || p < 1 || p > VOLUNTEER_MAX) return error(res, `志愿序号须为 1-${VOLUNTEER_MAX} 的整数`)
      if (seenTopic.has(tid)) return error(res, '同一课题不能重复填报')
      if (seenPriority.has(p)) return error(res, `志愿序号 ${p} 不能重复`)
      seenTopic.add(tid)
      seenPriority.add(p)
      items.push({ topicId: tid, priority: p, motivation: v?.motivation })
    }

    // 可见性与课题校验
    const studentMajor = await getStudentMajorCode(req.user!.id)
    const policy = await getTopicAccessPolicy(activeCycle.id)
    for (const it of items) {
      const topicRows = await query<any>('SELECT id, status, cycle_id, major_code FROM topics WHERE id = ?', [it.topicId])
      const topic = topicRows[0]
      if (!topic || topic.status !== 'published') return error(res, '课题不存在或未开放选课')
      if (Number(topic.cycle_id) !== Number(activeCycle.id)) return error(res, '课题不属于当前选题周期')
      if (!isTopicVisible(policy, studentMajor, topic.major_code)) return error(res, '只能申请允许查看范围内的专业课题')
    }

    const result: any = await transaction(async (conn: Connection): Promise<any> => {
      // 锁学生行，串行化“同一学生的并发整批提交”
      await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user!.id])
      const [placedRows] = await conn.query<any[]>(
        `SELECT a.id FROM applications a JOIN topics t ON a.topic_id = t.id
         WHERE a.student_id = ? AND a.status = 'accepted' AND t.cycle_id = ? LIMIT 1`,
        [req.user!.id, activeCycle.id]
      )
      if (placedRows.length) return { error: '您已被本周期课题录取，不能再提交志愿' }
      const [existingRows] = await conn.query<any[]>(
        `SELECT a.topic_id FROM applications a JOIN topics t ON a.topic_id = t.id
         WHERE a.student_id = ? AND t.cycle_id = ? AND a.status IN ('pending', 'submitted', 'pending_review')`,
        [req.user!.id, activeCycle.id]
      )
      if (existingRows.length) return { error: '已有在途志愿，请勿重复提交（如需调整请先全部撤回后再整批提交）' }
      for (const it of items) {
        await conn.query(
          `INSERT INTO applications (id, student_id, topic_id, priority, status, motivation)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
          [uuidv4(), req.user!.id, it.topicId, it.priority, it.motivation || '']
        )
      }
      return { error: null }
    })

    if (result.error) return error(res, result.error)
    success(res, { submitted: items.length }, `志愿已提交（${items.length} 个）`)
  } catch (err: any) {
    console.error('整批提交志愿失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/applications - 获取申请列表
router.get('/', async (req: AuthRequest, res) => {
  try {
    // 读取列表不写库；截止自动收口仅在明确的写入动作（教师录取/名单提交等）时触发，避免误触发导致不可逆落选
    if (req.user!.role === 'teacher') await maybeRemindTeacherReviewDeadline(req.user!.id)

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
               t.title AS topic_title, sp.gpa AS gpa
        FROM applications a
        JOIN users s ON a.student_id = s.id
        JOIN topics t ON a.topic_id = t.id
        LEFT JOIN student_profiles sp ON sp.user_id = s.id
        WHERE t.teacher_id = ?
        ORDER BY a.priority ASC, sp.gpa DESC, a.created_at ASC
      `
      params.push(req.user!.id)
    } else {
      sql = `
        SELECT a.*, s.real_name AS student_name, t.title AS topic_title,
               u_t.real_name AS teacher_name, sp.gpa AS gpa
        FROM applications a
        JOIN users s ON a.student_id = s.id
        JOIN topics t ON a.topic_id = t.id
        JOIN users u_t ON t.teacher_id = u_t.id
        LEFT JOIN student_profiles sp ON sp.user_id = s.id
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

      // 课题所属周期必须仍在进行中才允许审批（含录取/拒绝/候补）。无周期的历史数据不受此限。
      if (topic.cycle_id != null) {
        const [cycleRows] = await conn.query<any[]>(
          'SELECT status FROM cycles WHERE id = ?',
          [topic.cycle_id]
        )
        if (!cycleRows[0] || !isInProgressCycle(cycleRows[0].status)) {
          return { error: '该课题所属周期不在进行中，无法审批' }
        }
      }

      if (status === 'accepted') {
        // 该申请若已被“名单提交/截止落选”等置为终态（rejected），禁止再 accept 复活；pending/候补可录取
        if (!['pending', 'submitted', 'pending_review', 'waitlisted'].includes(app.status)) {
          return { error: '该申请已不是可录取状态（可能已被名单提交或截止落选处理），请刷新后重试' }
        }

        // 行锁该学生用户，使“同一学生可能被不同课题同时录取”的并发审批串行化（第二笔会读到第一笔已提交的录取）
        await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [app.student_id])

        // 同一周期内学生只能被录取到一个课题：若已被其他课题录取则拒绝，避免“一人多录”
        const [placedRows] = await conn.query<any[]>(`
          SELECT a.id FROM applications a
          JOIN topics t ON a.topic_id = t.id
          WHERE a.student_id = ? AND a.status = 'accepted' AND a.id != ? AND t.cycle_id = ?
          LIMIT 1
        `, [app.student_id, id, topic.cycle_id])
        if (placedRows.length > 0) {
          return { error: '该学生本周期已被其他课题录取，不能重复录取' }
        }

        // 志愿审核截止：超过截止时间不再允许普通录取，过期在途志愿自动转候补并释放（学生走调剂/补录）。未配置截止时间则跳过。
        let reviewDeadline: Date | null = null
        if (topic.cycle_id != null) {
          const [cfgRows] = await conn.query<any[]>(
            'SELECT phases_config FROM cycles WHERE id = ?',
            [topic.cycle_id]
          )
          reviewDeadline = getReviewDeadline(safeParseJson(cfgRows[0]?.phases_config, {}))
        }
        if (reviewDeadline && Date.now() > reviewDeadline.getTime()) {
          const rolled = await autoFinalizeOverdueCycle(conn, topic.cycle_id)
          return { error: `志愿审核已于 ${reviewDeadline.toISOString().slice(0, 10)} 截止，系统已自动提交名单（${rolled} 名未录取学生进入下一志愿/调剂），无法再录取` }
        }

        // 志愿序录取：若该学生本周期仍有更高优先级（第N志愿，N < 当前志愿号）的志愿未被处理，不得先录取当前志愿
        const [higherRows] = await conn.query<any[]>(`
          SELECT a.priority FROM applications a
          JOIN topics t ON a.topic_id = t.id
          WHERE a.student_id = ? AND t.cycle_id = ?
            AND a.id != ? AND a.status IN ('pending', 'submitted', 'pending_review') AND a.priority < ?
          ORDER BY a.priority ASC LIMIT 1
        `, [app.student_id, topic.cycle_id, id, app.priority])
        if (higherRows[0]) {
          return { error: `该生尚有第 ${higherRows[0].priority} 志愿（更高优先级）未处理，请先处理该志愿再录取本志愿` }
        }

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
            const phasesConfig = safeParseJson<Record<string, any>>(cycle.phases_config, {})
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

      // 录取成功后撤回该学生在本周期的其他在途志愿，防止其它教师再将其录取成“一人多录”
      if (status === 'accepted') {
        await conn.query(`
          UPDATE applications a
          JOIN topics t ON a.topic_id = t.id
          SET a.status = 'withdrawn'
          WHERE a.student_id = ? AND a.status IN ('pending', 'submitted', 'pending_review', 'waitlisted') AND t.cycle_id = ? AND a.id != ?
        `, [app.student_id, topic.cycle_id, id])
      }

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
    if (!activeCycle || !isStudentSelectionPhase(activeCycle.phase)) {
      return error(res, '当前不在志愿填报阶段，无法撤销申请')
    }

    const [app] = await query<any>(
      'SELECT * FROM applications WHERE id = ? AND student_id = ?',
      [id, req.user!.id]
    )
    if (!app) return error(res, '申请不存在')
    if (!['pending', 'submitted', 'pending_review'].includes(app.status)) return error(res, '该申请当前状态不可撤销')

    // 已提交志愿（≥3 个在途）后冻结：不可单独撤销，避免破坏已提交的整组志愿
    const [topicRow] = await query<any>(
      'SELECT cycle_id FROM topics WHERE id = ?',
      [app.topic_id]
    )
    const appCycleId = topicRow?.cycle_id
    if (appCycleId != null) {
      const lockRows = await query<any>(
        `SELECT COUNT(*) AS cnt FROM applications a JOIN topics t ON a.topic_id = t.id
         WHERE a.student_id = ? AND t.cycle_id = ? AND a.status IN ('pending', 'submitted', 'pending_review')`,
        [req.user!.id, appCycleId]
      )
      if (Number(lockRows[0]?.cnt || 0) >= 3) {
        return error(res, '已提交志愿（≥3 个），不可单独撤销；如需调整请到调剂阶段或联系管理员')
      }
    }

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
        SELECT adj.*, s.real_name AS student_name, s.student_id, sp.gpa AS gpa,
               ft.title AS from_topic_title, tt.title AS to_topic_title
        FROM adjustments adj
        JOIN users s ON adj.student_id = s.id
        LEFT JOIN student_profiles sp ON sp.user_id = s.id
        LEFT JOIN topics ft ON adj.from_topic_id = ft.id
        LEFT JOIN topics tt ON adj.to_topic_id = tt.id
        ORDER BY (adj.status = 'pending') DESC, tt.title, sp.gpa DESC, adj.created_at DESC
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
        const phasesConfig = safeParseJson<Record<string, any>>(rawConfig, {})
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

      // 征集补录（未录取学生直接补入目标课题）：
      // 1) 释放该生残留在途志愿，避免“未处理志愿”与补录结果矛盾（补录不绕过志愿序收口）；
      // 2) 同课题剩余名额有限时按 GPA 高者优先放行，低绩点不能先于仍在排队的高绩点学生占位。
      if (!currentApplication) {
        const [spRows] = await conn.query<any[]>(
          'SELECT gpa FROM student_profiles WHERE user_id = ?',
          [adj.student_id]
        )
        const studentGpa = Number(spRows[0]?.gpa) || 0
        const [hiPending] = await conn.query<any[]>(`
          SELECT COUNT(DISTINCT adj2.student_id) AS cnt
          FROM adjustments adj2
          LEFT JOIN users u2 ON u2.id = adj2.student_id
          LEFT JOIN student_profiles sp2 ON sp2.user_id = u2.id
          WHERE adj2.to_topic_id = ? AND adj2.status = 'pending' AND adj2.student_id != ?
            AND COALESCE(sp2.gpa, 0) > ?
        `, [targetTopic.id, adj.student_id, studentGpa])
        const seatsFree = Number(targetTopic.max_students) - acceptedCount
        if (Number(hiPending[0]?.cnt || 0) >= seatsFree) {
          return { error: '该课题补录名额有限，有更高绩点的学生在排队，请先处理其补录申请' }
        }
        await conn.query(`
          UPDATE applications a
          JOIN topics t ON a.topic_id = t.id
          SET a.status = 'withdrawn'
          WHERE a.student_id = ? AND t.cycle_id = ? AND a.topic_id <> ?
            AND a.status IN ('pending', 'submitted', 'pending_review', 'waitlisted')
        `, [adj.student_id, targetTopic.cycle_id, targetTopic.id])
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

// POST /api/applications/finalize-topic - 教师提交/确认本课题名单：未被选中的在途申请批量落选，自动进入下一志愿
router.post('/finalize-topic', requireRole(['teacher', 'admin']), async (req: AuthRequest, res) => {
  try {
    const { topicId } = req.body
    if (!topicId) return error(res, '请选择课题')

    const result: any = await transaction(async (conn: Connection): Promise<any> => {
      const [topics] = await conn.query<any[]>(
        'SELECT id, teacher_id, status, cycle_id FROM topics WHERE id = ? FOR UPDATE',
        [topicId]
      )
      const topic = topics[0]
      if (!topic) return { error: '课题不存在' }
      if (topic.teacher_id !== req.user!.id && req.user!.role !== 'admin') {
        return { error: '无权操作此课题' }
      }
      if (topic.cycle_id != null) {
        const [cycleRows] = await conn.query<any[]>(
          'SELECT status, phase FROM cycles WHERE id = ?',
          [topic.cycle_id]
        )
        if (!cycleRows[0] || !isInProgressCycle(cycleRows[0].status)) {
          return { error: '该课题所属周期不在进行中，无法提交名单' }
        }
        if (!isTeacherReviewPhase(cycleRows[0].phase)) {
          return { error: '当前周期不在遴选/录取阶段（需处于学生申报或教师遴选阶段），无法提交名单' }
        }
      }

      const rolled = await finalizePendingForTopic(conn, topic.id, topic.cycle_id)
      return { error: null, rolled }
    })

    if (result.error) return error(res, result.error)
    success(res, { rolled: result.rolled }, result.rolled
      ? `已提交名单，${result.rolled} 名未选中学生自动进入下一志愿`
      : '已提交名单（当前无待处理申请）')
  } catch (err: any) {
    console.error('提交课题名单失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// ===== 名单提交 / 截止自动收口辅助逻辑 =====

const REVIEW_UNRESOLVED_STATUSES = ['pending', 'submitted', 'pending_review'] as const

// 取出“该生当前最高志愿（未被更高志愿挡住）”的在途申请；topicId 限定单个课题，否则为整周期
async function collectActionablePending(conn: Connection, cycleId: number | null, topicId?: string) {
  const topicClause = topicId ? 'AND a.topic_id = ? ' : ''
  const [rows] = await conn.query<any[]>(
    `SELECT a.id, a.student_id, a.priority
     FROM applications a
     JOIN topics t ON a.topic_id = t.id
     WHERE t.cycle_id = ? AND a.status IN (${REVIEW_UNRESOLVED_STATUSES.map(() => '?').join(',')}) ${topicClause}`,
    [cycleId, ...REVIEW_UNRESOLVED_STATUSES, ...(topicId ? [topicId] : [])]
  )
  if (!rows.length) return []

  const students = [...new Set(rows.map((r: any) => r.student_id))]
  const marks = students.map(() => '?').join(',')
  const [allRows] = await conn.query<any[]>(
    `SELECT a.student_id, a.priority
     FROM applications a
     JOIN topics t ON a.topic_id = t.id
     WHERE t.cycle_id = ? AND a.student_id IN (${marks}) AND a.status IN (${REVIEW_UNRESOLVED_STATUSES.map(() => '?').join(',')})`,
    [cycleId, ...students, ...REVIEW_UNRESOLVED_STATUSES]
  )
  const minByStudent: Record<string, number> = {}
  for (const r of allRows) {
    const p = Number(r.priority)
    if (!(r.student_id in minByStudent) || p < minByStudent[r.student_id]) {
      minByStudent[r.student_id] = p
    }
  }
  return rows.filter((r: any) => Number(r.priority) === minByStudent[r.student_id])
}

async function rejectApplications(conn: Connection, ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const marks = ids.map(() => '?').join(',')
  const [result] = await conn.query<any>(
    `UPDATE applications
     SET status = 'rejected', teacher_comment = '未被选中，自动进入下一志愿', reviewed_at = NOW()
     WHERE id IN (${marks})`,
    ids
  )
  return Number(result?.affectedRows || 0)
}

// 单个课题的名单收口：只落选“当前最高志愿=该课题”的申请（更高志愿未决的不动）
async function finalizePendingForTopic(conn: Connection, topicId: string, cycleId: number | null): Promise<number> {
  const actionable = await collectActionablePending(conn, cycleId, topicId)
  return rejectApplications(conn, actionable.map((a: any) => a.id))
}

// 全周期“自动提交”：逐级把未被录取的在途申请落选，直到没有可落选的（学生逐级进入下一志愿，直至落入调剂）
async function autoFinalizeOverdueCycle(conn: Connection, cycleId: number | null): Promise<number> {
  if (cycleId == null) return 0
  let total = 0
  for (let i = 0; i < 200; i++) {
    const actionable = await collectActionablePending(conn, cycleId)
    if (!actionable.length) break
    const n = await rejectApplications(conn, actionable.map((a: any) => a.id))
    total += n
    if (n === 0) break
  }
  return total
}

// 教师端催办：审核截止前 1 天起、到截止后 5 分钟内，若该教师仍有未处理申请则站内提醒一次（按周期去重）
async function maybeRemindTeacherReviewDeadline(teacherId: string): Promise<void> {
  const active = await getActiveCycle()
  if (!active) return
  const deadline = getReviewDeadline(safeParseJson(active.phases_config, {}))
  if (!deadline) return
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  if (now < deadline.getTime() - dayMs || now > deadline.getTime() + 5 * 60 * 1000) return

  const pendingRows = await query<any>(
    `SELECT a.id FROM applications a
     JOIN topics t ON a.topic_id = t.id
     WHERE t.teacher_id = ? AND t.cycle_id = ? AND a.status IN (?, ?, ?)
     LIMIT 1`,
    [teacherId, active.id, ...REVIEW_UNRESOLVED_STATUSES]
  )
  if (!pendingRows.length) return

  const dupRows = await query<any>(
    `SELECT id FROM notifications WHERE user_id = ? AND type = 'review_deadline_reminder' AND related_id = ? LIMIT 1`,
    [teacherId, String(active.id)]
  )
  if (dupRows.length) return

  await notify(
    [teacherId],
    'review_deadline_reminder',
    '志愿审核即将截止',
    `你仍有未处理的选题申请，审核将于 ${deadline.toISOString().slice(0, 10)} 截止。请及时提交课题名单；未选中学生将自动进入下一志愿。`,
    'cycle',
    String(active.id)
  )
}

export default router
