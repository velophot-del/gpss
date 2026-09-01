import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { privateTemplateRoot } from '../utils/privateTemplates.js'
import { getAcceptedSelection } from '../utils/processFlow.js'
import { canDownloadDocumentTemplate, validateUploadFile } from '../utils/policies.js'
import { error, success } from '../utils/response.js'

const router = Router()
router.use(authMiddleware)

const templateRoot = privateTemplateRoot()
const documentTypes = ['task_book', 'proposal', 'midterm', 'thesis', 'other']

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

router.post('/', requireRole(['admin']), upload.single('file'), async (req: AuthRequest, res) => {
  const file = req.file
  try {
    const cycleId = Number(req.body.cycleId)
    const documentType = String(req.body.documentType || '')
    const title = String(req.body.title || '').trim()
    const version = String(req.body.version || '').trim()
    const status = req.body.status === 'published' ? 'published' : 'draft'
    if (!file || !Number.isInteger(cycleId) || cycleId < 1 || !documentTypes.includes(documentType) || !title || !version) {
      removeFile(file)
      return error(res, '请完整填写周期、资料类型、名称、版本并选择文件')
    }
    const validation = validateUploadFile('document_template', file.originalname, file.size)
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${status === 'published' ? 'NOW()' : 'NULL'}, ?)
    `, [id, cycleId, documentType, title, version, req.body.description?.trim() || null,
      file.originalname, file.filename, file.mimetype, file.size, status, req.user!.id])
    success(res, { id }, status === 'published' ? '模板已发布' : '模板草稿已保存')
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
    const [existing] = await query<any>('SELECT id, status FROM document_templates WHERE id = ?', [req.params.id])
    if (!existing) return error(res, '模板不存在', 404)
    await query(
      `UPDATE document_templates SET status = ?, published_at = ${status === 'published' ? 'COALESCE(published_at, NOW())' : 'published_at'} WHERE id = ?`,
      [status, req.params.id],
    )
    success(res, null, status === 'published' ? '模板已发布' : status === 'archived' ? '模板已归档' : '模板已撤回为草稿')
  } catch (err) {
    console.error('更新毕业资料模板失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

router.get('/:id/download', async (req: AuthRequest, res) => {
  try {
    const [template] = await query<any>('SELECT * FROM document_templates WHERE id = ?', [req.params.id])
    if (!template) return error(res, '模板不存在', 404)
    const selection = req.user!.role === 'student' ? await getAcceptedSelection(req.user!.id) : null
    if (!canDownloadDocumentTemplate(req.user!, template, selection?.cycle_id ?? null)) return error(res, '无权下载此模板', 403)
    const filePath = path.join(templateRoot, path.basename(template.storage_key))
    if (!fs.existsSync(filePath)) return error(res, '模板文件不存在', 404)
    res.download(filePath, template.original_name)
  } catch (err) {
    console.error('下载毕业资料模板失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return error(res, '文件大小超过 50MB')
  console.error('毕业资料模板上传失败:', err)
  return error(res, '文件上传失败', 400)
})

export default router
