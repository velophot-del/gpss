import fs from 'node:fs'
import path from 'node:path'
import { resolvePrivateTemplateDir, resolveUploadDir } from '../config/runtime.js'

let root: string | null = null

/**
 * 私有模板目录：位于公共 uploads 目录之外（兄弟目录 uploads-private），
 * 因此永远不会被 /uploads 静态服务暴露，无需依赖中间件顺序来遮蔽。
 * 首次调用时把历史遗留的 uploads/private-templates 迁移到新位置。
 */
export function privateTemplateRoot(): string {
  if (root) return root
  const target = resolvePrivateTemplateDir()
  const legacy = path.join(resolveUploadDir(), 'private-templates')
  if (!fs.existsSync(target) && fs.existsSync(legacy)) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.renameSync(legacy, target)
  }
  fs.mkdirSync(target, { recursive: true })
  root = target
  return root
}
