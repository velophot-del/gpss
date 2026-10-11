import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url))
const admin = { id: 'admin', role: 'admin' }
const student = { id: 'student', role: 'student' }
const future = new Date(Date.now() + 86400000).toISOString()
function harness(overrides = {}) {
  let state = {
    cycle: { id: 1, status: 'active', phase: 'adjustment', phases_config: { adjustment: { end: future } } },
    settlements: [{ id: 'settled-1', cycle_id: 1, status: 'completed', result_json: { accepted: 26, unmatchedStudents: 4 } }],
    volunteers: [{ id: 'v', student_id: 'student', topic_id: 'topic', status: 'rejected', version: 1 }],
    batches: [{ id: 'b' }], draftItems: [{ id: 'd' }], archives: [], logs: [],
    topics: [{ id: 'topic', status: 'published', cycle_id: 1, teacher_id: 'teacher', major_code: '130502', accepted_count: 0, teacher_accepted_count: 0, max_students: 5 }],
    applications: [{ id: 'locked', student_id: 'placed', status: 'accepted' }], ...overrides,
  }
  let snapshot
  const calls = []
  let failOn = '', denyLock = '', afterLock = null
  const conn = {
    release() { calls.push('release') },
    async beginTransaction() { snapshot = structuredClone(state) },
    async commit() { calls.push('commit') },
    async rollback() { state = snapshot; calls.push('rollback') },
    async query(sql, params = []) {
      sql = sql.trim()
      calls.push(sql)
      if (failOn && sql.includes(failOn)) throw new Error('injected failure')
      if (sql.includes('GET_LOCK')) {
        if (afterLock) { afterLock(); afterLock = null }
        return [[{ acquired: params[0] === denyLock ? 0 : 1 }]]
      }
      if (sql.includes('RELEASE_LOCK')) return [[]]
      if (sql.includes('FROM cycles')) return [[state.cycle]]
      if (sql.startsWith('SELECT') && sql.includes('FROM adjustment_settlements')) return [state.settlements]
      if (sql.includes('FROM selection_settlements')) return [[]]
      if (sql.startsWith('SELECT') && sql.includes('FROM adjustment_round_archives')) return [state.archives.slice(-1)]
      if (sql.startsWith('SELECT') && sql.includes('FROM adjustment_volunteers')) return [state.volunteers]
      if (sql.startsWith('SELECT') && sql.includes('FROM adjustment_batches')) return [state.batches]
      if (sql.startsWith('SELECT') && sql.includes('FROM adjustment_draft_items')) return [state.draftItems]
      if (sql.includes('FROM topics t LEFT JOIN') || sql.includes('FROM topics t JOIN users')) return [state.topics]
      if (sql.includes('FROM applications')) return [sql.includes("status = 'accepted'") ? state.applications.filter(a => a.student_id === params[0] && a.status === 'accepted') : [{ id: 'first' }]]
      if (sql.includes('FROM users')) return [[{ id: 'student', major_code: '130502' }]]
      if (sql.includes('INSERT INTO adjustment_round_archives')) state.archives.push({ id: params[0], snapshot_json: JSON.parse(params[3]) })
      else if (sql.includes('DELETE FROM adjustment_batches')) { state.batches = []; state.draftItems = [] }
      else if (sql.includes('DELETE FROM adjustment_volunteers')) state.volunteers = []
      else if (sql.includes('DELETE FROM adjustment_settlements')) state.settlements = []
      else if (sql.includes('INSERT INTO adjustment_volunteers')) state.volunteers.push({ id: params[0], student_id: params[2], topic_id: params[3], priority: params[4], motivation: params[5], version: params[6], status: 'submitted' })
      else if (sql.includes('INSERT INTO operation_logs')) state.logs.push(params)
      else if (sql.includes('INSERT INTO adjustment_settlements') || sql.includes('UPDATE adjustment_settlements')) throw new Error('unexpected settlement mutation')
      return [[]]
    },
  }
  const db = { getConnection: async () => conn, query: async (...args) => (await conn.query(...args))[0], transaction: async fn => {
    await conn.beginTransaction()
    try { const result = await fn(conn); await conn.commit(); return result } catch (e) { await conn.rollback(); throw e }
  } }
  const deps = {
    '../config/database.js': db,
    '../utils/json.js': { safeParseJson: (v, fallback) => typeof v === 'string' ? JSON.parse(v) : v ?? fallback },
    '../utils/policies.js': { getAdjustmentDeadline: config => config.adjustment?.end ? new Date(config.adjustment.end) : null, getTeacherStudentLimit: () => 15 },
    '../utils/adjustmentSettlement.js': { isAdjustmentSettlementDue: deadline => deadline.getTime() <= Date.now() },
    '../utils/majorCodes.js': { normalizeMajorCode: v => v, getMajorCodeAliases: v => [v] },
    '../utils/topicAccess.js': { getStudentMajorCode: async () => '130502' },
    '../utils/studentTopic.js': { getTeacherGroupKey: v => v, toStudentTopicView: v => v },
    './selectionMatcher.js': {}, uuid: serverRequire('uuid'),
  }
  function load(file) {
    const source = readFileSync(new URL(`../server/src/services/${file}.ts`, import.meta.url), 'utf8')
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const mod = { exports: {} }
    new Function('require', 'module', 'exports', code)(name => deps[name] ?? require(name), mod, mod.exports)
    return mod.exports
  }
  const settlement = load('adjustmentSettlementService')
  deps['./adjustmentSettlementService.js'] = settlement
  return { ...load('adjustmentReopenService'), ...load('adjustmentVolunteerService'), ...settlement, calls,
    state: () => state, fail: text => { failOn = text }, deny: name => { denyLock = name }, onLock: fn => { afterLock = fn },
  }
}
const input = { settlementId: 'settled-1', deadline: future, reason: '未录取学生再次填报' }
test('reopen archives all old rows atomically and retains formal admissions', async () => {
  const h = harness(); const before = structuredClone(h.state())
  const result = await h.reopenAdjustment(1, admin, input, null)
  assert.equal(h.state().archives[0].id, result.archiveId)
  assert.deepEqual(h.state().archives[0].snapshot_json, { settlement: before.settlements[0], volunteers: before.volunteers, batches: before.batches, draftItems: before.draftItems })
  assert.deepEqual(h.state().applications, before.applications)
  assert.deepEqual(h.state().volunteers, [])
  assert.deepEqual(h.state().settlements, [])
  assert.equal(h.state().logs.length, 1)
  await assert.rejects(h.reopenAdjustment(1, admin, input, null), /已重新开放/)
  assert.equal(h.state().archives.length, 1)
  const mine = await h.getMyAdjustmentVolunteers(student)
  assert.equal(mine.canEdit, true)
  assert.equal(mine.roundId, result.archiveId)
  assert.deepEqual(mine.items, [])
  const placed = await h.getMyAdjustmentVolunteers({ id: 'placed', role: 'student' })
  assert.equal(placed.canEdit, false)
  assert.match(placed.frozenReason, /已被录取/)
})
test('archive or audit failure rolls back the entire reopen', async () => {
  for (const sql of ['INSERT INTO adjustment_round_archives', 'INSERT INTO operation_logs']) {
    const h = harness(); const before = structuredClone(h.state()); h.fail(sql)
    await assert.rejects(h.reopenAdjustment(1, admin, input, null), /injected/)
    assert.deepEqual(h.state(), before)
    assert.ok(h.calls.includes('rollback'))
  }
})
test('reopen validates role, deadline, active cycle and exact settlement', async () => {
  for (const [overrides, actor, body] of [
    [{}, student, input], [{}, admin, { ...input, reason: ' ' }],
    [{}, admin, { ...input, deadline: 'changed' }], [{}, admin, { ...input, settlementId: 'stale' }],
    [{ cycle: { id: 1, status: 'completed', phase: 'adjustment' } }, admin, input],
    [{ cycle: { id: 1, status: 'active', phase: 'adjustment', phases_config: { adjustment: { end: '2000-01-01' } } } }, admin, input],
    [{ settlements: [{ id: 'settled-1', status: 'running' }] }, admin, input],
  ]) {
    const h = harness(overrides); const before = structuredClone(h.state())
    await assert.rejects(h.reopenAdjustment(1, actor, body, null))
    assert.deepEqual(h.state(), before)
  }
})
test('reopen cannot bypass either settlement lock and releases acquired locks', async () => {
  const h = harness(); h.deny('gpss:adjustment-settlement:1')
  await assert.rejects(h.reopenAdjustment(1, admin, input, null), /正在执行/)
  assert.equal(h.state().archives.length, 0)
  assert.ok(h.calls.some(sql => sql.includes('RELEASE_LOCK')))
  assert.equal(h.calls.at(-1), 'release')
})
test('old student round is rejected even if volunteer versions happen to match', async () => {
  const h = harness({ settlements: [], volunteers: [], archives: [{ id: 'new-round' }] })
  for (const oldRound of [null, 'old-round']) {
    await assert.rejects(h.saveMyAdjustmentVolunteers(student, 0, [{ topicId: 'topic' }], oldRound), /轮次已变化/)
  }
  assert.ok(!h.calls.some(sql => sql.startsWith('DELETE')))
})
test('settlement request captured before reopening cannot run the new round', async () => {
  const h = harness({ settlements: [], archives: [{ id: 'old-round' }], cycle: { id: 1, phase: 'adjustment', phases_config: { adjustment: { end: '2000-01-01' } } } })
  h.onLock(() => h.state().archives.push({ id: 'new-round' }))
  await assert.rejects(h.requestAdjustmentSettlementIfReady(1, 'deadline'), /轮次已变化/)
  assert.ok(!h.calls.some(sql => sql.startsWith('INSERT') || sql.startsWith('UPDATE')))
})
test('deadline extended while request was queued causes no failed settlement marker', async () => {
  const h = harness({ settlements: [], cycle: { id: 1, phase: 'adjustment', phases_config: { adjustment: { end: '2000-01-01' } } } })
  h.onLock(() => { h.state().cycle.phases_config.adjustment.end = future })
  await assert.rejects(h.requestAdjustmentSettlementIfReady(1, 'deadline'), /尚未到/)
  assert.ok(!h.calls.some(sql => sql.startsWith('INSERT') || sql.startsWith('UPDATE')))
})

test('new round accepts a fresh submission and rejects already admitted students', async () => {
  const h = harness({ settlements: [], volunteers: [], archives: [{ id: 'new-round' }] })
  const before = structuredClone(h.state().applications)
  const result = await h.saveMyAdjustmentVolunteers(student, 0, [{ topicId: 'topic', motivation: '新一轮选择' }], 'new-round')
  assert.equal(result.roundId, 'new-round')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].status, 'submitted')
  assert.equal(result.version, 1)
  await assert.rejects(h.saveMyAdjustmentVolunteers({ id: 'placed', role: 'student' }, 0, [{ topicId: 'topic' }], 'new-round'), /已被.*录取/)
  assert.deepEqual(h.state().applications, before)
})
