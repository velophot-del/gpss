import { Router } from 'express'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { safeParseJson } from '../utils/json.js'
import { getActiveCycle } from '../utils/processFlow.js'
import { getCycleMajors, getCycleResearchCategories, type MajorConfig } from '../utils/majors.js'

const router = Router()
router.use(authMiddleware)

// 归一化并校验专业/研究方向配置；返回 { majors, researchCategories } 或抛错文案
function normalizeConfig(body: any): { majors: MajorConfig[]; researchCategories: Record<string, string[]> } | string {
  const majorsRaw = body?.majors
  if (!Array.isArray(majorsRaw) || majorsRaw.length === 0) return '至少配置一个毕业专业'
  const seen = new Set<string>()
  const majors: MajorConfig[] = []
  for (const m of majorsRaw) {
    if (!m || typeof m !== 'object') return '专业配置格式不正确'
    const code = typeof m.code === 'string' ? m.code.trim() : ''
    const name = typeof m.name === 'string' ? m.name.trim() : ''
    if (!code || !name) return '每个专业都需要填写代码与名称'
    if (seen.has(code)) return `专业代码重复：${code}`
    seen.add(code)
    majors.push({ code, name, degree: typeof m.degree === 'string' ? m.degree : undefined })
  }

  const catsRaw = body?.researchCategories
  if (!catsRaw || typeof catsRaw !== 'object' || Array.isArray(catsRaw)) return '研究方向配置格式不正确'
  const researchCategories: Record<string, string[]> = {}
  for (const [code, list] of Object.entries(catsRaw)) {
    if (!Array.isArray(list)) return `研究方向「${code}」的格式不正确，应为数组`
    // 仅保留 majors 覆盖到的专业；孤儿 key 丢弃
    if (!seen.has(code)) continue
    researchCategories[code] = [...new Set(list.map(String).filter(Boolean))]
  }
  // 缺省的专业补空方向数组，前端联动可正常渲染
  for (const code of seen) if (!researchCategories[code]) researchCategories[code] = []
  return { majors, researchCategories }
}

// GET /api/cycle-config - 当前进行中周期的专业/研究方向（教师/学生下拉用；无进行中周期回退默认）
router.get('/', async (_req: AuthRequest, res) => {
  try {
    const active = await getActiveCycle()
    const [majors, researchCategories] = await Promise.all([
      getCycleMajors(active?.id),
      getCycleResearchCategories(active?.id),
    ])
    success(res, { majors, researchCategories })
  } catch (err: any) {
    console.error('获取周期配置失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/cycle-config/:cycleId - 按周期读取（管理员编辑回填）
router.get('/:cycleId', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const [majors, researchCategories] = await Promise.all([
      getCycleMajors(req.params.cycleId),
      getCycleResearchCategories(req.params.cycleId),
    ])
    success(res, { majors, researchCategories })
  } catch (err: any) {
    console.error('读取周期配置失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// PUT /api/cycle-config/:cycleId - 保存周期专业/研究方向（只改这两个键，读-合并-写回）
router.put('/:cycleId', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const { cycleId } = req.params
    const [cycle] = await query<any>('SELECT phases_config FROM cycles WHERE id = ?', [cycleId])
    if (!cycle) return error(res, '选题周期不存在', 404)

    const normalized = normalizeConfig(req.body)
    if (typeof normalized === 'string') return error(res, normalized, 400)

    const base = safeParseJson<any>(cycle.phases_config, null)
    const config = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
    config.majors = normalized.majors
    config.researchCategories = normalized.researchCategories

    await query('UPDATE cycles SET phases_config = ? WHERE id = ?', [JSON.stringify(config), cycleId])
    success(res, normalized, '周期专业与研究方向已保存')
  } catch (err: any) {
    console.error('保存周期配置失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

export default router
