import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'

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

// 获取当前进行中的周期阶段（phase）
export async function getCurrentPhase() {
  const rows = await query<any>(`
    SELECT phase FROM cycles
    WHERE status IN ('active', 'selection', 'review', 'adjustment')
    ORDER BY created_at DESC LIMIT 1
  `)
  return rows[0]?.phase || null
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
