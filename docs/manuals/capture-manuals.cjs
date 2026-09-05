/* 生成「学生操作手册 / 教师操作手册」截图
 * 依赖当前 5173(前端,base=/gpss) 与 3011(后端) 运行；admin 等演示登录账号可用。
 * 运行：NODE_PATH=.../node_modules node docs/manuals/capture-manuals.cjs
 */
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = 'http://127.0.0.1:5173'
const OUT_DIR = path.join(__dirname, 'images')
const CHROME = '/Users/tangwang/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

async function demoLogin(username) {
  const res = await fetch('http://127.0.0.1:3011/api/auth/demo-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  })
  return (await res.json()).data
}
const EXTRA = {
  student: { studentId: '2021305001', className: '视传2101班', major: '视觉传达设计' },
  teacher: { title: '教授', department: '视觉传达设计系' }
}
const buildUser = (raw, role) => ({ ...raw, ...EXTRA[role], realName: raw.realName || raw.real_name })

const SHOTS = [
  // 登录（共用一张）
  { login: true, name: 'login' },
  // 学生
  { role: 'student', route: '/student', name: 'stu-home' },
  { role: 'student', route: '/student/browse', name: 'stu-workspace' },
  { role: 'student', route: '/student/browse?panel=submitted', name: 'stu-submitted' },
  { role: 'student', route: '/student/result', name: 'stu-result' },
  { role: 'student', route: '/student/profile', name: 'stu-profile' },
  { role: 'student', route: '/process/task-book', name: 'stu-taskbook' },
  { role: 'student', route: '/process/proposal', name: 'stu-proposal' },
  { role: 'student', route: '/process/midterm', name: 'stu-midterm' },
  // 教师
  { role: 'teacher', route: '/teacher', name: 'tea-home' },
  { role: 'teacher', route: '/teacher/topics', name: 'tea-topics' },
  { role: 'teacher', route: '/teacher/topics/create', name: 'tea-topic-create' },
  { role: 'teacher', route: '/teacher/review', name: 'tea-review' },
  { role: 'teacher', route: '/teacher/results', name: 'tea-results' },
  { role: 'teacher', route: '/process/task-book', name: 'tea-taskbook' },
  { role: 'teacher', route: '/process/proposal/review', name: 'tea-proposal-review' },
  { role: 'teacher', route: '/process/midterm/review', name: 'tea-midterm-review' },
]

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })

  const loginShot = SHOTS.find(s => s.login)
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    const page = await ctx.newPage()
    await page.goto(BASE + '/gpss/login', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUT_DIR, loginShot.name + '.png') })
    console.log('✓', loginShot.name)
    await ctx.close()
  }

  for (const shot of SHOTS.filter(s => !s.login)) {
    const username = shot.role === 'teacher' ? 'chen' : 'zhangyi'
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
    try {
      const { token, user } = await demoLogin(username)
      await ctx.addInitScript(({ token, user }) => {
        localStorage.setItem('gpss_token', token)
        localStorage.setItem('gpss_user', JSON.stringify(user))
        localStorage.setItem('gpss_demo_mode', 'true')
      }, { token, user: buildUser(user, shot.role) })
      const page = await ctx.newPage()
      await page.goto(BASE + '/gpss' + shot.route, { waitUntil: 'networkidle', timeout: 25000 })
      await page.waitForTimeout(900)
      await page.screenshot({ path: path.join(OUT_DIR, shot.name + '.png') })
      console.log('✓', shot.name)
    } catch (e) {
      console.error('✗', shot.name, e.message)
    }
    await ctx.close()
  }

  await browser.close()
  console.log('截图目录：', OUT_DIR)
}
main().catch(e => { console.error(e); process.exit(1) })
