import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import { privateTemplateRoot } from '../utils/privateTemplates.js'
import { canonicalTemplateProfile, inspectTemplate, validateTemplateProfile, TemplateError, type TemplateProfile } from '../utils/templateContract.js'
import { isTemplateType, parseProfile, readUploadedTemplate } from './materialTemplateService.js'

interface EditInput {
  title: string
  version: string
  description: string
  revision: string
  profile?: TemplateProfile
  confirmMapping?: boolean
}

const sourceSql = `SELECT dt.*, tc.profile, tc.confirmed_at FROM document_templates dt
  LEFT JOIN document_template_contracts tc ON tc.template_id = dt.id WHERE dt.id = ?`
const supportsMapping = (row: any) => isTemplateType(row.document_type) && /\.docx$/i.test(row.original_name)

function revisionOf(row: any) {
  return crypto.createHash('sha256').update(JSON.stringify([
    row.id, row.title, row.version, row.description, row.status, row.storage_key,
    row.original_name, row.updated_at, row.confirmed_at, row.profile ? parseProfile(row.profile) : null,
  ])).digest('hex')
}

function requirePublished(row: any) {
  if (!row) throw new TemplateError('模板不存在')
  if (row.status !== 'published') throw new TemplateError('模板状态已变化，请刷新资料库后重试')
}

export async function getTemplateEditState(id: string) {
  const [row] = await query<any>(sourceSql, [id])
  requirePublished(row)
  const [count] = await query<any>('SELECT COUNT(*) AS total FROM document_material_templates WHERE template_id = ?', [id])
  const buffer = supportsMapping(row) ? readUploadedTemplate(row) : null
  const profile = buffer ? (row.profile ? parseProfile(row.profile) : inspectTemplate(row.document_type, buffer)) : null
  return { template: row, revision: revisionOf(row), boundCount: Number(count.total), profile,
    errors: buffer && profile ? validateTemplateProfile(profile, buffer) : [] }
}

export async function editPublishedTemplate(id: string, input: EditInput, actor: { id: string; ip?: string }) {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) throw new TemplateError('资料名称需为1—200字')
  if (typeof input.version !== 'string' || !input.version.trim() || input.version.trim().length > 50) throw new TemplateError('版本号需为1—50字')
  if (typeof input.description !== 'string' || input.description.length > 5000) throw new TemplateError('资料说明最多5000字')
  if (typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)) throw new TemplateError('请重新打开编辑窗口后保存')
  let copiedFile: string | undefined
  try {
    return await transaction(async conn => {
      // 新材料绑定同样锁定模板行；锁定后重新计数，不能信任编辑窗口打开时的数量。
      const [rows] = await conn.query<any[]>(sourceSql + ' FOR UPDATE', [id])
      const row = rows[0]
      requirePublished(row)
      if (revisionOf(row) !== input.revision) throw new TemplateError('模板已被修改，请刷新后重新核对')
      let profile: TemplateProfile | null = null
      if (supportsMapping(row)) {
        if (input.confirmMapping !== true) throw new TemplateError('请生成预览并确认填写区域及固定内容')
        if (!input.profile || input.profile.type !== row.document_type) throw new TemplateError('模板配置类型不符')
        profile = canonicalTemplateProfile(input.profile, readUploadedTemplate(row))
      } else if (input.profile != null) throw new TemplateError('此文件仅支持编辑名称、版本号和说明')

      const [counts] = await conn.query<any[]>('SELECT COUNT(*) AS total FROM document_material_templates WHERE template_id = ?', [id])
      const boundCount = Number(counts[0].total)
      const mode = boundCount ? 'versioned' : 'updated'
      const title = input.title.trim(), description = input.description.trim() || null
      let version = input.version.trim(), savedId = id
      const [versions] = await conn.query<any[]>('SELECT version FROM document_templates WHERE cycle_id = ? AND document_type = ? AND id <> ?', [row.cycle_id, row.document_type, id])
      const used = new Set(versions.map(item => item.version))
      if (boundCount && version === row.version) {
        let suffix = 2
        do {
          const ending = `-r${suffix++}`
          version = row.version.slice(0, 50 - ending.length) + ending
        } while (used.has(version))
      } else if (used.has(version)) throw new TemplateError('该周期下此资料类型和版本已存在，请更换版本号')

      if (boundCount) {
        savedId = uuidv4()
        const storageKey = `${savedId}${path.extname(row.storage_key)}`
        const target = path.join(privateTemplateRoot(), storageKey)
        fs.copyFileSync(path.join(privateTemplateRoot(), path.basename(row.storage_key)), target, fs.constants.COPYFILE_EXCL)
        copiedFile = target
        await conn.query(`INSERT INTO document_templates
          (id, cycle_id, document_type, title, version, description, original_name, storage_key, mime_type, size, status, published_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
        [savedId, row.cycle_id, row.document_type, title, version, description, row.original_name, storageKey, row.mime_type, row.size, 'published', actor.id])
      } else {
        await conn.query('UPDATE document_templates SET title = ?, version = ?, description = ? WHERE id = ?', [title, version, description, id])
      }
      if (profile) {
        await conn.query(`INSERT INTO document_template_contracts (template_id, profile, confirmed_at, confirmed_by)
          VALUES (?, ?, NOW(), ?) ON DUPLICATE KEY UPDATE profile = VALUES(profile), confirmed_at = NOW(), confirmed_by = VALUES(confirmed_by)`,
        [savedId, JSON.stringify(profile), actor.id])
      }
      await conn.query(`INSERT INTO operation_logs (user_id, action, target_type, target_id, detail, ip_address)
        VALUES (?, ?, 'document_templates', ?, ?, ?)`, [actor.id, mode === 'versioned' ? 'document_template_versioned' : 'document_template_updated', savedId,
        JSON.stringify({ sourceTemplateId: id, boundCount, previous: { title: row.title, version: row.version, description: row.description, profile: row.profile },
          saved: { title, version, description, profile } }), actor.ip || null])
      return { id: savedId, version, mode, status: 'published' }
    })
  } catch (err: any) {
    if (copiedFile) {
      try { fs.unlinkSync(copiedFile) } catch (cleanupError) { console.error('清理本次模板副本失败:', cleanupError) }
    }
    if (err.code === 'ER_DUP_ENTRY') throw new TemplateError('该周期下此资料类型和版本已存在，请更换版本号后重试')
    throw err
  }
}
