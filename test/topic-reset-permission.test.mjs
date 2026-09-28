import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

test('管理员可在统一结算开始前的任意周期阶段恢复单个课题', async () => {
  const route = await readFile(new URL('../server/src/routes/selectionAdmin.ts', import.meta.url), 'utf8')
  const resetRoute = route.slice(
    route.indexOf("router.post('/selection-topics/:topicId/reset'"),
    route.indexOf("router.post('/selection-settlement/:cycleId/run'"),
  )

  assert.match(resetRoute, /统一结算已开始或已完成，不能恢复单个课题/)
  assert.doesNotMatch(resetRoute, /c\.phase|cycle\.phase|仅志愿填报或教师遴选阶段/)
})
