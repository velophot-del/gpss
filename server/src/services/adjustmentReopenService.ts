import { v4 as uuidv4 } from 'uuid'
import { getConnection } from '../config/database.js'
import { safeParseJson } from '../utils/json.js'
import { getAdjustmentDeadline, type SessionUser } from '../utils/policies.js'
import { AdjustmentSettlementError } from './adjustmentSettlementService.js'

export async function reopenAdjustment(cycleId: number, actor: SessionUser, input: { settlementId: string; deadline: string; reason: string }, ip: string | null) {
  if (actor.role !== 'admin') throw new AdjustmentSettlementError('只有管理员可以重新开放补录', 403)
  if (!Number.isInteger(cycleId) || cycleId <= 0 || !input || typeof input.settlementId !== 'string'
    || !input.settlementId || typeof input.deadline !== 'string' || typeof input.reason !== 'string'
    || !input.reason.trim() || input.reason.trim().length > 500) throw new AdjustmentSettlementError('请提供结算记录、截止时间及不超过500字的原因', 400)
  const conn = await getConnection()
  const acquired: string[] = []
  try {
    for (const name of [`gpss:selection-settlement:${cycleId}`, `gpss:adjustment-settlement:${cycleId}`]) {
      const [rows] = await conn.query<any[]>('SELECT GET_LOCK(?, 0) AS acquired', [name])
      if (Number(rows[0]?.acquired) !== 1) throw new AdjustmentSettlementError('结算或录取调整正在执行，请稍后重试')
      acquired.push(name)
    }
    await conn.beginTransaction()
    try {
      const [cycles] = await conn.query<any[]>('SELECT * FROM cycles WHERE id = ? FOR UPDATE', [cycleId])
      const cycle = cycles[0]
      if (!cycle || !['active', 'selection', 'review', 'adjustment'].includes(cycle.status) || cycle.phase !== 'adjustment') {
        throw new AdjustmentSettlementError('请先将当前进行中周期设置为调剂阶段')
      }
      const config = safeParseJson<Record<string, any>>(cycle.phases_config, {})
      const deadline = getAdjustmentDeadline(config)
      if (!deadline || deadline.getTime() <= Date.now()) throw new AdjustmentSettlementError('请先在周期管理中设置未来的调剂截止时间')
      if (deadline.toISOString() !== input.deadline) throw new AdjustmentSettlementError('截止时间已变化，请刷新后确认')
      const [settlements] = await conn.query<any[]>('SELECT * FROM adjustment_settlements WHERE cycle_id = ? FOR UPDATE', [cycleId])
      const settlement = settlements[0]
      if (settlement?.status !== 'completed' || settlement.id !== input.settlementId) throw new AdjustmentSettlementError('本轮尚未结算完成或已重新开放，请刷新')
      const [selection] = await conn.query<any[]>('SELECT status FROM selection_settlements WHERE cycle_id = ? FOR UPDATE', [cycleId])
      if (selection[0]?.status === 'running') throw new AdjustmentSettlementError('首轮结算正在执行，请稍后重试')
      const [volunteers] = await conn.query<any[]>('SELECT * FROM adjustment_volunteers WHERE cycle_id = ? FOR UPDATE', [cycleId])
      const [batches] = await conn.query<any[]>('SELECT * FROM adjustment_batches WHERE cycle_id = ? FOR UPDATE', [cycleId])
      const [draftItems] = await conn.query<any[]>(`SELECT di.* FROM adjustment_draft_items di
        JOIN adjustment_batches b ON b.id = di.batch_id WHERE b.cycle_id = ? FOR UPDATE`, [cycleId])
      const archiveId = uuidv4()
      await conn.query(`INSERT INTO adjustment_round_archives (id, cycle_id, settlement_id, snapshot_json, reopened_by, reason, next_deadline)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [archiveId, cycleId, settlement.id,
        JSON.stringify({ settlement, volunteers, batches, draftItems }), actor.id, input.reason.trim(), deadline])
      // Archive all rows before clearing the active round; formal admissions stay in applications.
      await conn.query('DELETE FROM adjustment_batches WHERE cycle_id = ?', [cycleId])
      await conn.query('DELETE FROM adjustment_volunteers WHERE cycle_id = ?', [cycleId])
      await conn.query('DELETE FROM adjustment_settlements WHERE cycle_id = ?', [cycleId])
      await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail, ip_address)
        VALUES (?, 'adjustment_reopened', 'cycle', ?, ?, ?)`, [actor.id, String(cycleId),
        JSON.stringify({ archiveId, settlementId: settlement.id, deadline: deadline.toISOString(), reason: input.reason.trim() }), ip])
      await conn.commit()
      return { archiveId, deadline: deadline.toISOString() }
    } catch (cause) { await conn.rollback(); throw cause }
  } finally {
    try { for (const name of acquired.reverse()) await conn.query('SELECT RELEASE_LOCK(?)', [name]) }
    finally { conn.release() }
  }
}
