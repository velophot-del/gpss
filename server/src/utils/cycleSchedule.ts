// 选题周期默认时间节点（按「6 月第 N 周」规则生成，仅作默认值，管理员可在前端手动改日期）。
// 周边界锚定：6 月第 N 周 = 6 月第 (7N-6) 日至第 (7N) 日（第 1 周 = 6/1–6/7）。
//   - 发布      6 月第 1–2 周  6/01–6/14
//   - 学生选题  6 月第 3–4 周  6/15–6/28
//   - 遴选      之后一周       6/29–7/05
//   - 公布结果  遴选结束后一周 7/06

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
