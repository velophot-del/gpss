import { query } from '../config/database.js'

export function canEditTaskBook(phase: string | null, proposalApproved: boolean): boolean {
  return !proposalApproved && ['task_book', 'proposal', 'midterm', 'thesis_design', 'defense', 'grading'].includes(phase || '')
}

export async function taskBookEditable(studentId: string, topicId: string, cycleId: number | string, conn?: any): Promise<boolean> {
  // 与任务书确认、开题审核共用课题锁，防止审核通过与修改同时发生。
  if (conn) await conn.query('SELECT id FROM topics WHERE id = ? FOR UPDATE', [topicId])
  const sql = `SELECT c.phase, EXISTS(SELECT 1 FROM proposals p WHERE p.student_id = ? AND p.topic_id = ? AND p.status = 'approved') AS approved
    FROM cycles c WHERE c.id = ?`
  const params = [studentId, topicId, cycleId]
  const rows = conn ? (await conn.query(sql, params))[0] : await query<any>(sql, params)
  return Boolean(rows[0] && canEditTaskBook(rows[0].phase, Boolean(Number(rows[0].approved))))
}
