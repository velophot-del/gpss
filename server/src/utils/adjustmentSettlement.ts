export function isAdjustmentSettlementDue(deadline: Date, now = Date.now()): boolean {
  return Number.isFinite(deadline.getTime()) && now >= deadline.getTime()
}
