import fs from 'node:fs'
import path from 'node:path'
import { query } from '../config/database.js'
import { privateTemplateRoot } from '../utils/privateTemplates.js'
import { safeParseJson } from '../utils/json.js'
import { TemplateError, templateHash, validateTemplateProfile, studentTemplateFields, type TemplateProfile, type TemplateType } from '../utils/templateContract.js'

export const materialTables: Record<TemplateType, string> = { task_book: 'task_books', proposal: 'proposals', midterm: 'midterm_reports' }
export const isTemplateType = (type: string): type is TemplateType => Object.hasOwn(materialTables, type)
export function readUploadedTemplate(row: any): Buffer {
  if (!/\.docx$/i.test(row.original_name || '')) throw new TemplateError('在线生成仅支持 DOCX 模板，请管理员上传 DOCX 版本')
  try { return fs.readFileSync(path.join(privateTemplateRoot(), path.basename(row.storage_key))) }
  catch { throw new TemplateError('管理员上传的模板文件缺失，请联系管理员处理') }
}
export function parseProfile(value: unknown): TemplateProfile { return safeParseJson(value, null) as unknown as TemplateProfile }
export function checkedProfile(row: any, profile = parseProfile(row.profile)) {
  const buffer = readUploadedTemplate(row)
  if (!profile) throw new TemplateError('请管理员先识别并确认此模板的填写区域')
  const errors = validateTemplateProfile(profile, buffer)
  if (errors.length) throw new TemplateError(errors.join('；'))
  if (profile.type !== row.document_type) throw new TemplateError('模板类型与配置不一致')
  return { buffer, profile }
}

export function presentTemplate(row: any, profile: TemplateProfile) {
  return { id: row.id, title: row.title, version: row.version, documentType: row.document_type, profile }
}
export async function resolveMaterialTemplate(type: TemplateType, cycleId: number | string, recordId?: string) {
  if (recordId) {
    const [bound] = await query<any>(`SELECT dt.*, mt.profile, mt.field_values FROM document_material_templates mt
      JOIN document_templates dt ON dt.id = mt.template_id WHERE mt.document_type = ? AND mt.record_id = ?`, [type, recordId])
    if (bound) {
      const { profile, buffer } = checkedProfile(bound)
      return { template: presentTemplate(bound, profile), values: safeParseJson<Record<string, string>>(bound.field_values, {}), buffer, bound: true }
    }
  }
  const [row] = await query<any>(`SELECT dt.*, tc.profile, tc.confirmed_at FROM document_templates dt
    LEFT JOIN document_template_contracts tc ON tc.template_id = dt.id
    WHERE dt.cycle_id = ? AND dt.document_type = ? AND dt.status = 'published'
    ORDER BY dt.published_at DESC, dt.updated_at DESC, dt.id DESC LIMIT 1`, [cycleId, type])
  if (!row) throw new TemplateError('当前周期尚未发布此类模板，请管理员先上传、确认填写区域并发布')
  if (!row.confirmed_at) throw new TemplateError('已发布模板尚未确认填写区域，请管理员先完成模板配置')
  const { profile, buffer } = checkedProfile(row)
  return { template: presentTemplate(row, profile), values: {} as Record<string, string>, buffer, bound: false }
}

export async function materialPresentation(type: TemplateType, row: any) {
  const [bound] = await query<any>(`SELECT dt.*, mt.profile, mt.field_values FROM document_material_templates mt
    JOIN document_templates dt ON dt.id = mt.template_id WHERE mt.document_type = ? AND mt.record_id = ?`, [type, row.id])
  return bound ? { template: presentTemplate(bound, parseProfile(bound.profile)), templateValues: safeParseJson(bound.field_values, {}) } : { template: null }
}

export function materialValues(profile: TemplateProfile, input: unknown, submit: boolean) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TemplateError('请重新加载模板填写页面后保存')
  const values: Record<string, string> = Object.create(null)
  for (const f of studentTemplateFields(profile)) {
    const value = (input as Record<string, unknown>)[f.key]
    if (value !== undefined && typeof value !== 'string') throw new TemplateError(`${f.label}必须为文本`)
    const text = String(value ?? '')
    const limit = f.key === 'title' ? 200 : 50000
    if (text.length > limit) throw new TemplateError(`${f.label}超过${limit}字，请精简`)
    if (submit && f.required && !text.trim()) throw new TemplateError(`请填写${f.label}`)
    values[f.key] = text
  }
  return values
}

// 与材料正文保存共用同一事务；重查发布状态与文件哈希，防止保存期间切换模板。
export async function bindMaterial(conn: any, type: TemplateType, recordId: string, cycleId: any, selected: Awaited<ReturnType<typeof resolveMaterialTemplate>>, values: Record<string, string>) {
  const [rows] = await conn.query('SELECT * FROM document_material_templates WHERE document_type = ? AND record_id = ? FOR UPDATE', [type, recordId])
  const bound = rows[0]
  if (bound) {
    if (bound.template_id !== selected.template.id || parseProfile(bound.profile).sha256 !== selected.template.profile.sha256) throw new TemplateError('材料模板已变更，请刷新后重试')
    await conn.query('UPDATE document_material_templates SET field_values = ? WHERE document_type = ? AND record_id = ?', [JSON.stringify(values), type, recordId])
  } else {
    const [templates] = await conn.query(`SELECT dt.*, tc.confirmed_at, tc.profile FROM document_templates dt JOIN document_template_contracts tc ON tc.template_id = dt.id
      WHERE dt.id = ? AND dt.cycle_id = ? AND dt.document_type = ? AND dt.status = 'published' FOR UPDATE`, [selected.template.id, cycleId, type])
    const row = templates[0]
    if (!row?.confirmed_at || templateHash(readUploadedTemplate(row)) !== selected.template.profile.sha256 || JSON.stringify(parseProfile(row.profile)) !== JSON.stringify(selected.template.profile)) throw new TemplateError('模板发布状态或配置已变化，请刷新后重试')
    await conn.query(`INSERT INTO document_material_templates (document_type, record_id, template_id, profile, field_values) VALUES (?, ?, ?, ?, ?)`,
      [type, recordId, selected.template.id, JSON.stringify(selected.template.profile), JSON.stringify(values)])
  }
}

export async function requireBoundExport(type: TemplateType, record: any) {
  const resolved = await resolveMaterialTemplate(type, record.cycle_id ?? record.cycleId, record.id)
  if (!resolved.bound) throw new TemplateError('此历史材料尚未绑定模板版本，请管理员在毕业资料库中明确关联后再导出')
  return resolved
}
