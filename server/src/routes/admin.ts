import { Router } from 'express'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getActiveCycle } from '../utils/processFlow.js'
import { getTeacherStudentLimit } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'

const router = Router()
router.use(authMiddleware)
router.use(requireRole(['admin']))

// 当前周期选题监控：学生状态和课题空位使用同一周期口径。
router.get('/selection-overview', async (_req: AuthRequest, res) => {
  try {
    const cycle = await getActiveCycle()
    if (!cycle) return success(res, { cycle: null, students: [], topics: [], teacherLimit: 0 })
    const students = await query<any>(`
      SELECT u.id, u.student_id, u.real_name, u.class_name, u.major,
             COUNT(a.id) AS application_count,
             SUM(a.status = 'accepted') AS accepted_count,
             SUM(a.status IN ('pending', 'submitted', 'pending_review', 'waitlisted')) AS pending_count,
             GROUP_CONCAT(DISTINCT at.category SEPARATOR '、') AS preferred_categories,
             GROUP_CONCAT(DISTINCT a.topic_id) AS applied_topic_ids
      FROM users u
      LEFT JOIN applications a ON a.student_id = u.id AND a.status != 'withdrawn'
        AND a.topic_id IN (SELECT id FROM topics WHERE cycle_id = ?)
      LEFT JOIN topics at ON at.id = a.topic_id
      WHERE u.role = 'student' AND u.status = 'active'
      GROUP BY u.id, u.student_id, u.real_name, u.class_name, u.major
      ORDER BY u.student_id
    `, [cycle.id])
    const topics = await query<any>(`
      SELECT t.id, t.title, t.category, t.major, t.teacher_id, u.real_name AS teacher_name,
             t.max_students, t.status,
             COUNT(a.id) AS application_count,
             SUM(a.priority = 1) AS first_choice_count,
             SUM(a.status = 'accepted') AS accepted_count,
             (SELECT COUNT(DISTINCT ta.student_id) FROM applications ta
              JOIN topics tt ON tt.id = ta.topic_id
              WHERE tt.teacher_id = t.teacher_id AND tt.cycle_id = ? AND ta.status = 'accepted') AS teacher_accepted_count,
             (SELECT COUNT(DISTINCT ta.student_id) FROM applications ta
               JOIN topics tt ON tt.id = ta.topic_id
               WHERE tt.teacher_id = t.teacher_id AND tt.cycle_id = ? AND ta.priority = 1
                 AND ta.status IN ('pending', 'submitted', 'pending_review', 'waitlisted', 'accepted')) AS teacher_first_choice_count
      FROM topics t
      LEFT JOIN users u ON u.id = t.teacher_id
      LEFT JOIN applications a ON a.topic_id = t.id
        AND a.status IN ('pending', 'submitted', 'pending_review', 'waitlisted', 'accepted')
      WHERE t.cycle_id = ? AND t.status IN ('published', 'full')
      GROUP BY t.id, t.title, t.category, t.major, t.teacher_id, u.real_name, t.max_students, t.status
      ORDER BY t.title
    `, [cycle.id, cycle.id, cycle.id])
    const teacherLimit = getTeacherStudentLimit(safeParseJson(cycle.phases_config, {}))
    success(res, { cycle: { id: cycle.id, name: cycle.name, phase: cycle.phase }, students, topics, teacherLimit })
  } catch (err) {
    console.error('获取当前周期选题监控失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/admin/topics - 管理员查看所有选题
router.get('/topics', async (_req: AuthRequest, res) => {
  try {
    const topics = await query<any>(`
      SELECT t.*, u.real_name as teacher_name, u.title as teacher_title, u.department as teacher_dept,
             u.email as teacher_email, u.phone as teacher_phone,
             (SELECT COUNT(*) FROM applications a WHERE a.topic_id = t.id AND a.status != 'withdrawn') as apply_count,
             (SELECT COUNT(*) FROM applications a WHERE a.topic_id = t.id AND a.status = 'pending') as pending_count,
             (SELECT COUNT(*) FROM applications a WHERE a.topic_id = t.id AND a.status = 'accepted') as accepted_count
      FROM topics t
      LEFT JOIN users u ON t.teacher_id = u.id
      ORDER BY t.created_at DESC
    `)

    const result = topics.map(t => ({
      ...t,
      tags: typeof t.tags === 'string' ? JSON.parse(t.tags) : t.tags || [],
      schedules: typeof t.schedules === 'string' ? JSON.parse(t.schedules) : t.schedules || [],
      attachments: typeof t.attachments === 'string' ? JSON.parse(t.attachments) : t.attachments || []
    }))

    success(res, result)
  } catch (err: any) {
    console.error('获取选题列表失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/admin/teachers - 教师申报状态统计
router.get('/teachers', async (_req: AuthRequest, res) => {
  try {
    const teachers = await query<any>(`
      SELECT u.id, u.username, u.real_name, u.title, u.department, u.status,
             (SELECT COUNT(*) FROM topics t WHERE t.teacher_id = u.id AND t.status != 'draft') as published_count,
             (SELECT COUNT(*) FROM topics t WHERE t.teacher_id = u.id AND t.status = 'draft') as draft_count,
             (SELECT COUNT(*) FROM topics t WHERE t.teacher_id = u.id) as total_topics,
             u.created_at
      FROM users u
      WHERE u.role = 'teacher'
      ORDER BY u.real_name
    `)

    success(res, teachers)
  } catch (err: any) {
    console.error('获取教师列表失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/admin/students - 学生选课状态统计
router.get('/students', async (_req: AuthRequest, res) => {
  try {
    const students = await query<any>(`
      SELECT u.id, u.username, u.real_name, u.student_id, u.class_name, u.major, u.status,
             (SELECT COUNT(*) FROM applications a WHERE a.student_id = u.id AND a.status != 'withdrawn') as application_count,
             (SELECT COUNT(*) FROM applications a WHERE a.student_id = u.id AND a.status = 'accepted') as accepted_count,
             (SELECT COUNT(*) FROM topic_shortlist s WHERE s.student_id = u.id) as shortlist_count,
             u.created_at
      FROM users u
      WHERE u.role = 'student'
      ORDER BY u.student_id
    `)

    success(res, students)
  } catch (err: any) {
    console.error('获取学生列表失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/admin/applications - 所有选课申请数据
router.get('/applications', async (_req: AuthRequest, res) => {
  try {
    const applications = await query<any>(`
      SELECT a.*, s.real_name as student_name, s.student_id as student_code, s.class_name as student_class, s.major as student_major,
             t.title as topic_title, t.category as topic_category, t.difficulty as topic_difficulty,
             u.real_name as teacher_name, u.title as teacher_title, u.department as teacher_dept
      FROM applications a
      JOIN users s ON a.student_id = s.id
      JOIN topics t ON a.topic_id = t.id
      JOIN users u ON t.teacher_id = u.id
      ORDER BY a.created_at DESC
    `)

    success(res, applications)
  } catch (err: any) {
    console.error('获取申请列表失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/admin/student-selections - 学生选题详情（用于展开查看和导出）
router.get('/student-selections', async (_req: AuthRequest, res) => {
  try {
    const selections = await query<any>(`
      SELECT 
        s.id as student_id, s.username, s.real_name as student_name, 
        s.student_id as student_code, s.class_name, s.major,
        a.id as application_id, a.priority, a.status as application_status, a.motivation,
        t.title as topic_title, t.category as topic_category, t.difficulty as topic_difficulty,
        u.real_name as teacher_name, u.title as teacher_title, u.department as teacher_dept
      FROM users s
      LEFT JOIN applications a ON s.id = a.student_id AND a.status != 'withdrawn'
      LEFT JOIN topics t ON a.topic_id = t.id
      LEFT JOIN users u ON t.teacher_id = u.id
      WHERE s.role = 'student'
      ORDER BY s.student_id, a.priority
    `)

    success(res, selections)
  } catch (err: any) {
    console.error('获取学生选题详情失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/admin/statistics - 综合统计数据
router.get('/statistics', async (_req: AuthRequest, res) => {
  try {
    const [topicStats] = await query<any>('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'published\' THEN 1 ELSE 0 END) as published, SUM(CASE WHEN status = \'draft\' THEN 1 ELSE 0 END) as draft, SUM(CASE WHEN status = \'pending\' THEN 1 ELSE 0 END) as pending FROM topics')
    const [teacherStats] = await query<any>('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'active\' THEN 1 ELSE 0 END) as active FROM users WHERE role = \'teacher\'')
    const [studentStats] = await query<any>('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'active\' THEN 1 ELSE 0 END) as active FROM users WHERE role = \'student\'')
    const [applicationStats] = await query<any>('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'accepted\' THEN 1 ELSE 0 END) as accepted, SUM(CASE WHEN status = \'pending\' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status = \'rejected\' THEN 1 ELSE 0 END) as rejected FROM applications')

    const teacherWithTopics = await query<any>('SELECT COUNT(DISTINCT teacher_id) as count FROM topics WHERE status != \'draft\'')
    const studentsApplied = await query<any>('SELECT COUNT(DISTINCT student_id) as count FROM applications WHERE status != \'withdrawn\'')

    success(res, {
      topics: topicStats,
      teachers: {
        ...teacherStats,
        with_topics: teacherWithTopics[0]?.count || 0,
        without_topics: (teacherStats.total || 0) - (teacherWithTopics[0]?.count || 0)
      },
      students: {
        ...studentStats,
        applied: studentsApplied[0]?.count || 0,
        not_applied: (studentStats.total || 0) - (studentsApplied[0]?.count || 0)
      },
      applications: applicationStats
    })
  } catch (err: any) {
    console.error('获取统计数据失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
