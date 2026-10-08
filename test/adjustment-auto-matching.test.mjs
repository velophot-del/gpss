import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { buildAdjustmentMatchingPlan } from '../server/dist/services/selectionMatcher.js'
import { isAdjustmentSettlementDue } from '../server/dist/utils/adjustmentSettlement.js'

const require = createRequire(import.meta.url)
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url))

const cycleId = 88
function lottery(teacherId, studentId) {
  return createHash('sha256').update(`${cycleId}:${teacherId}:${studentId}`).digest('hex')
}
function rankedStudents(teacherId, studentIds) {
  return [...studentIds].sort((a, b) => lottery(teacherId, a).localeCompare(lottery(teacherId, b)))
}
function match({ volunteers, topics, lockedAssignments = [], teacherLimit = 0 }) {
  return buildAdjustmentMatchingPlan({ cycleId, volunteers, topics, lockedAssignments, teacherLimit })
}

test('student receives their highest-ranked available adjustment topic', () => {
  const result = match({
    volunteers: [
      { applicationId: 's1-a', studentId: 's1', topicId: 'a', teacherId: 'ta', priority: 1 },
      { applicationId: 's1-b', studentId: 's1', topicId: 'b', teacherId: 'tb', priority: 2 },
    ],
    topics: [
      { topicId: 'a', teacherId: 'ta', capacity: 1 },
      { topicId: 'b', teacherId: 'tb', capacity: 1 },
    ],
  })

  assert.deepEqual(result.acceptedApplicationIds, ['s1-a'])
  assert.deepEqual(result.withdrawnApplicationIds, ['s1-b'])
  assert.deepEqual(result.unmatchedStudentIds, [])
})

test('student rejected by a full higher choice advances to the next preference', () => {
  const [winner, loser] = rankedStudents('ta', ['s1', 's2'])
  const result = match({
    volunteers: [
      { applicationId: `${winner}-a`, studentId: winner, topicId: 'a', teacherId: 'ta', priority: 1 },
      { applicationId: `${loser}-a`, studentId: loser, topicId: 'a', teacherId: 'ta', priority: 1 },
      { applicationId: `${loser}-b`, studentId: loser, topicId: 'b', teacherId: 'tb', priority: 2 },
    ],
    topics: [
      { topicId: 'a', teacherId: 'ta', capacity: 1 },
      { topicId: 'b', teacherId: 'tb', capacity: 1 },
    ],
  })

  assert.deepEqual(result.acceptedApplicationIds.sort(), [`${winner}-a`, `${loser}-b`].sort())
  assert.deepEqual(result.unmatchedStudentIds, [])
})

test('one deterministic teacher lottery ranks applicants competing for a topic', () => {
  const [winner, loser] = rankedStudents('ta', ['s1', 's2'])
  const result = match({
    volunteers: [
      { applicationId: `${loser}-a`, studentId: loser, topicId: 'a', teacherId: 'ta', priority: 1 },
      { applicationId: `${winner}-a`, studentId: winner, topicId: 'a', teacherId: 'ta', priority: 1 },
    ],
    topics: [{ topicId: 'a', teacherId: 'ta', capacity: 1 }],
  })

  assert.deepEqual(result.acceptedApplicationIds, [`${winner}-a`])
  assert.deepEqual(result.unmatchedStudentIds, [loser])
})

test('teacher aggregate limit applies across topics and rejected candidates continue to another teacher', () => {
  const [winner, loser] = rankedStudents('ta', ['s1', 's2'])
  const result = match({
    volunteers: [
      { applicationId: `${winner}-a`, studentId: winner, topicId: 'a', teacherId: 'ta', priority: 1 },
      { applicationId: `${loser}-b`, studentId: loser, topicId: 'b', teacherId: 'ta', priority: 1 },
      { applicationId: `${loser}-c`, studentId: loser, topicId: 'c', teacherId: 'tc', priority: 2 },
    ],
    topics: [
      { topicId: 'a', teacherId: 'ta', capacity: 1 },
      { topicId: 'b', teacherId: 'ta', capacity: 1 },
      { topicId: 'c', teacherId: 'tc', capacity: 1 },
    ],
    teacherLimit: 1,
  })

  assert.deepEqual(result.acceptedApplicationIds.sort(), [`${winner}-a`, `${loser}-c`].sort())
  assert.equal(result.topicAcceptedCounts.a + result.topicAcceptedCounts.b, 1)
  assert.deepEqual(result.unmatchedStudentIds, [])
})

test('displaced student applies to the next choice and released seats stay within capacity', () => {
  const [winner, displaced] = rankedStudents('tx', ['s1', 's2'])
  const result = match({
    volunteers: [
      { applicationId: `${displaced}-x`, studentId: displaced, topicId: 'x', teacherId: 'tx', priority: 1 },
      { applicationId: `${displaced}-y`, studentId: displaced, topicId: 'y', teacherId: 'ty', priority: 2 },
      { applicationId: `${winner}-z`, studentId: winner, topicId: 'z', teacherId: 'tz', priority: 1 },
      { applicationId: `${winner}-x`, studentId: winner, topicId: 'x', teacherId: 'tx', priority: 2 },
    ],
    topics: [
      { topicId: 'x', teacherId: 'tx', capacity: 1 },
      { topicId: 'y', teacherId: 'ty', capacity: 1 },
      { topicId: 'z', teacherId: 'tz', capacity: 0 },
    ],
  })

  assert.deepEqual(result.acceptedApplicationIds.sort(), [`${winner}-x`, `${displaced}-y`].sort())
  assert.deepEqual(result.unmatchedStudentIds, [])
  assert.equal(result.topicAcceptedCounts.x, 1)
})

test('existing accepted students remain locked and consume topic and teacher capacity', () => {
  const result = match({
    volunteers: [
      { applicationId: 's1-a', studentId: 's1', topicId: 'a', teacherId: 'ta', priority: 1 },
      { applicationId: 's2-b', studentId: 's2', topicId: 'b', teacherId: 'ta', priority: 1 },
    ],
    topics: [
      { topicId: 'a', teacherId: 'ta', capacity: 2 },
      { topicId: 'b', teacherId: 'ta', capacity: 2 },
    ],
    lockedAssignments: [{ applicationId: 'locked', studentId: 's1', topicId: 'a', teacherId: 'ta' }],
    teacherLimit: 1,
  })

  assert.deepEqual(result.acceptedApplicationIds, [])
  assert.deepEqual(result.withdrawnApplicationIds, ['s1-a'])
  assert.deepEqual(result.rejectedApplicationIds, ['s2-b'])
  assert.deepEqual(result.unmatchedStudentIds, ['s2'])
  assert.equal(result.topicAcceptedCounts.a, 1)
  assert.equal(result.topicAcceptedCounts.b, 0)
})

test('matching output is stable when volunteer and topic input order changes', () => {
  const volunteers = [
    { applicationId: 's1-a', studentId: 's1', topicId: 'a', teacherId: 'ta', priority: 1 },
    { applicationId: 's2-a', studentId: 's2', topicId: 'a', teacherId: 'ta', priority: 1 },
    { applicationId: 's2-b', studentId: 's2', topicId: 'b', teacherId: 'tb', priority: 2 },
  ]
  const topics = [
    { topicId: 'a', teacherId: 'ta', capacity: 1 },
    { topicId: 'b', teacherId: 'tb', capacity: 1 },
  ]
  const first = match({ volunteers, topics })
  const shuffled = match({ volunteers: [...volunteers].reverse(), topics: [...topics].reverse() })

  assert.deepEqual(shuffled, first)
  assert.match(first.lotteryVersion, /^sha256-teacher-priority-v\d+$/)
})

test('deadline comparison keeps adjustment open before the boundary and closes it exactly at the boundary', () => {
  const deadline = new Date('2026-10-08T12:00:00Z')

  assert.equal(isAdjustmentSettlementDue(deadline, deadline.getTime() - 1), false)
  assert.equal(isAdjustmentSettlementDue(deadline, deadline.getTime()), true)
  assert.equal(isAdjustmentSettlementDue(deadline, deadline.getTime() + 1), true)
})

test('adjustment deadline is the only normal settlement trigger regardless of volunteer progress', async () => {
  const service = readFileSync(new URL('../server/src/services/adjustmentSettlementService.ts', import.meta.url), 'utf8')

  assert.match(service, /if \(!isAdjustmentSettlementDue\(deadline\)\) return \{ status: 'waiting' \}/)
  assert.doesNotMatch(service, /countProgress|pending_topics|all_submitted/)
})

test('pre-deadline progress never starts the adjustment settlement', async () => {
  const deadline = new Date(Date.now() + 60_000)
  const cycle = { id: cycleId, phase: 'adjustment', phases_config: '{}' }
  let settlementStarted = false
  const database = {
    query: async () => [cycle],
    getConnection: async () => { settlementStarted = true; throw new Error('settlement must wait for deadline') },
    transaction: async () => { throw new Error('settlement must wait for deadline') },
  }
  const source = readFileSync(new URL('../server/src/services/adjustmentSettlementService.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const dependencies = {
    '../config/database.js': database,
    '../utils/json.js': { safeParseJson: () => ({}) },
    '../utils/policies.js': { getAdjustmentDeadline: () => deadline, getTeacherStudentLimit: () => 0 },
    '../utils/adjustmentSettlement.js': serverRequire('./dist/utils/adjustmentSettlement.js'),
    './selectionMatcher.js': serverRequire('./dist/services/selectionMatcher.js'),
    uuid: serverRequire('uuid'),
  }
  new Function('require', 'module', 'exports', code)(name => dependencies[name] ?? require(name), module, module.exports)

  assert.deepEqual(await module.exports.requestAdjustmentSettlementIfReady(cycleId, 'deadline'), { status: 'waiting' })
  assert.equal(settlementStarted, false)
})

test('empty adjustment cycle produces a complete zero-placement matching plan', () => {
  assert.deepEqual(match({ volunteers: [], topics: [] }), {
    acceptedApplicationIds: [], withdrawnApplicationIds: [], rejectedApplicationIds: [],
    unmatchedStudentIds: [], topicAcceptedCounts: {}, lotteryVersion: 'sha256-teacher-priority-v1',
  })
})

test('deadline settlement writes the automatic match and avoids teacher draft tables', async () => {
  const deadline = new Date(0)
  const cycle = { id: cycleId, phase: 'adjustment', phases_config: '{}' }
  const topics = [{ id: 'a', title: 'Topic A', teacher_id: 'ta', max_students: 1, status: 'published', accepted_count: 0 }]
  const volunteers = [{ id: 'v1', student_id: 's1', topic_id: 'a', priority: 1, teacher_id: 'ta', motivation: '首选' }]
  const calls = []
  const connection = {
    release() {},
    async query(sql, params) {
      calls.push({ sql, params })
      if (sql.includes('SELECT id, phase, phases_config FROM cycles')) return [[cycle]]
      if (sql.includes('FROM topics t WHERE t.cycle_id')) return [topics]
      if (sql.includes('FROM applications a JOIN topics t')) return [[]]
      if (sql.includes('FROM adjustment_volunteers av JOIN topics t')) return [volunteers]
      if (sql.includes("FROM users WHERE role = 'admin'")) return [[{ id: 'admin' }]]
      return [[]]
    },
  }
  const lockConnection = {
    release() {},
    async query(sql) {
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
      if (sql.includes('SELECT status, result_json')) return [[]]
      return [[]]
    },
  }
  const database = {
    query: async () => [cycle],
    getConnection: async () => lockConnection,
    transaction: async callback => callback(connection),
  }
  const source = readFileSync(new URL('../server/src/services/adjustmentSettlementService.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const dependencies = {
    '../config/database.js': database,
    '../utils/json.js': { safeParseJson: (value, fallback) => { try { return JSON.parse(value) } catch { return fallback } } },
    '../utils/policies.js': { getAdjustmentDeadline: () => deadline, getTeacherStudentLimit: () => 1 },
    '../utils/adjustmentSettlement.js': serverRequire('./dist/utils/adjustmentSettlement.js'),
    './selectionMatcher.js': serverRequire('./dist/services/selectionMatcher.js'),
    uuid: serverRequire('uuid'),
  }
  new Function('require', 'module', 'exports', code)(name => dependencies[name] ?? require(name), module, module.exports)

  const result = await module.exports.requestAdjustmentSettlementIfReady(cycleId, 'deadline')

  assert.equal(result.status, 'completed')
  assert.deepEqual(result.summary.accepted, 1)
  assert.equal(result.summary.lotteryVersion, 'sha256-teacher-priority-v1')
  assert.ok(calls.some(call => call.sql.includes("UPDATE adjustment_volunteers SET status = 'accepted'")))
  const formalApplicationWrite = calls.find(call => call.sql.includes('INSERT INTO applications'))
  assert.ok(formalApplicationWrite)
  assert.ok(formalApplicationWrite.params.includes('首选'))
  assert.ok(calls.some(call => call.sql.includes("role = 'admin'")))
  assert.ok(calls.every(call => !call.sql.includes('adjustment_draft_items') && !call.sql.includes('adjustment_batches')))
})

test('teacher adjustment mutations are retired and admin can only retry failed settlement', () => {
  const route = readFileSync(new URL('../server/src/routes/adjustmentVolunteers.ts', import.meta.url), 'utf8')
  const adminRoute = readFileSync(new URL('../server/src/routes/selectionAdmin.ts', import.meta.url), 'utf8')
  const layout = readFileSync(new URL('../src/layouts/MainLayout.vue', import.meta.url), 'utf8')
  const adminPage = readFileSync(new URL('../src/views/admin/AdjustmentSettlement.vue', import.meta.url), 'utf8')
  const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8')

  assert.match(route, /router\.put\('\/topics\/:topicId\/draft'.*?return error\(res, .*?, 410\)/s)
  assert.match(route, /router\.post\('\/topics\/:topicId\/submit'.*?return error\(res, .*?, 410\)/s)
  assert.doesNotMatch(layout, /teacher\/adjustment-review/)
  assert.match(adminRoute, /settlement\?\.status !== 'failed'/)
  assert.match(adminPage, /data\.settlement\?\.status === 'failed'/)
  assert.match(packageJson, /test\/adjustment-auto-matching\.test\.mjs/)
})
