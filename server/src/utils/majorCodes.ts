export const SMART_INTERACTION_MAJOR_CODE = '080218T'

const SMART_INTERACTION_LEGACY_CODES = new Set(['080906T', '080922T'])
const SMART_INTERACTION_NAMES = new Set([
  '智能交互设计',
  '智能交互',
  '智能交互（工科）',
  '智能交互设计（工科）',
])

export function normalizeMajorCode(code: unknown, majorName = ''): string {
  const value = String(code ?? '').trim()
  if (SMART_INTERACTION_LEGACY_CODES.has(value) || SMART_INTERACTION_NAMES.has(majorName.trim())) {
    return SMART_INTERACTION_MAJOR_CODE
  }
  return value
}

export function getMajorCodeAliases(code: string): string[] {
  const normalized = normalizeMajorCode(code)
  return normalized === SMART_INTERACTION_MAJOR_CODE
    ? [SMART_INTERACTION_MAJOR_CODE, ...SMART_INTERACTION_LEGACY_CODES]
    : [normalized]
}

export function normalizeSmartInteractionCycleConfig(config: any): any {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config

  const normalized = { ...config }
  if (Array.isArray(config.majors)) {
    normalized.majors = config.majors.map((major: any) => {
      if (!major || typeof major !== 'object') return major
      const name = String(major.name ?? '').trim()
      const code = normalizeMajorCode(major.code, name)
      return code === SMART_INTERACTION_MAJOR_CODE
        ? { ...major, code, name: '智能交互设计' }
        : major
    })
  }

  for (const key of ['researchCategories', 'topicAccessPolicy'] as const) {
    const value = config[key]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    if (key === 'researchCategories') {
      const categories: Record<string, string[]> = {}
      for (const [code, items] of Object.entries(value)) {
        const normalizedCode = normalizeMajorCode(code)
        const existing = categories[normalizedCode] || []
        categories[normalizedCode] = [...new Set([...existing, ...(Array.isArray(items) ? items.map(String) : [])])]
      }
      normalized.researchCategories = categories
      continue
    }

    const matrixRaw = (value as any).matrix
    if (!matrixRaw || typeof matrixRaw !== 'object' || Array.isArray(matrixRaw)) continue
    const matrix: Record<string, string[]> = {}
    for (const [studentCode, topicCodes] of Object.entries(matrixRaw)) {
      const keyCode = normalizeMajorCode(studentCode)
      const targets = Array.isArray(topicCodes) ? topicCodes.map(code => normalizeMajorCode(code)) : []
      matrix[keyCode] = [...new Set([...(matrix[keyCode] || []), ...targets])]
    }
    normalized.topicAccessPolicy = { ...value, matrix }
  }

  return normalized
}
