import { query } from '../config/database.js'
import { safeParseJson } from './json.js'

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
      matrix[key] = Array.isArray(value) ? value.map(String) : []
    }
  }
  return { mode: raw.mode, matrix }
}

export function isTopicVisible(policy: TopicAccessPolicy, studentMajorCode?: string | null, topicMajorCode?: string | null): boolean {
  if (!studentMajorCode || !topicMajorCode) return false
  if (policy.mode === 'all') return true
  if (policy.mode === 'matrix') return (policy.matrix[String(studentMajorCode)] || []).includes(String(topicMajorCode))
  return String(studentMajorCode) === String(topicMajorCode)
}

export async function getStudentMajorCode(userId: string): Promise<string> {
  const rows = await query<any>('SELECT major_code FROM users WHERE id = ? LIMIT 1', [userId])
  return String(rows[0]?.major_code || '')
}
