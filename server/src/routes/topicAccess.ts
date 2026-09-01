import { Router } from 'express'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getTopicAccessPolicy } from '../utils/topicAccess.js'
import { safeParseJson } from '../utils/json.js'

const router = Router()
router.use(authMiddleware)

router.get('/:cycleId', requireRole(['admin']), async (req: AuthRequest, res) => {
  try { success(res, await getTopicAccessPolicy(req.params.cycleId)) } catch { error(res, '读取选题查看规则失败', 500) }
})

router.put('/:cycleId', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const [cycle] = await query<any>('SELECT phases_config FROM cycles WHERE id = ?', [req.params.cycleId])
    if (!cycle) return error(res, '选题周期不存在', 404)
    const body = req.body || {}
    if (!['same_major', 'all', 'matrix'].includes(body.mode)) return error(res, '无效的查看规则')
    const matrix: Record<string, string[]> = {}
    if (body.mode === 'matrix' && body.matrix && typeof body.matrix === 'object') {
      for (const [key, value] of Object.entries(body.matrix)) matrix[key] = Array.isArray(value) ? value.map(String) : []
    }
    const parsedConfig = safeParseJson<Record<string, any>>(cycle.phases_config, {})
    const config = parsedConfig && typeof parsedConfig === 'object' && !Array.isArray(parsedConfig) ? parsedConfig : {}
    config.topicAccessPolicy = { mode: body.mode, matrix }
    await query('UPDATE cycles SET phases_config = ? WHERE id = ?', [JSON.stringify(config), req.params.cycleId])
    success(res, config.topicAccessPolicy, '选题查看规则已保存')
  } catch (err) { console.error('保存选题查看规则失败:', err); error(res, '保存选题查看规则失败', 500) }
})

export default router
