import mysql from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import { resolveDatabaseConfig } from '../config/runtime.js'

type MigrationResult = { cycleId: number | null; migrated: number }

export async function migrateSelectionDrafts(): Promise<MigrationResult> {
  const conn = await mysql.createConnection(resolveDatabaseConfig())
  try {
    const [cycles] = await conn.query<any[]>(`
      SELECT id FROM cycles
      WHERE status IN ('active', 'selection', 'review', 'adjustment')
      ORDER BY created_at DESC LIMIT 1
    `)
    const cycleId = cycles[0]?.id == null ? null : Number(cycles[0].id)
    if (cycleId == null) return { cycleId: null, migrated: 0 }

    await conn.beginTransaction()
    try {
      const [rows] = await conn.query<any[]>(`
        SELECT a.id, a.topic_id, a.priority, a.created_at
        FROM applications a
        JOIN topics t ON t.id = a.topic_id
        WHERE t.cycle_id = ? AND a.status = 'waitlisted'
        ORDER BY a.topic_id, a.priority ASC, a.created_at ASC, a.id ASC
        FOR UPDATE
      `, [cycleId])

      let migrated = 0
      const rankByTopic = new Map<string, number>()
      const batchByTopic = new Map<string, string>()
      for (const row of rows) {
        let batchId = batchByTopic.get(row.topic_id)
        if (!batchId) {
          const [existing] = await conn.query<any[]>(
            'SELECT id FROM selection_batches WHERE cycle_id = ? AND topic_id = ? FOR UPDATE',
            [cycleId, row.topic_id],
          )
          const resolvedBatchId = String(existing[0]?.id || uuidv4())
          batchId = resolvedBatchId
          if (!existing[0]) {
            await conn.query(
              `INSERT INTO selection_batches (id, cycle_id, topic_id, status)
               VALUES (?, ?, ?, 'draft')`,
              [resolvedBatchId, cycleId, row.topic_id],
            )
          }
          batchByTopic.set(row.topic_id, resolvedBatchId)
        }

        const rank = (rankByTopic.get(row.topic_id) || 0) + 1
        rankByTopic.set(row.topic_id, rank)
        await conn.query(`
          INSERT INTO selection_draft_items
            (id, batch_id, application_id, decision, decision_rank, comment)
          VALUES (?, ?, ?, 'reserve', ?, '由旧候补状态自动迁移')
          ON DUPLICATE KEY UPDATE decision = VALUES(decision), decision_rank = VALUES(decision_rank)
        `, [uuidv4(), batchId, row.id, rank])
        const [updated] = await conn.query<any>(
          "UPDATE applications SET status = 'pending' WHERE id = ? AND status = 'waitlisted'",
          [row.id],
        )
        migrated += Number(updated.affectedRows || 0)
      }
      await conn.commit()
      return { cycleId, migrated }
    } catch (error) {
      await conn.rollback()
      throw error
    }
  } finally {
    await conn.end()
  }
}

migrateSelectionDrafts()
  .then(result => console.log(`[gpss] 遴选草稿迁移完成：cycle=${result.cycleId ?? 'none'}, migrated=${result.migrated}`))
  .catch(error => {
    console.error('[gpss] 遴选草稿迁移失败:', error)
    process.exitCode = 1
  })
