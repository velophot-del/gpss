import { query } from '../config/database.js'
import { safeParseJson } from './json.js'
import { normalizeMajorCode } from './majorCodes.js'

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

export function isTopicVisible(policy: TopicAccessPolicy, studentMajorCode?: string | null, topicMajorCode?: string | null): boolean {
  if (!studentMajorCode || !topicMajorCode) return false
  if (policy.mode === 'all') return true
  const studentCode = normalizeMajorCode(String(studentMajorCode))
  const topicCode = normalizeMajorCode(String(topicMajorCode))
  if (policy.mode === 'matrix') return (policy.matrix[studentCode] || policy.matrix[String(studentMajorCode)] || []).some(code => normalizeMajorCode(code) === topicCode)
  return studentCode === topicCode
}

export async function getStudentMajorCode(userId: string): Promise<string> {
  const rows = await query<any>('SELECT major_code, major FROM users WHERE id = ? LIMIT 1', [userId])
  return normalizeMajorCode(String(rows[0]?.major_code || ''), String(rows[0]?.major || ''))
}
