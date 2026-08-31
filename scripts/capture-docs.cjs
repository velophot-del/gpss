/* 使用说明文档截图脚本
 * 运行：NODE_PATH=/Users/tangwang/.npm/_npx/31e32ef8478fbf80/node_modules node scripts/capture-docs.cjs
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = 'http://127.0.0.1:5173'
const OUT_DIR = path.join(__dirname, '..', 'docs', 'screenshots')
const CHROME = '/Users/tangwang/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

async function demoLogin(username) {
  const res = await fetch('http://127.0.0.1:3011/api/auth/demo-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  })
  const json = await res.json()
  return json.data
}

const EXTRA = {
  student: { studentId: '2021305001', className: '视传2101班', major: '视觉传达设计' },
  teacher: { title: '教授', department: '视觉传达设计系' },
  admin: {}
}

function buildUser(raw, role) {
  return { ...raw, ...EXTRA[role], realName: raw.realName || raw.real_name }
}

// 每个角色需要截图的页面
const SHOTS = [
  // 学生
  { role: 'student', route: '/student/browse', name: 'student-browse' },
  { role: 'student', route: '/process/task-book', name: 'student-task-book' },
  { role: 'student', route: '/process/proposal', name: 'student-proposal' },
  { role: 'student', route: '/process/midterm', name: 'student-midterm' },
  { role: 'student', route: '/process/thesis', name: 'student-thesis' },
  { role: 'student', route: '/process/design', name: 'student-design' },
  { role: 'student', route: '/process/guidance', name: 'student-guidance' },
  { role: 'student', route: '/process/grades', name: 'student-grades' },
  { role: 'student', route: '/process/defense', name: 'student-defense' },
  // 教师
  { role: 'teacher', route: '/teacher/topics', name: 'teacher-topics' },
  { role: 'teacher', route: '/process/task-book', name: 'teacher-task-book' },
  { role: 'teacher', route: '/process/proposal/review', name: 'teacher-proposal-review' },
  { role: 'teacher', route: '/process/midterm/review', name: 'teacher-midterm-review' },
  { role: 'teacher', route: '/process/thesis/review', name: 'teacher-thesis-review' },
  { role: 'teacher', route: '/process/design/review', name: 'teacher-design-review' },
  { role: 'teacher', route: '/process/guidance', name: 'teacher-guidance' },
  // 管理员
  { role: 'admin', route: '/process/overview', name: 'admin-overview' },
  { role: 'admin', route: '/process/defense', name: 'admin-defense' },
  { role: 'admin', route: '/process/grades', name: 'admin-grades' },
  { role: 'admin', route: '/process/announcements', name: 'admin-announcements' },
  { role: 'admin', route: '/admin/cycles', name: 'admin-cycles' },
  { role: 'admin', route: '/admin/users', name: 'admin-users' }
]

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })

  // 登录页与开发模式登录页（无需登录态）
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    for (const [route, name] of [['/login', 'login'], ['/debug', 'debug-login']]) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(OUT_DIR, name + '.png') })
      console.log('✓', name)
    }
    await ctx.close()
  }

  // 三角色登录态截图
  for (const role of ['student', 'teacher', 'admin']) {
    const username = { student: 'zhangyi', teacher: 'chen', admin: 'admin' }[role]
    const { token, user } = await demoLogin(username)
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 })
    await ctx.addInitScript(({ token, user }) => {
      localStorage.setItem('gpss_token', token)
      localStorage.setItem('gpss_user', JSON.stringify(user))
      localStorage.setItem('gpss_demo_mode', 'true')
    }, { token, user: buildUser(user, role) })
    const page = await ctx.newPage()
    for (const shot of SHOTS.filter(s => s.role === role)) {
      try {
        await page.goto(BASE + shot.route, { waitUntil: 'networkidle', timeout: 20000 })
        await page.waitForTimeout(700)
        await page.screenshot({ path: path.join(OUT_DIR, shot.name + '.png') })
        console.log('✓', shot.name)
      } catch (e) {
        console.error('✗', shot.name, e.message)
      }
    }
    await ctx.close()
  }

  await browser.close()
  console.log('\n全部截图完成，输出目录：', OUT_DIR)
}

main().catch(e => { console.error(e); process.exit(1) })
