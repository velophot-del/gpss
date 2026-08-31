import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { query } from '../config/database.js'
import { resolveJwtSecret, resolveSessionUser } from '../utils/policies.js'

export interface AuthRequest extends Request {
  user?: {
    id: string
    username: string
    role: 'admin' | 'teacher' | 'student'
    realName: string
  }
}

const JWT_SECRET = resolveJwtSecret()
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'

// 生成 JWT Token
export function generateToken(payload: { id: string; username: string; role: string; realName: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as any })
}

// 验证 Token 中间件（登录即可）
export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未提供认证令牌' })
  }

  const token = authHeader.substring(7)
  let decoded: any
  try {
    decoded = jwt.verify(token, JWT_SECRET)
    if (typeof decoded?.id !== 'string') throw new Error('invalid token payload')
  } catch {
    return res.status(401).json({ code: 401, message: '令牌无效或已过期' })
  }

  try {
    const [databaseUser] = await query<any>(
      'SELECT id, username, role, real_name, status FROM users WHERE id = ? LIMIT 1',
      [decoded.id],
    )
    const currentUser = resolveSessionUser(decoded, databaseUser)
    if (!currentUser) {
      return res.status(401).json({ code: 401, message: '账号已失效，请重新登录' })
    }
    req.user = currentUser
    next()
  } catch (error) {
    console.error('验证账号状态失败:', error)
    return res.status(500).json({ code: 500, message: '服务器内部错误' })
  }
}

// 角色验证中间件（admin 继承 teacher 的所有权限）
export function requireRole(roles: ('admin' | 'teacher' | 'student')[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ code: 401, message: '未认证' })
    }
    // 构建有效角色列表：admin 同时拥有 teacher 权限
    const effectiveRoles: ('admin' | 'teacher' | 'student')[] = [req.user.role]
    if (req.user.role === 'admin') {
      effectiveRoles.push('teacher')
    }
    if (!roles.some(r => effectiveRoles.includes(r))) {
      return res.status(403).json({ code: 403, message: '权限不足，需要角色: ' + roles.join('/') })
    }
    next()
  }
}
