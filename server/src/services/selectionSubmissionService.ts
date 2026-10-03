import type { Connection } from 'mysql2/promise'

// 仅处理尚可审核的申请；正式录取、撤回及已结算结果不改动。
export async function finalizeSelectionDecisions(conn: Connection, batchId: string): Promise<number> {
  const [rows] = await conn.query<any[]>(`
    SELECT a.id, a.priority, sdi.decision, sdi.decision_rank
    FROM selection_batches b JOIN applications a ON a.topic_id = b.topic_id
    LEFT JOIN selection_draft_items sdi ON sdi.batch_id = b.id AND sdi.application_id = a.id
    WHERE b.id = ? AND b.status IN ('draft','submitted','auto_submitted')
      AND a.status IN ('pending','submitted','pending_review','waitlisted')
    ORDER BY a.priority, a.created_at, a.id FOR UPDATE
  `, [batchId])
  let rank = Math.max(0, ...rows.filter(row => row.decision === 'reserve').map(row => Number(row.decision_rank) || 0))
  let rejected = 0
  for (const row of rows) {
    if (!row.decision) {
      await conn.query(`INSERT INTO selection_draft_items (id, batch_id, application_id, decision, decision_rank, comment)
        VALUES (UUID(), ?, ?, 'reject', NULL, '提交时未选择接收，自动归为本课题不录取')`, [batchId, row.id])
      rejected++
    } else if (row.decision === 'proposed' && Number(row.priority) !== 1) {
      // 保留旧版已保存的接收意愿，低志愿拟录取在提交时转为候补。
      await conn.query("UPDATE selection_draft_items SET decision = 'reserve', decision_rank = ? WHERE batch_id = ? AND application_id = ?", [++rank, batchId, row.id])
    }
  }
  return rejected
}
