import mysql from 'mysql2/promise'
import { resolveDatabaseConfig } from '../config/runtime.js'
import { createAdjustmentTables } from './adjustmentSchema.js'

async function migrate() {
  const conn = await mysql.createConnection(resolveDatabaseConfig())
  try {
    await createAdjustmentTables(conn)
    console.log('[gpss] 调剂志愿数据表迁移完成')
  } finally {
    await conn.end()
  }
}

migrate().catch(error => {
  console.error('[gpss] 调剂志愿数据表迁移失败:', error)
  process.exitCode = 1
})
