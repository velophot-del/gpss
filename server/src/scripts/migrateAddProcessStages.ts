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

async function addTaskBookColumnIfMissing(conn: mysql.Connection, column: string, definition: string) {
  const [rows] = await conn.query<any[]>(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'task_books' AND column_name = ?
  `, [column])
  if (!rows.length) await conn.query(`ALTER TABLE task_books ADD COLUMN ${definition}`)
}

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

    // 3. 任务书由“教师下达”升级为“学生填报、教师确认”；保留 issued 兼容历史记录。
    await addTaskBookColumnIfMissing(conn, 'main_content', 'main_content TEXT AFTER content')
    await addTaskBookColumnIfMissing(conn, 'specific_requirements', 'specific_requirements TEXT AFTER requirements')
    await addTaskBookColumnIfMissing(conn, 'teacher_comment', 'teacher_comment TEXT AFTER issued_at')
    await addTaskBookColumnIfMissing(conn, 'reviewed_by', 'reviewed_by VARCHAR(36) AFTER teacher_comment')
    await addTaskBookColumnIfMissing(conn, 'reviewed_at', 'reviewed_at DATETIME AFTER reviewed_by')
    await conn.query(`
      ALTER TABLE task_books
      MODIFY COLUMN status ENUM('draft', 'issued', 'submitted', 'need_revision', 'confirmed') NOT NULL DEFAULT 'draft'
    `)
    console.log('✅ 任务书已升级为学生填报、教师确认流程')

    console.log('\n迁移完成！')
  } catch (err: any) {
    console.error('迁移失败:', err.message)
    process.exitCode = 1
  } finally {
    await conn.end()
  }
}

migrate()
