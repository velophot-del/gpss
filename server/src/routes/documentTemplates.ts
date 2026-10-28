import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { query, transaction } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { privateTemplateRoot } from '../utils/privateTemplates.js'
import { getAcceptedSelection } from '../utils/processFlow.js'
import { canDownloadDocumentTemplate, validateUploadFile } from '../utils/policies.js'
import { error, success } from '../utils/response.js'
import { inspectTemplate, validateTemplateProfile, canonicalTemplateProfile, renderTemplate, TemplateError, type TemplateType } from '../utils/templateContract.js'
import { checkedProfile, readUploadedTemplate, parseProfile, isTemplateType, materialTables, resolveMaterialTemplate, materialValues } from '../services/materialTemplateService.js'

const router = Router()
router.use(authMiddleware)

const templateRoot = privateTemplateRoot()
const documentTypes = ['task_book', 'proposal', 'midterm', 'thesis', 'other']

// multer/busboy 对不含 RFC5987 filename* 的 multipart 中文文件名常按 latin1 解码成乱码，
// 需回转回 UTF-8；若名字已含真正的多字节字符(>0xFF)则说明已正确解码，保持原样。
function decodeUploadFilename(name: string): string {
  if (!name || /^[\x00-\x7F]*$/.test(name)) return name
  if ([...name].some(ch => (ch.codePointAt(0) || 0) > 0xff)) return name
  return Buffer.from(name, 'latin1').toString('utf8')
}

function ensureTemplateRoot() {
  if (!fs.existsSync(templateRoot)) fs.mkdirSync(templateRoot, { recursive: true })
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      ensureTemplateRoot()
      cb(null, templateRoot)
    },
    filename(_req, file, cb) {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname).toLowerCase()}`)
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
})

function removeFile(file?: Express.Multer.File) {
  if (file) fs.unlink(file.path, () => {})
}

function cleanTemplate(row: any) {
  return {
    ...row,
    cycleId: row.cycle_id,
    documentType: row.document_type,
    originalName: row.original_name,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  }
}

router.get('/', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const cycleId = Number(req.query.cycleId)
    const rows = await query<any>(`
      SELECT dt.*, c.name AS cycle_name, u.real_name AS creator_name
      FROM document_templates dt
      JOIN cycles c ON c.id = dt.cycle_id
      LEFT JOIN users u ON u.id = dt.created_by
      ${Number.isInteger(cycleId) && cycleId > 0 ? 'WHERE dt.cycle_id = ?' : ''}
      ORDER BY dt.updated_at DESC
    `, Number.isInteger(cycleId) && cycleId > 0 ? [cycleId] : [])
    success(res, rows.map(cleanTemplate))
  } catch (err) {
    console.error('获取毕业资料模板失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

router.get('/mine', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const selection = await getAcceptedSelection(req.user!.id)
    if (!selection?.cycle_id) return success(res, { selection: null, templates: [] })
    const rows = await query<any>(`
      SELECT dt.*, c.name AS cycle_name
      FROM document_templates dt
      JOIN cycles c ON c.id = dt.cycle_id
      WHERE dt.cycle_id = ? AND dt.status = 'published'
      ORDER BY dt.document_type, dt.published_at DESC
    `, [selection.cycle_id])
    success(res, { selection, templates: rows.map(cleanTemplate) })
  } catch (err) {
    console.error('获取我的毕业资料失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

router.get('/form', requireRole(['student']), async (req: AuthRequest, res) => {
  try {
    const type = String(req.query.documentType)
    if (!isTemplateType(type)) return error(res, '不支持的材料类型')
    const recordId = String(req.query.recordId || '')
    let cycleId: any
    if (recordId) {
      const [row] = await query<any>(`SELECT * FROM ${materialTables[type]} WHERE id = ? AND student_id = ?`, [recordId, req.user!.id])
      if (!row) return error(res, '记录不存在', 404)
      cycleId = row.cycle_id
      const result = await resolveMaterialTemplate(type, cycleId, recordId)
      if (!result.bound && !['draft', 'not_started', 'need_revision'].includes(row.status)) throw new TemplateError('此历史材料尚未绑定模板，请管理员在毕业资料库中明确关联')
      return success(res, { template: result.template, values: result.values })
    }
    const selection = await getAcceptedSelection(req.user!.id)
    if (!selection) return error(res, '正式确定课题后才可填写毕业材料')
    const result = await resolveMaterialTemplate(type, selection.cycle_id)
    success(res, { template: result.template, values: result.values })
  } catch (err: any) { error(res, err.message || '读取模板失败', err.status || 500) }
})

router.get('/:id/inspect', requireRole(['admin']), async (req, res) => {
  try {
    const [row] = await query<any>(`SELECT dt.*, tc.profile, tc.confirmed_at FROM document_templates dt
      LEFT JOIN document_template_contracts tc ON tc.template_id = dt.id WHERE dt.id = ?`, [req.params.id])
    if (!row) return error(res, '模板不存在', 404)
    if (!isTemplateType(row.document_type)) return error(res, '此资料类型无需在线填写配置')
    const buffer = readUploadedTemplate(row)
    const profile = row.profile ? parseProfile(row.profile) : inspectTemplate(row.document_type, buffer)
    success(res, { profile, saved: Boolean(row.profile), locked: Boolean(row.confirmed_at), errors: validateTemplateProfile(profile, buffer) })
  } catch (err: any) { error(res, err.message, err.status || 500) }
})

router.put('/:id/profile', requireRole(['admin']), async (req, res) => {
  try {
    let profile
    await transaction(async conn => {
      const [rows] = await conn.query<any[]>(`SELECT * FROM document_templates WHERE id = ? FOR UPDATE`, [req.params.id])
      const row = rows[0]
      if (!row) throw new TemplateError('模板不存在')
      const [contracts] = await conn.query<any[]>('SELECT * FROM document_template_contracts WHERE template_id = ?', [row.id])
      if (contracts[0]?.confirmed_at) throw new TemplateError('此版本已发布确认，不可修改填写配置；请上传新版本')
      if (!isTemplateType(row.document_type) || req.body.profile?.type !== row.document_type) throw new TemplateError('模板配置类型不符')
      profile = canonicalTemplateProfile(req.body.profile, readUploadedTemplate(row))
      await conn.query(`INSERT INTO document_template_contracts (template_id, profile) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE profile = VALUES(profile)`, [row.id, JSON.stringify(profile)])
    })
    success(res, { profile }, '填写区域配置已保存，发布后生效')
  } catch (err: any) { error(res, err.message, err.status || 500) }
})

router.post('/:id/preview', requireRole(['admin']), async (req, res) => {
  try {
    const [row] = await query<any>('SELECT * FROM document_templates WHERE id = ?', [req.params.id])
    if (!row) return error(res, '模板不存在', 404)
    const buffer = readUploadedTemplate(row)
    if (req.body.profile?.type !== row.document_type) throw new TemplateError('模板配置类型不符')
    const profile = canonicalTemplateProfile(req.body.profile, buffer)
    const values = Object.fromEntries((profile?.fields || []).filter((f: any) => f.source === 'student').map((f: any) => [f.key, `【${f.label}填写示例】`]))
    const output = renderTemplate(buffer, profile, values, { studentName: '示例学生', studentCode: '20260001', className: '示例班级', major: '示例专业', teacherName: '示例教师', collegeName: '视觉传达设计学院', title: '示例毕业设计题目', topicTitle: '示例毕业设计题目', teacherComment: '示例指导意见' })
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').attachment('template-preview.docx').send(output)
  } catch (err: any) { error(res, err.message, err.status || 500) }
})

router.get('/:id/unbound', requireRole(['admin']), async (req, res) => {
  try {
    const [template] = await query<any>('SELECT * FROM document_templates WHERE id = ?', [req.params.id])
    if (!template || !isTemplateType(template.document_type)) return error(res, '模板不存在', 404)
    const type: TemplateType = template.document_type
    const rows = await query<any>(`SELECT s.id, s.status, ${type === 'midterm' ? "''" : 's.title'} AS title, u.real_name AS studentName FROM ${materialTables[type]} s
      JOIN users u ON u.id = s.student_id LEFT JOIN document_material_templates mt ON mt.record_id = s.id AND mt.document_type = ?
      WHERE s.cycle_id = ? AND mt.record_id IS NULL`, [type, template.cycle_id])
    success(res, rows)
  } catch (err: any) { error(res, err.message, err.status || 500) }
})

router.post('/:id/bind', requireRole(['admin']), async (req, res) => {
  try {
    if (req.body.confirm !== true || !Array.isArray(req.body.recordIds) || !req.body.recordIds.length || req.body.recordIds.length > 200) return error(res, '请明确选择要关联的历史材料并确认')
    await transaction(async conn => {
      const [templates] = await conn.query<any[]>(`SELECT dt.*, tc.profile, tc.confirmed_at FROM document_templates dt
        JOIN document_template_contracts tc ON tc.template_id = dt.id WHERE dt.id = ? FOR UPDATE`, [req.params.id])
      const template = templates[0]
      if (!template?.confirmed_at || !isTemplateType(template.document_type)) throw new TemplateError('请先确认并发布模板')
      const { profile } = checkedProfile(template)
      const type: TemplateType = template.document_type
      for (const id of [...new Set(req.body.recordIds)]) {
        const [records] = await conn.query<any[]>(`SELECT * FROM ${materialTables[type]} WHERE id = ? AND cycle_id = ? FOR UPDATE`, [id, template.cycle_id])
        const row = records[0]
        if (!row) throw new TemplateError('历史材料不属于此周期')
        const legacy = { ...row, mainContent: row.main_content, specificRequirements: row.specific_requirements, completedWork: row.completed_work, nextPlan: row.next_plan }
        let values: Record<string, string>
        try {
          values = materialValues(profile, Object.fromEntries(Object.entries(legacy).map(([key, value]) => [key, value ?? ''])), true)
        } catch (cause: any) {
          throw new TemplateError(`历史材料 ${id} 无法完整匹配模板：${cause.message}；请先核对历史内容和模板字段标识`)
        }
        await conn.query('INSERT INTO document_material_templates (document_type, record_id, template_id, profile, field_values) VALUES (?, ?, ?, ?, ?)', [type, id, template.id, JSON.stringify(profile), JSON.stringify(values)])
      }
    })
    success(res, null, '已明确关联所选历史材料，原填写内容未修改')
  } catch (err: any) { error(res, err.code === 'ER_DUP_ENTRY' ? '所选材料已关联模板，请刷新' : err.message, err.status || 409) }
})

router.post('/', requireRole(['admin']), upload.single('file'), async (req: AuthRequest, res) => {
  const file = req.file
  try {
    const cycleId = Number(req.body.cycleId)
    const documentType = String(req.body.documentType || '')
    const title = String(req.body.title || '').trim()
    const version = String(req.body.version || '').trim()
    const status = 'draft'
    const originalName = decodeUploadFilename(file?.originalname || '')
    if (!file || !Number.isInteger(cycleId) || cycleId < 1 || !documentTypes.includes(documentType) || !title || !version) {
      removeFile(file)
      return error(res, '请完整填写周期、资料类型、名称、版本并选择文件')
    }
    const validation = validateUploadFile('document_template', originalName, file.size)
    if (!validation.ok) {
      removeFile(file)
      return error(res, validation.message)
    }
    const [cycle] = await query<any>('SELECT id FROM cycles WHERE id = ?', [cycleId])
    if (!cycle) {
      removeFile(file)
      return error(res, '选题周期不存在', 404)
    }
    const id = uuidv4()
    await query(`
      INSERT INTO document_templates
      (id, cycle_id, document_type, title, version, description, original_name, storage_key, mime_type, size, status, published_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `, [id, cycleId, documentType, title, version, req.body.description?.trim() || null,
      originalName, file.filename, file.mimetype, file.size, status, req.user!.id])
    success(res, { id }, '模板草稿已保存，请核对填写区域后发布')
  } catch (err: any) {
    removeFile(file)
    if (err?.code === 'ER_DUP_ENTRY') return error(res, '该周期下此资料类型和版本已存在')
    console.error('上传毕业资料模板失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

router.put('/:id', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const status = String(req.body.status || '')
    if (!['draft', 'published', 'archived'].includes(status)) return error(res, '无效的模板状态')
    await transaction(async conn => {
    const [rows] = await conn.query<any[]>('SELECT * FROM document_templates WHERE id = ? FOR UPDATE', [req.params.id])
    const existing = rows[0]
    if (!existing) throw new TemplateError('模板不存在')
    if (status === 'published' && isTemplateType(existing.document_type)) {
      const [contracts] = await conn.query<any[]>('SELECT * FROM document_template_contracts WHERE template_id = ?', [existing.id])
      if (!contracts[0] || req.body.confirmMapping !== true) throw new TemplateError('请先保存填写区域配置，并确认预览结果后发布')
      checkedProfile(existing, parseProfile(contracts[0].profile))
      await conn.query('UPDATE document_template_contracts SET confirmed_at = COALESCE(confirmed_at, NOW()), confirmed_by = COALESCE(confirmed_by, ?) WHERE template_id = ?', [(req as AuthRequest).user!.id, existing.id])
    }
    await conn.query(
      `UPDATE document_templates SET status = ?, published_at = ${status === 'published' ? 'COALESCE(published_at, NOW())' : 'published_at'} WHERE id = ?`,
      [status, req.params.id],
    )
    })
    success(res, null, status === 'published' ? '模板已发布' : status === 'archived' ? '模板已归档' : '模板已撤回为草稿')
  } catch (err) {
    console.error('更新毕业资料模板失败:', err)
    error(res, (err as any).message || '服务器内部错误', (err as any).status || 500)
  }
})

router.get('/:id/download', async (req: AuthRequest, res) => {
  try {
    const [template] = await query<any>('SELECT * FROM document_templates WHERE id = ?', [req.params.id])
    if (!template) return error(res, '模板不存在', 404)
    const selection = req.user!.role === 'student' ? await getAcceptedSelection(req.user!.id) : null
    if (!canDownloadDocumentTemplate(req.user!, template, selection?.cycle_id ?? null)) return error(res, '无权下载此模板', 403)
    if (isTemplateType(template.document_type) && (req.user!.role !== 'admin' || req.query.effective === 'true')) {
      const [contract] = await query<any>('SELECT * FROM document_template_contracts WHERE template_id = ?', [template.id])
      if (!contract?.confirmed_at) throw new TemplateError('此模板尚未确认填写区域，请联系管理员')
      const { buffer, profile } = checkedProfile(template, parseProfile(contract.profile))
      const output = renderTemplate(buffer, profile, {}, {})
      res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .attachment(`published-${template.version}.docx`).send(output)
      return
    }
    const filePath = path.join(templateRoot, path.basename(template.storage_key))
    if (!fs.existsSync(filePath)) return error(res, '模板文件不存在', 404)
    res.download(filePath, template.original_name)
  } catch (err) {
    console.error('下载毕业资料模板失败:', err)
    error(res, (err as any).message || '服务器内部错误', (err as any).status || 500)
  }
})

// DELETE /api/document-templates/:id - 删除资料模板（管理员；同时删除磁盘文件）
router.delete('/:id', requireRole(['admin']), async (req: AuthRequest, res) => {
  try {
    const [template] = await query<any>('SELECT * FROM document_templates WHERE id = ?', [req.params.id])
    if (!template) return error(res, '模板不存在', 404)
    await transaction(async conn => {
      await conn.query('SELECT id FROM document_templates WHERE id = ? FOR UPDATE', [req.params.id])
      const [bound] = await conn.query<any[]>('SELECT record_id FROM document_material_templates WHERE template_id = ? LIMIT 1', [req.params.id])
      if (bound.length) throw new TemplateError('此模板已被学生材料使用，只能归档，不能删除')
      await conn.query('DELETE FROM document_template_contracts WHERE template_id = ?', [req.params.id])
      await conn.query('DELETE FROM document_templates WHERE id = ?', [req.params.id])
    })
    // 磁盘文件尽力删除，缺失不影响结果
    const filePath = path.join(templateRoot, path.basename(template.storage_key))
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath) } catch { /* ignore */ }
    success(res, null, '模板已删除')
  } catch (err) {
    console.error('删除毕业资料模板失败:', err)
    error(res, (err as any).message || '服务器内部错误', (err as any).status || 500)
  }
})

router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return error(res, '文件大小超过 50MB')
  console.error('毕业资料模板上传失败:', err)
  return error(res, '文件上传失败', 400)
})

export default router
