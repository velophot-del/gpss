import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error, paginated } from '../utils/response.js'

const router = Router()
router.use(authMiddleware)

// GET /api/students/profile - 获取当前学生档案（JOIN users 表，确保管理员修改同步）
router.get('/profile', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const [row] = await query<any>(`
      SELECT u.student_id, u.class_name, u.major, u.major_code, u.grade,
             sp.id AS profile_id, sp.user_id, sp.gpa, sp.ranking, sp.total_students,
             sp.skills, sp.interests, sp.portfolio, sp.self_intro,
             sp.contact_email, sp.contact_phone, sp.is_complete
      FROM users u
      LEFT JOIN student_profiles sp ON u.id = sp.user_id
      WHERE u.id = ?
    `, [req.user!.id])

    if (!row) return success(res, null)

    // 合并 users 表字段和 student_profiles 表字段
    const profile = {
      // 来自 users 表（管理员可直接修改，始终最新）
      studentId: row.student_id || '',
      className: row.class_name || '',
      major: row.major || '',
      majorCode: row.major_code || '',
      grade: row.grade || '',
      // 来自 student_profiles 表（学生自行填写或管理员同步）
      gpa: Number(row.gpa) || 0,
      ranking: row.ranking || 0,
      totalStudents: row.total_students || 0,
      skills: row.skills || [],
      interests: row.interests || [],
      portfolio: row.portfolio || [],
      personalStatement: row.self_intro || '',
      selfIntro: row.self_intro || '',
      contactEmail: row.contact_email || '',
      contactPhone: row.contact_phone || '',
      isComplete: !!(row.is_complete)
    }
    success(res, profile)
  } catch (err: any) {
    error(res, '服务器内部错误', 500)
  }
})

// PUT /api/students/profile - 更新学生档案（学生自行填写，不包含 GPA）
router.put('/profile', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const { skills, interests, selfIntro, portfolio, contactEmail, contactPhone } = req.body

    // 读取当前 GPA（由管理员维护，学生不可修改）
    const [current] = await query<any>('SELECT gpa FROM student_profiles WHERE user_id = ?', [req.user!.id])
    const currentGpa = current?.gpa ?? 0

    const isComplete = !!(currentGpa > 0 && selfIntro && skills && skills.length > 0)

    const [existing] = await query<any>('SELECT id FROM student_profiles WHERE user_id = ?', [req.user!.id])

    if (existing) {
      await query(`
        UPDATE student_profiles SET
        skills = ?, interests = ?, self_intro = ?, portfolio = ?,
        contact_email = ?, contact_phone = ?, is_complete = ?
        WHERE user_id = ?
      `, [JSON.stringify(skills), JSON.stringify(interests), selfIntro, JSON.stringify(portfolio || []), contactEmail, contactPhone, isComplete, req.user!.id])
    } else {
      await query(`
        INSERT INTO student_profiles (id, user_id, gpa, skills, interests, self_intro, portfolio, contact_email, contact_phone, is_complete)
        VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      `, [uuidv4(), req.user!.id, JSON.stringify(skills), JSON.stringify(interests), selfIntro, JSON.stringify(portfolio || []), contactEmail, contactPhone, isComplete])
    }

    success(res, null, '档案更新成功')
  } catch (err: any) {
    console.error('更新档案失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/students/:userId - 教师/管理员获取单个学生完整档案
// 支持按 user.id (UUID) 或 student_id (学号) 查找
router.get('/:userId', requireRole(['admin', 'teacher']), async (req: AuthRequest, res) => {
  try {
    const { userId } = req.params
    const users = await query<any>(
      `SELECT u.*, sp.gpa, sp.ranking, sp.total_students, sp.skills, sp.interests,
              sp.portfolio, sp.self_intro, sp.contact_email, sp.contact_phone,
              sp.grade, sp.is_complete
       FROM users u
       LEFT JOIN student_profiles sp ON u.id = sp.user_id
       WHERE (u.id = ? OR u.student_id = ?) AND u.role = 'student'`,
      [userId, userId]
    )
    if (users.length === 0) {
      return error(res, '学生不存在', 404)
    }
    const item = users[0]
    const result = {
      userId: item.id,
      realName: item.real_name || '',
      studentId: item.student_id || '',
      className: item.class_name || '',
      major: item.major || '',
      grade: item.grade || '',
      gpa: Number(item.gpa) || 0,
      ranking: Number(item.ranking) || 0,
      totalStudents: Number(item.total_students) || 0,
      skills: typeof item.skills === 'string' ? JSON.parse(item.skills || '[]') : (item.skills || []),
      interests: typeof item.interests === 'string' ? JSON.parse(item.interests || '[]') : (item.interests || []),
      portfolio: typeof item.portfolio === 'string' ? JSON.parse(item.portfolio || '[]') : (item.portfolio || []),
      personalStatement: item.self_intro || '',
      contactEmail: item.contact_email || '',
      contactPhone: item.contact_phone || '',
      isComplete: !!(item.is_complete),
    }
    success(res, result)
  } catch (err: any) {
    console.error('获取学生详情失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/students - 管理员获取学生列表
router.get('/', requireRole(['admin', 'teacher']), async (req: AuthRequest, res) => {
  try {
    const { page = '1', pageSize = '20', keyword, major } = req.query
    const p = Math.max(1, Number(page))
    const ps = Math.min(50, Math.max(1, Number(pageSize)))
    const offset = (p - 1) * ps

    let whereSql = `WHERE u.role = 'student' AND u.status = 'active'`
    const params: any[] = []

    if (keyword) {
      whereSql += ` AND (u.real_name LIKE ? OR u.student_id LIKE ?)`
      params.push(`%${keyword}%`, `%${keyword}%`)
    }
    if (major) {
      whereSql += ` AND u.major_code = ?`
      params.push(major)
    }

    const list = await query<any>(`
      SELECT u.*, sp.gpa, sp.ranking, sp.total_students, sp.skills, sp.interests, sp.portfolio, sp.self_intro, sp.contact_email, sp.contact_phone, sp.grade, sp.is_complete
      FROM users u
      LEFT JOIN student_profiles sp ON u.id = sp.user_id
      ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, ps, offset])

    const countResult = await query<any>(`SELECT COUNT(*) as total FROM users u ${whereSql}`, params)

    paginated(res, list, countResult[0]?.total || 0, p, ps)
  } catch (err: any) {
    error(res, '服务器内部错误', 500)
  }
})

export default router
