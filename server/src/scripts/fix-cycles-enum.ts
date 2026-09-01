/**
 * 修复 cycles 表的 ENUM 字段，添加缺失的状态值
 * 
 * 问题: status 字段只有 draft/active/closed，但前端使用了 upcoming/selection/review/adjustment/completed
 *       phase 字段缺少 topic_publish/student_apply/teacher_review/result_announce 等值
 */

import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { processPhaseEnum } from './processSchema.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'gpss_db',
  })

  try {
    console.log('开始修复 cycles 表 ENUM 字段...')

    // 1. 更新 status 字段：从 (draft, active, closed) 扩展为完整状态列表
    await conn.query(`
      ALTER TABLE cycles 
      MODIFY COLUMN status ENUM('draft', 'upcoming', 'active', 'selection', 'review', 'adjustment', 'completed') 
      NOT NULL DEFAULT 'draft'
    `)
    console.log('✓ status 字段已更新: draft/upcoming/active/selection/review/adjustment/completed')

    // 2. 更新 phase 字段：扩展为完整的阶段列表
    await conn.query(`
      ALTER TABLE cycles
      MODIFY COLUMN phase ${processPhaseEnum()} NOT NULL DEFAULT 'topic_submission'
    `)
    console.log('✓ phase 字段已更新: 支持所有阶段值')

    // 3. 将现有的 active 状态数据保持不变，closed -> completed（如果有）
    const [rows] = await conn.query<any[]>("SELECT id, status FROM cycles WHERE status = 'closed'")
    if ((rows as any[]).length > 0) {
      await conn.query("UPDATE cycles SET status = 'completed' WHERE status = 'closed'")
      console.log(`✓ 已将 ${(rows as any[]).length} 条 closed 状态记录转换为 completed`)
    }

    console.log('\n修复完成！')
  } catch (error) {
    console.error('修复失败:', error)
    throw error
  } finally {
    await conn.end()
  }
}

migrate()
  .then(() => {
    console.log('迁移脚本执行成功')
    process.exit(0)
  })
  .catch((err) => {
    console.error('迁移脚本执行失败:', err)
    process.exit(1)
  })
