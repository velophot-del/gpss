import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config()

const dbConfig = {
  host: '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'gpss_db',
  charset: 'utf8mb4'
}

async function migrate() {
  console.log('正在连接数据库...')
  const conn = await mysql.createConnection(dbConfig)

  try {
    await conn.query(`
      ALTER TABLE topics 
      ADD COLUMN major VARCHAR(50),
      ADD COLUMN major_code VARCHAR(20),
      ADD INDEX idx_major (major)
    `)
    console.log('✅ 已添加 major 和 major_code 字段到 topics 表')

    await conn.query(`
      INSERT IGNORE INTO system_configs (\`key\`, value, description) VALUES
      ('allowed_majors', '[{"name":"视觉传达设计","code":"130502"},{"name":"数字媒体艺术","code":"130508"},{"name":"包装工程","code":"081702"},{"name":"智能交互","code":"080906T"}]', '允许的专业列表')
    `)
    console.log('✅ 已添加专业配置')

    console.log('\n迁移完成！')
  } catch (err: any) {
    console.error('迁移失败:', err.message)
    process.exit(1)
  } finally {
    await conn.end()
  }
}

migrate()