import { query } from '../config/database.js'
import { safeParseJson } from '../utils/json.js'
import { nextScheduledPhase, parseScheduleDate } from '../utils/cycleSchedule.js'
import { getSelectionConfigurationError, requestSettlementIfReady } from './selectionSettlementService.js'
import { getReviewDeadline, getAdjustmentDeadline } from '../utils/policies.js'

export async function advanceScheduledCycles(now = new Date()): Promise<string[]> {
  const errors: string[] = []
  const cycles = await query<any>("SELECT id FROM cycles WHERE status IN ('active','selection','review','adjustment')")
  for (const cycle of cycles) {
    try {
      // 顺序补查：即使服务停机跨过多个阶段，也不能跳过遴选及结算。
      for (let step = 0; step < 4; step++) {
        const [current] = await query<any>('SELECT * FROM cycles WHERE id = ?', [cycle.id])
        if (!current || !['active', 'selection', 'review', 'adjustment'].includes(current.status)) break
        const config = safeParseJson<Record<string, any>>(current.phases_config, {})
        if (config.phase_switch_mode === 'manual') break
        const next = nextScheduledPhase(current.phase, config, now)
        if (!next) break
        if (next === 'teacher_review') {
          const configurationError = await getSelectionConfigurationError(Number(cycle.id), config)
          if (configurationError) throw new Error(configurationError)
          const start = parseScheduleDate(config.teacher_review?.start)
          const deadline = getReviewDeadline(config)
          if (!start || !deadline || deadline <= start) throw new Error('教师遴选截止时间必须晚于开始时间')
        }
        if (next === 'result_announce') {
          const deadline = getReviewDeadline(config)
          if (!deadline || now < deadline) throw new Error('教师遴选尚未截止，不能自动公示')
          const result = await requestSettlementIfReady(Number(cycle.id), 'deadline')
          if (result.status !== 'completed') throw new Error('录取结算尚未完成，不能自动公示')
        }
        if (next === 'adjustment') {
          const [settlement] = await query<any>('SELECT status FROM selection_settlements WHERE cycle_id = ?', [cycle.id])
          if (settlement?.status !== 'completed') throw new Error('录取结算尚未完成，不能开放调剂')
          const start = parseScheduleDate(config.adjustment?.start)
          const deadline = getAdjustmentDeadline(config)
          if (!start || !deadline || deadline <= start) throw new Error('调剂截止时间必须晚于开始时间')
        }
        const statuses: Record<string, string> = { student_apply: 'selection', teacher_review: 'review', result_announce: 'review', adjustment: 'adjustment' }
        // 管理员并发修改配置或阶段时放弃本次更新，下次检查再重新判断。
        const updated = await query<any>(`UPDATE cycles SET phase = ?, status = ? WHERE id = ? AND phase = ? AND status = ? AND updated_at = ?`,
          [next, statuses[next], cycle.id, current.phase, current.status, current.updated_at])
        if ((updated as any).affectedRows !== 1) break
      }
    } catch (cause: any) {
      errors.push(`cycle ${cycle.id}: ${cause?.message || cause}`)
    }
  }
  return errors
}
