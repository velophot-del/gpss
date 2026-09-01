import path from 'path'

type Environment = Record<string, string | undefined>

export function resolveDatabaseConfig(env: Environment = process.env, includeDatabase = true) {
  const baseConfig: Record<string, string | number> = {
    user: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  }

  if (includeDatabase) {
    baseConfig.database = env.DB_NAME || 'gpss_db'
  }

  if (env.USE_SOCKET === 'true') {
    return {
      socketPath: env.DB_SOCKET_PATH || '/tmp/mysql.sock',
      ...baseConfig,
    }
  }

  return {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT) || 3306,
    ...baseConfig,
  }
}

export function resolveUploadDir(env: Environment = process.env, cwd = process.cwd()) {
  const configuredPath = env.UPLOAD_DIR?.trim() || 'uploads'
  return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(cwd, configuredPath)
}

// 私有模板目录：uploads 的兄弟目录（uploads-private），位于公共静态服务范围之外
export function resolvePrivateTemplateDir(env: Environment = process.env, cwd = process.cwd()) {
  const uploadDir = resolveUploadDir(env, cwd)
  return path.join(path.dirname(uploadDir), `${path.basename(uploadDir)}-private`)
}

// 对外访问路径前缀（内嵌到「半山学堂」时为 /gpss；独立部署时为空字符串）
// 用于给返回给前端的 URL（如上传文件 /uploads/...）加上子路径前缀
export function resolvePublicBasePath(env: Environment = process.env) {
  const base = env.PUBLIC_BASE_PATH?.trim() || ''
  if (!base) return ''
  return base.startsWith('/') ? base.replace(/\/$/, '') : `/${base.replace(/\/$/, '')}`
}

export function isDemoLoginEnabled(env: Environment = process.env) {
  return env.ENABLE_DEMO_LOGIN === 'true'
}
