// 选题周期默认时间节点（与后端 server/src/utils/cycleSchedule.ts 保持一致）。
// 按「6 月第 N 周」规则生成，仅作默认值，管理员可在创建周期时手动改日期。
// 周边界锚定：6 月第 N 周 = 6 月第 (7N-6) 日至第 (7N) 日（第 1 周 = 6/1–6/7）。
export interface DefaultCycleSchedule {
  topic_publish: { start: string; end: string }
  student_apply: { start: string; end: string }
  teacher_review: { start: string; end: string }
  result_announce: string
}

export function defaultCycleSchedule(year: number | string): DefaultCycleSchedule {
  const y = String(year)
  return {
    topic_publish: { start: `${y}-06-01`, end: `${y}-06-14` },
    student_apply: { start: `${y}-06-15`, end: `${y}-06-28` },
    teacher_review: { start: `${y}-06-29`, end: `${y}-07-05` },
    result_announce: `${y}-07-06`,
  }
}
