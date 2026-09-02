import { query } from '../config/database.js'
import { safeParseJson } from './json.js'
import type { TopicAccessPolicy } from './topicAccess.js'

// 专业自由增删后，权威来源是「周期配置 cycles.phases_config.majors」；
// 此文件里硬编码的 4 专业只作为「未配置/无周期」时的默认值（与前端 src/types 对齐）。

export interface MajorConfig {
  code: string   // 权威键（对齐 topics.major_code、users.major_code、topicAccessPolicy.matrix）
  name: string   // 展示名（写入 topics.major）
  degree?: string
  keywords?: string[]
}

// 下拉选项：value 即专业代码（name 不再作为绑定键，避免同名歧义）
export interface MajorOption {
  value: string
  label: string
  code: string
}

export const DEFAULT_MAJORS: MajorConfig[] = [
  { code: '130502', name: '视觉传达设计', degree: '艺术学', keywords: ['视觉语言', '品牌', '书籍插画', '书籍绘本', '包装', '字体设计', '版式设计', '信息可视化'] },
  { code: '130508', name: '数字媒体艺术（交互方向）', degree: '艺术学', keywords: ['交互设计', '用户体验', '动态视觉', '数字媒体', 'UI设计', 'UX研究', '服务设计'] },
  { code: '081702', name: '包装工程', degree: '工学', keywords: ['包装结构', '材料性能', '工艺制造', '智能包装', '绿色包装', '物流包装', '包装测试'] },
  { code: '080906T', name: '智能交互（工科）', degree: '工学', keywords: ['智能硬件交互', 'AI交互系统', '机器人交互', '物联网交互', '传感器', '嵌入式开发', '原型制作'] },
]

export const DEFAULT_RESEARCH_CATEGORIES: Record<string, string[]> = {
  '130502': ['品牌形象与VI设计', '书籍纸媒与插画绘本', '包装视觉与结构设计', '企业实题与社会服务设计', '概念设计与实验性视觉', '视觉传达专业研究'],
  '130508': ['交互界面与系统设计', '用户体验与服务设计', '动态视觉与动效设计', '游戏与虚拟体验设计', '数字媒体叙事与创作', '数字媒体艺术研究'],
  '081702': ['包装结构设计与优化', '包装材料与性能研究', '包装工艺与智能制造', '智能包装与物联网应用', '绿色包装与循环经济', '包装系统集成与产品设计'],
  '080906T': ['智能硬件交互设计', '人工智能交互系统', '机器人交互设计', '物联网与空间交互', '感知与交互技术', '交互工程与原型开发'],
}

// 默认 4 专业的历史名称别名（如“数字媒体艺术”“数字媒体艺术（交互方向）”混写），
// 仅用于老课题 t.major 只填了名称、未写 major_code 时的名称兜底
const LEGACY_MAJOR_ALIASES: Record<string, string[]> = {
  '130502': ['视觉传达设计'],
  '130508': ['数字媒体艺术', '数字媒体艺术（交互方向）'],
  '081702': ['包装工程'],
  '080906T': ['智能交互（工科）', '智能交互'],
}

// ===== 周期配置读取（缺失/非法回退默认） =====

function parseCycleMajors(raw: any): MajorConfig[] {
  if (!Array.isArray(raw)) return DEFAULT_MAJORS
  const seen = new Set<string>()
  const result: MajorConfig[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const code = typeof m.code === 'string' ? m.code.trim() : ''
    const name = typeof m.name === 'string' ? m.name.trim() : ''
    if (!code || !name || seen.has(code)) continue
    seen.add(code)
    result.push({
      code,
      name,
      degree: typeof m.degree === 'string' ? m.degree : undefined,
      keywords: Array.isArray(m.keywords) ? m.keywords.map(String) : undefined,
    })
  }
  return result.length ? result : DEFAULT_MAJORS
}

function parseResearchCategories(raw: any): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_RESEARCH_CATEGORIES
  for (const [code, list] of Object.entries(raw)) {
    if (Array.isArray(list)) out[code] = [...new Set(list.map(String).filter(Boolean))]
  }
  return out
}

/** 读取周期配置的毕业专业列表（未配置/非法时回退默认 4 专业） */
export async function getCycleMajors(cycleId?: string | number | null): Promise<MajorConfig[]> {
  if (cycleId == null || cycleId === '') return DEFAULT_MAJORS
  const rows = await query<any>('SELECT phases_config FROM cycles WHERE id = ? LIMIT 1', [cycleId])
  const config = safeParseJson<any>(rows[0]?.phases_config, null)
  return parseCycleMajors(config?.majors)
}

/** 读取周期配置的研究方向列表（Record<code, string[]>，未配置/非法时回退默认 24 方向） */
export async function getCycleResearchCategories(cycleId?: string | number | null): Promise<Record<string, string[]>> {
  if (cycleId == null || cycleId === '') return DEFAULT_RESEARCH_CATEGORIES
  const rows = await query<any>('SELECT phases_config FROM cycles WHERE id = ? LIMIT 1', [cycleId])
  const config = safeParseJson<any>(rows[0]?.phases_config, null)
  const majors = parseCycleMajors(config?.majors)
  const hasMajorsConfig = Array.isArray(config?.majors)
  let cats: Record<string, string[]>
  if (config?.researchCategories && typeof config.researchCategories === 'object' && !Array.isArray(config.researchCategories)) {
    cats = parseResearchCategories(config.researchCategories)
  } else if (!hasMajorsConfig) {
    cats = { ...DEFAULT_RESEARCH_CATEGORIES }
  } else {
    cats = {}
  }
  // 与 majors 对齐：只保留 majors 覆盖到的专业，缺省的补空数组
  const codes = new Set(majors.map(m => m.code))
  for (const key of Object.keys(cats)) if (!codes.has(key)) delete cats[key]
  for (const code of codes) if (!cats[code]) cats[code] = []
  return cats
}

/** 按周期配置生成专业下拉选项（value === code） */
export async function getCycleMajorOptions(cycleId?: string | number | null): Promise<MajorOption[]> {
  const majors = await getCycleMajors(cycleId)
  return majors.map(m => ({ value: m.code, label: `${m.name} (${m.code})`, code: m.code }))
}

/** 某专业代码对应的全部名称（该专业配置名 + 默认专业的历史别名，供老课题名称兜底） */
export function getMajorNames(code: string, cycleMajors: MajorConfig[]): string[] {
  const names = cycleMajors.filter(m => m.code === code).map(m => m.name)
  if (LEGACY_MAJOR_ALIASES[code]) names.push(...LEGACY_MAJOR_ALIASES[code])
  return [...new Set(names)]
}

/** 计算某学生在当前“查看选题规则”下允许浏览的专业选项（value=code，顺序按周期专业列表） */
export function getAllowedMajorOptions(
  policy: TopicAccessPolicy,
  cycleMajors: MajorConfig[],
  studentMajorCode?: string | null,
): MajorOption[] {
  let codes: string[] = []
  if (policy.mode === 'all') {
    codes = cycleMajors.map(m => m.code)
  } else if (!studentMajorCode) {
    return []
  } else if (policy.mode === 'matrix') {
    codes = (policy.matrix[studentMajorCode] || []).map(String)
  } else {
    codes = [studentMajorCode]
  }
  const allowed = new Set(codes)
  return cycleMajors.filter(m => allowed.has(m.code)).map(m => ({ value: m.code, label: `${m.name} (${m.code})`, code: m.code }))
}

/** 允许专业对应的全部名称别名（老课题只写 major 名称时的 SQL 兜底） */
export function getAllowedMajorNames(codes: string[], cycleMajors: MajorConfig[]): string[] {
  const names: string[] = []
  for (const code of codes) names.push(...getMajorNames(code, cycleMajors))
  return [...new Set(names)]
}
