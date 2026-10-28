// Run only against a separately initialized/seeded gpss_template_verify_* database.
// GPSS_TEMPLATE_TEST_DB=... GPSS_TEMPLATE_SOURCE_DB=gpss_demo_20261028 node test/template-contract.integration.mjs
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import mysql from '../server/node_modules/mysql2/promise.js'
import PizZip from '../server/node_modules/pizzip/js/index.js'

const database = process.env.GPSS_TEMPLATE_TEST_DB
const sourceDatabase = process.env.GPSS_TEMPLATE_SOURCE_DB
assert.match(database || '', /^gpss_template_verify_[A-Za-z0-9_]+$/, 'requires a dedicated verification database')
assert.match(sourceDatabase || '', /^[A-Za-z0-9_]+$/, 'requires source database name')
assert.notEqual(database, sourceDatabase)
const conn = await mysql.createConnection({ user: 'root', socketPath: '/tmp/mysql.sock', database })
const port = 3012
let server, serverLog = ''
const base = `http://127.0.0.1:${port}/api`
async function api(path, token, body, method = body ? 'POST' : 'GET', expected = 200) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`)
  return data.data
}
const textOf = buffer => [...new PizZip(buffer).file('word/document.xml').asText().matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
  .map(p => [...p[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')).join('\n')
try {
  const run = randomUUID().slice(0, 8), studentId = randomUUID(), username = `verify_${run}`
  await conn.query(`INSERT INTO users (id, username, password, real_name, role, student_id, class_name, major)
    SELECT ?, ?, password, '核验学生', 'student', 'CHECK2026', '核验班', '视觉传达设计' FROM users WHERE id = 's001'`, [studentId, username])
  const [[topic]] = await conn.query("SELECT id,cycle_id FROM topics WHERE teacher_id = 't001' LIMIT 1")
  await conn.query("INSERT INTO applications (id,student_id,topic_id,status) VALUES (?, ?, ?, 'accepted')", [randomUUID(), studentId, topic.id])
  await conn.query("UPDATE cycles SET status = 'process', phase = 'task_book', phases_config = JSON_SET(COALESCE(phases_config, JSON_OBJECT()), '$.phase_switch_mode', 'manual') WHERE id = ?", [topic.cycle_id])
  const templates = []
  for (const type of ['task_book', 'proposal', 'midterm']) {
    const [[source]] = await conn.query(`SELECT * FROM \`${sourceDatabase}\`.document_templates WHERE document_type = ? ORDER BY updated_at DESC LIMIT 1`, [type])
    assert.ok(source, `source ${type} uploaded template is required`)
    const id = randomUUID()
    await conn.query(`INSERT INTO document_templates (id,cycle_id,document_type,title,version,original_name,storage_key,size,status,created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'admin-001')`, [id, topic.cycle_id, type, `核验${type}`, run, source.original_name, source.storage_key, source.size])
    templates.push({ id, type })
  }
  server = spawn(process.execPath, ['dist/index.js'], { cwd: new URL('../server/', import.meta.url), env: { ...process.env, NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(port), DB_NAME: database, USE_SOCKET: 'true', DB_SOCKET_PATH: '/tmp/mysql.sock', ENABLE_DEMO_LOGIN: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', data => { serverLog += data })
  server.stderr.on('data', data => { serverLog += data })
  let ready = false
  for (let i = 0; i < 40; i++) {
    try { ready = (await fetch(base + '/health')).ok; if (ready) break } catch {}
    await delay(100)
  }
  assert.ok(ready, serverLog)
  const admin = (await api('/auth/demo-login', null, { username: 'admin' })).token
  const teacher = (await api('/auth/demo-login', null, { username: 'chen' })).token
  const student = (await api('/auth/login', null, { username, password: '123456' })).token
  const stranger = (await api('/auth/demo-login', null, { username: 'zhangyi' })).token

  await api(`/document-templates/${templates[0].id}/inspect`, student, null, 'GET', 403)
  for (const item of templates) {
    await api(`/document-templates/${item.id}`, admin, { status: 'published', confirmMapping: true }, 'PUT', 409)
    const inspected = await api(`/document-templates/${item.id}/inspect`, admin)
    assert.deepEqual(inspected.errors, [])
    item.profile = inspected.profile
    if (item.type === 'midterm') {
      // A renamed/new custom field must be reflected in both form and export.
      const field = item.profile.fields.find(f => f.key === 'nextPlan')
      field.key = 'custom_next'; field.label = '下一阶段实践与时间'
    }
    const fixed = item.profile.fields.find(f => f.source === 'fixed' && f.original.includes('注：本表'))
    assert.ok(fixed)
    fixed.value = `管理员统一说明_${item.type}`
    fixed.original = '客户端不可信原文'
    const savedProfile = await api(`/document-templates/${item.id}/profile`, admin, { profile: item.profile }, 'PUT')
    item.profile = savedProfile.profile
    assert.notEqual(item.profile.fields.find(f => f.id === fixed.id).original, '客户端不可信原文')
    const preview = await fetch(base + `/document-templates/${item.id}/preview`, { method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: item.profile }) })
    assert.equal(preview.status, 200)
    assert.match(textOf(Buffer.from(await preview.arrayBuffer())), /示例学生/)
    await api(`/document-templates/${item.id}`, admin, { status: 'published', confirmMapping: true }, 'PUT')
    await api(`/document-templates/${item.id}/profile`, admin, { profile: item.profile }, 'PUT', 409)
    const effective = await fetch(base + `/document-templates/${item.id}/download?effective=true`, { headers: { Authorization: `Bearer ${admin}` } })
    assert.equal(effective.status, 200)
    const blank = textOf(Buffer.from(await effective.arrayBuffer()))
    assert.match(blank, new RegExp(`管理员统一说明_${item.type}`))
    assert.doesNotMatch(blank, /品牌定位与视觉策略|新式茶饮|张艺/)
  }
  console.log('PASS: upload inspection, explicit publication, immutable profile, admin permission, preview')

  const outputs = []
  for (const item of templates) {
    const route = item.type === 'task_book' ? 'task-books' : item.type === 'midterm' ? 'midterm' : 'proposals'
    const form = await api(`/document-templates/form?documentType=${item.type}`, student)
    assert.equal(form.template.id, item.id)
    const values = Object.fromEntries(item.profile.fields.filter(f => f.source === 'student').map(f => [f.key, `核验填写_${f.key}`]))
    await api('/' + route, student, { templateId: 'wrong-id', templateValues: values, submit: false }, 'POST', 409)
    await api('/' + route, student, { templateId: item.id, templateValues: {}, submit: true }, 'POST', 409)
    const saved = await api('/' + route, student, { templateId: item.id, templateValues: { ...values, requirements: '学生伪造固定要求', fixed_44: '伪造时间' }, submit: false })
    item.recordId = saved.id
    const list = await api('/' + route, student)
    const row = list.find(r => r.id === saved.id)
    assert.equal(row.template.id, item.id)
    assert.ok(!Object.values(row.templateValues).includes('学生伪造固定要求'))
    await api(`/document-templates/form?documentType=${item.type}&recordId=${saved.id}`, stranger, null, 'GET', 404)
    await api(`/${route}/${saved.id}/export`, stranger, null, 'GET', 403)
    await api('/' + route, student, { templateId: item.id, templateValues: values, submit: true })
    const status = item.type === 'task_book' ? 'confirmed' : item.type === 'proposal' ? 'approved' : 'passed'
    await api(`/${route}/${saved.id}/review`, teacher, { status, comment: '核验教师意见', score: 90 }, 'PUT')
    const response = await fetch(base + `/${route}/${saved.id}/export`, { headers: { Authorization: `Bearer ${student}` } })
    assert.equal(response.status, 200)
    const buffer = Buffer.from(await response.arrayBuffer()), text = textOf(buffer)
    assert.match(text, /视觉传达设计学院/)
    assert.match(text, new RegExp(`管理员统一说明_${item.type}`))
    assert.doesNotMatch(text, /学生伪造固定要求|伪造时间|品牌定位与视觉策略|新式茶饮|张艺/)
    for (const value of Object.values(values)) assert.ok(text.includes(value), value)
    if (item.type === 'task_book') assert.match(text, /2026年10月份/)
    if (item.type === 'midterm') assert.match(text, /核验填写_custom_next/)
    outputs.push({ route, id: saved.id, buffer })
    await api(`/document-templates/${item.id}`, admin, null, 'DELETE', 409)
    await api(`/document-templates/${item.id}`, admin, { status: 'archived' }, 'PUT')
    const afterArchive = await fetch(base + `/${route}/${saved.id}/export`, { headers: { Authorization: `Bearer ${student}` } })
    assert.equal(afterArchive.status, 200)
    assert.deepEqual(Buffer.from(await afterArchive.arrayBuffer()), buffer)
    if (item.type !== 'midterm') await conn.query('UPDATE cycles SET phase = ? WHERE id = ?', [item.type === 'task_book' ? 'proposal' : 'midterm', topic.cycle_id])
    console.log(`PASS: ${item.type} dynamic form → save → submit → review → export; ownership, fixed content and archived version protection`)
  }

  // Historical records are not silently switched; administrator must explicitly bind them.
  const item = templates[0]
  const oldId = randomUUID(), legacyId = randomUUID(), legacyUsername = `legacy_${run}`
  await conn.query(`INSERT INTO users (id, username, password, real_name, role)
    SELECT ?, ?, password, '历史核验学生', 'student' FROM users WHERE id = 's001'`, [legacyId, legacyUsername])
  await conn.query(`INSERT INTO task_books (id, student_id, topic_id,cycle_id,title,content,main_content,requirements,specific_requirements,schedule,file_urls,status)
    SELECT ?, ?, topic_id, cycle_id, title, content, NULL, requirements, specific_requirements, schedule, file_urls, 'issued'
    FROM task_books WHERE student_id = 's001' LIMIT 1`, [oldId, legacyId])
  const history = await api(`/document-templates/${item.id}/unbound`, admin)
  const old = history.find(r => r.id === oldId)
  assert.ok(old)
  const legacyToken = (await api('/auth/login', null, { username: legacyUsername, password: '123456' })).token
  await api(`/task-books/${old.id}/export`, legacyToken, null, 'GET', 409)
  await api(`/document-templates/${item.id}/bind`, student, { recordIds: [old.id], confirm: true }, 'POST', 403)
  await api(`/document-templates/${item.id}/bind`, admin, { recordIds: [old.id], confirm: true }, 'POST', 409)
  await conn.query('UPDATE task_books SET main_content = ?, specific_requirements = ? WHERE id = ?', ['完整历史主要内容', '完整历史具体要求', old.id])
  await api(`/document-templates/${item.id}/bind`, admin, { recordIds: [old.id], confirm: true })
  const rows = await api('/task-books', admin)
  assert.equal(rows.find(r => r.id === old.id).template.id, item.id)
  console.log('PASS: legacy version association requires explicit administrator action')

  // Publishing a new template cannot switch an already-bound material.
  const newId = randomUUID()
  await conn.query(`INSERT INTO document_templates (id,cycle_id,document_type,title,version,original_name,storage_key,size,status,created_by)
    SELECT ?, cycle_id, document_type, '新版本核验', ?, original_name,storage_key,size,'draft','admin-001' FROM document_templates WHERE id = ?`, [newId, `next_${run}`, item.id])
  const nextProfile = structuredClone(item.profile)
  nextProfile.fields.find(f => f.source === 'fixed').value = '新版本管理员内容'
  await api(`/document-templates/${newId}/profile`, admin, { profile: nextProfile }, 'PUT')
  await api(`/document-templates/${newId}`, admin, { status: 'published', confirmMapping: true }, 'PUT')
  const savedForm = await api(`/document-templates/form?documentType=task_book&recordId=${item.recordId}`, student)
  assert.equal(savedForm.template.id, item.id)
  const final = await fetch(base + `/task-books/${item.recordId}/export`, { headers: { Authorization: `Bearer ${student}` } })
  assert.deepEqual(Buffer.from(await final.arrayBuffer()), outputs[0].buffer)
  console.log('PASS: publishing a new version leaves bound exports byte-identical')
} catch (error) {
  console.error(serverLog.slice(-3500))
  throw error
} finally {
  server?.kill('SIGTERM')
  await conn.end()
}
