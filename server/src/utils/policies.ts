import path from 'path'
import { safeParseJson } from './json.js'

export type UserRole = 'admin' | 'teacher' | 'student'

type TokenUser = {
  id?: unknown
  username?: unknown
  role?: unknown
  realName?: unknown
}

type DatabaseUser = {
  id: string
  username: string
  role: string
  real_name: string
  status: string
}

export type SessionUser = {
  id: string
  username: string
  role: UserRole
  realName: string
}

const USER_ROLES: UserRole[] = ['admin', 'teacher', 'student']

export function resolveJwtSecret(env: Record<string, string | undefined> = process.env): string {
  const configured = env.JWT_SECRET?.trim()
  if (configured) return configured
  if (env.NODE_ENV === 'production') {
    throw new Error('生产环境必须设置 JWT_SECRET')
  }
  return 'development-only-secret'
}

export function resolveSessionUser(tokenUser: TokenUser, databaseUser?: DatabaseUser | null): SessionUser | null {
  if (!databaseUser || databaseUser.status !== 'active' || databaseUser.id !== tokenUser.id) return null
  if (!USER_ROLES.includes(databaseUser.role as UserRole)) return null

  return {
    id: databaseUser.id,
    username: databaseUser.username,
    role: databaseUser.role as UserRole,
    realName: databaseUser.real_name,
  }
}

function parseJsonArray(value: unknown): string[] {
  const parsed = safeParseJson<unknown[]>(value, [])
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

export function getDefenseScoreAccess(
  user: Pick<SessionUser, 'id' | 'role'>,
  group: { judges: unknown; students: unknown; created_by?: string | null },
): 'all' | 'self' | 'none' {
  if (user.role === 'admin') return 'all'
  if (user.role === 'student') return parseJsonArray(group.students).includes(user.id) ? 'self' : 'none'
  if (parseJsonArray(group.judges).includes(user.id) || group.created_by === user.id) return 'all'
  return 'none'
}

export function getDefenseScoreListScope(user: Pick<SessionUser, 'role'>): 'all' | 'judge' | 'student' {
  if (user.role === 'admin') return 'all'
  return user.role === 'teacher' ? 'judge' : 'student'
}

export function canDownloadDocumentTemplate(
  user: Pick<SessionUser, 'role'>,
  template: { cycle_id: number; status: string },
  acceptedCycleId: number | null,
) {
  if (user.role === 'admin') return true
  return user.role === 'student' && template.status === 'published' && acceptedCycleId === template.cycle_id
}

export const UPLOAD_CATEGORY_CONFIG: Record<string, { allowed: string[]; maxSize: number; label: string }> = {
  thesis: { allowed: ['.pdf', '.doc', '.docx', '.zip'], maxSize: 50 * 1024 * 1024, label: '论文' },
  proposal: { allowed: ['.pdf', '.doc', '.docx', '.zip'], maxSize: 50 * 1024 * 1024, label: '开题报告' },
  midterm: { allowed: ['.pdf', '.doc', '.docx', '.zip', '.jpg', '.jpeg', '.png'], maxSize: 50 * 1024 * 1024, label: '中期检查' },
  task_book: { allowed: ['.pdf', '.doc', '.docx'], maxSize: 20 * 1024 * 1024, label: '任务书' },
  design: { allowed: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.zip', '.rar', '.stl', '.obj', '.pdf'], maxSize: 500 * 1024 * 1024, label: '设计作品' },
  image: { allowed: ['.jpg', '.jpeg', '.png', '.gif', '.webp'], maxSize: 100 * 1024 * 1024, label: '图片' },
  portfolio: { allowed: ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.mp4', '.mov'], maxSize: 50 * 1024 * 1024, label: '作品集' },
  document_template: { allowed: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip'], maxSize: 50 * 1024 * 1024, label: '毕业资料模板' },
  general: { allowed: ['.pdf', '.doc', '.docx', '.zip', '.jpg', '.jpeg', '.png'], maxSize: 50 * 1024 * 1024, label: '文件' },
}

export function validateUploadFile(category: string, originalName: string, size: number) {
  const cfg = UPLOAD_CATEGORY_CONFIG[category] || UPLOAD_CATEGORY_CONFIG.general
  const ext = path.extname(originalName).toLowerCase()
  if (!cfg.allowed.includes(ext)) {
    return { ok: false as const, message: `${originalName}: 类型 ${ext || '未知'} 不属于「${cfg.label}」允许范围` }
  }
  if (!Number.isFinite(size) || size < 0 || size > cfg.maxSize) {
    return { ok: false as const, message: `${originalName}: 大小超过「${cfg.label}」上限 ${cfg.maxSize / 1024 / 1024}MB` }
  }
  return { ok: true as const }
}

export function parseOptionalScore(value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('分数需在 0-100 之间')
  }
  const score = Number(value)
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('分数需在 0-100 之间')
  }
  return score
}

export function parseRequiredScore(value: unknown): number {
  const score = parseOptionalScore(value)
  if (score == null) throw new Error('分数需在 0-100 之间')
  return score
}

function gradeLevel(total: number): string {
  if (total >= 90) return '优秀'
  if (total >= 80) return '良好'
  if (total >= 70) return '中等'
  if (total >= 60) return '及格'
  return '不及格'
}

export function computeWeightedGrade(
  supervisor: number | null,
  review: number | null,
  defense: number | null,
): { total: number | null; level: string | null } {
  const scores = [
    { value: supervisor, weight: 0.4 },
    { value: review, weight: 0.2 },
    { value: defense, weight: 0.4 },
  ].filter((item): item is { value: number; weight: number } => item.value != null)

  if (scores.length === 0) return { total: null, level: null }
  const weightSum = scores.reduce((sum, item) => sum + item.weight, 0)
  const weightedSum = scores.reduce((sum, item) => sum + item.value * item.weight, 0)
  const total = Math.round((weightedSum / weightSum) * 10) / 10
  return { total, level: gradeLevel(total) }
}

export function getTeacherStudentLimit(config: unknown): number {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 0
  const record = config as Record<string, unknown>
  const rawLimit = record.teacher_student_limit ?? record.teacherStudentLimit ?? 0
  const limit = Number(rawLimit)
  return Number.isInteger(limit) && limit > 0 ? limit : 0
}

// 志愿审核截止时间：取自 phases_config 中 review_deadline / teacher_review.end / review.end。
// 未配置（返回 null）则视为不启用“截止自动释放”，保持原有阻塞逻辑。
export function getReviewDeadline(config: unknown): Date | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const record = config as Record<string, unknown>
  for (const key of ['review_deadline', 'teacher_review', 'review'] as const) {
    const value = record[key]
    const end = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).end
      : value
    if (typeof end === 'string' && end.trim()) {
      const date = new Date(end)
      if (!Number.isNaN(date.getTime())) return date
    }
  }
  return null
}

export function getUploadedFilePaths(files: unknown): string[] {
  const candidates = Array.isArray(files)
    ? files
    : files && typeof files === 'object'
      ? Object.values(files as Record<string, unknown>).flatMap(value => Array.isArray(value) ? value : [])
      : []

  return candidates
    .map(file => file && typeof file === 'object' ? (file as { path?: unknown }).path : undefined)
    .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.length > 0)
}
