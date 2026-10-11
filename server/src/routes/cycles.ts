import { Router } from 'express'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { isInProgressCycle } from '../utils/processFlow.js'
import { safeParseJson } from '../utils/json.js'
import { getReviewDeadline } from '../utils/policies.js'
import { getSelectionConfigurationError } from '../services/selectionSettlementService.js'
import { validateTopicStudentLimitSetting } from '../utils/topicCapacity.js'

const router = Router()
router.use(authMiddleware)

// GET /api/cycles - 获取所有周期
router.get('/', async (req: AuthRequest, res) => {
  try {
    const list = await query<any>('SELECT * FROM cycles ORDER BY created_at DESC')
    success(res, list)
  } catch (err: any) {
    error(res, '服务器内部错误', 500)
  }
})

// 优先返回选题周期；选题周期结束后返回最近的毕业设计周期供全局阶段提示使用。
router.get('/active', async (req: AuthRequest, res) => {
  try {
    const [cycle] = await query<any>(`
      SELECT * FROM cycles 
      WHERE status IN ('active', 'selection', 'review', 'adjustment', 'process')
      ORDER BY CASE WHEN status = 'process' THEN 1 ELSE 0 END, created_at DESC LIMIT 1
    `)
    success(res, cycle || null)
  } catch (err: any) {
    error(res, '服务器内部错误', 500)
  }
})

// POST /api/cycles - 创建周期（管理员）
router.post('/', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { name, description, year, startDate, endDate, phasesConfig, status } = req.body

    if (phasesConfig && typeof phasesConfig === 'object' && phasesConfig.topic_student_limit !== undefined) {
      const limitError = validateTopicStudentLimitSetting(phasesConfig.topic_student_limit)
      if (limitError) return error(res, limitError, 400)
    }

    const newStatus = status || 'draft'
    // 同一时刻只允许一个进行中周期：直接以进行中状态创建前需先结束旧周期
    if (isInProgressCycle(newStatus)) {
      const rivalRows = await query<any>(
        "SELECT id, name FROM cycles WHERE status IN ('active','selection','review','adjustment') LIMIT 1"
      )
      if (rivalRows.length > 0) {
        return error(res, `已有进行中的周期「${rivalRows[0].name}」，请先将其结束再开启新周期`, 400)
      }
    }

    const result = await query<any>(`
      INSERT INTO cycles (name, description, year, status, phase, start_date, end_date, phases_config, created_by)
      VALUES (?, ?, ?, ?, 'topic_submission', ?, ?, ?, ?)
    `, [name, description, year, newStatus, startDate, endDate, phasesConfig ? JSON.stringify(phasesConfig) : null, req.user!.id])
    success(res, { id: (result as any).insertId }, '周期创建成功')
  } catch (err: any) {
    console.error('创建周期失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// PUT /api/cycles/:id - 更新周期
router.put('/:id', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { name, description, year, status, phase, startDate, endDate, phasesConfig } = req.body
    // 获取现有记录，用作回退默认值
    const [existing] = await query<any>('SELECT * FROM cycles WHERE id = ?', [id])
    if (!existing) return error(res, '周期不存在')

    // 同一时刻只允许一个进行中周期：开启本周期前须先结束其它进行中周期
    const nextStatus = status ?? existing.status
    if (isInProgressCycle(nextStatus)) {
      const rivalRows = await query<any>(
        "SELECT id, name FROM cycles WHERE status IN ('active','selection','review','adjustment') AND id != ? LIMIT 1",
        [id]
      )
      if (rivalRows.length > 0) {
        return error(res, `已有进行中的周期「${rivalRows[0].name}」，请先将其结束再开启新周期`, 400)
      }
    }

    // phases_config：请求只覆盖其传的顶层键，未传的键（topicAccessPolicy/majors/researchCategories 等）保留，
    // 避免编辑阶段时间时把其它周期配置整体清掉
    const base = safeParseJson<any>(existing.phases_config, null)
    const merged = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
    if (phasesConfig && typeof phasesConfig === 'object' && !Array.isArray(phasesConfig)) {
      Object.assign(merged, phasesConfig)
    }
    if (!['auto', 'manual'].includes(merged.phase_switch_mode ?? 'auto')) return error(res, '阶段切换方式无效', 400)
    if (merged.ignore_capacity_conflicts !== undefined && typeof merged.ignore_capacity_conflicts !== 'boolean') return error(res, '忽略人数冲突必须为布尔值', 400)
    const phasesConfigFinal = JSON.stringify(merged)

    if (phasesConfig && typeof phasesConfig === 'object' && Object.prototype.hasOwnProperty.call(phasesConfig, 'topic_student_limit')) {
      const limitError = validateTopicStudentLimitSetting(phasesConfig.topic_student_limit)
      if (limitError) return error(res, limitError, 400)
    }

    const nextPhase = phase ?? existing.phase
    if (nextStatus === 'process' && nextPhase === 'task_book' && existing.status !== 'process') {
      if (!['adjustment', 'completed'].includes(existing.status)) {
        return error(res, '请在选题与调剂结束后开启毕业设计阶段', 409)
      }
      const [accepted] = await query<any>(`
        SELECT COUNT(*) AS count FROM applications a
        JOIN topics t ON t.id = a.topic_id
        WHERE t.cycle_id = ? AND a.status = 'accepted'
      `, [id])
      if (Number(accepted?.count || 0) === 0) return error(res, '本周期尚无已录取学生，无法开启毕业设计阶段', 409)
    }
    if (nextPhase === 'teacher_review') {
      if (!getReviewDeadline(merged)) return error(res, '进入教师遴选阶段前必须配置有效的审核截止时间', 409)
      const configurationError = await getSelectionConfigurationError(Number(id), merged)
      if (configurationError) return error(res, configurationError, 409)
    }

    await query(`
      UPDATE cycles SET name = ?, description = ?, year = ?, status = ?, phase = ?,
                        start_date = ?, end_date = ?, phases_config = ?
      WHERE id = ?
    `, [
      name ?? existing.name,
      description ?? existing.description,
      year ?? existing.year,
      status ?? existing.status,
      phase ?? existing.phase,
      startDate ?? existing.start_date,
      endDate ?? existing.end_date,
      phasesConfigFinal,
      id
    ])
    success(res, null, '周期更新成功')
  } catch (err: any) {
    console.error('更新周期失败 - 请求参数:', JSON.stringify(req.body))
    console.error('更新周期失败 - 错误详情:', err.message, err.sql || '')
    error(res, '服务器内部错误', 500)
  }
})

// DELETE /api/cycles/:id - 删除周期（管理员）
router.delete('/:id', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    // 检查周期是否存在
    const [cycle] = await query<any>('SELECT id, status FROM cycles WHERE id = ?', [id])
    if (!cycle) {
      return error(res, '周期不存在', 404)
    }
    // 不允许删除正在进行中的周期（有关联数据）
    if (['active', 'selection', 'review', 'adjustment', 'process'].includes(cycle.status)) {
      return error(res, '不能删除进行中的毕业设计周期，请先将其归档结束', 400)
    }
    await query('DELETE FROM cycles WHERE id = ?', [id])
    success(res, null, '周期已删除')
  } catch (err: any) {
    console.error('删除周期失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
