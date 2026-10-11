import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('学生毕业阶段持续看到最终未录取状态，不再误报结果未公布', () => {
  const result = read('src/views/student/MyResult.vue')
  assert.match(result, /'task_book'[\s\S]*'archive'/)
  assert.match(result, /本周期调剂已结束，您未被正式录取/)
})

test('正式录取结果持续展示选题信息并提醒学生主动联系导师', () => {
  const result = read('src/views/student/MyResult.vue')
  for (const field of ['result.topicTitle', 'result.requirements', 'result.teacherName']) assert.match(result, new RegExp(field.replace('.', '\\.')))
  assert.match(result, /主动联系指导教师/)
  assert.match(result, /applicationApi\.getAcceptedTopic\(\)/)
})

test('选题、调剂和管理员补录录取通知均提醒学生主动联系导师', () => {
  for (const file of [
    'server/src/services/selectionSettlementService.ts',
    'server/src/services/adjustmentSettlementService.ts',
    'server/src/services/acceptedResultAdjustmentService.ts',
  ]) {
    assert.match(read(file), /主动联系指导教师/)
  }
})
