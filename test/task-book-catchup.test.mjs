import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const { canEditTaskBook } = await import('../server/dist/utils/taskBookPolicy.js')

test('all graduation handling phases allow task-book edits until proposal approval', () => {
  for (const phase of ['task_book', 'proposal', 'midterm', 'thesis_design', 'defense', 'grading']) {
    assert.equal(canEditTaskBook(phase, false), true)
    assert.equal(canEditTaskBook(phase, true), false)
  }
})

test('selection, archive, ended and unknown phases do not allow task-book edits', () => {
  for (const phase of ['topic_publish', 'student_selection', 'adjustment', 'result', 'archive', 'ended', '', null]) {
    assert.equal(canEditTaskBook(phase, false), false, String(phase))
  }
})

function submission({ phase = 'proposal', approved = false, approvedAtLock = false, submit = true, existing = null, selection = { topic_id: 'topic', cycle_id: 1, topic_title: '题目', teacher_id: 'teacher' } } = {}) {
  let handler
  let outcome
  const writes = []
  const router = { use() {}, post(path, _role, fn) { if (path === '/') handler = fn }, put() {}, get() {} }
  const deps = {
    express: { Router: () => router },
    uuid: { v4: () => 'new-record' },
    '../config/database.js': {
      query: async () => existing ? [existing] : [],
      transaction: async fn => fn({ query: async (sql, values) => {
        if (sql.includes('FROM topics')) return [[{ id: 'topic' }]]
        if (sql.includes('FROM task_books') && sql.includes('FOR UPDATE')) return [existing ? [existing] : []]
        if (sql.startsWith('SELECT')) return [[]]
        writes.push({ sql, values }); return [[]]
      } }),
    },
    '../middleware/auth.js': { authMiddleware() {}, requireRole: roles => { assert.deepEqual(roles.includes('student') || roles.includes('teacher'), true); return () => {} } },
    '../utils/response.js': { success: (_res, data) => { outcome = { ok: true, data } }, error: (_res, message) => { outcome = { ok: false, message } } },
    '../utils/processFlow.js': { getAcceptedSelection: async () => selection, notify: async () => {} },
    '../utils/taskBookPolicy.js': { taskBookEditable: async (studentId, topicId, cycleId, conn) => { assert.equal(studentId, 'student'); assert.equal(cycleId, 1); return canEditTaskBook(phase, approved || Boolean(conn && approvedAtLock)) } },
    '../utils/submissionFlow.js': { presentSubmissionBase: row => row },
    '../utils/officialDocx.js': {},
    '../utils/json.js': { safeParseJson: (value, fallback) => value == null ? fallback : JSON.parse(value) },
    '../services/materialTemplateService.js': { resolveMaterialTemplate: async () => ({ template: { id: 'template', profile: {} } }), materialValues: () => ({ content: '学生填写内容' }), bindMaterial: async () => {}, materialPresentation: async () => ({}) },
    '../utils/templateContract.js': { TemplateError: Error },
  }
  const source = readFileSync(new URL('../server/src/routes/taskBooks.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(deps[name], name); return deps[name] }, module, module.exports)
  return { run: async () => { await handler({ user: { id: 'student', role: 'student' }, body: { submit, templateId: 'template', templateValues: {} } }, {}); return outcome }, writes }
}

test('proposal-phase catch-up uses the accepted cycle and saves a submitted task book', async () => {
  const fixture = submission()
  assert.equal((await fixture.run()).ok, true)
  assert.equal(fixture.writes.length, 1)
  assert.match(fixture.writes[0].sql, /INSERT INTO task_books/)
  assert.equal(fixture.writes[0].values.at(-1), 'submitted')
})

test('editing submitted and confirmed task books resets approval and preserves old content in audit', async () => {
  for (const status of ['submitted', 'confirmed', 'issued']) {
    const fixture = submission({ existing: { id: 'old', status, content: 'previous content', reviewed_by: 'teacher' } })
    assert.equal((await fixture.run()).ok, true)
    const audit = fixture.writes.find(w => w.sql.includes('INSERT INTO operation_logs'))
    assert.equal(JSON.parse(audit.values.at(-1)).previous.content, 'previous content')
    const update = fixture.writes.find(w => w.sql.includes('UPDATE task_books'))
    assert.match(update.sql, /reviewed_by = NULL/)
    assert.equal(update.values.at(-2), 'submitted')
  }
})

test('approval cutoff blocks both draft saves and submissions, including concurrent approval', async () => {
  for (const options of [{ selection: null }, { approved: true }, { approved: true, submit: false }, { approvedAtLock: true }, { phase: 'archive' }, { phase: 'archive', submit: false }]) {
    const fixture = submission(options)
    assert.equal((await fixture.run()).ok, false)
    assert.equal(fixture.writes.length, 0)
  }
})
