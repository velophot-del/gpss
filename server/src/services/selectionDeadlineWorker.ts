import { query } from '../config/database.js'
import { getReviewDeadline } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'
import { requestSettlementIfReady } from './selectionSettlementService.js'

export type DeadlineCheckSummary = { checkedAt: string; cyclesChecked: number; settlementsStarted: number; errors: string[] }

let lastCheck: DeadlineCheckSummary | null = null

export function getDeadlineWorkerStatus() { return lastCheck }

export async function checkSelectionDeadlines(now = new Date()): Promise<DeadlineCheckSummary> {
  const cycles = await query<any>(`
    SELECT id, phases_config FROM cycles
    WHERE status IN ('active','selection','review','adjustment') AND phase = 'teacher_review'
  `)
  const summary: DeadlineCheckSummary = { checkedAt: now.toISOString(), cyclesChecked: cycles.length, settlementsStarted: 0, errors: [] }
  for (const cycle of cycles) {
    const deadline = getReviewDeadline(safeParseJson(cycle.phases_config, {}))
    if (!deadline || now.getTime() < deadline.getTime()) continue
    try {
      const result = await requestSettlementIfReady(Number(cycle.id), 'deadline')
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
  void checkSelectionDeadlines()
  const timer = setInterval(() => void checkSelectionDeadlines(), 60_000)
  timer.unref()
  return { stop: () => clearInterval(timer) }
}
