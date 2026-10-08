import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function setup(topics) {
  const source = readFileSync(new URL('../src/views/admin/StudentStatus.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'student-status' }).content
  const code = ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }
  const dependencies = {
    vue: { ...require('vue'), onMounted() {} },
    '@/api': {}, '@/utils/volunteerRules': {},
  }
  new Function('require', 'module', 'exports', code)(name => dependencies[name] || require(name), module, module.exports)
  const state = module.exports.default.setup({}, { expose() {} })
  state.overview.value = { cycle: { phase: 'adjustment' }, teacherLimit: 15, topics }
  return state
}
const topic = { id: 't1', title: '可补录课题', major: '视觉传达设计', major_code: '130502', status: 'published', max_students: 3, accepted_count: 1, teacher_accepted_count: 10 }
test('首轮已申报的有空位课题仍可推荐补录', () => {
  const state = setup([topic])
  assert.equal(state.suggestedTopics({ major: topic.major, major_code: topic.major_code, applied_topic_ids: 't1' }), topic.title)
})
test('同专业代码名称不同仍推荐，其他专业不混入', () => {
  const state = setup([topic])
  assert.equal(state.suggestedTopics({ major: '视觉传达', major_code: '130502' }), topic.title)
  assert.equal(state.suggestedTopics({ major: topic.major, major_code: '130503' }), '暂无同专业空余课题')
})
test('课题满额或教师达到上限不推荐', () => {
  for (const row of [{ ...topic, accepted_count: 3 }, { ...topic, teacher_accepted_count: 15 }]) {
    assert.equal(setup([row]).suggestedTopics({ major: topic.major, major_code: topic.major_code }), '暂无同专业空余课题')
  }
})
