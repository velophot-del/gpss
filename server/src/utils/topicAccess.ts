import { query } from '../config/database.js'
import { safeParseJson } from './json.js'
import { haveSameMajorCode, isSameMajor, normalizeMajorCode } from './majorCodes.js'
import { resolveCycleMajorCode, type MajorConfig } from './majors.js'

export type TopicAccessMode = 'same_major' | 'all' | 'matrix'
export interface TopicAccessPolicy {
  mode: TopicAccessMode
  matrix: Record<string, string[]>
}

const DEFAULT_POLICY: TopicAccessPolicy = { mode: 'same_major', matrix: {} }

function parseJson(value: any): any {
  return safeParseJson<any>(value, null)
}

export async function getTopicAccessPolicy(cycleId?: string | null): Promise<TopicAccessPolicy> {
  if (!cycleId) return DEFAULT_POLICY
  const rows = await query<any>('SELECT phases_config FROM cycles WHERE id = ? LIMIT 1', [cycleId])
  const config = parseJson(rows[0]?.phases_config)
  const raw = config?.topicAccessPolicy
  if (!raw || !['same_major', 'all', 'matrix'].includes(raw.mode)) return DEFAULT_POLICY
  const matrix: Record<string, string[]> = {}
  if (raw.matrix && typeof raw.matrix === 'object') {
    for (const [key, value] of Object.entries(raw.matrix)) {
      const normalizedKey = normalizeMajorCode(key)
      matrix[normalizedKey] = [...new Set([...(matrix[normalizedKey] || []), ...(Array.isArray(value) ? value.map(String).map(code => normalizeMajorCode(code)) : [])])]
    }
  }
  return { mode: raw.mode, matrix }
}

export function isTopicVisible(
  policy: TopicAccessPolicy,
  studentMajorCode?: string | null,
  topicMajorCode?: string | null,
  studentMajorName?: string | null,
  topicMajorName?: string | null,
  cycleMajors: MajorConfig[] = [],
): boolean {
  if (policy.mode === 'all') return true
  if (!studentMajorCode && !studentMajorName) return false
  if (!topicMajorCode && !topicMajorName) return false
  const studentCode = normalizeMajorCode(String(studentMajorCode ?? ''), String(studentMajorName ?? ''))
  const topicCode = normalizeMajorCode(String(topicMajorCode ?? ''), String(topicMajorName ?? ''))
  if (policy.mode === 'matrix') {
    const matrixStudentCode = resolveCycleMajorCode(cycleMajors, studentCode, studentMajorName) || studentCode
    const matrixTopicCode = resolveCycleMajorCode(cycleMajors, topicCode, topicMajorName) || topicCode
    const allowedCodes = Object.entries(policy.matrix).find(([code]) => haveSameMajorCode(code, matrixStudentCode))?.[1] || []
    return !!matrixTopicCode && allowedCodes.some(code => haveSameMajorCode(code, matrixTopicCode))
  }
  return isSameMajor(
    { majorCode: studentMajorCode, major: studentMajorName },
    { majorCode: topicMajorCode, major: topicMajorName },
  )
}

export async function getStudentMajor(userId: string): Promise<{ code: string; name: string }> {
  const rows = await query<any>('SELECT major_code, major FROM users WHERE id = ? LIMIT 1', [userId])
  const name = String(rows[0]?.major || '')
  return { code: normalizeMajorCode(String(rows[0]?.major_code || ''), name), name }
}

export async function getStudentMajorCode(userId: string): Promise<string> {
  return (await getStudentMajor(userId)).code
}
