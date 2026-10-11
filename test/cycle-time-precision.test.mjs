import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import dayjs from 'dayjs'
import { getAdjustmentDeadline } from '../server/dist/utils/policies.js'
import { isAdjustmentSettlementDue } from '../server/dist/utils/adjustmentSettlement.js'
const source = readFileSync(new URL('../src/views/admin/CycleManagement.vue', import.meta.url), 'utf8')
const fields = ['topicPublishStart','topicPublishEnd','studentApplyStart','studentApplyEnd','teacherReviewStart','teacherReviewEnd','resultAnnounceTime','adjustmentStart','adjustmentEnd']
test('create and edit expose all nine schedule fields with hours minutes seconds and timezone serialization', () => {
  const pickers = source.match(/<el-date-picker\b[^>]*\/>/g) || []
  assert.equal(pickers.length, 18)
  for (const field of fields) {
    const entries = pickers.filter(p => p.includes(`v-model="form.${field}"`))
    assert.equal(entries.length, 2)
    for (const picker of entries) {
      assert.match(picker, /type="datetime"/)
      assert.match(picker, / format="YYYY-MM-DD HH:mm:ss"/)
      assert.match(picker, /value-format="YYYY-MM-DDTHH:mm:ssZ"/)
    }
  }
})
test('cycle list shows seconds including adjustment deadline', () => {
  const body = source.slice(source.indexOf('function formatDate('), source.indexOf('onMounted(() =>'))
  const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const format = new Function('dayjs', code + ';return formatDate')(dayjs)
  const value = '2026-10-11T23:59:37+08:00'
  assert.equal(format(value), dayjs(value).format('YYYY-MM-DD HH:mm:ss'))
  assert.match(source, /formatDate\(row.adjustmentEnd\)/)
})
test('create and edit payloads preserve precise schedule instants', async () => {
  const instant = '2026-10-11T23:59:37+08:00'
  const form = { name: '周期', year: 2027, status: 'adjustment', ...Object.fromEntries(fields.map(f => [f, instant])) }
  for (const [name, next] of [['handleCreate','changeStatus'], ['handleEdit','handleDelete']]) {
    const start = source.indexOf(`async function ${name}`)
    const end = source.indexOf(`async function ${next}`,start)
    const body = source.slice(start,end)
    const code = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    let payload
    const deps = {
      form, submitting: { value: false }, editingId: { value: 1 }, dialogVisible: { value: true }, configurationError: { value: '' },
      cycleApi: { create: async data => { payload = data }, update: async (_, data) => { payload = data } },
      cycleConfigApi: { save: async () => {} }, cycleStore: { cycles: [{ id: 1, status: 'adjustment', phase: 'adjustment' }] },
      buildCfgPayload: () => ({}), ElMessage: { success() {}, warning() {}, error: message => { throw new Error(message) } },
      fetchCycles: async () => {}, closeEditDialog() {},
    }
    await new Function(...Object.keys(deps),code+`;return ${name}`)(...Object.values(deps))()
    assert.equal(payload.phasesConfig.adjustment.end, instant)
    assert.equal(payload.phasesConfig.teacher_review.end, instant)
    assert.equal(payload.phasesConfig.student_apply.end, instant)
    assert.equal(payload.phasesConfig.result_announce, instant)
  }
})
test('deadline stays open until the configured second across timezone offsets', () => {
  const deadline = getAdjustmentDeadline({ adjustment: { end: '2026-10-11T23:59:37+08:00' } })
  assert.equal(deadline.toISOString(), '2026-10-11T15:59:37.000Z')
  assert.equal(isAdjustmentSettlementDue(deadline, new Date('2026-10-11T15:59:36.999Z')), false)
  assert.equal(isAdjustmentSettlementDue(deadline, new Date('2026-10-11T15:59:37.000Z')), true)
})
