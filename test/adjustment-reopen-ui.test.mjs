import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const vue = require('vue')
function setup({ cancel = false, fail = false } = {}) {
  const calls = []
  const source = readFileSync(new URL('../src/views/admin/AdjustmentSettlement.vue', import.meta.url), 'utf8')
  const code = ts.transpileModule(compileScript(parse(source).descriptor, { id: 'reopen' }).content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  const data = { cycle: { id: 1, phase: 'adjustment', deadline: '2099-01-01T00:00:00.000Z' }, settlement: { id: 'old', status: 'completed' } }
  const deps = {
    vue: { ...vue, onMounted() {} },
    'element-plus': {
      ElMessage: { success: m => calls.push(['success', m]), error: m => calls.push(['error', m]) },
      ElMessageBox: { async prompt(message, title, options) {
        calls.push(['prompt', message]); assert.notEqual(options.inputValidator('  '), true)
        if (cancel) throw new Error('cancel')
        return { value: ' 再次补录 ' }
      } },
    },
    '@/api': {
      cycleApi: { async getActive() { return { data: { id: 1 } } } },
      adjustmentAdminApi: {
        async getProgress() { calls.push(['reload']); return { data } },
        async reopen(...args) { calls.push(['reopen', ...args]); if (fail) throw { response: { data: { message: '截止时间已变化' } } } },
      },
    },
  }
  new Function('require', 'module', 'exports', code)(name => deps[name] ?? require(name), mod, mod.exports)
  const state = mod.exports.default.setup({}, { expose() {} }); state.data.value = data
  return { calls, state }
}
test('admin confirmation explains retained admissions and submits exact settlement and deadline', async () => {
  const h = setup(); await h.state.reopen()
  assert.match(h.calls[0][1], /已录取结果保留.*上一轮.*归档.*重新提交/s)
  assert.deepEqual(h.calls.find(c => c[0] === 'reopen'), ['reopen', 1, { settlementId: 'old', deadline: '2099-01-01T00:00:00.000Z', reason: '再次补录' }])
  assert.ok(h.calls.some(c => c[0] === 'reload'))
  assert.equal(h.state.running.value, false)
})
test('cancel does not reopen and server rejection does not show success', async () => {
  const cancelled = setup({ cancel: true }); await cancelled.state.reopen()
  assert.ok(!cancelled.calls.some(c => c[0] === 'reopen'))
  const failed = setup({ fail: true }); await failed.state.reopen()
  assert.deepEqual(failed.calls.find(c => c[0] === 'error'), ['error', '截止时间已变化'])
  assert.ok(!failed.calls.some(c => c[0] === 'success'))
  assert.equal(failed.state.running.value, false)
})
test('round token crosses student store, API and route; completed UI does not invite submission', () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  assert.match(read('src/stores/adjustmentVolunteer.ts'), /saveMine\(Number\(mine.value.version \|\| 0\), items, mine.value.roundId \|\| null\)/)
  assert.match(read('src/api/index.ts'), /request.put\('\/adjustment-volunteers\/mine', \{ version, items, roundId \}\)/)
  assert.match(read('server/src/routes/adjustmentVolunteers.ts'), /saveMyAdjustmentVolunteers\(req.user!, version, req.body.items, req.body.roundId \?\? null\)/)
  const page = read('src/views/student/Adjustment.vue')
  assert.match(page, /v-if="adjustmentStore.mine.canEdit" class="toolbar"/)
  assert.match(page, /以前的志愿不会自动参加本轮匹配/)
  const admin = read('server/src/routes/selectionAdmin.ts')
  assert.match(admin, /router.use\(authMiddleware, requireRole\(\['admin'\]\)\)/)
  assert.match(admin, /adjustment-settlement\/:cycleId\/reopen/)
})
