import test from 'node:test'
import assert from 'node:assert/strict'

const topicCapacity = await import('../server/dist/utils/topicCapacity.js').catch(() => ({}))

test('教师本周期总名额限制创建和编辑课题的招生人数', () => {
  assert.equal(topicCapacity.validateTeacherTopicCapacity?.(3, 8, 5), null)
  assert.match(topicCapacity.validateTeacherTopicCapacity?.(4, 8, 5), /本周期教师招生总人数不能超过8人/)
  assert.equal(topicCapacity.validateTeacherTopicCapacity?.(9, 0, 5), null)
})
