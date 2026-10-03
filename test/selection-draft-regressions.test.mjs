import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function load(path, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => dependencies[name] ?? require(name), module, module.exports)
  return module.exports
}
const deadline = new Date(Date.now() + 86400000).toISOString()
const topic = { id: 't', teacher_id: 'teacher', cycle_id: 1, max_students: 5, topic_status: 'published', phase: 'teacher_review', phases_config: '{}' }
const policies = { getReviewDeadline: () => new Date(deadline), getTeacherStudentLimit: () => 0 }
function service({ failSettlement = false } = {}) {
  const conn = { query: async sql => {
    if (sql.includes('FROM topics t JOIN cycles')) return [[topic]]
    if (sql.includes('SELECT * FROM selection_batches')) return [[{ id: 'b', version: 0, status: 'draft' }]]
    if (sql.includes('COUNT(DISTINCT student_id)')) return [[{ cnt: 0 }]]
    return [[]]
  } }
  return load('../server/src/services/selectionDraftService.ts', {
    '../config/database.js': { transaction: fn => fn(conn), query: async sql => {
      if (sql.includes('FROM topics t LEFT JOIN cycles')) return [topic]
      if (sql.includes('AS accepted_count')) return [{ accepted_count: 3, proposed_count: 2 }]
      if (sql.includes('SELECT * FROM selection_batches')) return [{ id: 'b', status: 'submitted', version: 1 }]
      return []
    } },
    uuid: createRequire(new URL('../server/package.json', import.meta.url))('uuid'),
    '../utils/policies.js': policies,
    '../utils/json.js': { safeParseJson: () => ({}) },
    './selectionPriorityService.js': { buildPriorityBlocks: () => new Map() },
    './selectionSettlementService.js': { requestSettlementIfReady: async () => { if (failSettlement) throw new Error('结算暂不可用') } },
  })
}
test('草稿返回数据库中的教师人数', async () => {
  const view = await service().getSelectionDraft('t', { id: 'teacher', role: 'teacher' })
  assert.equal(view.teacherAcceptedCount, 3)
  assert.equal(view.teacherProposedCount, 2)
})
test('修改普通名单保留暂停学生的顺序号并可保存间隔排名', async () => {
  const { createPinia, setActivePinia } = require('pinia')
  setActivePinia(createPinia())
  let saved
  const { useSelectionDraftStore } = load('../src/stores/selectionDraft.ts', { '../api': { selectionDraftApi: { save: async (_, data) => { saved = data; return { data: {} } } } } })
  const store = useSelectionDraftStore()
  store.drafts.t = { batch: { version: 0 }, applications: [
    { id: 'a', decision: 'proposed', decisionRank: 1 },
    { id: 'b', decision: 'proposed', decisionRank: 2, blockedByHigherPriority: true },
  ] }
  store.setDecision('t', 'a', 'reject')
  assert.equal(store.drafts.t.applications[1].decisionRank, 2)
  await store.save('t')
  assert.equal(saved.items[1].decisionRank, 2)
  // Exercise the actual rank validator with the preserved gap.
  const source = readFileSync(new URL('../server/src/services/selectionDraftService.ts', import.meta.url), 'utf8')
  const validator = source.slice(source.indexOf('function validateRanks'), source.indexOf('async function loadPriorityCandidates'))
  const code = ts.transpileModule(validator, {}).outputText
  const validate = new Function('SelectionDraftError', `${code}; return validateRanks`)(Error)
  assert.doesNotThrow(() => validate(saved.items))
  assert.throws(() => validate([{ applicationId: 'x', decision: 'proposed', decisionRank: 0 }]))
  assert.throws(() => validate([{ applicationId: 'x', decision: 'proposed', decisionRank: 2 }, { applicationId: 'y', decision: 'proposed', decisionRank: 2 }]))
})
test('结算错误不撤销已完成的提交，并返回独立警告', async () => {
  const view = await service({ failSettlement: true }).submitSelectionBatch('t', { id: 'teacher', role: 'teacher' }, 0)
  assert.equal(view.batch.status, 'submitted')
  assert.match(view.settlementWarning, /结算/)
})
