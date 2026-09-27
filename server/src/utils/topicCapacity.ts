export function getTopicStudentLimit(config: unknown): number {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 10
  const rawLimit = (config as Record<string, unknown>).topic_student_limit
  const limit = typeof rawLimit === 'number' || typeof rawLimit === 'string' ? Number(rawLimit) : NaN
  return Number.isInteger(limit) && limit >= 1 && limit <= 10 ? limit : 10
}

export function validateTopicStudentCount(value: unknown, limit: number): string | null {
  const count = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(count) || count < 1) return '课题招收人数必须为正整数'
  if (count > limit) return `课题招收人数不能超过本周期设置的上限（最多可设置为${limit}人）`
  return null
}

export function validateTopicStudentLimitSetting(value: unknown): string | null {
  const limit = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(limit) && limit >= 1 && limit <= 10
    ? null
    : '单课题人数上限必须设置为1至10之间的整数'
}
