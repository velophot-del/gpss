import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
const { canDownloadDocumentTemplate } = await import('../server/dist/utils/policies.js')

function load(file, deps) {
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(deps[name], name); return deps[name] }, module, module.exports)
  return module.exports
}

function download({ confirmed = false, cycle = 1 } = {}) {
  let handler, sent
  const router = { use() {}, get(route, ...handlers) { if (route === '/:id/download') handler = handlers.at(-1) }, put() {}, post() {}, delete() {} }
  const multer = Object.assign(() => ({ single: () => () => {} }), { diskStorage: () => ({}), MulterError: class extends Error {} })
  const deps = {
    express: { Router: () => router }, multer: { default: multer }, fs: { default: { existsSync: () => true } }, path: { default: path }, uuid: {},
    '../config/database.js': { query: async sql => sql.includes('document_template_contracts') ? [{ confirmed_at: confirmed ? '2026-11-06' : null }] : [{ id: 'template', cycle_id: 1, status: 'published', document_type: 'midterm', storage_key: 'midterm.docx', original_name: '中期.docx', version: '1' }] },
    '../middleware/auth.js': { authMiddleware() {}, requireRole: () => () => {} },
    '../utils/privateTemplates.js': { privateTemplateRoot: () => '/private-templates' },
    '../utils/processFlow.js': { getAcceptedSelection: async () => ({ cycle_id: cycle }) },
    '../utils/taskBookPolicy.js': {}, '../utils/policies.js': { canDownloadDocumentTemplate },
    '../services/templateEditingService.js': {},
    '../utils/response.js': { error: (_res, message, code) => ({ message, code }) },
    '../utils/templateContract.js': { renderTemplate: () => Buffer.from('rendered') },
    '../services/materialTemplateService.js': { isTemplateType: () => true, parseProfile: () => ({}), checkedProfile: () => ({ buffer: Buffer.from('original'), profile: {} }) },
  }
  load('server/src/routes/documentTemplates.ts', deps)
  const response = { download: (file, name) => ({ file, name }), type() { return this }, attachment() { return this }, send: data => { sent = { data } } }
  return async () => (await handler({ user: { id: 'student', role: 'student' }, params: { id: 'template' }, query: {} }, response)) || sent
}

test('published materials download without online-fill mapping; cycle boundaries remain enforced', async () => {
  const result = await download()()
  assert.equal(result.file, '/private-templates/midterm.docx')
  assert.equal((await download({ cycle: 2 })()).code, 403)
})

test('confirmed template still downloads the cleaned published rendering', async () => {
  assert.equal((await download({ confirmed: true })()).data.toString(), 'rendered')
})

function proposalReview(previousStatus) {
  let handler, outcome
  const writes = []
  const row = { id: 'proposal', topic_id: 'topic', student_id: 'student', teacher_id: 'teacher', status: 'submitted' }
  const router = { use() {}, post() {}, get() {}, put(_route, _auth, fn) { handler = fn } }
  const deps = {
    express: { Router: () => router }, uuid: {},
    '../config/database.js': { query: async () => [row], transaction: fn => fn({ query: async sql => {
      if (sql.includes('FROM topics')) return [[{ id: 'topic' }]]
      if (sql.includes('FROM proposals')) return [[row]]
      if (sql.includes('FROM task_books')) return [[{ status: previousStatus }]]
      writes.push(sql); return [[]]
    } }) },
    '../middleware/auth.js': { authMiddleware() {}, requireRole: () => () => {} },
    '../utils/response.js': { success: () => { outcome = { ok: true } }, error: (_res, message) => { outcome = { ok: false, message } } },
    './processFlow.js': { notify: async () => {} }, './officialDocx.js': {},
    '../services/materialTemplateService.js': {}, './templateContract.js': { TemplateError: Error },
  }
  const { createSubmissionRouter } = load('server/src/utils/submissionFlow.ts', deps)
  createSubmissionRouter({ table: 'proposals', stagePhase: 'proposal', label: '开题报告', reviewStates: { pass: 'approved', reject: 'rejected', revision: 'need_revision' }, requiresPrevious: { table: 'task_books', statuses: ['confirmed', 'issued'], label: '任务书确认' } })
  return { run: async () => { await handler({ user: { id: 'teacher', role: 'teacher' }, params: { id: 'proposal' }, body: { status: 'approved' } }, {}); return outcome }, writes }
}

test('proposal cannot pass after task-book edits invalidate prior confirmation', async () => {
  for (const state of ['draft', 'submitted', 'need_revision']) {
    const fixture = proposalReview(state)
    assert.equal((await fixture.run()).ok, false)
    assert.equal(fixture.writes.length, 0)
  }
  const fixture = proposalReview('confirmed')
  assert.equal((await fixture.run()).ok, true)
  assert.equal(fixture.writes.length, 1)
})

const templateContract = await import('../server/dist/utils/templateContract.js')
const buffer = fs.readFileSync(new URL('../server/src/assets/process-templates/task-book.docx', import.meta.url))
function legacyExports() {
  const profile = templateContract.inspectTemplate('task_book', buffer)
  return load('server/src/services/materialTemplateService.ts', {
    'node:fs': { default: { readFileSync: () => buffer } }, 'node:path': { default: path },
    '../config/database.js': { query: async sql => {
      assert.match(sql, /SELECT/)
      return sql.includes('document_material_templates') ? [] : [{ id: 'current-template', original_name: 'task.docx', storage_key: 'task.docx', document_type: 'task_book', confirmed_at: '2026-11-06', profile: JSON.stringify(profile) }]
    } },
    '../utils/privateTemplates.js': { privateTemplateRoot: () => '/private' },
    '../utils/json.js': { safeParseJson: (value, fallback) => value == null ? fallback : typeof value === 'string' ? JSON.parse(value) : value },
    '../utils/templateContract.js': templateContract,
  })
}

test('unbound incomplete legacy drafts export previews with existing student content and no writes', async () => {
  const result = await legacyExports().requireBoundExport('task_book', { id: 'old', cycle_id: 1, status: 'draft', title: '原题目', content: '已有目的内容', main_content: '已有主要内容' })
  assert.equal(result.values.title, '原题目')
  assert.equal(result.values.content, '已有目的内容')
  assert.equal(result.values.mainContent, '已有主要内容')
  assert.equal(result.values.specificRequirements, '')
  assert.equal(result.bound, false)
})

test('unbound submitted or confirmed historical documents still require an explicit version', async () => {
  for (const status of ['submitted', 'confirmed', 'issued']) {
    await assert.rejects(legacyExports().requireBoundExport('task_book', { id: 'old', cycle_id: 1, status }), /尚未绑定模板/)
  }
})
