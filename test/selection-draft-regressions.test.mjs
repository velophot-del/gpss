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
  const conn = { query: async (sql, params) => {
    if (sql.includes('FROM topics t JOIN cycles')) return [[topic]]
    if (sql.includes('SELECT * FROM selection_batches')) return [[{ id: 'b', version: 0, status: 'draft' }]]
    if (sql.includes('SELECT id FROM applications')) return [params[1].map(id => ({ id }))]
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
test('修改完整候选名单后正常重排且兼容旧间隔排名', async () => {
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
  assert.equal(store.drafts.t.applications[1].decisionRank, 1)
  await store.save('t')
  assert.equal(saved.items[1].decisionRank, 1)
  // Old saved drafts can contain gaps; they remain valid after the rule change.
  const source = readFileSync(new URL('../server/src/services/selectionDraftService.ts', import.meta.url), 'utf8')
  const validator = source.slice(source.indexOf('function validateRanks'), source.indexOf('async function validateDraftItems'))
  const code = ts.transpileModule(validator, {}).outputText
  const validate = new Function('SelectionDraftError', `${code}; return validateRanks`)(Error)
  assert.doesNotThrow(() => validate(saved.items))
  assert.doesNotThrow(() => validate([{ applicationId: 'gap', decision: 'reserve', decisionRank: 2 }]))
  assert.throws(() => validate([{ applicationId: 'x', decision: 'proposed', decisionRank: 0 }]))
  assert.throws(() => validate([{ applicationId: 'x', decision: 'proposed', decisionRank: 2 }, { applicationId: 'y', decision: 'proposed', decisionRank: 2 }]))
})
test('结算错误不撤销已完成的提交，并返回独立警告', async () => {
  const view = await service({ failSettlement: true }).submitSelectionBatch('t', { id: 'teacher', role: 'teacher' }, 0)
  assert.equal(view.batch.status, 'submitted')
  assert.match(view.settlementWarning, /结算/)
})

const { buildSettlementPlan } = load('../server/src/services/selectionMatcher.ts', {})
const candidate = (id, studentId, topicId, priority, decision = 'reserve', decisionRank = 1) => ({ applicationId: id, studentId, topicId, teacherId: topicId, priority, decision, decisionRank, appliedAt: '2026-10-03T00:00:00Z' })
const settle = (candidates, topics, extra = {}) => buildSettlementPlan({ candidates, topics: topics.map(([topicId, capacity]) => ({ topicId, teacherId: topicId, capacity })), lockedAssignments: [], teacherLimit: 10, ...extra })
test('第一志愿候补先于第二志愿拟录取', () => {
 const result = settle([candidate('first','s1','A',1),candidate('second','s2','A',2,'proposed')],[['A',1]])
 assert.deepEqual(result.acceptedApplicationIds,['first'])
})
test('三名优先候选被更高志愿录取后自动递补三名剩余候选', () => {
 const candidates=[]
 for(let i=1;i<=3;i++) { candidates.push(candidate('high'+i,'s'+i,'H',1,'proposed',i),candidate('low'+i,'s'+i,'A',2,'proposed',i),candidate('backup'+i,'b'+i,'A',3,'reserve',i)) }
 const result=settle(candidates,[['A',3],['H',3]])
 assert.equal(result.topicAcceptedCounts.A,3)
 assert.deepEqual(result.acceptedApplicationIds,['backup1','backup2','backup3','high1','high2','high3'])
})
test('高志愿因名额不足未录取仍可自动进入低志愿', () => {
 const result=settle([candidate('h1','s1','H',1,'proposed',1),candidate('h2','s2','H',1,'proposed',2),candidate('low','s2','A',2)],[['H',1],['A',1]])
 assert.deepEqual(result.acceptedApplicationIds,['h1','low'])
})
test('保持已有录取并排除未处理和拒绝，允许递补到第六志愿', () => {
 const result=settle([candidate('locked-low','locked','A',1),candidate('none','s1','A',1,null),candidate('reject','s2','A',1,'reject'),candidate('six','s3','A',6)],[['A',2]],{lockedAssignments:[{applicationId:'existing',studentId:'locked',topicId:'A',teacherId:'A'}]})
 assert.deepEqual(result.acceptedApplicationIds,['six'])
 assert.equal(result.topicAcceptedCounts.A,2)
})
test('低志愿可提前审核，候选接收意见不占正式名额', async () => {
 const {createPinia,setActivePinia}=require('pinia');setActivePinia(createPinia())
 const {useSelectionDraftStore}=load('../src/stores/selectionDraft.ts',{'../api':{selectionDraftApi:{}}})
 const store=useSelectionDraftStore();store.drafts.t={batch:{version:0},applications:[{id:'low',blockedByHigherPriority:true,decision:null}]}
 store.setDecision('t','low','reserve')
 assert.equal(store.drafts.t.applications[0].decision,'reserve')
})

test('保存超过招生名额的完整接收名单，候补无需等待高志愿教师', async () => {
 const items = Array.from({length: 7},(_,i)=>({applicationId:'a'+i,decision:'proposed',decisionRank:i+1}))
 await assert.doesNotReject(()=>service().saveSelectionDraft('t',{id:'teacher',role:'teacher'},0,items))
})
test('同志愿按教师决定和排序择优，教师共享上限不可超出且输入顺序不影响结果', () => {
 const candidates=[candidate('b','s2','A',1,'reserve',1),candidate('a','s1','A',1,'proposed',2),candidate('c','s3','A',1,'proposed',1)]
 const result=settle(candidates,[['A',2]])
 assert.deepEqual(result.acceptedApplicationIds,['a','c'])
 assert.deepEqual(settle([...candidates].reverse(),[['A',2]]),result)
 const shared=settle([candidate('x','s1','A',1),{...candidate('y','s2','B',2),teacherId:'A'}],[['A',2]],{topics:[{topicId:'A',teacherId:'A',capacity:2},{topicId:'B',teacherId:'A',capacity:2}],teacherLimit:1})
 assert.deepEqual(shared.acceptedApplicationIds,['x'])
})
