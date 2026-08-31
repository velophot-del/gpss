import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { resolveUploadDir, resolvePublicBasePath } from '../config/runtime.js'
import { getUploadedFilePaths, UPLOAD_CATEGORY_CONFIG, validateUploadFile } from '../utils/policies.js'

const router = Router()
router.use(authMiddleware)

const uploadRoot = resolveUploadDir()
const publicBasePath = resolvePublicBasePath()

const GLOBAL_MAX_SIZE = 500 * 1024 * 1024

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function getCategory(req: Request): string {
  const c = (req.body?.category || req.query?.category || 'general') as string
  return UPLOAD_CATEGORY_CONFIG[c] ? c : 'general'
}

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const category = getCategory(req)
    const dir = path.join(uploadRoot, category)
    ensureDir(dir)
    cb(null, dir)
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase()
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    cb(null, name)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: GLOBAL_MAX_SIZE, files: 20 }
})

// 校验单个已落盘文件，返回 { ok, msg } 或 { ok, info }
function validateFile(file: Express.Multer.File, category: string) {
  const validation = validateUploadFile(category, file.originalname, file.size)
  if (!validation.ok) return { ok: false as const, msg: validation.message }
  return {
    ok: true as const,
    info: {
      filename: file.filename,
      url: `${publicBasePath}/uploads/${category}/${file.filename}`,
      originalName: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
      category
    }
  }
}

// POST /api/upload - 通用文件上传（兼容单文件 fieldname=file，新增多文件 fieldname=files）
router.post('/', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'files', maxCount: 20 }]), (req: AuthRequest, res) => {
  try {
    const category = getCategory(req)
    const files = req.files as any
    const received: Express.Multer.File[] = [...(files?.file || []), ...(files?.files || [])]

    if (received.length === 0) {
      return error(res, '请选择要上传的文件', 400)
    }

    const results: any[] = []
    for (const f of received) {
      const v = validateFile(f, category)
      if (!v.ok) {
        received.forEach(file => fs.unlink(file.path, () => {}))
        return error(res, v.msg, 400)
      }
      results.push(v.info)
    }

    // 向后兼容：单文件（fieldname=file）返回扁平结构
    if (files?.file?.length === 1 && received.length === 1) {
      const info = results[0]
      return success(res, {
        filename: info.filename,
        url: info.url,
        originalName: info.originalName,
        size: info.size,
        mimetype: info.mimetype,
        category: info.category
      }, '上传成功')
    }

    success(res, { files: results }, '上传成功')
  } catch (err: any) {
    console.error('上传失败:', err)
    error(res, '文件上传失败', 500)
  }
})

// Multer 错误处理（文件过大 / 数量超限等）
router.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    getUploadedFilePaths(req.files).forEach(filePath => fs.unlink(filePath, () => {}))
    if (err.code === 'LIMIT_FILE_SIZE') return error(res, '文件大小超过上限（最大 500MB）', 400)
    if (err.code === 'LIMIT_FILE_COUNT') return error(res, '单次上传文件数量超过限制', 400)
    return error(res, `上传失败: ${err.message}`, 400)
  }
  next(err)
})

export default router
