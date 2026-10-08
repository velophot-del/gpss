import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url))
function service(teacherCount = 15, limit = 15, topicCount = 3) {
  const cycle = { id: 1, phase: 'adjustment', phases_config: '{}' }
  const topics = Array.from({ length: topicCount }, (_, index) => index + 1).map(id => ({ id: String(id), teacher_id: id === 3 ? 'b' : 'a', cycle_id: 1, major_code: '130502', status: 'published', max_students: 3, accepted_count: 1, teacher_accepted_count: id === 3 ? 0 : teacherCount }))
  let deleted = false
  const conn = { release() {}, async query(sql) {
    if (sql.includes('SELECT * FROM cycles')) return [[cycle]]
    if (sql.includes('SELECT major_code')) return [[{ major_code: '130502' }]]
    if (sql.includes('FROM applications a JOIN topics') && sql.includes('a.student_id')) return [sql.includes("a.status = 'accepted'") ? [] : [{ id: 'first' }]]
    if (sql.includes('SELECT phases_config')) return [[cycle]]
    if (sql.includes('FROM topics t JOIN users')) return [topics]
    if (sql.includes('FROM topics t LEFT JOIN')) return [topics]
    if (sql.includes('DELETE FROM')) deleted = true
    return [[]]
  } }
  const db = { getConnection: async () => conn, transaction: fn => fn(conn), query: async sql => sql.includes('SELECT * FROM cycles') ? [cycle] : [] }
  const source = readFileSync(new URL('../server/src/services/adjustmentVolunteerService.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const deps = { '../config/database.js': db, uuid: serverRequire('uuid'), '../utils/policies.js': { getAdjustmentDeadline: () => new Date(Date.now()+86400000), getTeacherStudentLimit: () => limit }, '../utils/topicAccess.js': { getStudentMajorCode: async () => '130502' }, '../utils/json.js': { safeParseJson: () => ({}) }, '../utils/studentTopic.js': { toStudentTopicView: x => x, getTeacherGroupKey: x => x }, '../utils/majorCodes.js': serverRequire('./dist/utils/majorCodes.js') }
  new Function('require','module','exports',code)(name => deps[name] ?? require(name),module,module.exports)
  return { ...module.exports, deleted: () => deleted }
}
const actor = { id: 's', role: 'student' }
test('教师满额时隐藏其所有课题，未满额教师仍展示', async () => {
  assert.deepEqual((await service().getEligibleAdjustmentTopics(actor)).topics.map(x=>x.id), ['3'])
})
test('教师未满额时全部展示，不因首轮申报或方向限制', async () => {
  assert.equal((await service(14).getEligibleAdjustmentTopics(actor)).topics.length,3)
  assert.equal((await service(100,0).getEligibleAdjustmentTopics(actor)).topics.length,3)
})
test('提交时教师已满额则拒绝，且保留原志愿', async () => {
  const s = service()
  await assert.rejects(s.saveMyAdjustmentVolunteers(actor,0,[1,2,3].map(id=>({topicId:String(id)}))), /教师.*满|教师.*上限/)
  assert.equal(s.deleted(),false)
})
test('教师仍有余量时允许保存全部所选志愿', async () => {
  const s = service(14)
  await s.saveMyAdjustmentVolunteers(actor,0,[1,2,3].map(id=>({topicId:String(id)})))
  assert.equal(s.deleted(),true)
})

test('补录允许保存一个志愿，也允许只覆盖一位教师的志愿', async () => {
  const s = service(14)
  await s.saveMyAdjustmentVolunteers(actor,0,[{topicId:'1'}])
  assert.equal(s.deleted(),true)
})

test('补录允许保存六个志愿', async () => {
  const s = service(14,15,6)
  await s.saveMyAdjustmentVolunteers(actor,0,Array.from({length:6},(_,index)=>({topicId:String(index+1)})))
  assert.equal(s.deleted(),true)
})

test('补录拒绝空志愿和超过六项且不覆盖原志愿', async () => {
  for (const count of [0,7]) {
    const s = service(14,15,7)
    await assert.rejects(s.saveMyAdjustmentVolunteers(actor,0,Array.from({length:count},(_,index)=>({topicId:String(index+1)}))), /1–6/)
    assert.equal(s.deleted(),false)
  }
})
