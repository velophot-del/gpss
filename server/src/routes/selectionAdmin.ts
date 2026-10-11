import { reopenAdjustment } from '../services/adjustmentReopenService.js'
import { Router } from 'express'
import { query, transaction } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { error, success } from '../utils/response.js'
import { getAdjustmentDeadline, getReviewDeadline, getTeacherStudentLimit } from '../utils/policies.js'
import { safeParseJson } from '../utils/json.js'
import { getMajorCodeAliases, normalizeMajorCode } from '../utils/majorCodes.js'
import { getDeadlineWorkerStatus } from '../services/selectionDeadlineWorker.js'
import { getSelectionConfigurationError, requestSettlementIfReady, SelectionSettlementError } from '../services/selectionSettlementService.js'
import { requestAdjustmentSettlementIfReady, AdjustmentSettlementError } from '../services/adjustmentSettlementService.js'
import { AcceptedResultAdjustmentError, adjustAcceptedResult, getAcceptedResultAdjustmentOptions } from '../services/acceptedResultAdjustmentService.js'

const router = Router()
router.use(authMiddleware, requireRole(['admin']))

router.get('/accepted-results/:applicationId/options', async (req: AuthRequest, res) => {
  try {
    success(res, await getAcceptedResultAdjustmentOptions(req.user!, req.params.applicationId))
  } catch (cause: any) {
    if (cause instanceof AcceptedResultAdjustmentError) return error(res, cause.message, cause.statusCode)
    console.error('读取录取调整选项失败:', cause)
    error(res, '服务器内部错误', 500)
  }
})

router.post('/accepted-results/:applicationId/adjust', async (req: AuthRequest, res) => {
  try {
    const targetApplicationId = req.body?.targetApplicationId
    const targetTopicId = req.body?.targetTopicId
    if (targetApplicationId !== null && targetApplicationId !== undefined && typeof targetApplicationId !== 'string') return error(res, '目标志愿格式无效', 400)
    if (targetTopicId !== null && targetTopicId !== undefined && typeof targetTopicId !== 'string') return error(res, '目标课题格式无效', 400)
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : ''
    const expectedCurrentApplicationId = req.body?.expectedCurrentApplicationId
    if (expectedCurrentApplicationId !== undefined && expectedCurrentApplicationId !== null && typeof expectedCurrentApplicationId !== 'string') return error(res, '当前录取标识格式无效', 400)
    success(res, await adjustAcceptedResult(req.user!, req.params.applicationId, targetApplicationId ?? null, reason, req.ip || null, expectedCurrentApplicationId, targetTopicId ?? null), '录取结果已调整')
  } catch (cause: any) {
    if (cause instanceof AcceptedResultAdjustmentError) return error(res, cause.message, cause.statusCode)
    console.error('调整正式录取结果失败:', cause)
    error(res, '服务器内部错误', 500)
  }
})

router.get('/selection-settlement/:cycleId', async (req: AuthRequest, res) => {
  try {
    const cycleId = Number(req.params.cycleId)
    const [cycle] = await query<any>('SELECT id, name, phase, phases_config FROM cycles WHERE id = ?', [cycleId])
    if (!cycle) return error(res, '选题周期不存在', 404)
    const config = safeParseJson<Record<string, any>>(cycle.phases_config, {})
    const deadline = getReviewDeadline(config)
    const topics = await query<any>(`
      SELECT t.id, t.title, t.teacher_id, u.real_name AS teacher_name, t.max_students,
             COUNT(DISTINCT a.id) AS application_count,
             COUNT(DISTINCT sdi.application_id) AS decided_count,
             sb.status AS batch_status, sb.version, sb.updated_at AS last_saved_at,
             sb.submitted_at, sb.auto_submitted_at
      FROM topics t JOIN users u ON u.id = t.teacher_id
      LEFT JOIN applications a ON a.topic_id = t.id AND a.status IN ('pending','submitted','pending_review','waitlisted','accepted')
      LEFT JOIN selection_batches sb ON sb.cycle_id = t.cycle_id AND sb.topic_id = t.id
      LEFT JOIN selection_draft_items sdi ON sdi.batch_id = sb.id
      WHERE t.cycle_id = ? AND t.status IN ('published','full')
      GROUP BY t.id, t.title, t.teacher_id, u.real_name, t.max_students, sb.status, sb.version, sb.updated_at, sb.submitted_at, sb.auto_submitted_at
      ORDER BY u.real_name, t.title
    `, [cycleId])
    const [settlement] = await query<any>('SELECT * FROM selection_settlements WHERE cycle_id = ?', [cycleId])
    success(res, {
      cycle: { id: cycle.id, name: cycle.name, phase: cycle.phase, deadline: deadline?.toISOString() || null },
      configurationError: await getSelectionConfigurationError(cycleId, config),
      worker: getDeadlineWorkerStatus(),
      settlement: settlement ? { ...settlement, result_json: safeParseJson(settlement.result_json, null) } : null,
      topics: topics.map(topic => ({
        ...topic,
        application_count: Number(topic.application_count),
        decided_count: Number(topic.decided_count),
        batch_status: Number(topic.application_count) === 0 ? 'not_required' : (topic.batch_status || 'draft'),
      })),
    })
  } catch (cause) {
    console.error('读取录取结算进度失败:', cause)
    error(res, '服务器内部错误', 500)
  }
})

router.post('/selection-topics/:topicId/unlock', async (req: AuthRequest, res) => {
  try {
    const reason = String(req.body?.reason || '').trim()
    if (!reason) return error(res, '请填写退回原因')
    await transaction(async conn => {
      const [batches] = await conn.query<any[]>(`
        SELECT sb.*, ss.status AS settlement_status
        FROM selection_batches sb
        LEFT JOIN selection_settlements ss ON ss.cycle_id = sb.cycle_id
        WHERE sb.topic_id = ? FOR UPDATE
      `, [req.params.topicId])
      const batch = batches[0]
      if (!batch) throw new SelectionSettlementError('该课题尚无遴选批次', 404)
      if (['running', 'completed'].includes(batch.settlement_status)) throw new SelectionSettlementError('结算已开始或已完成，不能退回')
      if (!['submitted', 'auto_submitted'].includes(batch.status)) throw new SelectionSettlementError('只有已提交名单可以退回')
      await conn.query("UPDATE selection_batches SET status = 'draft', version = version + 1, submitted_by = NULL, submitted_at = NULL, auto_submitted_at = NULL WHERE id = ?", [batch.id])
      await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail, ip_address)
        VALUES (?, 'selection_batch_unlocked', 'topic', ?, ?, ?)`, [req.user!.id, req.params.topicId, JSON.stringify({ reason, cycleId: batch.cycle_id }), req.ip || null])
    })
    success(res, null, '已退回教师修改')
  } catch (cause: any) {
    if (cause instanceof SelectionSettlementError) return error(res, cause.message, cause.statusCode)
    console.error('退回遴选名单失败:', cause)
    error(res, '服务器内部错误', 500)
  }
})

router.post('/selection-topics/:topicId/reset', async (req: AuthRequest, res) => {
  try {
    const reason = String(req.body?.reason || '').trim()
    if (req.body?.confirmation !== 'RESET') return error(res, '请确认恢复操作')
    if (!reason) return error(res, '请填写恢复原因')

    const result = await transaction(async conn => {
      const [topics] = await conn.query<any[]>(`
        SELECT t.id, t.cycle_id, t.status, ss.status AS settlement_status
        FROM topics t JOIN cycles c ON c.id = t.cycle_id
        LEFT JOIN selection_settlements ss ON ss.cycle_id = t.cycle_id
        WHERE t.id = ? FOR UPDATE
      `, [req.params.topicId])
      const topic = topics[0]
      if (!topic) throw new SelectionSettlementError('课题不存在或未关联选题周期', 404)
      if (['running', 'completed'].includes(topic.settlement_status)) throw new SelectionSettlementError('统一结算已开始或已完成，不能恢复单个课题')
      const cycleId = Number(topic.cycle_id)

      const [applications] = await conn.query<any[]>(`
        SELECT id, status, reviewed_at FROM applications WHERE topic_id = ? FOR UPDATE
      `, [topic.id])
      const resetIds = applications
        .filter(item => ['accepted', 'rejected', 'waitlisted'].includes(item.status) || (item.status === 'withdrawn' && item.reviewed_at))
        .map(item => item.id)
      const [draftCountRows] = await conn.query<any[]>(`
        SELECT COUNT(*) AS cnt FROM selection_draft_items sdi
        JOIN selection_batches sb ON sb.id = sdi.batch_id WHERE sb.topic_id = ?
      `, [topic.id])
      const [batches] = await conn.query<any[]>('SELECT id FROM selection_batches WHERE cycle_id = ? AND topic_id = ? FOR UPDATE', [cycleId, topic.id])

      if (resetIds.length) {
        await conn.query(`UPDATE applications
          SET status = 'pending_review', teacher_comment = NULL, reviewed_by = NULL, reviewed_at = NULL
          WHERE id IN (?)`, [resetIds])
      }
      await conn.query("UPDATE topics SET status = 'published' WHERE id = ? AND status = 'full'", [topic.id])
      await conn.query(`DELETE sdi FROM selection_draft_items sdi
        JOIN selection_batches sb ON sb.id = sdi.batch_id WHERE sb.topic_id = ?`, [topic.id])
      if (batches[0]) {
        await conn.query(`UPDATE selection_batches
          SET status = 'draft', version = version + 1, submitted_by = NULL, submitted_at = NULL, auto_submitted_at = NULL, settled_at = NULL
          WHERE id = ?`, [batches[0].id])
      }
      await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail, ip_address)
        VALUES (?, 'selection_topic_reset', 'topic', ?, ?, ?)`, [req.user!.id, topic.id, JSON.stringify({
          reason, cycleId, resetApplications: resetIds.length, deletedDraftItems: Number(draftCountRows[0]?.cnt || 0),
        }), req.ip || null])
      return { resetApplications: resetIds.length, deletedDraftItems: Number(draftCountRows[0]?.cnt || 0) }
    })
    success(res, result, '该课题教师遴选已恢复为未处理状态')
  } catch (cause: any) {
    if (cause instanceof SelectionSettlementError) return error(res, cause.message, cause.statusCode)
    console.error('恢复课题遴选失败:', cause)
    error(res, '服务器内部错误', 500)
  }
})

router.post('/selection-settlement/:cycleId/run', async (req: AuthRequest, res) => {
  try {
    const cycleId = Number(req.params.cycleId)
    const [settlement] = await query<any>('SELECT status FROM selection_settlements WHERE cycle_id = ?', [cycleId])
    const result = await requestSettlementIfReady(cycleId, settlement?.status === 'failed' ? 'admin_retry' : 'all_submitted')
    if (result.status === 'waiting') return error(res, `仍有 ${result.pendingTopics} 个课题未提交，且尚未到截止时间`, 409)
    success(res, result, '统一录取检查已完成')
  } catch (cause: any) {
    if (cause instanceof SelectionSettlementError) return error(res, cause.message, cause.statusCode)
    console.error('手动执行统一录取失败:', cause)
    error(res, cause?.message || '服务器内部错误', 500)
  }
})

router.get('/adjustment-settlement/:cycleId', async (req: AuthRequest, res) => {
  try {
    const cycleId = Number(req.params.cycleId)
    const [cycle] = await query<any>('SELECT id,name,phase,phases_config FROM cycles WHERE id=?', [cycleId])
    if (!cycle) return error(res, '选题周期不存在', 404)
    const deadline = getAdjustmentDeadline(safeParseJson(cycle.phases_config, {}))
    const eligibleStudents = await query<any>(`SELECT DISTINCT s.id, s.real_name AS student_name,
        s.student_id AS student_code, s.class_name, s.major, s.major_code,
        (SELECT COUNT(*) FROM adjustment_volunteers av WHERE av.cycle_id=? AND av.student_id=s.id) AS volunteer_count
      FROM applications a JOIN topics t ON t.id=a.topic_id JOIN users s ON s.id=a.student_id
      WHERE t.cycle_id=? AND s.role='student' AND NOT EXISTS (
        SELECT 1 FROM applications accepted JOIN topics accepted_topic ON accepted_topic.id=accepted.topic_id
        WHERE accepted.student_id=a.student_id AND accepted_topic.cycle_id=? AND accepted.status='accepted'
      ) ORDER BY s.real_name,s.student_id`, [cycleId, cycleId, cycleId])
    const [volunteers] = await query<any>(`SELECT COUNT(*) AS total,COUNT(DISTINCT student_id) AS students
      FROM adjustment_volunteers WHERE cycle_id=?`, [cycleId])
    const topics = await query<any>(`SELECT t.id,t.title,t.major,t.major_code,u.real_name teacher_name,t.max_students,
        COUNT(DISTINCT av.id) volunteer_count,
        (SELECT COUNT(DISTINCT accepted.student_id) FROM applications accepted WHERE accepted.topic_id=t.id AND accepted.status='accepted') current_accepted_count,
        (SELECT COUNT(DISTINCT teacher_accepted.student_id) FROM applications teacher_accepted
          JOIN topics teacher_topic ON teacher_topic.id=teacher_accepted.topic_id
          WHERE teacher_topic.teacher_id=t.teacher_id AND teacher_topic.cycle_id=t.cycle_id AND teacher_accepted.status='accepted') teacher_accepted_count,
        COUNT(DISTINCT CASE WHEN av.status='accepted' THEN av.student_id END) adjustment_accepted_count
      FROM topics t JOIN users u ON u.id=t.teacher_id
      LEFT JOIN adjustment_volunteers av ON av.topic_id=t.id AND av.cycle_id=t.cycle_id
      WHERE t.cycle_id=? AND t.status='published'
      GROUP BY t.id,t.title,t.major,t.major_code,t.teacher_id,t.cycle_id,u.real_name,t.max_students
      ORDER BY u.real_name,t.title`, [cycleId])
    const eligibleMajorCodes = new Set(eligibleStudents.flatMap((student: any) =>
      getMajorCodeAliases(normalizeMajorCode(student.major_code, student.major)).filter(Boolean)))
    const teacherLimit = getTeacherStudentLimit(safeParseJson(cycle.phases_config, {}))
    const eligibleTopics = topics.filter((topic: any) => {
      const topicMajorCodes = getMajorCodeAliases(normalizeMajorCode(topic.major_code, topic.major))
      return topicMajorCodes.some(code => !!code && eligibleMajorCodes.has(code))
        && Number(topic.current_accepted_count) < Number(topic.max_students)
        && (teacherLimit <= 0 || Number(topic.teacher_accepted_count) < teacherLimit)
    })
    const [settlement] = await query<any>('SELECT * FROM adjustment_settlements WHERE cycle_id=?', [cycleId])
    const archives = await query<any>(`SELECT id, reopened_at, reason,
      JSON_EXTRACT(snapshot_json, '$.settlement.result_json') AS result_json
      FROM adjustment_round_archives WHERE cycle_id = ? ORDER BY sequence DESC`, [cycleId])
    const result = settlement ? safeParseJson<Record<string, any> | null>(settlement.result_json, null) : null
    success(res, {
      cycle: { id: cycle.id, name: cycle.name, phase: cycle.phase, deadline: deadline?.toISOString() || null },
      configurationError: deadline ? null : '当前周期未配置有效的调剂截止时间',
      counts: {
        students: eligibleStudents.length, volunteers: Number(volunteers?.total || 0),
        submittedStudents: Number(volunteers?.students || 0), accepted: Number(result?.accepted || 0),
        unmatchedStudents: Number(result?.unmatchedStudents || 0),
      }, eligibleStudents: eligibleStudents.map((student: any) => ({ ...student, volunteer_count: Number(student.volunteer_count || 0) })),
      topics: eligibleTopics.map((topic: any) => ({
        ...topic, max_students: Number(topic.max_students), volunteer_count: Number(topic.volunteer_count || 0),
        current_accepted_count: Number(topic.current_accepted_count || 0),
        teacher_accepted_count: Number(topic.teacher_accepted_count || 0),
        teacher_student_limit: teacherLimit,
        adjustment_accepted_count: Number(topic.adjustment_accepted_count || 0),
      })), archives: archives.map(row => ({ ...row, result_json: safeParseJson(safeParseJson(row.result_json, null), null) })),
      settlement: settlement ? { ...settlement, result_json: result } : null,
    })
  } catch (cause) { console.error('读取调剂结算进度失败:', cause); error(res, '服务器内部错误', 500) }
})

router.post('/adjustment-topics/:topicId/unlock', async (req: AuthRequest, res) => {
  return error(res, '调剂阶段不再由教师遴选名单，旧批次仅保留为历史记录', 410)
})

router.post('/adjustment-settlement/:cycleId/reopen', async (req: AuthRequest, res) => {
  try {
    success(res, await reopenAdjustment(Number(req.params.cycleId), req.user!, req.body, req.ip || null), '已重新开放补录，请未录取学生重新提交志愿')
  } catch (cause: any) {
    if (cause instanceof AdjustmentSettlementError) return error(res, cause.message, cause.statusCode)
    console.error('重新开放补录失败:', cause)
    error(res, '重新开放失败，原结算已保留', 500)
  }
})

router.post('/adjustment-settlement/:cycleId/run', async (req: AuthRequest, res) => {
  try {
    const [settlement] = await query<any>('SELECT status FROM adjustment_settlements WHERE cycle_id=?',[Number(req.params.cycleId)])
    if (settlement?.status !== 'failed') return error(res, '系统将在调剂截止后自动匹配；仅失败结算可在截止后重试', 409)
    const result = await requestAdjustmentSettlementIfReady(Number(req.params.cycleId), 'admin_retry')
    if (result.status === 'waiting') return error(res, '尚未到调剂截止时间，暂不能重试',409)
    success(res,result,'调剂统一结算已完成')
  } catch(cause:any) { if(cause instanceof AdjustmentSettlementError) return error(res,cause.message,cause.statusCode); error(res,cause?.message || '服务器内部错误',500) }
})

export default router
