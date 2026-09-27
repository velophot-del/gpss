export const VOLUNTEER_MIN = 3
export const VOLUNTEER_MAX = 6

export function formatPriority(priority: number): string {
  return `第 ${priority} 志愿`
}

export function validateContinuousPriorities(priorities: number[]): string | null {
  if (priorities.length < VOLUNTEER_MIN || priorities.length > VOLUNTEER_MAX) {
    return `志愿数量须为 ${VOLUNTEER_MIN}-${VOLUNTEER_MAX} 个`
  }
  if (priorities.some(priority => !Number.isInteger(priority))) {
    return `志愿序号须为 1-${VOLUNTEER_MAX} 的整数`
  }
  const sorted = [...new Set(priorities)].sort((a, b) => a - b)
  if (sorted.length !== priorities.length || sorted.some((priority, index) => priority !== index + 1)) {
    return `志愿序号必须连续且恰好为 1-${priorities.length}`
  }
  return null
}
