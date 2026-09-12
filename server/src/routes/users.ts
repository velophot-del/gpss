import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'
import XLSX from 'xlsx'
import path from 'path'
import fs from 'fs'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error, paginated } from '../utils/response.js'
import { resolveUploadDir } from '../config/runtime.js'

const router = Router()

const uploadDir = resolveUploadDir()
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase()
    if (['.csv', '.xlsx', '.xls'].includes(ext)) {
      cb(null, true)
    } else {
      cb(new Error('仅支持 .csv / .xlsx / .xls 格式'))
    }
  }
})

// 所有路由都需要认证
router.use(authMiddleware)

// 判断是否为系统管理员（内置 admin 账号）
function isSuperAdmin(user: AuthRequest['user']): boolean {
  return user?.username === 'admin'
}

// GET /api/users/me - 获取当前登录用户详情
router.get('/me', async (req: AuthRequest, res) => {
  try {
    const users = await query<any>(
      `SELECT id, username, real_name, email, role, avatar, student_id, class_name,
              major, major_code, grade, title, department, phone, status, created_at
       FROM users WHERE id = ?`,
      [req.user!.id]
    )

    if (users.length === 0) {
      return error(res, '用户不存在')
    }

    const user = users[0]

    // 学生额外获取档案信息
    if (user.role === 'student') {
      const profiles = await query<any>('SELECT * FROM student_profiles WHERE user_id = ?', [user.id])
      user.profile = profiles[0] || null
    }

    success(res, user)
  } catch (err: any) {
    console.error('获取用户失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// ===== 管理员接口：用户管理 CRUD =====

// GET /api/users - 用户列表（管理员，支持分页/搜索/角色筛选）
router.get('/', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { page = '1', pageSize = '20', keyword, role, status, all } = req.query
    const isExportAll = all === 'true'

    let whereSql = `WHERE 1=1`
    const params: any[] = []

    if (keyword) {
      whereSql += ` AND (u.real_name LIKE ? OR u.username LIKE ? OR u.student_id LIKE ? OR u.email LIKE ?)`
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
    }
    if (role && ['admin', 'teacher', 'student'].includes(role as string)) {
      whereSql += ` AND u.role = ?`
      params.push(role)
    }
    if (status) {
      whereSql += ` AND u.status = ?`
      params.push(status)
    }

    const listSql = `SELECT u.id, u.username, u.real_name, u.email, u.role, u.avatar, u.student_id, u.class_name, u.major, u.major_code, u.grade, u.title, u.department, u.phone, u.status, u.created_at, sp.gpa, sp.grade AS profile_grade FROM users u LEFT JOIN student_profiles sp ON u.id = sp.user_id ${whereSql} ORDER BY u.created_at DESC`

    // 导出模式：不分页，返回全部
    if (isExportAll) {
      const list = await query<any>(listSql, params)
      const formattedList = list.map(item => ({
        id: item.id, username: item.username, realName: item.real_name,
        email: item.email, role: item.role, avatar: item.avatar,
        studentId: item.student_id, className: item.class_name,
        major: item.major, majorCode: item.major_code, grade: item.grade,
        title: item.title, department: item.department, phone: item.phone,
        status: item.status, createdAt: item.created_at,
        gpa: item.gpa, ranking: item.ranking
      }))
      return paginated(res, formattedList, formattedList.length, 1, formattedList.length)
    }

    const p = Math.max(1, Number(page))
    const ps = Math.min(50, Math.max(1, Number(pageSize)))
    const offset = (p - 1) * ps

    const list = await query<any>(listSql + ' LIMIT ? OFFSET ?', [...params, ps, offset])
    const countResult = await query<any>(`SELECT COUNT(*) as total FROM users u ${whereSql}`, params)

    const formattedList = list.map(item => ({
      id: item.id, username: item.username, realName: item.real_name,
      email: item.email, role: item.role, avatar: item.avatar,
      studentId: item.student_id, className: item.class_name,
      major: item.major, majorCode: item.major_code, grade: item.grade,
      title: item.title, department: item.department, phone: item.phone,
      status: item.status, createdAt: item.created_at,
      gpa: item.gpa, ranking: item.ranking
    }))

    paginated(res, formattedList, countResult[0]?.total || 0, p, ps)
  } catch (err: any) {
    console.error('获取用户列表失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// POST /api/users - 创建新用户（管理员）
router.post('/', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { username, password, realName, email, role, studentId, className, major, majorCode, grade, title, department, phone } = req.body

    if (!username || !password || !realName || !role) {
      return error(res, '用户名、密码、姓名、角色为必填项')
    }

    if (!['admin', 'teacher', 'student'].includes(role)) {
      return error(res, '无效的角色值')
    }

    // 普通管理员无权创建任何用户
    if (!isSuperAdmin(req.user!)) {
      return error(res, '权限不足：仅系统管理员可创建用户账号')
    }

    // 检查用户名是否已存在
    const [existing] = await query<any>('SELECT id FROM users WHERE username = ?', [username])
    if (existing) {
      return error(res, '该用户名已被使用')
    }

    const id = uuidv4()
    const hashedPw = await bcrypt.hash(password, 10)

    await query(`
      INSERT INTO users (id, username, password, real_name, email, role, student_id, class_name, major, major_code, grade, title, department, phone, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [id, username, hashedPw, realName, email || null, role, studentId || null, className || null, major || null, majorCode || null, grade || null, title || null, department || null, phone || null, 'active'])

    // 如果角色为学生，自动创建 student_profiles 空记录
    if (role === 'student') {
      await query(`
        INSERT INTO student_profiles (id, user_id, gpa, grade, is_complete)
        VALUES (?, ?, 0, ?, 0)
      `, [uuidv4(), id, grade || null])
    }

    success(res, { id }, `${role === 'student' ? '学生' : role === 'teacher' ? '教师' : '管理员'}创建成功`)
  } catch (err: any) {
    console.error('创建用户失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// ===== 以下具体路由必须放在 /:id 参数化路由之前，避免被 :id 截获 =====

// PUT /api/users/password - 修改密码（自己改自己的）
router.put('/password', async (req: AuthRequest, res) => {
  try {
    const { oldPassword, newPassword } = req.body

    if (!oldPassword || !newPassword) {
      return error(res, '请输入原密码和新密码')
    }

    if (newPassword.length < 6) {
      return error(res, '新密码长度不能少于6位')
    }

    const users = await query<any>('SELECT password FROM users WHERE id = ?', [req.user!.id])
    if (users.length === 0) return error(res, '用户不存在')

    const isValid = await bcrypt.compare(oldPassword, users[0].password)
    if (!isValid) return error(res, '原密码不正确')

    const hashedNew = await bcrypt.hash(newPassword, 10)
    await query('UPDATE users SET password = ? WHERE id = ?', [hashedNew, req.user!.id])

    success(res, null, '密码修改成功')
  } catch (err: any) {
    console.error('修改密码失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// PUT /api/users/profile - 更新个人信息
router.put('/profile', async (req: AuthRequest, res) => {
  try {
    const { email, avatar, phone } = req.body
    await query(
      'UPDATE users SET email = ?, avatar = ?, phone = ? WHERE id = ?',
      [email, avatar, phone, req.user!.id]
    )
    success(res, null, '个人信息更新成功')
  } catch (err: any) {
    console.error('更新个人信息失败:', err)
    error(res, '服务器内部错误', 500)
  }
})


// PUT /api/users/:id/status - 更新用户状态（启用/禁用）（管理员）
router.put('/:id/status', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { status } = req.body

    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return error(res, '无效的状态值')
    }

    const [user] = await query<any>('SELECT id, role FROM users WHERE id = ?', [id])
    if (!user) return error(res, '用户不存在')

    // 不能禁用自己
    if (id === req.user!.id) {
      return error(res, '不能操作自己的账号')
    }

    // 普通管理员无权修改任何用户状态
    if (!isSuperAdmin(req.user!)) {
      return error(res, '权限不足：仅系统管理员可修改用户账号状态')
    }

    // 不能禁用唯一的管理员（如果当前用户是admin且目标也是admin）
    if (user.role === 'admin') {
      const adminCount = await query<any>("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'")
      if (adminCount[0].cnt <= 1) {
        return error(res, '不能禁用系统中仅有的管理员账号')
      }
    }

    await query('UPDATE users SET status = ? WHERE id = ?', [status, id])
    success(res, null, `账号已${status === 'active' ? '启用' : '禁用'}`)
  } catch (err: any) {
    console.error('更新用户状态失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// PUT /api/users/:id - 更新用户信息（管理员编辑）
router.put('/:id', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { realName, email, role, title, department, phone, studentId, className, major, majorCode, grade, gpa } = req.body

    const [user] = await query<any>('SELECT id, role, username FROM users WHERE id = ?', [id])
    if (!user) return error(res, '用户不存在')

    // 内置 admin 账号角色不可更改
    if (user.username === 'admin' && role !== 'admin') {
      return error(res, '系统管理员 admin 的角色不可更改')
    }

    // 普通管理员无权编辑任何用户
    if (!isSuperAdmin(req.user!)) {
      return error(res, '权限不足：仅系统管理员可编辑用户账号')
    }

    // 防止撤销最后一个管理员
    if (user.role === 'admin' && role !== 'admin') {
      const [adminCount] = await query<any>("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND status = 'active'")
      if (adminCount.cnt <= 1) {
        return error(res, '不能撤销系统中唯一的管理员')
      }
    }

    await query(`
      UPDATE users SET real_name = ?, email = ?, role = ?, title = ?, department = ?,
                      phone = ?, student_id = ?, class_name = ?, major = ?, major_code = ?, grade = ?
      WHERE id = ?
    `, [realName, email, role, title, department, phone, studentId, className, major, majorCode, grade, id])

    // 如果角色为学生，同步更新 student_profiles 中的关联字段
    if (role === 'student') {
      const gpaVal = gpa != null ? parseFloat(gpa) : null
      const [existingProfile] = await query<any>('SELECT id FROM student_profiles WHERE user_id = ?', [id])

      if (existingProfile) {
        // 更新已有档案：同步 grade 和 gpa（仅当提供了新值）
        const updates: string[] = ['grade = ?']
        const params: any[] = [grade || null]
        if (gpaVal != null && !isNaN(gpaVal)) {
          updates.push('gpa = ?')
          params.push(gpaVal)
        }
        params.push(id)
        await query(`UPDATE student_profiles SET ${updates.join(', ')} WHERE user_id = ?`, params)
      } else {
        // 档案不存在则创建基础记录
        await query(`
          INSERT INTO student_profiles (id, user_id, gpa, grade, is_complete)
          VALUES (?, ?, ?, ?, 0)
        `, [uuidv4(), id, gpaVal != null && !isNaN(gpaVal) ? gpaVal : 0, grade || null])
      }
    }

    success(res, null, '用户信息更新成功')
  } catch (err: any) {
    console.error('更新用户信息失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// DELETE /api/users/:id - 删除用户（管理员）
router.delete('/:id', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params

    if (id === req.user!.id) {
      return error(res, '不能删除自己的账号')
    }

    const [user] = await query<any>('SELECT id, role FROM users WHERE id = ?', [id])
    if (!user) return error(res, '用户不存在')

    // 普通管理员无权删除任何用户
    if (!isSuperAdmin(req.user!)) {
      return error(res, '权限不足：仅系统管理员可删除用户账号')
    }

    // 不能删除唯一的管理员
    if (user.role === 'admin') {
      const adminCount = await query<any>("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'")
      if (adminCount[0].cnt <= 1) {
        return error(res, '不能删除系统中仅有的管理员账号')
      }
    }

    await query('DELETE FROM student_profiles WHERE user_id = ?', [id])
    await query('DELETE FROM applications WHERE student_id = ?', [id])
    await query('DELETE FROM adjustments WHERE student_id = ?', [id])
    await query('DELETE FROM users WHERE id = ?', [id])

    success(res, null, '用户已删除')
  } catch (err: any) {
    console.error('删除用户失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// POST /api/users/batch-delete - 批量删除用户
router.post('/batch-delete', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return error(res, '请选择要删除的用户')
    }

    // 普通管理员无权删除任何用户
    if (!isSuperAdmin(req.user!)) {
      return error(res, '权限不足：仅系统管理员可删除用户账号')
    }

    let deletedCount = 0
    const errors: string[] = []

    for (const id of ids) {
      try {
        // 不能删除自己
        if (id === req.user!.id) {
          errors.push(`不能删除自己的账号`)
          continue
        }

        const [user] = await query<any>('SELECT id, role, real_name FROM users WHERE id = ?', [id])
        if (!user) {
          errors.push(`用户 ${id} 不存在，已跳过`)
          continue
        }

        // 不能删除其他管理员
        if (user.role === 'admin') {
          errors.push(`不能删除管理员「${user.real_name}」`)
          continue
        }

        // 删除关联数据
        await query('DELETE FROM student_profiles WHERE user_id = ?', [id])
        await query('DELETE FROM applications WHERE student_id = ?', [id])
        await query('DELETE FROM adjustments WHERE student_id = ?', [id])
        await query('DELETE FROM topic_shortlist WHERE student_id = ?', [id])
        // 如果是教师，清理其课题相关数据
        await query('DELETE FROM applications WHERE topic_id IN (SELECT id FROM topics WHERE teacher_id = ?)', [id])
        await query('DELETE FROM topic_shortlist WHERE topic_id IN (SELECT id FROM topics WHERE teacher_id = ?)', [id])
        await query('DELETE FROM topics WHERE teacher_id = ?', [id])
        await query('DELETE FROM users WHERE id = ?', [id])

        deletedCount++
      } catch (err: any) {
        errors.push(`删除用户 ${id} 失败：${err.message || '未知错误'}`)
      }
    }

    success(res, { deletedCount, errors }, `成功删除 ${deletedCount} 个用户${errors.length > 0 ? `，${errors.length} 个失败` : ''}`)
  } catch (err: any) {
    console.error('批量删除失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// POST /api/users/batch-import - 批量导入用户（管理员，支持 CSV/Excel）
router.post('/batch-import', requireRole(['admin']), upload.single('file'), async (req: AuthRequest, res) => {
  try {
    // 普通管理员无权批量导入用户
    if (!isSuperAdmin(req.user!)) {
      // 清理可能已上传的文件
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path)
      }
      return error(res, '权限不足：仅系统管理员可批量导入用户')
    }

    if (!req.file) {
      return error(res, '请选择要上传的文件')
    }

    const filePath = req.file.path
    const workbook = XLSX.readFile(filePath)

    // 读取第一个 sheet
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' })

    // 清理临时文件
    await fs.promises.unlink(filePath).catch(() => {})

    if (rows.length === 0) {
      return error(res, '文件中没有数据')
    }

    // 验证必填列：username, realName(或 姓名), role(或 角色)
    const firstRow = rows[0]
    const cleanKey = (key: string) => String(key).replace(/^\uFEFF/, '').replace(/\s/g, '').toLowerCase()
    const keys = Object.keys(firstRow).map(cleanKey)
    const hasRealName = keys.some(k => ['realname', 'real_name', '姓名', 'name'].includes(k))
    const hasUsername = keys.some(k => ['username', '用户名', '账号'].includes(k))
    const hasStudentId = keys.some(k => ['studentid', 'student_id', '学号'].includes(k))

    if (!hasRealName || (!hasUsername && !hasStudentId)) {
      return error(res, '文件格式不正确，必须包含「姓名」列，以及「用户名」或「学号」中的至少一列。请参考模板格式：用户名、密码、姓名、角色、邮箱、学号、班级、专业、职称、院系、手机号（角色可选，默认为学生；学生可只填学号，将自动作为用户名）')
    }

    // 标准化字段名映射
    function normalizeRow(row: any): any {
      const map: Record<string, string[]> = {
        username: ['username', '用户名', '账号'],
        password: ['password', '密码'],
        realName: ['realname', 'real_name', '姓名', 'name'],
        role: ['role', '角色'],
        email: ['email', '邮箱', '电子邮件'],
        studentId: ['studentid', 'student_id', '学号'],
        className: ['classname', 'class_name', '班级'],
        major: ['major', '专业'],
        majorCode: ['majorcode', 'major_code', '专业代码'],
        grade: ['grade', '届别', '年级'],
        title: ['title', '职称'],
        department: ['department', '院系', '所属院系'],
        phone: ['phone', '手机', '手机号', '联系电话'],
        gpa: ['gpa', '学分绩点', '绩点', '平均学分绩点']
      }

      const result: Record<string, any> = {}
      for (const [field, aliases] of Object.entries(map)) {
        for (const alias of aliases) {
          const foundKey = Object.keys(row).find(
            k => cleanKey(k) === alias.toLowerCase()
          )
          if (foundKey !== undefined) {
            result[field] = String(row[foundKey] || '').trim()
            break
          }
        }
      }
      return result
    }

    const results = { success: 0, failed: 0, errors: [] as string[] }
    const roleMap: Record<string, string> = { '教师': 'teacher', '学生': 'student', '管理员': 'admin' }

    // 预加载已存在的用户名，避免逐条查询
    const allUsernames = new Set<string>()
    try {
      const existingUsers = await query<any>('SELECT username FROM users')
      existingUsers.forEach(u => allUsernames.add(u.username))
    } catch { /* ignore */ }

    // 预计算默认密码的 hash（降低 rounds 加速）
    const defaultHashedPw = await bcrypt.hash('123456', 8)

    // 收集有效记录
    const validRecords: any[] = []
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i]
      const item = normalizeRow(raw)

      // 未填用户名时自动使用学号：学号天然唯一，避免姓名全拼重名时第二条被跳过
      if (!item.username && item.studentId) {
        item.username = item.studentId
      }

      // 必填校验：姓名必填，用户名与学号至少填一个
      if (!item.realName || !item.username) {
        results.failed++
        results.errors.push(`第${i + 2}行：姓名为空，或用户名与学号都未填`)
        continue
      }

      // 格式化用户名：首字母大写，其余小写
      const formattedUsername = item.username.charAt(0).toUpperCase() + item.username.slice(1).toLowerCase()

      // 检查重复（内存中判断）
      if (allUsernames.has(formattedUsername)) {
        results.failed++
        results.errors.push(`第${i + 2}行：用户名「${formattedUsername}」已存在`)
        continue
      }
      allUsernames.add(formattedUsername)
      item.username = formattedUsername

      let role = (item.role ? roleMap[item.role] || item.role : 'student').toLowerCase()
      if (!['admin', 'teacher', 'student'].includes(role)) role = 'student'

      const password = item.password || '123456'
      const hashedPw = password === '123456' ? defaultHashedPw : await bcrypt.hash(password, 8)

      validRecords.push({
        id: uuidv4(),
        username: item.username,
        password: hashedPw,
        realName: item.realName,
        email: item.email || null,
        role,
        studentId: item.studentId || null,
        className: item.className || null,
        major: item.major || null,
        majorCode: item.majorCode || null,
        grade: item.grade || null,
        title: item.title || null,
        department: item.department || null,
        phone: item.phone || null,
        gpa: item.gpa ? parseFloat(item.gpa) : null
      })
    }

    // 批量插入（每批 100 条）
    if (validRecords.length > 0) {
      const batchSize = 100
      for (let i = 0; i < validRecords.length; i += batchSize) {
        const batch = validRecords.slice(i, i + batchSize)
        const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',')
        const values = batch.flatMap(r => [
          r.id, r.username, r.password, r.realName, r.email, r.role,
          r.studentId, r.className, r.major, r.majorCode, r.grade,
          r.title, r.department, r.phone, 'active'
        ])

        try {
          await query(`
            INSERT INTO users (id, username, password, real_name, email, role, student_id, class_name,
                              major, major_code, grade, title, department, phone, status)
            VALUES ${placeholders}
          `, values)
          results.success += batch.length

          // 为学生角色导入学分绩点到 student_profiles
          const studentsWithGpa = batch.filter(r => r.role === 'student' && r.gpa != null)
          if (studentsWithGpa.length > 0) {
            const profilePlaceholders = studentsWithGpa.map(() => '(?,?,?,?)').join(',')
            const profileValues = studentsWithGpa.flatMap(r => [
              uuidv4(), r.id, r.gpa, 0
            ])
            await query(`
              INSERT INTO student_profiles (id, user_id, gpa, is_complete)
              VALUES ${profilePlaceholders}
              ON DUPLICATE KEY UPDATE gpa = VALUES(gpa)
            `, profileValues)
          }
        } catch (err: any) {
          // 批量 INSERT 要么全部成功，要么全部失败
          results.failed += batch.length
          results.errors.push(`批量插入第 ${i + 1}-${i + batch.length} 行失败：${err.message || '未知错误'}`)
        }
      }
    }

    success(res, results, `导入完成：成功 ${results.success} 条，失败 ${results.failed} 条`)
  } catch (err: any) {
    // 清理临时文件（如果存在）
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path)
    }
    console.error('批量导入失败:', err)
    error(res, err.message === '仅支持 .csv / .xlsx / .xls 格式' ? err.message : '服务器内部错误', 500)
  }
})


// PUT /api/users/:id/password - 管理员重置用户密码
router.put('/:id/password', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { newPassword } = req.body

    if (!newPassword || newPassword.length < 6) {
      return error(res, '新密码长度不能少于6位')
    }

    const [user] = await query<any>('SELECT id, username, real_name, role FROM users WHERE id = ?', [id])
    if (!user) return error(res, '用户不存在')

    // 普通管理员无权重置任何用户密码
    if (!isSuperAdmin(req.user!)) {
      return error(res, '权限不足：仅系统管理员可重置用户密码')
    }

    const hashedNew = await bcrypt.hash(newPassword, 10)
    await query('UPDATE users SET password = ? WHERE id = ?', [hashedNew, id])

    success(res, null, `已重置用户「${user.real_name || user.username}」的密码`)
  } catch (err: any) {
    console.error('重置密码失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
