import test from 'node:test'
import assert from 'node:assert/strict'

const majors = await import('../server/dist/utils/majors.js')
const majorCodes = await import('../server/dist/utils/majorCodes.js')

test('智能交互设计及历史专业代码解析到学校现行代码', () => {
  assert.deepEqual(majors.getMajorNames('080218T', majors.DEFAULT_MAJORS), [
    '智能交互设计',
    '智能交互',
    '智能交互（工科）',
    '智能交互设计（工科）',
  ])
})

test('legacy intelligent-interaction codes and cycle policy normalize to the official code', () => {
  assert.equal(majorCodes.normalizeMajorCode('080906T'), '080218T')
  assert.equal(majorCodes.normalizeMajorCode('080922T', '智能交互设计'), '080218T')
  assert.equal(majorCodes.normalizeMajorCode('080906'), '080906')

  const config = majorCodes.normalizeSmartInteractionCycleConfig({
    majors: [{ code: '080906T', name: '智能交互' }],
    researchCategories: { '080906T': ['人工智能交互系统'] },
    topicAccessPolicy: { mode: 'matrix', matrix: { '080922T': ['080906T'] } },
  })
  assert.deepEqual(config.majors, [{ code: '080218T', name: '智能交互设计' }])
  assert.deepEqual(config.researchCategories, { '080218T': ['人工智能交互系统'] })
  assert.deepEqual(config.topicAccessPolicy.matrix, { '080218T': ['080218T'] })
})
