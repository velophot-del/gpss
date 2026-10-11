import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url))
const majorCodes = await import('../server/dist/utils/majorCodes.js')
const majors = await import('../server/dist/utils/majors.js')
const topicAccess = await import('../server/dist/utils/topicAccess.js')

const PACKAGING_TOPIC = { id: 'pack', title: '包装结构设计', major_code: '081702', major: '包装工程', status: 'published', max_students: 3, accepted_count: 0, teacher_accepted_count: 0 }
const VISUAL_TOPIC = { id: 'visual', title: '品牌视觉设计', major_code: '130502', major: '视觉传达设计', status: 'published', max_students: 3, accepted_count: 0, teacher_accepted_count: 0 }

// 名册导入后专业代码会丢前导零、专业名称会带方向后缀，课题侧则按周期配置写标准代码/名称。
function volunteerService({ student = { major_code: '81702', major: '包装工程(理)' }, topics = [PACKAGING_TOPIC, VISUAL_TOPIC] } = {}) {
  const cycle = { id: 1, status: 'adjustment', phase: 'adjustment', phases_config: { adjustment: { end: new Date(Date.now() + 86400000).toISOString() } } }
  const conn = {
    release() {},
    async query(sql) {
      if (sql.includes('SELECT * FROM cycles')) return [[cycle]]
      if (sql.includes('SELECT major_code')) return [[student]]
      if (sql.includes('SELECT phases_config')) return [[cycle]]
      if (sql.includes('FROM applications a JOIN topics') && sql.includes('a.student_id')) {
        return [sql.includes("a.status = 'accepted'") ? [] : [{ id: 'first' }]]
      }
      if (sql.includes('FROM topics t JOIN users')) return [topics]
      return [[]]
    },
  }
  const db = { getConnection: async () => conn, transaction: fn => fn(conn), query: async () => [cycle] }
  const source = readFileSync(new URL('../server/src/services/adjustmentVolunteerService.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  const deps = {
    '../config/database.js': db,
    uuid: serverRequire('uuid'),
    '../utils/policies.js': { getAdjustmentDeadline: () => new Date(Date.now() + 86400000), getTeacherStudentLimit: () => 0 },
    '../utils/topicAccess.js': { getStudentMajorCode: async () => majorCodes.normalizeMajorCode(student.major_code, student.major) },
    '../utils/json.js': { safeParseJson: () => ({}) },
    '../utils/studentTopic.js': { toStudentTopicView: x => x, getTeacherGroupKey: x => x },
    '../utils/majorCodes.js': majorCodes,
  }
  new Function('require', 'module', 'exports', code)(name => deps[name] ?? require(name), module, module.exports)
  return module.exports
}

test('名册专业代码丢前导零时补录课题仍按专业匹配', async () => {
  const topics = (await volunteerService().getEligibleAdjustmentTopics({ id: 's', role: 'student' })).topics
  assert.deepEqual(topics.map(topic => topic.id), ['pack'])
})

test('名册专业名称带方向后缀时补录课题仍按专业匹配', async () => {
  const service = volunteerService({ student: { major_code: '081702', major: '包装工程（理）' } })
  assert.deepEqual((await service.getEligibleAdjustmentTopics({ id: 's', role: 'student' })).topics.map(t => t.id), ['pack'])
})

test('代码规范的学生只看到本专业课题，其他专业不混入', async () => {
  const service = volunteerService({ student: { major_code: '130502', major: '视觉传达设计' } })
  assert.deepEqual((await service.getEligibleAdjustmentTopics({ id: 's', role: 'student' })).topics.map(t => t.id), ['visual'])
})

test('智能交互历史代码与现行代码视为同一专业', () => {
  assert.equal(majorCodes.isSameMajor({ majorCode: '080906T', major: '智能交互（工科）' }, { majorCode: '080218T', major: '智能交互设计' }), true)
  assert.equal(majorCodes.isSameMajor({ majorCode: '080922T', major: '' }, { majorCode: '080906T', major: '' }), true)
})

test('课题只填了带方向后缀的专业名称时按名称兜底，不同专业不匹配', () => {
  assert.equal(majorCodes.isSameMajor({ majorCode: '130502', major: '视觉传达设计' }, { majorCode: '', major: '视觉传达设计（印刷设计）' }), true)
  assert.equal(majorCodes.isSameMajor({ majorCode: '81702', major: '包装工程(理)' }, { majorCode: '081702', major: '包装工程' }), true)
  assert.equal(majorCodes.isSameMajor({ majorCode: '81702', major: '包装工程(理)' }, { majorCode: '130502', major: '视觉传达设计' }), false)
  assert.equal(majorCodes.isSameMajor({ majorCode: '', major: '' }, { majorCode: '', major: '' }), false)
  assert.equal(majorCodes.isSameMajor({ majorCode: '130502', major: '视觉传达设计' }, { majorCode: '130508', major: '数字媒体艺术（交互方向）' }), false)
})

test('可选专业把名册写法归到周期专业，未识别的专业不放开可见范围', () => {
  const policy = { mode: 'same_major', matrix: {} }
  const cycleMajors = majors.DEFAULT_MAJORS
  assert.deepEqual(majors.getAllowedMajorOptions(policy, cycleMajors, '81702', '包装工程(理)').map(m => m.code), ['081702'])
  assert.deepEqual(majors.getAllowedMajorOptions(policy, cycleMajors, '130502', '视觉传达设计（印刷设计）').map(m => m.code), ['130502'])
  assert.deepEqual(majors.getAllowedMajorOptions(policy, cycleMajors, '999999', '未知专业').map(m => m.code), [])
  assert.equal(majors.resolveCycleMajorCode(cycleMajors, '080930T', '智能交互设计'), '080218T')
})

test('查看选题规则与课题可见性对同一专业的不同写法一致', () => {
  const policy = { mode: 'same_major', matrix: {} }
  assert.equal(topicAccess.isTopicVisible(policy, '81702', '081702', '包装工程(理)', '包装工程'), true)
  assert.equal(topicAccess.isTopicVisible(policy, '81702', '130502', '包装工程(理)', '视觉传达设计'), false)
  assert.equal(topicAccess.isTopicVisible(policy, '', '081702', '包装工程(理)', '包装工程'), true)
  assert.equal(topicAccess.isTopicVisible(policy, '81702', '', '', ''), false)
})
