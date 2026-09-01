import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import PizZip from '../server/node_modules/pizzip/js/index.js'

const { createOfficialDocx, officialFilename } = await import('../server/dist/utils/officialDocx.js')

const record = {
  studentName: '测试学生', studentCode: '20260001', className: '2026级视觉传达设计1班', major: '视觉传达设计学院', teacherName: '测试教师',
  title: '测试毕业设计题目', topicTitle: '测试任务书题目', content: '设计目的内容', mainContent: '设计主要内容', requirements: '基本要求内容', specificRequirements: '具体要求内容',
  background: '开题意义内容', objectives: '预期成果内容', methods: '技术方法内容', plan: '方案提纲内容',
  completedWork: '已完成工作内容', problems: '问题内容', nextPlan: '下一步计划内容', teacherComment: '指导教师意见内容',
  topicSchedules: [{ startDate: '2026-09-01', endDate: '2026-09-30' }, { startDate: '2026-10-01', endDate: '2026-10-31' }],
  phasesConfig: { task_book: { startDate: '2026-08-20', endDate: '2026-08-31' }, proposal: { startDate: '2026-11-01', endDate: '2026-11-30' }, midterm: { startDate: '2027-03-01', endDate: '2027-03-15' }, thesis_design: { startDate: '2027-04-01', endDate: '2027-04-20' }, defense: { startDate: '2027-05-01', endDate: '2027-05-15' } }
}

test('official DOCX exports retain a valid Word package and fill each school template', () => {
  const expectations = {
    'task-book': ['设计目的内容', '设计主要内容', '具体要求内容'],
    proposal: ['开题意义内容', '预期成果内容', '技术方法内容', '方案提纲内容', '指导教师意见内容'],
    midterm: ['已完成工作内容', '问题内容', '下一步计划内容', '指导教师意见内容'],
  }
  for (const [type, values] of Object.entries(expectations)) {
    const zip = new PizZip(createOfficialDocx(type, record))
    const xml = zip.file('word/document.xml')?.asText() || ''
    assert.ok(zip.file('[Content_Types].xml'))
    assert.doesNotMatch(xml, /xml:space="[^"]*"\s+xml:space=/)
    for (const value of values) {
      assert.match(xml, new RegExp(value))
      assert.match(xml, new RegExp(`<w:r(?: [^>]*)?>[\\s\\S]*?<w:color w:val="000000"\\s*/>[\\s\\S]*?<w:t[^>]*>${value}`))
    }
    if (type === 'task-book') {
      assert.match(xml, /2026年08月20日—2026年08月31日/)
      assert.match(xml, /2026年09月01日—2026年09月30日/)
      assert.match(xml, /2027年05月01日—2027年05月15日/)
      assert.doesNotMatch(xml, /山东工艺美术学院\s*视觉传达设计学院/)
    }
  }
  assert.equal(officialFilename('task-book', record), '测试学生_毕业设计任务书.docx')
})

test('official DOCX export accepts a cycle-specific uploaded template buffer', () => {
  const source = new PizZip(fs.readFileSync('server/src/assets/process-templates/task-book.docx'))
  const xml = source.file('word/document.xml').asText().replace('山东工艺美术学院毕业设计任务书', '新周期任务书模板')
  source.file('word/document.xml', xml)
  const zip = new PizZip(createOfficialDocx('task-book', record, source.generate({ type: 'nodebuffer' })))
  assert.match(zip.file('word/document.xml').asText(), /新周期任务书模板/)
})

test('task-book schedule selections fill the eight fixed month cells', () => {
  const schedule = ['选题、下达任务书', '实施研究、收集资料', '开题报告', '撰写设计报告、完成初稿', '毕业设计中期检查', '完成修改、定稿', '学术不端检测', '答辩、展览']
    .map((phase, index) => ({ phase, month: index + 1 }))
  const zip = new PizZip(createOfficialDocx('task-book', { ...record, schedule }))
  const xml = zip.file('word/document.xml').asText()
  const plain = xml.replace(/<[^>]+>/g, '')
  for (let month = 1; month <= 8; month += 1) assert.match(plain, new RegExp(`${month}月份`))
})
