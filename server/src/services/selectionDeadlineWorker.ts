import { advanceScheduledCycles } from './cycleScheduleService.js'
import { query } from '../config/database.js'
import { getReviewDeadline } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'
import { requestSettlementIfReady } from './selectionSettlementService.js'
import { requestAdjustmentSettlementIfReady } from './adjustmentSettlementService.js'
import { getAdjustmentDeadline } from '../utils/policies.js'

export type DeadlineCheckSummary = { checkedAt: string; cyclesChecked: number; settlementsStarted: number; errors: string[] }

let lastCheck: DeadlineCheckSummary | null = null

export function getDeadlineWorkerStatus() { return lastCheck }

export async function checkSelectionDeadlines(now = new Date()): Promise<DeadlineCheckSummary> {
  const scheduleErrors = await advanceScheduledCycles(now)
  const cycles = await query<any>(`
    SELECT id, status, phase, phases_config FROM cycles
    WHERE (status IN ('active','selection','review','adjustment') AND phase IN ('teacher_review','adjustment'))
       OR (status = 'process'
           AND EXISTS (SELECT 1 FROM adjustment_round_archives ara WHERE ara.cycle_id = cycles.id)
           AND NOT EXISTS (SELECT 1 FROM adjustment_settlements ads WHERE ads.cycle_id = cycles.id AND ads.status = 'completed'))
  `)
  const summary: DeadlineCheckSummary = { checkedAt: now.toISOString(), cyclesChecked: cycles.length, settlementsStarted: 0, errors: scheduleErrors }
  for (const cycle of cycles) {
    const config = safeParseJson(cycle.phases_config, {})
    const adjustmentRound = cycle.phase === 'adjustment' || cycle.status === 'process'
    const deadline = adjustmentRound ? getAdjustmentDeadline(config) : getReviewDeadline(config)
    if (!deadline || now.getTime() < deadline.getTime()) continue
    try {
      const result = adjustmentRound
        ? await requestAdjustmentSettlementIfReady(Number(cycle.id), 'deadline')
        : await requestSettlementIfReady(Number(cycle.id), 'deadline')
      if (result.status === 'completed') summary.settlementsStarted += 1
    } catch (cause: any) {
      summary.errors.push(`cycle ${cycle.id}: ${cause?.message || cause}`)
      console.error('[selection-deadline]', cause)
    }
  }
  lastCheck = summary
  return summary
}

export function startSelectionDeadlineWorker(): { stop(): void } {
  let checking = false
  const check = async () => {
    if (checking) return
    checking = true
    try { await checkSelectionDeadlines() }
    catch (cause: any) {
      lastCheck = { checkedAt: new Date().toISOString(), cyclesChecked: 0, settlementsStarted: 0, errors: [String(cause?.message || cause)] }
      console.error('[selection-deadline]', cause)
    } finally { checking = false }
  }
  void check()
  const timer = setInterval(() => void check(), 60_000)
  timer.unref()
  return { stop: () => clearInterval(timer) }
}
