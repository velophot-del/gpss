// 毕业流程端到端回归（需临时库 + 已启动的服务）
// 用法：DB=<库名> BASE=http://127.0.0.1:3199/api node e2e/graduation-flow-e2e.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const mysql2 = require('../server/node_modules/mysql2/promise.js')

const BASE = process.env.BASE || 'http://127.0.0.1:3199/api'
const DB = process.env.DB || 'gpss_e2e'
const db = await mysql2.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: DB,
})

const failures = []
const checks = []
function check(name, cond, extra = '') {
  checks.push([name, !!cond])
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (cond ? '' : '  | ' + String(extra).slice(0, 200)))
  if (!cond) failures.push(name)
}
async function sql(q, params = []) { const [rows] = await db.query(q, params); return rows }

async function req(method, path, token, body, raw = false) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(BASE + path, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (raw) return res
  let data = null
  const text = await res.text()
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}
async function login(username) {
  const r = await req('POST', '/auth/login', null, { username, password: '123456' })
  if (r.status !== 200) throw new Error(`login ${username} 失败 ${r.status}`)
  return r.data.data.token
}

const ADMIN = await login('admin')
const TEACHER = await login('chen')
const STU = await login('zhangyi')
const STU2 = await login('linsiyuan')
const STU3 = await login('wanghan')

const [cycleRow] = await sql("SELECT id FROM cycles WHERE status IN ('active','selection','review','adjustment') ORDER BY id DESC LIMIT 1")
const cycleId = cycleRow.id
const setPhase = p => sql('UPDATE cycles SET phase = ? WHERE id = ?', [p, cycleId])

// 前置：保证 s001 有“已正式录取课题”（任务书/开题/中期均需在此基础上）
const [adopted] = await sql(
  "SELECT t.id FROM topics t WHERE t.cycle_id = ? AND t.teacher_id = 't001' AND t.major_code = '130502' AND t.status IN ('published','full') LIMIT 1",
  [cycleId],
)
if (!adopted) throw new Error('临时库缺少可用的陈教授视觉课题')
await sql(
  "DELETE FROM applications WHERE student_id = 's001' AND status = 'accepted'",
)
await sql(
  'INSERT INTO applications (id, student_id, topic_id, priority, status, motivation) VALUES (?, ?, ?, 1, ?, ?)',
  [`e2e-s001-accept-${Date.now()}`, 's001', adopted.id, 'accepted', 'e2e'],
)

// ===== 一、发布 / 已发布锁定 / 管理员撤回 =====
const cat = '品牌形象与VI设计'
const majorCode = '130502'
let r = await req('POST', '/topics', TEACHER, {
  title: `E2E测试课题_${Date.now()}`, category: cat, major: '视觉传达设计', majorCode,
  description: 'e2e', requirements: 'e2e', difficulty: 'medium', maxStudents: 1, status: 'draft',
})
check('教师创建草稿课题', r.status === 200, r.data)
const tid = r.data?.data?.id
check('教师可编辑草稿', (await req('PUT', `/topics/${tid}`, TEACHER, { title: `E2E草稿_${Date.now()}` })).status === 200)
check('管理员发布 -> published', (await req('PUT', `/topics/${tid}/status`, ADMIN, { status: 'published' })).status === 200)
r = await req('PUT', `/topics/${tid}`, TEACHER, { title: 'E2E_违规修改' })
check('教师编辑已发布被锁定(400)', r.status === 400 && /锁定/.test(r.data?.message || ''), r.data)
r = await req('PUT', `/topics/${tid}/status`, TEACHER, { status: 'draft' })
check('教师不能改已发布状态(400)', r.status === 400 && /锁定/.test(r.data?.message || ''), r.data)
r = await req('DELETE', `/topics/${tid}`, TEACHER)
check('教师不能删已发布(400)', r.status === 400 && /锁定/.test(r.data?.message || ''), r.data)
r = await req('PUT', `/topics/${tid}/status`, ADMIN, { status: 'draft' })
check('管理员撤回发布回草稿(200)', r.status === 200, r.data)
check('撤回后教师可再编辑', (await req('PUT', `/topics/${tid}`, TEACHER, { title: `E2E撤回后可编辑_${Date.now()}` })).status === 200)

// ===== 二、选志愿门槛（浏览 + 少于 3 个拒绝）=====
await setPhase('student_apply')
r = await req('GET', '/topics?page=1&pageSize=50', STU3)
check('学生浏览课题列表含 allowedMajors', r.status === 200 && Array.isArray(r.data?.data?.list) && (r.data?.data?.allowedMajors || []).length > 0, r.data)
const pick = r.data?.data?.list?.slice(0, 2)?.map(t => ({ topicId: t.id, priority: 1 }))
if (pick) {
  const rr = await req('POST', '/applications/volunteers/submit', STU3, pick.map((p, i) => ({ ...p, priority: i + 1 })))
  check('志愿少于3个被拒(400)', rr.status === 400, rr.data)
}

// ===== 三、任务书：学生提交 -> 教师确认 -> 不可逆 =====
const sel = (await sql("SELECT topic_id FROM applications WHERE student_id='s001' AND status='accepted' LIMIT 1"))[0]
await sql("DELETE FROM task_books WHERE student_id='s001'")
await sql("DELETE FROM proposals WHERE student_id='s001'")
await sql("DELETE FROM midterm_reports WHERE student_id='s001'")
await setPhase('task_book')
const taskSchedule = ['选题、下达任务书', '实施研究、收集资料', '开题报告', '撰写设计报告、完成初稿', '毕业设计中期检查', '完成修改、定稿', '学术不端检测', '答辩、展览']
  .map((phase, i) => ({ phase, month: (i % 12) + 1 }))
r = await req('POST', '/task-books', STU, {
  title: 'E2E任务书', content: '目的与意义内容', mainContent: '主要内容', requirements: '基本要求',
  specificRequirements: '具体要求', schedule: taskSchedule, submit: true,
})
check('学生提交任务书', r.status === 200, r.data)
const [tb] = await sql("SELECT id FROM task_books WHERE student_id='s001'")
r = await req('PUT', `/task-books/${tb.id}/review`, TEACHER, { status: 'confirmed' })
check('教师确认任务书(confirmed)', r.status === 200, r.data)
check('确认后学生不能再提交(400)', (await req('POST', '/task-books', STU, { content: 'x', mainContent: 'x', requirements: 'x', specificRequirements: 'x', schedule: taskSchedule, submit: true })).status === 400)
check('确认后教师不能退回(400)', (await req('PUT', `/task-books/${tb.id}/review`, TEACHER, { status: 'need_revision' })).status === 400)
const tbDoc = await req('GET', `/task-books/${tb.id}/export`, STU, undefined, true)
check('任务书 docx 导出 200 且非空', tbDoc.status === 200 && Number(tbDoc.headers.get('content-length') || 0) > 1000, tbDoc.status)

// ===== 四、开题：前置校验 + 审核 + 通过不可逆 =====
await setPhase('proposal')
// 前置负例：用 s003（无已确认任务书）
r = await req('POST', '/proposals', STU2, { title: 'x', background: 'b', objectives: 'o', methods: 'm', plan: 'p', submit: true })
check('无已确认任务书不能提交开题(400)', r.status === 400 && /任务书确认/.test(r.data?.message || ''), r.data)
// 正例：s001 已有 confirmed 任务书
r = await req('POST', '/proposals', STU, { title: 'E2E开题', background: 'b1', objectives: 'o1', methods: 'm1', plan: 'p1', submit: true })
check('任务书确认后学生提交开题', r.status === 200, r.data)
const [pr] = await sql("SELECT id FROM proposals WHERE student_id='s001'")
check('教师审核通过开题(approved)', (await req('PUT', `/proposals/${pr.id}/review`, TEACHER, { status: 'approved', comment: 'ok' })).status === 200)
check('开题通过后不可逆(400)', (await req('PUT', `/proposals/${pr.id}/review`, TEACHER, { status: 'rejected' })).status === 400)
const prDoc = await req('GET', `/proposals/${pr.id}/export`, STU, undefined, true)
check('开题 docx 导出 200 且非空', prDoc.status === 200 && Number(prDoc.headers.get('content-length') || 0) > 1000, prDoc.status)

// ===== 五、中期：前置校验 + 通过不可逆 + 不影响开题 =====
await setPhase('midterm')
await sql("DELETE FROM proposals WHERE student_id='s001'")
r = await req('POST', '/midterm', STU, { completedWork: 'c', problems: 'p', nextPlan: 'n', submit: true })
check('无已通过开题不能提交中期(400)', r.status === 400 && /开题审核/.test(r.data?.message || ''), r.data)
// 重新让 s001 开题通过
await setPhase('proposal')
await req('POST', '/proposals', STU, { title: 'E2E开题2', background: 'b2', objectives: 'o2', methods: 'm2', plan: 'p2', submit: true })
const [pr2] = await sql("SELECT id FROM proposals WHERE student_id='s001'")
await req('PUT', `/proposals/${pr2.id}/review`, TEACHER, { status: 'approved', comment: 'ok' })
await setPhase('midterm')
r = await req('POST', '/midterm', STU, { completedWork: '已完成X', problems: '问题Y', nextPlan: '计划Z', submit: true })
check('开题通过后学生提交中期', r.status === 200, r.data)
const [mr] = await sql("SELECT id FROM midterm_reports WHERE student_id='s001'")
check('教师评分通过中期(passed)', (await req('PUT', `/midterm/${mr.id}/review`, TEACHER, { status: 'passed', score: 88, comment: 'ok' })).status === 200)
check('中期通过后不可逆(400)', (await req('PUT', `/midterm/${mr.id}/review`, TEACHER, { status: 'failed' })).status === 400)
const propStatus = (await sql("SELECT status FROM proposals WHERE id = ?", [pr2.id]))[0]?.status
check('中期未通过不影响开题(开题仍 approved)', propStatus === 'approved', propStatus)
const mrDoc = await req('GET', `/midterm/${mr.id}/export`, STU, undefined, true)
check('中期 docx 导出 200 且非空', mrDoc.status === 200 && Number(mrDoc.headers.get('content-length') || 0) > 1000, mrDoc.status)

// ===== 六、越权 =====
r = await req('GET', `/proposals/${pr2.id}`, STU3)
check('学生不能看他人开题(403)', r.status === 403, r.status)
r = await req('GET', '/topics', null)
check('未带 token 被拒(401)', r.status === 401, r.status)

console.log('\n==== 结果 ====')
console.log(`通过 ${checks.filter(c => c[1]).length}/${checks.length}`)
if (failures.length) { console.log('失败项：', failures); process.exitCode = 1 }
else console.log('ALL PASS')
await db.end()
