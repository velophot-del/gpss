const UNRESOLVED_STATUSES = new Set(['pending', 'submitted', 'pending_review'])
const FINAL_STATUSES = new Set(['accepted', 'rejected', 'waitlisted', 'cancelled'])

export function canReturnVolunteerRows(rows: any[]): boolean {
  const pending = rows.filter(row => UNRESOLVED_STATUSES.has(row.status))
  return pending.length >= 3 && pending.length <= 6 && !rows.some(row => FINAL_STATUSES.has(row.status))
}
