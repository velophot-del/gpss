import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const vue = require('vue')
const source = readFileSync(new URL('../src/views/admin/ApplicationData.vue', import.meta.url), 'utf8')

function setupHarness({ adjustmentError = null } = {}) {
  const hooks = []
  const calls = []
  let applicationsReloads = 0
  const resultOptions = {
    cycle: { id: 4, name: '当前周期', phase: 'adjustment' },
    student: { id: 'student-1', name: '张三' },
    current: { applicationId: 'app-old', title: '原课题', teacherName: '导师甲', priority: 1 },
    canCancel: true,
    targets: [
      { applicationId: 'app-new', title: '目标课题', teacherName: '导师乙', priority: 2, acceptedCount: 1, topicLimit: 3, teacherAcceptedCount: 4, teacherLimit: 15, eligible: true },
      { applicationId: 'app-full', title: '满员课题', teacherName: '导师丙', priority: 3, acceptedCount: 3, topicLimit: 3, teacherAcceptedCount: 5, teacherLimit: 15, eligible: false, reason: '目标课题名额已满' },
    ],
  }
  const selectionAdminApi = {
    async getAcceptedResultOptions(id) { calls.push(['options', id]); return { data: resultOptions } },
    async adjustAcceptedResult(id, data) {
      calls.push(['adjust', id, data])
      if (adjustmentError) throw { response: { data: { message: adjustmentError } } }
      return { data: { message: '录取结果已调整' } }
    },
  }
  const adminApi = { async getAllApplications() {
    applicationsReloads++
    return { data: [
      { id: 'app-old', student_id: 'student-1', student_name: '张三', cycle_id: 4, status: 'accepted' },
      { id: 'old-cycle', student_id: 'student-2', student_name: '李四', cycle_id: 3, status: 'accepted' },
      { id: 'pending', student_id: 'student-3', student_name: '王五', cycle_id: 4, status: 'pending' },
    ] }
  } }
  const dependencies = {
    vue: { ...vue, onMounted: fn => hooks.push(fn) },
    '@element-plus/icons-vue': { Download: {} },
    'element-plus': {
      ElMessage: { success: message => calls.push(['success', message]), warning: message => calls.push(['warning', message]), error: message => calls.push(['error', message]) },
      ElMessageBox: { async confirm(message, title, options) { calls.push(['confirm', message, title, options]); return true } },
    },
    '@/api': { adminApi, selectionAdminApi },
    '@/stores/cycle': { useCycleStore: () => ({ currentPhase: 'adjustment', currentCycle: { id: 4 }, async fetchCurrentCycle() {} }) },
    '@/utils/volunteerRules': { formatPriority: priority => `第${priority}志愿`, priorityTagType: () => 'info' },
  }
  const compiled = compileScript(parse(source).descriptor, { id: 'admin-accepted-adjustment' }).content
  const code = ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => dependencies[name] ?? require(name), module, module.exports)
  const state = module.exports.default.setup({}, { expose() {} })
  return { state, calls, resultOptions, applicationsReloads: () => applicationsReloads, async start() { for (const fn of hooks) await fn() } }
}

test('只有当前周期已录取申请显示调整入口', async () => {
  const h = setupHarness(); await h.start()
  assert.deepEqual(h.state.adjustableAcceptedIds.value, new Set(['app-old']))
})

test('调整面板展示当前和有名额的既有志愿，确认后刷新申请数据', async () => {
  const h = setupHarness(); await h.start()
  await h.state.openAcceptedResultAdjustment(h.state.applications.value[0])
  assert.equal(h.state.adjustmentOptions.value.current.title, '原课题')
  assert.equal(h.state.eligibleAdjustmentTargets.value.length, 1)
  h.state.adjustmentTargetId.value = 'app-new'
  h.state.adjustmentReason.value = '核对原始志愿后调整'
  await h.state.submitAcceptedResultAdjustment()
  assert.deepEqual(h.calls.find(item => item[0] === 'adjust'), ['adjust', 'app-old', { targetApplicationId: 'app-new', reason: '核对原始志愿后调整', expectedCurrentApplicationId: 'app-old' }])
  assert.equal(h.applicationsReloads(), 2)
})

test('取消录取传空目标；原因缺失不请求，服务端失败保留填写内容', async () => {
  const h = setupHarness({ adjustmentError: '导师本周期指导学生已达上限' }); await h.start()
  await h.state.openAcceptedResultAdjustment(h.state.applications.value[0])
  h.state.adjustmentTargetId.value = '__cancel__'
  await h.state.submitAcceptedResultAdjustment()
  assert.equal(h.calls.some(item => item[0] === 'adjust'), false)
  h.state.adjustmentReason.value = '确认后取消录取'
  await h.state.submitAcceptedResultAdjustment()
  assert.deepEqual(h.calls.find(item => item[0] === 'adjust'), ['adjust', 'app-old', { targetApplicationId: null, reason: '确认后取消录取', expectedCurrentApplicationId: 'app-old' }])
  assert.equal(h.state.adjustmentReason.value, '确认后取消录取')
  assert.equal(h.state.adjustmentDialogVisible.value, true)
  assert.equal(h.applicationsReloads(), 1)
  assert.ok(h.calls.some(item => item[0] === 'error' && item[1] === '导师本周期指导学生已达上限'))
})

test('未录取学生每人一个补录入口，筛选后保留入口且已有录取者不出现补录', async () => {
  const h = setupHarness(); await h.start()
  h.state.applications.value.push(
    { id: 'rejected-placed', student_id: 'student-1', cycle_id: 4, status: 'rejected' },
    { id: 'r1', student_id: 'unplaced', cycle_id: 4, status: 'rejected' },
    { id: 'r2', student_id: 'unplaced', cycle_id: 4, status: 'rejected' },
    { id: 'historical', student_id: 'old', cycle_id: 3, status: 'rejected' },
  )
  h.state.filterStatus.value = 'rejected'
  assert.deepEqual(h.state.supplementApplicationIds.value, new Set(['r1']))
  h.resultOptions.current = null
  h.resultOptions.canCancel = false
  await h.state.openAcceptedResultAdjustment({ id: 'r1' })
  h.state.adjustmentReason.value = '核对学生意愿后补录'
  h.state.adjustmentTargetId.value = '__cancel__'
  await h.state.submitAcceptedResultAdjustment()
  assert.equal(h.calls.some(c => c[0] === 'adjust'), false)
  h.state.adjustmentTargetId.value = 'app-new'
  await h.state.submitAcceptedResultAdjustment()
  assert.ok(h.calls.some(c => c[0] === 'confirm' && c[1].includes('原结果：未录取') && c[1].includes('补录至')))
  assert.deepEqual(h.calls.find(c => c[0] === 'adjust'), ['adjust', 'r1', { targetApplicationId: 'app-new', expectedCurrentApplicationId: null, reason: '核对学生意愿后补录' }])
})
