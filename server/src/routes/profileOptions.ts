import { Router } from 'express'
import multer from 'multer'
import XLSX from 'xlsx'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { safeParseJson } from '../utils/json.js'

type Option = { type: 'skill' | 'interest'; label: string; majorCodes: string[]; order: number; enabled: boolean }
const fallback: Option[] = [
  ...['平面设计', '字体设计', '插画设计', '品牌设计', '包装设计', '网页设计', '摄影', '视频'].map((label, order) => ({ type: 'skill' as const, label, majorCodes: [], order, enabled: true })),
  ...['品牌形象', '包装设计', '书籍装帧', '插画', '数字媒体', '影像'].map((label, order) => ({ type: 'interest' as const, label, majorCodes: [], order, enabled: true }))
]
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })
const router = Router(); router.use(authMiddleware)

async function readOptions(): Promise<Option[]> {
  const rows = await query<any>("SELECT value FROM system_configs WHERE `key` = 'profile_options' LIMIT 1")
  if (!rows[0]?.value) return fallback
  const parsed = safeParseJson<Option[]>(rows[0].value, fallback)
  return Array.isArray(parsed) ? parsed : fallback
}
function normalize(input: any[]): Option[] {
  return input.filter(Boolean).map((item, index) => ({
    type: (item.type === 'interest' || item['类型'] === '兴趣' || item['类型'] === 'interest' ? 'interest' : 'skill') as 'skill' | 'interest',
    label: String(item.label ?? item.name ?? item['标签'] ?? item['名称'] ?? '').trim(),
    majorCodes: String(item.majorCodes ?? item.majors ?? item['专业代码'] ?? '').split(/[，,;；\s]+/).filter(Boolean),
    order: Number(item.order ?? item['排序'] ?? index) || index,
    enabled: item.enabled === false || String(item['状态'] ?? '').toLowerCase() === '停用' ? false : true
  })).filter(item => item.label)
}

router.get('/', async (req: AuthRequest, res) => {
  try {
    const options = (await readOptions()).filter(o => o.enabled)
    if (req.user!.role !== 'student') return success(res, options)
    const rows = await query<any>('SELECT major_code FROM users WHERE id = ?', [req.user!.id])
    const major = String(rows[0]?.major_code || '')
    success(res, options.filter(o => !o.majorCodes.length || o.majorCodes.includes(major)))
  } catch { error(res, '读取学生标签选项失败', 500) }
})
router.get('/admin', requireRole(['admin']), async (_req, res) => { try { success(res, await readOptions()) } catch { error(res, '读取标签配置失败', 500) } })
router.put('/', requireRole(['admin']), async (req, res) => {
  try { const options = normalize(Array.isArray(req.body) ? req.body : req.body.options); if (!options.length) return error(res, '至少保留一个有效标签'); await query("INSERT INTO system_configs (`key`, value, description) VALUES ('profile_options', ?, '学生技能与兴趣标签') ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify(options)]); success(res, options, '标签配置已保存') } catch (err) { console.error(err); error(res, '保存标签配置失败', 500) }
})
router.post('/import', requireRole(['admin']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return error(res, '请选择 Excel 文件')
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' }); const sheet = wb.Sheets[wb.SheetNames[0]]
    const options = normalize(XLSX.utils.sheet_to_json(sheet, { defval: '' }))
    if (!options.length) return error(res, 'Excel 中没有识别到有效标签，请使用“类型、标签、专业代码、排序、状态”列')
    success(res, options, 'Excel 解析成功，请确认后保存')
  } catch (err) { console.error('解析标签 Excel 失败:', err); error(res, 'Excel 解析失败，请检查文件格式', 400) }
})
export default router
