// 未携带时区的阶段时间统一按北京时间解释，避免服务器时区影响开放时间。
export function parseScheduleDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  let text = value.trim().replace(' ', 'T')
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(text)
  if (!match) return null
  const [, year, month, day] = match
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day)) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00:00'
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(text)) text += '+08:00'
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

export function nextScheduledPhase(phase: string, config: Record<string, any>, now: Date): string | null {
  const aliases: Record<string, string> = { topic_submission: 'topic_publish', student_selection: 'student_apply', result: 'result_announce' }
  const phases = ['topic_publish', 'student_apply', 'teacher_review', 'result_announce', 'adjustment']
  const index = phases.indexOf(aliases[phase] || phase)
  if (index < 0 || index >= phases.length - 1) return null
  const next = phases[index + 1]
  const value = config[next] ?? (next === 'student_apply' ? config.student_selection : next === 'result_announce' ? config.result : undefined)
  const start = parseScheduleDate(typeof value === 'object' && value ? value.start : value)
  return start && now.getTime() >= start.getTime() ? next : null
}
