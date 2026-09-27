import mysql from 'mysql2/promise'
import { resolveDatabaseConfig } from '../config/runtime.js'
import { normalizeSmartInteractionCycleConfig } from '../utils/majorCodes.js'

async function migrate() {
  const conn = await mysql.createConnection(resolveDatabaseConfig())
  try {
    await conn.beginTransaction()
    const [students] = await conn.query<any>(`
      UPDATE users
      SET major_code = '080218T', major = '智能交互设计'
      WHERE role = 'student'
        AND (major_code IN ('080906T', '080922T')
          OR major IN ('智能交互', '智能交互（工科）', '智能交互设计（工科）'))
    `)
    const [topics] = await conn.query<any>(`
      UPDATE topics
      SET major_code = '080218T', major = '智能交互设计'
      WHERE major_code IN ('080906T', '080922T')
        OR major IN ('智能交互', '智能交互（工科）', '智能交互设计（工科）')
    `)

    const [cycles] = await conn.query<any[]>('SELECT id, phases_config FROM cycles')
    let cyclesUpdated = 0
    for (const cycle of cycles) {
      let config: any
      try { config = typeof cycle.phases_config === 'string' ? JSON.parse(cycle.phases_config) : cycle.phases_config }
      catch { continue }
      if (!config || typeof config !== 'object' || Array.isArray(config)) continue
      const normalized = normalizeSmartInteractionCycleConfig(config)
      const encoded = JSON.stringify(normalized)
      if (encoded !== JSON.stringify(config)) {
        await conn.query('UPDATE cycles SET phases_config = ? WHERE id = ?', [encoded, cycle.id])
        cyclesUpdated += 1
      }
    }
    await conn.commit()
    console.log(`[gpss] 智能交互专业代码迁移完成：学生 ${students.affectedRows}，课题 ${topics.affectedRows}，周期 ${cyclesUpdated}`)
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    await conn.end()
  }
}

migrate().catch(error => {
  console.error('[gpss] 智能交互专业代码迁移失败:', error)
  process.exitCode = 1
})
