import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'

// 进行中周期的 status 值（active/selection/review/adjustment 均视为进行中）
export const IN_PROGRESS_CYCLE_STATUSES = ['active', 'selection', 'review', 'adjustment'] as const

export function isInProgressCycle(status?: string | null): boolean {
  return IN_PROGRESS_CYCLE_STATUSES.some(s => s === status)
}

// 学生“填报/撤销志愿”允许的阶段（兼容新旧两套阶段命名）
export const STUDENT_SELECTION_PHASES = ['student_selection', 'student_apply'] as const

export function isStudentSelectionPhase(phase?: string | null): boolean {
  return STUDENT_SELECTION_PHASES.some(p => p === phase)
}

// 教师遴选只能在教师遴选阶段进行，学生申报阶段只允许学生填报志愿。
export const TEACHER_REVIEW_PHASES = ['teacher_review'] as const

export function isTeacherReviewPhase(phase?: string | null): boolean {
  return TEACHER_REVIEW_PHASES.some(p => p === phase)
}

/**
 * 毕业全流程共享辅助函数：
 *  - 学生被录取的选题锚点（学生-课题-导师 三元关系）
 *  - 当前进行中周期的阶段（phase）
 *  - 站内通知
 */

// 获取学生当前被录取的选题（学生-课题-导师 三元关系锚点）
export async function getAcceptedSelection(studentId: string) {
  const rows = await query<any>(`
    SELECT a.id AS application_id, a.student_id, a.topic_id,
           t.teacher_id, t.title AS topic_title, t.cycle_id
    FROM applications a
    JOIN topics t ON a.topic_id = t.id
    WHERE a.student_id = ? AND a.status = 'accepted'
    ORDER BY a.updated_at DESC
    LIMIT 1
  `, [studentId])
  return rows[0] || null
}

// 获取当前进行中的周期（active/selection/review/adjustment 任一状态）
export async function getActiveCycle() {
  const rows = await query<any>(`
    SELECT * FROM cycles
    WHERE status IN ('active', 'selection', 'review', 'adjustment')
    ORDER BY created_at DESC LIMIT 1
  `)
  return rows[0] || null
}

// 获取当前进行中的周期阶段（phase）
export async function getCurrentPhase() {
  const cycle = await getActiveCycle()
  return cycle?.phase || null
}

// 发送站内通知
export async function notify(userIds: (string | null | undefined)[], type: string, title: string, content: string, relatedType?: string, relatedId?: string) {
  const uniq = [...new Set(userIds.filter(Boolean))] as string[]
  for (const uid of uniq) {
    await query(`
      INSERT INTO notifications (id, user_id, type, title, content, related_type, related_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [uuidv4(), uid, type, title, content, relatedType || null, relatedId || null])
  }
}
