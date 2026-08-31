import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveDatabaseConfig } from '../config/runtime.js'
import { validateInitialAdminPassword } from './adminBootstrap.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config()

async function bootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin'
  const realName = process.env.ADMIN_REAL_NAME || '系统管理员'
  const email = process.env.ADMIN_EMAIL || 'admin@localhost'
  const password = validateInitialAdminPassword(process.env.ADMIN_INITIAL_PASSWORD)
  const conn = await mysql.createConnection(resolveDatabaseConfig())

  try {
    const [rows] = await conn.query<any[]>('SELECT id, role FROM users WHERE username = ? LIMIT 1', [username])
    if (rows[0]) {
      if (rows[0].role !== 'admin') {
        throw new Error(`用户名 ${username} 已存在且不是管理员`)
      }
      console.log(`管理员 ${username} 已存在，未覆盖密码`)
      return
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    await conn.query(
      `INSERT INTO users (id, username, password, real_name, email, role, status)
       VALUES (?, ?, ?, ?, ?, 'admin', 'active')`,
      [uuidv4(), username, hashedPassword, realName, email]
    )
    console.log(`管理员 ${username} 已创建`)
  } finally {
    await conn.end()
  }
}

bootstrapAdmin().catch((err) => {
  console.error('管理员初始化失败:', err.message)
  process.exit(1)
})
