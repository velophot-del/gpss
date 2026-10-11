import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('管理员可从毕业全流程菜单进入任务书确认页', () => {
  const router = read('src/router/index.ts')
  const layout = read('src/layouts/MainLayout.vue')
  const route = router.match(/path: 'process\/task-book',[\s\S]*?meta: \{ roles: \[([^\]]+)\] \}/)?.[1] || ''
  assert.match(route, /'admin'/)
  assert.match(layout, /<el-menu-item index="\/process\/task-book">任务书确认<\/el-menu-item>/)
})

test('全流程看板按选定周期取阶段并过滤各项统计数据', () => {
  const overview = read('src/views/process/ProcessOverview.vue')
  assert.match(overview, /selectedCycle/)
  assert.match(overview, /cycleStore\.fetchAllCycles\(\)/)
  assert.match(overview, /cycleRows\(v\(apps\)\)/)
  const settled = overview.match(/const \[([^\]]+)\] = await Promise\.allSettled/)
  assert.deepEqual(settled?.[1].split(',').map(name => name.trim()), ['apps', 'props_', 'mid', 'groups', 'grades'])
  for (const collection of ['props_', 'mid', 'groups', 'grades']) {
    assert.match(overview, new RegExp(`cycleRows\\(v\\(${collection}\\)\\)`))
  }
  assert.match(overview, /cycle_id \?\? row\.cycleId/)
  assert.match(overview, /adminApi\.getAllApplications\(\)/)
})

test('GPSS 生产镜像启动入口执行毕业流程数据库迁移', () => {
  const dockerfile = read('deployment/aliyun/Dockerfile')
  const entrypoint = read('deployment/aliyun/entrypoint.sh')
  assert.match(dockerfile, /ENTRYPOINT \["\/entrypoint\.sh"\]/)
  assert.match(entrypoint, /initDb\.js[\s\S]*migrateAddProcessStages\.js/)
})
