import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import { generateToken } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { isDemoLoginEnabled } from '../config/runtime.js'

const router = Router()

// POST /api/auth/login - 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return error(res, '请输入用户名和密码')
    }

    const users = await query<any>(
      'SELECT id, username, password, real_name, role, avatar, status FROM users WHERE username = ?',
      [username]
    )

    if (users.length === 0) {
      return error(res, '用户名或密码错误')
    }

    const user = users[0]

    if (user.status !== 'active') {
      return error(res, '账号已被禁用，请联系管理员')
    }

    const isValid = await bcrypt.compare(password, user.password)
    if (!isValid) {
      return error(res, '用户名或密码错误')
    }

    // 生成 Token
    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role,
      realName: user.real_name
    })

    // 获取角色额外信息
    let extraInfo: any = {}
    if (user.role === 'student') {
      const profiles = await query<any>(
        `SELECT * FROM student_profiles WHERE user_id = ?`,
        [user.id]
      )
      extraInfo.profile = profiles[0] || null
    }

    success(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        realName: user.real_name,
        role: user.role,
        avatar: user.avatar,
        ...extraInfo
      }
    }, '登录成功')
  } catch (err: any) {
    console.error('登录失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// 演示账号列表（用户名不变，密码始终重置为 123456）
const DEMO_ACCOUNTS = ['admin', 'chen', 'zhangyi']

// POST /api/auth/demo-login - 演示模式快速登录（自动重置密码为 123456）
router.post('/demo-login', async (req, res) => {
  if (!isDemoLoginEnabled()) {
    return error(res, '接口不存在', 404)
  }

  try {
    const { username } = req.body

    if (!username) {
      return error(res, '请输入用户名')
    }

    if (!DEMO_ACCOUNTS.includes(username)) {
      return error(res, '该账号不支持演示登录')
    }

    const users = await query<any>(
      'SELECT id, username, password, real_name, role, avatar, status FROM users WHERE username = ?',
      [username]
    )

    if (users.length === 0) {
      return error(res, '演示账号不存在，请先初始化数据库')
    }

    const user = users[0]

    // 确保演示账号为活跃状态
    if (user.status !== 'active') {
      await query('UPDATE users SET status = ? WHERE id = ?', ['active', user.id])
    }

    // 重置演示账号密码为 123456
    const hashedPw = await bcrypt.hash('123456', 10)
    await query('UPDATE users SET password = ? WHERE id = ?', [hashedPw, user.id])

    // 生成 Token
    const token = generateToken({
      id: user.id,
      username: user.username,
      role: user.role,
      realName: user.real_name
    })

    // 获取角色额外信息
    let extraInfo: any = {}
    if (user.role === 'student') {
      const profiles = await query<any>(
        'SELECT * FROM student_profiles WHERE user_id = ?',
        [user.id]
      )
      extraInfo.profile = profiles[0] || null
    }

    success(res, {
      token,
      user: {
        id: user.id,
        username: user.username,
        realName: user.real_name,
        role: user.role,
        avatar: user.avatar,
        ...extraInfo
      }
    }, '演示登录成功')
  } catch (err: any) {
    console.error('演示登录失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/auth/me - 获取当前用户信息
// 需要使用 authMiddleware 前置

export default router
