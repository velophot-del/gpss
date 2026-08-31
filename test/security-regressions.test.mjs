import test from 'node:test'
import assert from 'node:assert/strict'

const policies = await import('../server/dist/utils/policies.js').catch(() => ({}))

test('disabled accounts cannot restore a session from an otherwise valid token', () => {
  const result = policies.resolveSessionUser?.(
    { id: 'u1', username: 'old-name', role: 'admin', realName: '旧姓名' },
    { id: 'u1', username: 'current-name', role: 'student', real_name: '当前姓名', status: 'inactive' },
  )
  assert.equal(result, null)
})

test('production refuses to start without an explicit JWT secret', () => {
  assert.throws(() => policies.resolveJwtSecret?.({ NODE_ENV: 'production' }), /JWT_SECRET/)
  assert.equal(policies.resolveJwtSecret?.({ NODE_ENV: 'test' }), 'development-only-secret')
})

test('active sessions use the current database role instead of the token role', () => {
  const result = policies.resolveSessionUser?.(
    { id: 'u1', username: 'old-name', role: 'admin', realName: '旧姓名' },
    { id: 'u1', username: 'current-name', role: 'student', real_name: '当前姓名', status: 'active' },
  )
  assert.deepEqual(result, {
    id: 'u1',
    username: 'current-name',
    role: 'student',
    realName: '当前姓名',
  })
})

test('defense score access exposes only a student own score', () => {
  const group = {
    judges: JSON.stringify(['teacher-1']),
    students: JSON.stringify(['student-1']),
    created_by: 'admin-1',
  }

  assert.equal(policies.getDefenseScoreAccess?.({ id: 'student-1', role: 'student' }, group), 'self')
  assert.equal(policies.getDefenseScoreAccess?.({ id: 'student-2', role: 'student' }, group), 'none')
  assert.equal(policies.getDefenseScoreAccess?.({ id: 'teacher-1', role: 'teacher' }, group), 'all')
  assert.equal(policies.getDefenseScoreAccess?.({ id: 'teacher-2', role: 'teacher' }, group), 'none')
  assert.equal(policies.getDefenseScoreAccess?.({ id: 'admin-1', role: 'admin' }, group), 'all')
})

test('unfiltered defense score lists stay scoped to the current student or judge', () => {
  assert.equal(policies.getDefenseScoreListScope?.({ id: 'student-1', role: 'student' }), 'student')
  assert.equal(policies.getDefenseScoreListScope?.({ id: 'teacher-1', role: 'teacher' }), 'judge')
  assert.equal(policies.getDefenseScoreListScope?.({ id: 'admin-1', role: 'admin' }), 'all')
})

test('upload policy rejects SVG active content and accepts ordinary images', () => {
  assert.equal(policies.validateUploadFile?.('image', 'payload.svg', 100).ok, false)
  assert.equal(policies.validateUploadFile?.('design', 'payload.svg', 100).ok, false)
  assert.equal(policies.validateUploadFile?.('image', 'poster.png', 100).ok, true)
})

test('grade policy accepts blank scores but rejects non-finite and out-of-range values', () => {
  assert.equal(policies.parseOptionalScore?.(''), null)
  assert.equal(policies.parseOptionalScore?.('   '), null)
  assert.equal(policies.parseOptionalScore?.(0), 0)
  assert.equal(policies.parseOptionalScore?.(100), 100)
  assert.throws(() => policies.parseOptionalScore?.(-1), /0-100/)
  assert.throws(() => policies.parseOptionalScore?.(101), /0-100/)
  assert.throws(() => policies.parseOptionalScore?.('not-a-number'), /0-100/)
  assert.throws(() => policies.parseOptionalScore?.(true), /0-100/)
  assert.throws(() => policies.parseOptionalScore?.([]), /0-100/)
})

test('defense scores are required and use the same strict numeric validation', () => {
  assert.equal(policies.parseRequiredScore?.(0), 0)
  assert.equal(policies.parseRequiredScore?.('100'), 100)
  assert.throws(() => policies.parseRequiredScore?.(''), /0-100/)
  assert.throws(() => policies.parseRequiredScore?.(true), /0-100/)
})

test('weighted grades keep an empty result unpublished and normalize partial weights', () => {
  assert.deepEqual(policies.computeWeightedGrade?.(null, null, null), { total: null, level: null })
  assert.deepEqual(policies.computeWeightedGrade?.(80, null, null), { total: 80, level: '良好' })
  assert.deepEqual(policies.computeWeightedGrade?.(80, 90, 70), { total: 78, level: '中等' })
})

test('adjustment policy rejects closed, unchanged, and full target topics', () => {
  assert.match(
    policies.validateAdjustmentTarget?.({ currentTopicId: 'a', targetTopicId: 'a', targetStatus: 'published', acceptedCount: 0, maxStudents: 1 }),
    /同一课题/,
  )
  assert.match(
    policies.validateAdjustmentTarget?.({ currentTopicId: 'a', targetTopicId: 'b', targetStatus: 'closed', acceptedCount: 0, maxStudents: 1 }),
    /未开放/,
  )
  assert.match(
    policies.validateAdjustmentTarget?.({ currentTopicId: 'a', targetTopicId: 'b', targetStatus: 'published', acceptedCount: 1, maxStudents: 1 }),
    /名额已满/,
  )
  assert.equal(
    policies.validateAdjustmentTarget?.({ currentTopicId: 'a', targetTopicId: 'b', targetStatus: 'published', acceptedCount: 0, maxStudents: 1 }),
    null,
  )
})

test('adjustment policy enforces a single active adjustment cycle', () => {
  assert.match(
    policies.validateAdjustmentCycle?.({ currentCycleId: 1, targetCycleId: 2, cycleStatus: 'active', cyclePhase: 'adjustment' }),
    /同一选题周期/,
  )
  assert.match(
    policies.validateAdjustmentCycle?.({ currentCycleId: 1, targetCycleId: 1, cycleStatus: 'closed', cyclePhase: 'adjustment' }),
    /未处于调整阶段/,
  )
  assert.match(
    policies.validateAdjustmentCycle?.({ currentCycleId: 1, targetCycleId: 1, cycleStatus: 'active', cyclePhase: 'student_selection' }),
    /未处于调整阶段/,
  )
  assert.equal(
    policies.validateAdjustmentCycle?.({ currentCycleId: 1, targetCycleId: 1, cycleStatus: 'adjustment', cyclePhase: 'adjustment' }),
    null,
  )
})

test('teacher capacity reads the persisted snake_case key and legacy camelCase key', () => {
  assert.equal(policies.getTeacherStudentLimit?.({ teacher_student_limit: 4 }), 4)
  assert.equal(policies.getTeacherStudentLimit?.({ teacherStudentLimit: 3 }), 3)
  assert.equal(policies.getTeacherStudentLimit?.({ teacher_student_limit: 'invalid' }), 0)
  assert.equal(policies.getTeacherStudentLimit?.(null), 0)
})

test('adjustment source supports unselected students and anchors selected students to their current topic', () => {
  assert.deepEqual(policies.resolveAdjustmentSource?.([], null), { sourceTopicId: null, error: null })
  assert.deepEqual(policies.resolveAdjustmentSource?.(['topic-a'], null), { sourceTopicId: 'topic-a', error: null })
  assert.deepEqual(policies.resolveAdjustmentSource?.(['topic-a'], 'topic-a'), { sourceTopicId: 'topic-a', error: null })
  assert.match(policies.resolveAdjustmentSource?.(['topic-a'], 'topic-b').error, /不一致/)
  assert.match(policies.resolveAdjustmentSource?.(['topic-a', 'topic-b'], null).error, /异常/)
})

test('multer cleanup enumerates every file already written by a failed request', () => {
  assert.deepEqual(
    policies.getUploadedFilePaths?.({ file: [{ path: '/tmp/a' }], files: [{ path: '/tmp/b' }, { path: '' }] }),
    ['/tmp/a', '/tmp/b'],
  )
})
