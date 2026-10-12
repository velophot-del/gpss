import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../server/src/services/acceptedResultAdjustmentService.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
let databaseState = null
const database = {
  async query(sql, params = []) { return databaseState ? (await databaseState.query(sql, params))[0] : [] },
  async getConnection() { return databaseState.connection() },
  async transaction(fn) { return databaseState.transaction(fn) },
}
const dependencies = {
  '../config/database.js': database,
  '../utils/policies.js': { getTeacherStudentLimit: () => 15 },
  '../utils/json.js': { safeParseJson: value => JSON.parse(value || '{}') },
  '../utils/majorCodes.js': require('../server/dist/utils/majorCodes.js'),
  uuid: createRequire(new URL('../server/package.json', import.meta.url))('uuid'),
}
new Function('require', 'module', 'exports', compiled)(name => dependencies[name] ?? require(name), module, module.exports)
const { buildAcceptedResultAdjustmentPlan } = module.exports

const makeInput = (overrides = {}) => ({
  cycleId: 4,
  studentId: 'student-1',
  studentMajorCode: '130502',
  studentMajor: '视觉传达设计',
  currentApplicationId: 'app-old',
  targetApplicationId: 'app-new',
  reason: '核对志愿后修正录取去向',
  selectionSettlementStatus: 'completed',
  adjustmentSettlementStatus: 'completed',
  teacherLimit: 15,
  applications: [
    { id: 'app-old', studentId: 'student-1', topicId: 'topic-old', cycleId: 4, priority: 1, status: 'accepted' },
    { id: 'app-new', studentId: 'student-1', topicId: 'topic-new', cycleId: 4, priority: 2, status: 'withdrawn' },
  ],
  topics: [
    { id: 'topic-old', teacherId: 'teacher-a', cycleId: 4, status: 'full', maxStudents: 1, majorCode: '130502', major: '视觉传达设计' },
    { id: 'topic-new', teacherId: 'teacher-b', cycleId: 4, status: 'published', maxStudents: 3, majorCode: '130502', major: '视觉传达设计' },
  ],
  acceptedByTopic: { 'topic-old': 1, 'topic-new': 1 },
  acceptedByTeacher: { 'teacher-a': 1, 'teacher-b': 1 },
  ...overrides,
})

test('改录到同一学生的其他既有志愿并重算名额状态', () => {
  const plan = buildAcceptedResultAdjustmentPlan(makeInput())
  assert.deepEqual(plan.applicationUpdates, [
    { id: 'app-old', status: 'withdrawn' },
    { id: 'app-new', status: 'accepted' },
  ])
  assert.deepEqual(plan.topicStatuses, { 'topic-old': 'published', 'topic-new': 'published' })
  assert.deepEqual(plan.affectedTeacherIds, ['teacher-a', 'teacher-b'])
})

test('取消录取不需要目标志愿', () => {
  const plan = buildAcceptedResultAdjustmentPlan(makeInput({ targetApplicationId: null }))
  assert.deepEqual(plan.applicationUpdates, [{ id: 'app-old', status: 'withdrawn' }])
  assert.deepEqual(plan.topicStatuses, { 'topic-old': 'published' })
})

test('同一教师改录时从教师占用人数中扣除学生的旧录取', () => {
  const plan = buildAcceptedResultAdjustmentPlan(makeInput({
    topics: [
      { id: 'topic-old', teacherId: 'teacher-a', cycleId: 4, status: 'full', maxStudents: 2 },
      { id: 'topic-new', teacherId: 'teacher-a', cycleId: 4, status: 'published', maxStudents: 3 },
    ],
    acceptedByTopic: { 'topic-old': 1, 'topic-new': 2 },
    acceptedByTeacher: { 'teacher-a': 3 },
  }))
  assert.equal(plan.applicationUpdates[1].status, 'accepted')
})

test('拒绝不属于该学生或当前周期的目标申请', () => {
  assert.throws(() => buildAcceptedResultAdjustmentPlan(makeInput({ targetApplicationId: 'app-other' })), /目标志愿/)
  assert.throws(() => buildAcceptedResultAdjustmentPlan(makeInput({
    applications: makeInput().applications.map(item => item.id === 'app-new' ? { ...item, cycleId: 3 } : item),
  })), /目标志愿/)
})

test('容量、教师上限、原因和结算运行状态均作为硬性限制', () => {
  assert.throws(() => buildAcceptedResultAdjustmentPlan(makeInput({ acceptedByTopic: { 'topic-old': 1, 'topic-new': 3 } })), /课题名额/)
  assert.throws(() => buildAcceptedResultAdjustmentPlan(makeInput({ acceptedByTeacher: { 'teacher-a': 1, 'teacher-b': 15 } })), /教师.*上限/)
  assert.throws(() => buildAcceptedResultAdjustmentPlan(makeInput({ reason: '  ' })), /原因/)
  assert.throws(() => buildAcceptedResultAdjustmentPlan(makeInput({ selectionSettlementStatus: 'running' })), /结算正在运行/)
  assert.throws(() => buildAcceptedResultAdjustmentPlan(makeInput({ adjustmentSettlementStatus: 'running' })), /结算正在运行/)
})

test('拒绝已有多条正式录取的异常状态', () => {
  assert.throws(() => buildAcceptedResultAdjustmentPlan(makeInput({
    applications: makeInput().applications.map(item => item.id === 'app-new' ? { ...item, status: 'accepted' } : item),
  })), /录取结果已变化/)
})

function databaseHarness({ selectionStatus = 'completed', adjustmentStatus = 'completed', teacherLimit = 15, teacherBCount = 1, oldAdjustmentStatus = 'accepted', targetAdjustmentStatus = 'rejected', otherMajorTopic = false } = {}) {
  const state = {
    cycle: { id: 4, name: '2026级', status: 'adjustment', phase: 'adjustment', phases_config: JSON.stringify({ teacher_student_limit: teacherLimit }) },
    applications: [
      { id: 'app-old', student_id: 'student-1', topic_id: 'topic-old', cycle_id: 4, priority: 1, status: 'accepted' },
      { id: 'app-new', student_id: 'student-1', topic_id: 'topic-new', cycle_id: 4, priority: 2, status: 'withdrawn' },
    ],
    topics: [
      { id: 'topic-old', title: '原课题', teacher_id: 'teacher-a', teacher_name: '导师甲', cycle_id: 4, status: 'full', max_students: 1, major_code: '130502', major: '视觉传达设计' },
      { id: 'topic-new', title: '目标课题', teacher_id: 'teacher-b', teacher_name: '导师乙', cycle_id: 4, status: 'published', max_students: 3, major_code: '130502', major: '视觉传达设计' },
      { id: 'topic-admin', title: '空余课题', teacher_id: 'teacher-c', teacher_name: '导师丙', cycle_id: 4, status: 'published', max_students: 2, major_code: '130502', major: '视觉传达设计' },
      ...(otherMajorTopic ? [{ id: 'topic-other-major', title: '其他专业课题', teacher_id: 'teacher-d', teacher_name: '导师丁', cycle_id: 4, status: 'published', max_students: 2, major_code: '130503', major: '数字媒体艺术' }] : []),
    ],
    adjustmentVolunteers: [
      { id: 'av-old', student_id: 'student-1', topic_id: 'topic-old', cycle_id: 4, status: oldAdjustmentStatus },
      { id: 'av-new', student_id: 'student-1', topic_id: 'topic-new', cycle_id: 4, status: targetAdjustmentStatus },
    ],
    notices: [], logs: [], released: [], calls: [], processMaterials: false,
    selectionStatus, adjustmentStatus, teacherBCount,
    async query(sql, params = []) {
      this.calls.push(sql.replace(/\s+/g, ' ').trim())
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
      if (sql.includes('RELEASE_LOCK')) { this.released.push(params[0]); return [[{ released: 1 }]] }
      if (sql.includes('FROM cycles')) return [[this.cycle]]
      if (sql.includes('FROM selection_settlements')) return [this.selectionStatus ? [{ status: this.selectionStatus }] : []]
      if (sql.includes('FROM adjustment_settlements')) return [this.adjustmentStatus ? [{ status: this.adjustmentStatus }] : []]
      if (sql.includes('FROM task_books') || sql.includes('FROM proposals') || sql.includes('FROM midterm_reports')) return [[{ has_materials: this.processMaterials ? 1 : 0 }]]
      if (sql.includes('FROM applications a JOIN topics t') && sql.includes("a.status IN ('accepted','rejected')")) {
        const app = this.applications.find(item => item.id === params[0])
        return app && ['accepted', 'rejected'].includes(app.status) ? [[{ student_id: app.student_id }]] : [[]]
      }
      if (sql.includes('FROM applications a JOIN topics t') && sql.includes('JOIN users s')) {
        return [this.applications.map(app => {
          const topic = this.topics.find(item => item.id === app.topic_id)
          return { ...app, student_name: '张三', student_major: '视觉传达设计', student_major_code: '130502', topic_title: topic.title, teacher_id: topic.teacher_id,
            teacher_name: topic.teacher_name, topic_status: topic.status, max_students: topic.max_students }
        })]
      }
      if (sql.includes('FROM topics WHERE cycle_id')) return [this.topics.filter(topic => ['published', 'full'].includes(topic.status)).map(topic => ({ id: topic.id }))]
      if (sql.includes('FROM topics t JOIN users u') && sql.includes('WHERE t.id IN')) return [this.topics.filter(topic => params[0].includes(topic.id))]
      if (sql.includes('COUNT(DISTINCT student_id) AS cnt') && sql.includes('GROUP BY topic_id')) {
        return [this.topics.map(topic => ({ topic_id: topic.id, cnt: this.applications.filter(app => app.topic_id === topic.id && app.status === 'accepted').length }))]
      }
      if (sql.includes('COUNT(DISTINCT a.student_id) AS cnt')) {
        return [this.topics.map(topic => ({ teacher_id: topic.teacher_id, cnt: topic.teacher_id === 'teacher-b' ? this.teacherBCount : 1 }))]
      }
      if (sql.includes('FROM adjustment_volunteers')) return [this.adjustmentVolunteers]
      if (sql.startsWith('UPDATE applications SET status')) {
        const app = this.applications.find(item => item.id === params[2]); app.status = params[0]; return [{ affectedRows: 1 }]
      }
      if (sql.includes('INSERT INTO applications')) {
        this.applications.push({ id: params[0], student_id: params[1], topic_id: params[2], priority: 0,
          status: 'accepted', teacher_comment: params[3], reviewed_by: params[4] })
        return [{ affectedRows: 1 }]
      }
      if (sql.includes('UPDATE adjustment_volunteers SET status')) {
        const row = this.adjustmentVolunteers.find(item => item.cycle_id === params[0] && item.student_id === params[1] && item.topic_id === params[2] && (sql.includes("SET status = 'withdrawn'") ? ['submitted','accepted'].includes(item.status) : ['submitted','withdrawn','rejected','accepted'].includes(item.status)))
        if (row) row.status = sql.includes("SET status = 'withdrawn'") ? 'withdrawn' : 'accepted'
        return [{ affectedRows: row ? 1 : 0 }]
      }
      if (sql.startsWith('UPDATE topics SET status')) {
        const topic = this.topics.find(item => item.id === params[1]); topic.status = params[0]; return [{ affectedRows: 1 }]
      }
      if (sql.includes('INSERT INTO operation_logs')) { this.logs.push(JSON.parse(params[2])); return [{ affectedRows: 1 }] }
      if (sql.includes('INSERT INTO notifications')) { this.notices.push({ userId: params[1], title: params[2], content: params[3] }); return [{ affectedRows: 1 }] }
      if (sql.includes('SELECT id FROM users')) return [[]]
      return [[]]
    },
    connection() { return { query: this.query.bind(this), release() {} } },
    async transaction(fn) {
      const snapshot = structuredClone({ applications: this.applications, topics: this.topics, adjustmentVolunteers: this.adjustmentVolunteers, notices: this.notices, logs: this.logs })
      try { return await fn(this.connection()) }
      catch (cause) { Object.assign(this, snapshot); throw cause }
    },
  }
  databaseState = state
  return state
}

const admin = { id: 'admin-1', role: 'admin' }

test('服务改录时同步申请、调剂状态、课题状态、通知和操作日志', async () => {
  const db = databaseHarness()
  const result = await module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '核对志愿后修正录取去向', '127.0.0.1')
  assert.equal(result.newApplicationId, 'app-new')
  assert.deepEqual(db.applications.map(item => item.status), ['withdrawn', 'accepted'])
  assert.deepEqual(db.adjustmentVolunteers.map(item => item.status), ['withdrawn', 'accepted'])
  assert.deepEqual(db.topics.map(item => item.status), ['published', 'published', 'published'])
  assert.equal(db.logs.length, 1)
  assert.equal(db.notices.length, 3)
  assert.deepEqual(db.released.sort(), ['gpss:adjustment-settlement:4', 'gpss:selection-settlement:4'])
})

test('服务容量冲突时保留原结果并且不写通知或日志', async () => {
  const db = databaseHarness({ teacherBCount: 15 })
  await assert.rejects(module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '改录', null), /教师.*上限/)
  assert.deepEqual(db.applications.map(item => item.status), ['accepted', 'withdrawn'])
  assert.equal(db.logs.length, 0)
  assert.equal(db.notices.length, 0)
})

test('改录目标若仍是待处理的调剂志愿，也同步为已录取', async () => {
  const db = databaseHarness({ oldAdjustmentStatus: 'draft', targetAdjustmentStatus: 'submitted' })
  await module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '确认补录志愿后调整', null)
  assert.equal(db.adjustmentVolunteers[1].status, 'accepted')
})

test('录取调整选项按两类名额标示可选志愿', async () => {
  const db = databaseHarness({ teacherBCount: 15 })
  let options
  try { options = await module.exports.getAcceptedResultAdjustmentOptions(admin, 'app-old') }
  catch (cause) { cause.message += `\nSQL: ${db.calls.join('\n')}`; throw cause }
  assert.equal(options.current.title, '原课题')
  assert.deepEqual(options.targets.map(target => target.topicId), ['topic-new'])
  assert.equal(options.targets[0].eligible, false)
  assert.match(options.targets[0].reason, /教师.*上限/)
  assert.equal(options.canCancel, true)
  assert.equal(db.logs.length, 0)
})

const unplacedInput = (overrides = {}) => makeInput({
  allowAdmission: true,
  applications: makeInput().applications.map(item => ({ ...item, status: 'rejected' })),
  acceptedByTopic: { 'topic-old': 0, 'topic-new': 1 },
  acceptedByTeacher: { 'teacher-a': 0, 'teacher-b': 1 },
  ...overrides,
})

test('未录取学生可以补录到自己的既有志愿，包括作为入口的志愿', () => {
  const plan = buildAcceptedResultAdjustmentPlan(unplacedInput())
  assert.equal(plan.oldApplicationId, null)
  assert.deepEqual(plan.applicationUpdates, [{ id: 'app-new', status: 'accepted' }])
  assert.deepEqual(plan.affectedTeacherIds, ['teacher-b'])
  assert.deepEqual(plan.topicStatuses, { 'topic-new': 'published' })
  assert.equal(buildAcceptedResultAdjustmentPlan(unplacedInput({ targetApplicationId: 'app-old' })).newApplicationId, 'app-old')
})

test('管理员可将未录取学生补录到无既有申请且容量充足的课题', () => {
  const plan = buildAcceptedResultAdjustmentPlan(unplacedInput({
    targetApplicationId: null,
    targetTopicId: 'topic-admin',
    newApplicationId: 'app-admin',
    topics: [...makeInput().topics, { id: 'topic-admin', teacherId: 'teacher-c', cycleId: 4, status: 'published', maxStudents: 2, majorCode: '130502', major: '视觉传达设计' }],
    acceptedByTopic: { 'topic-old': 0, 'topic-new': 1, 'topic-admin': 0 },
    acceptedByTeacher: { 'teacher-a': 0, 'teacher-b': 1, 'teacher-c': 0 },
  }))
  assert.equal(plan.newApplicationId, 'app-admin')
  assert.equal(plan.newTopicId, 'topic-admin')
  assert.deepEqual(plan.applicationUpdates, [])
  assert.deepEqual(plan.topicStatuses, { 'topic-admin': 'published' })
})

test('管理员补录拒绝其他专业课题', () => {
  assert.throws(() => buildAcceptedResultAdjustmentPlan(unplacedInput({
    targetApplicationId: null, targetTopicId: 'topic-admin',
    topics: [...makeInput().topics, { id: 'topic-admin', teacherId: 'teacher-c', cycleId: 4, status: 'published', maxStudents: 2, majorCode: '130503', major: '数字媒体艺术' }],
    acceptedByTopic: { 'topic-old': 0, 'topic-new': 1, 'topic-admin': 0 },
    acceptedByTeacher: { 'teacher-a': 0, 'teacher-b': 1, 'teacher-c': 0 },
  })), /本专业/)
})

test('毕业设计 process 阶段仍可为未录取学生补录且选项只包含本专业课题', async () => {
  const db = databaseHarness({ otherMajorTopic: true })
  db.cycle.status = 'process'
  db.cycle.phase = 'task_book'
  db.applications.forEach(app => { app.status = 'rejected' })
  const options = await module.exports.getAcceptedResultAdjustmentOptions(admin, 'app-old')
  assert.equal(options.current, null)
  assert.deepEqual(options.targets.map(target => target.topicId).sort(), ['topic-admin', 'topic-new', 'topic-old'])
  assert.ok(options.targets.every(target => target.eligible))
  await module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '毕业设计阶段补录', null, null, 'topic-new')
  assert.equal(db.applications.find(app => app.id === 'app-new').status, 'accepted')
})

test('毕业设计 process 阶段允许无毕业材料的已录取学生改题', async () => {
  const db = databaseHarness()
  db.cycle.status = 'process'
  db.cycle.phase = 'task_book'
  const options = await module.exports.getAcceptedResultAdjustmentOptions(admin, 'app-old')
  assert.equal(options.current.topicId, 'topic-old')
  assert.deepEqual(options.targets.map(target => target.topicId), ['topic-new'])
  assert.equal(options.canCancel, false)
  await assert.rejects(module.exports.adjustAcceptedResult(admin, 'app-old', null, '取消录取', null), /毕业设计阶段只能调整至其他课题/)
  await module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '经学生确认后调整', null)
  assert.deepEqual(db.applications.map(item => item.status), ['withdrawn', 'accepted'])
})

test('毕业设计 process 阶段有毕业材料时拒绝修改已录取学生的课题', async () => {
  const db = databaseHarness()
  db.cycle.status = 'process'
  db.cycle.phase = 'task_book'
  db.processMaterials = true
  await assert.rejects(module.exports.getAcceptedResultAdjustmentOptions(admin, 'app-old'), /已有毕业材料，不能调整已录取结果/)
  await assert.rejects(module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '尝试改题', null), /已有毕业材料，不能调整已录取结果/)
  assert.deepEqual(db.applications.map(item => item.status), ['accepted', 'withdrawn'])
  assert.equal(db.logs.length, 0)
})

test('管理员可用管理员补录重新激活本人之前取消的课题记录，并移出志愿统计', () => {
  const input = unplacedInput({
    targetApplicationId: null,
    targetTopicId: 'topic-new',
    applications: makeInput().applications.map(item => ({ ...item, status: item.id === 'app-new' ? 'cancelled' : 'rejected' })),
  })
  const plan = buildAcceptedResultAdjustmentPlan(input)
  assert.deepEqual(plan.applicationUpdates, [{ id: 'app-new', status: 'accepted', priority: 0 }])
  assert.equal(plan.newApplicationId, 'app-new')
})

test('未录取补录不能取消、不提前介入结算、不超容量且不绕过旧结果变化', () => {
  assert.throws(() => buildAcceptedResultAdjustmentPlan(unplacedInput({ targetApplicationId: null })), /请选择.*课题/)
  assert.throws(() => buildAcceptedResultAdjustmentPlan(unplacedInput({ allowAdmission: false })), /调剂.*完成/)
  assert.throws(() => buildAcceptedResultAdjustmentPlan(unplacedInput({ acceptedByTeacher: { 'teacher-b': 15 } })), /教师.*上限/)
  assert.throws(() => buildAcceptedResultAdjustmentPlan(unplacedInput({ acceptedByTopic: { 'topic-new': 3 } })), /课题名额/)
  assert.throws(() => buildAcceptedResultAdjustmentPlan(unplacedInput({ applications: makeInput().applications.map(a => ({ ...a, status: a.id === 'app-new' ? 'accepted' : 'rejected' })) })), /录取结果已变化/)
})

test('未录取补录选项包含入口志愿，成功写入录取、补录状态、日志和通知', async () => {
  const db = databaseHarness({ oldAdjustmentStatus: 'rejected', targetAdjustmentStatus: 'rejected' })
  db.applications.forEach(app => { app.status = 'rejected' })
  const options = await module.exports.getAcceptedResultAdjustmentOptions(admin, 'app-old')
  assert.equal(options.current, null)
  assert.equal(options.canCancel, false)
  assert.deepEqual(options.targets.map(t => t.topicId), ['topic-old', 'topic-new', 'topic-admin'])
  await module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '经学生确认补录', null, null)
  assert.deepEqual(db.applications.map(app => app.status), ['rejected', 'accepted'])
  assert.equal(db.adjustmentVolunteers[1].status, 'accepted')
  assert.equal(db.logs[0].action, 'admit')
  assert.equal(db.logs[0].before, null)
  assert.equal(db.notices.length, 2)
  assert.ok(db.notices.every(n => n.content.includes('补录')))
  await assert.rejects(module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '重复请求', null, null), /录取结果已变化/)
  assert.equal(db.logs.length, 1)
})

test('服务为无既有申请的课题新增 priority=0 正式录取，保留学生原志愿', async () => {
  const db = databaseHarness({ oldAdjustmentStatus: 'rejected', targetAdjustmentStatus: 'rejected' })
  db.applications.forEach(app => { app.status = 'rejected' })
  const result = await module.exports.adjustAcceptedResult(admin, 'app-old', null, '学生确认后管理员补录', null, null, 'topic-admin')
  const inserted = db.applications.find(app => app.id === result.newApplicationId)
  assert.equal(inserted.topic_id, 'topic-admin')
  assert.equal(inserted.priority, 0)
  assert.equal(inserted.status, 'accepted')
  assert.match(inserted.teacher_comment, /管理员补录/)
  assert.deepEqual(db.applications.slice(0, 2).map(app => app.status), ['rejected', 'rejected'])
  assert.equal(db.logs[0].after.topicId, 'topic-admin')
  assert.ok(db.notices.every(notice => notice.content.includes('补录')))
})

test('未录取补录容量冲突、未结算或通知失败时不留下部分结果', async () => {
  const db = databaseHarness({ teacherBCount: 15, oldAdjustmentStatus: 'rejected', targetAdjustmentStatus: 'rejected' })
  db.applications.forEach(app => { app.status = 'rejected' })
  await assert.rejects(module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '补录', null), /教师.*上限/)
  db.teacherBCount = 1
  db.adjustmentStatus = null
  await assert.rejects(module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '补录', null), /调剂.*完成/)
  db.adjustmentStatus = 'completed'
  const query = db.query.bind(db)
  db.query = async (sql, params) => {
    if (sql.includes('INSERT INTO notifications')) throw new Error('通知写入失败')
    return query(sql, params)
  }
  await assert.rejects(module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '补录', null), /通知写入失败/)
  assert.deepEqual(db.applications.map(app => app.status), ['rejected', 'rejected'])
  assert.deepEqual(db.adjustmentVolunteers.map(av => av.status), ['rejected', 'rejected'])
  assert.equal(db.logs.length, 0)
})

test('面板打开后入口志愿被别人录取，补录请求必须拒绝，不能变成改录', async () => {
  const db = databaseHarness()
  await assert.rejects(module.exports.adjustAcceptedResult(admin, 'app-old', 'app-new', '补录', null, null), /录取结果已变化/)
  assert.deepEqual(db.applications.map(app => app.status), ['accepted', 'withdrawn'])
})
