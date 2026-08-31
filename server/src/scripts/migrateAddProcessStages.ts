/**
 * 迁移脚本：将「选题系统」升级为「毕业设计管理系统」
 *
 * 对已有部署执行两件事：
 *   1. 扩展 cycles.phase 枚举，加入全流程阶段（task_book/proposal/midterm/thesis_design/defense/grading/archive）
 *   2. 创建全流程新增数据表（任务书/开题/中期/论文/作品/答辩/成绩/指导/公告/通知）
 *
 * 用法：cd server && npx tsx src/scripts/migrateAddProcessStages.ts
 */

import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveDatabaseConfig } from '../config/runtime.js'
import { processPhaseEnum, createProcessTables } from './processSchema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config()

async function migrate() {
  const conn = await mysql.createConnection(resolveDatabaseConfig())

  try {
    console.log('开始升级为毕业设计管理系统...')

    // 1. 扩展 phase 枚举
    await conn.query(`
      ALTER TABLE cycles
      MODIFY COLUMN phase ${processPhaseEnum()} NOT NULL DEFAULT 'topic_submission'
    `)
    console.log('✅ cycles.phase 已扩展为全流程阶段')

    // 2. 创建全流程数据表
    await createProcessTables(conn)
    console.log('✅ 全流程数据表已创建（任务书/开题/中期/论文/作品/答辩/成绩/指导/公告/通知）')

    console.log('\n迁移完成！')
  } catch (err: any) {
    console.error('迁移失败:', err.message)
    process.exitCode = 1
  } finally {
    await conn.end()
  }
}

migrate()
