import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { resolveUploadDir } from './config/runtime.js'

// 加载环境变量
dotenv.config()

// 导入路由
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import topicRoutes from './routes/topics.js'
import templateRoutes from './routes/templates.js'
import applicationRoutes from './routes/applications.js'
import cycleRoutes from './routes/cycles.js'
import statisticsRoutes from './routes/statistics.js'
import studentRoutes from './routes/students.js'
import uploadRoutes from './routes/upload.js'
import shortlistRoutes from './routes/shortlist.js'
import adminRoutes from './routes/admin.js'
import taskBookRoutes from './routes/taskBooks.js'
import proposalRoutes from './routes/proposals.js'
import midtermRoutes from './routes/midterm.js'
import defenseRoutes from './routes/defense.js'
import gradeRoutes from './routes/grades.js'
import guidanceRoutes from './routes/guidance.js'
import announcementRoutes from './routes/announcements.js'
import notificationRoutes from './routes/notifications.js'
import documentTemplateRoutes from './routes/documentTemplates.js'
import topicAccessRoutes from './routes/topicAccess.js'
import cycleConfigRoutes from './routes/cycleConfig.js'
import profileOptionsRoutes from './routes/profileOptions.js'

// 导入认证中间件
import { authMiddleware, type AuthRequest } from './middleware/auth.js'

const app = express()
const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '127.0.0.1'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

// ===== 中间件 =====
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// 静态文件上传目录（私有模板存放在 uploads 目录之外，不会被这里暴露）
app.use('/uploads', express.static(resolveUploadDir(), {
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (path.extname(filePath).toLowerCase() === '.svg') {
      res.setHeader('Content-Disposition', 'attachment')
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
    }
  }
}))

// ===== 生产环境：托管前端构建文件 =====
const isProduction = process.env.NODE_ENV === 'production'
if (isProduction) {
  const frontendDist = path.join(process.cwd(), '..', 'dist')
  app.use(express.static(frontendDist))
  // SPA fallback：所有非 API 路由返回 index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}

// 请求日志（简易版）
app.use((req, _res, next) => {
  const time = new Date().toLocaleString('zh-CN')
  console.log(`[${time}] ${req.method} ${req.path}`)
  next()
})

// ===== 路由注册 =====

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({
    code: 200,
    message: 'OK',
    data: { service: 'GPSS API', version: '1.0.0', timestamp: new Date().toISOString() }
  })
})

// 认证路由（不需要登录）
app.use('/api/auth', authRoutes)

// 需要登录的路由
app.use('/api/users', userRoutes)
app.use('/api/topics', topicRoutes)
app.use('/api/templates', templateRoutes)
app.use('/api/applications', applicationRoutes)
app.use('/api/cycles', cycleRoutes)
app.use('/api/topic-access', topicAccessRoutes)
app.use('/api/cycle-config', cycleConfigRoutes)
app.use('/api/profile-options', profileOptionsRoutes)
app.use('/api/statistics', statisticsRoutes)
app.use('/api/students', studentRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/shortlist', shortlistRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/task-books', taskBookRoutes)
app.use('/api/proposals', proposalRoutes)
app.use('/api/midterm', midtermRoutes)
app.use('/api/defense', defenseRoutes)
app.use('/api/grades', gradeRoutes)
app.use('/api/guidance', guidanceRoutes)
app.use('/api/announcements', announcementRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/document-templates', documentTemplateRoutes)

// 当前用户信息（GET /api/auth/me 需要 authMiddleware）
app.get('/api/auth/me', authMiddleware, (req: AuthRequest, res) => {
  res.json({ code: 200, message: 'success', data: req.user })
})

// 404 处理
app.use((_req, res) => {
  res.status(404).json({ code: 404, message: '接口不存在' })
})

// 全局错误处理
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('未捕获错误:', err.stack)
  res.status(500).json({ code: 500, message: '服务器内部错误' })
})

// 启动服务
app.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════╗
║   毕业设计管理系统 - API Server       ║
║                                        ║
║   运行地址: http://${HOST}:${PORT}        ║
║   API前缀:  /api                       ║
║   环境:     ${process.env.NODE_ENV || 'development'}                    ║
╚════════════════════════════════════════╝
  `)
})

export default app
