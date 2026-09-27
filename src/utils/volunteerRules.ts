export const VOLUNTEER_MIN = 3
export const VOLUNTEER_MAX = 6

export function formatPriority(priority: number): string {
  return `第 ${priority} 志愿`
}

export function priorityTagType(priority: number): 'danger' | 'warning' | 'info' {
  if (priority === 1) return 'danger'
  if (priority === 2) return 'warning'
  return 'info'
}
