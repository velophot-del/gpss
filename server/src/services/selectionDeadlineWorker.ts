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
    SELECT id, phases_config FROM cycles
    WHERE status IN ('active','selection','review','adjustment') AND phase IN ('teacher_review','adjustment')
  `)
  const summary: DeadlineCheckSummary = { checkedAt: now.toISOString(), cyclesChecked: cycles.length, settlementsStarted: 0, errors: scheduleErrors }
  for (const cycle of cycles) {
    const config = safeParseJson(cycle.phases_config, {})
    const [phase] = await query<any>('SELECT phase FROM cycles WHERE id = ?', [cycle.id])
    const deadline = phase?.phase === 'adjustment' ? getAdjustmentDeadline(config) : getReviewDeadline(config)
    if (!deadline || now.getTime() < deadline.getTime()) continue
    try {
      const result = phase?.phase === 'adjustment'
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
