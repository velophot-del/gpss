import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import PizZip from '../server/node_modules/pizzip/js/index.js'

const module = await import('../server/dist/utils/templateContract.js')
const { inspectTemplate, validateTemplateProfile, renderTemplate, studentTemplateFields, canonicalTemplateProfile } = module
const { materialValues } = await import('../server/dist/services/materialTemplateService.js')
const read = type => fs.readFileSync(`server/src/assets/process-templates/${type}.docx`)
const plain = buffer => new PizZip(buffer).file('word/document.xml').asText().replace(/<[^>]+>/g, '')
const record = { studentName: '核验学生', studentCode: 'CHECK2026', className: '核验班', major: '核验专业', collegeName: '视觉传达设计学院', teacherName: '核验教师', title: '全新题目', topicTitle: '全新课题', teacherComment: '审核意见' }

test('uploaded task-book replaces cover and complete content regions but retains administrator schedule', () => {
  const source = new PizZip(read('task-book'))
  let xml = source.file('word/document.xml').asText().replace(/(<w:t[^>]*>)10(<\/w:t>)/, '$12026年10$2')
  source.file('word/document.xml', xml)
  const buffer = source.generate({ type: 'nodebuffer' })
  const profile = inspectTemplate('task_book', buffer)
  assert.deepEqual(validateTemplateProfile(profile, buffer), [])
  const values = { title: '全新题目', content: '全新目的\n第二段<&>', mainContent: '全新内容', specificRequirements: '全新具体要求' }
  const output = renderTemplate(buffer, profile, values, record)
  const text = plain(output)
  assert.doesNotMatch(text, /新式茶饮|张三|2023000000|每段首行缩进/)
  assert.match(text, /全新题目/)
  assert.match(text, /2026年10月份/)
  assert.match(text, /正文字数不得少于6000字/)
  assert.match(text, /指导教师\(签字\)/)
  assert.equal((text.match(/全新具体要求/g) || []).length, 1)
  assert.match(text, /第二段&lt;&amp;&gt;/)
  const before = new PizZip(buffer), after = new PizZip(output)
  for (const file of Object.keys(before.files).filter(f => f !== 'word/document.xml' && !before.files[f].dir)) {
    assert.deepEqual(after.file(file).asNodeBuffer(), before.file(file).asNodeBuffer(), file)
  }
})

test('proposal and midterm expose template labels and keep signatures and review decision instructions', () => {
  for (const [type, file, keys] of [['proposal','proposal',['title','background','objectives','methods','plan']], ['midterm','midterm',['completedWork','problems','nextPlan']]]) {
    const buffer = read(file), profile = inspectTemplate(type, buffer)
    assert.deepEqual(validateTemplateProfile(profile, buffer), [])
    assert.deepEqual(new Set(studentTemplateFields(profile).map(f => f.key)), new Set(keys))
    const text = plain(renderTemplate(buffer, profile, Object.fromEntries(keys.map(k => [k, `新${k}`])), record))
    assert.match(text, /指导教师\(签字\)/)
    assert.match(text, /审核意见/)
    if (type === 'proposal') assert.match(text, /是否同意开题/)
    else assert.match(text, /签名：（手写）/)
  }
})

test('administrator can map a renamed or added field and make fixed requirements read-only', () => {
  const buffer = read('midterm'), profile = inspectTemplate('midterm', buffer)
  const field = profile.fields.find(f => f.key === 'nextPlan')
  field.label = '后续实践工作与日期'
  field.key = 'custom_next'
  const values = { custom_next: '新版字段填写', completedWork: '完成内容', problems: '问题内容' }
  assert.deepEqual(validateTemplateProfile(profile, buffer), [])
  assert.match(plain(renderTemplate(buffer, profile, values, record)), /新版字段填写/)
  assert.equal(studentTemplateFields(profile).find(f => f.key === 'custom_next').label, '后续实践工作与日期')
})

test('invalid ranges, overlaps, hashes and missing body cannot silently generate a document', () => {
  const buffer = read('midterm'), profile = inspectTemplate('midterm', buffer)
  const bad = structuredClone(profile)
  bad.fields.push({ ...bad.fields[0], id: 'overlap' })
  assert.ok(validateTemplateProfile(bad, buffer).length)
  assert.throws(() => renderTemplate(buffer, bad, {}, record))
  assert.throws(() => inspectTemplate('midterm', Buffer.from('not a Word file')))
  const changed = new PizZip(buffer)
  changed.file('word/document.xml', changed.file('word/document.xml').asText().replace('检查表','检查表新版'))
  assert.throws(() => renderTemplate(changed.generate({ type: 'nodebuffer' }), profile, {}, record))
})

test('cover line drawings survive text replacement without blocking a valid template', () => {
  const zip = new PizZip(read('task-book'))
  const xml = zip.file('word/document.xml').asText().replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, p => {
    const text = p.replace(/<[^>]+>/g, '').replace(/\s/g, '')
    return text.startsWith('姓名') ? p.replace('</w:p>', '<w:r><w:drawing><wp:anchor><a:graphic/></wp:anchor></w:drawing></w:r></w:p>') : p
  })
  zip.file('word/document.xml', xml)
  const buffer = zip.generate({ type: 'nodebuffer' }), profile = inspectTemplate('task_book', buffer)
  assert.deepEqual(validateTemplateProfile(profile, buffer), [])
  const output = new PizZip(renderTemplate(buffer, profile, {}, record)).file('word/document.xml').asText()
  assert.match(output, /<w:drawing><wp:anchor><a:graphic\/><\/wp:anchor><\/w:drawing>/)
  assert.match(output, /核验学生/)
})

test('real export without a college database column retains the template college or school default', () => {
  for (const [type, file] of [['task_book', 'task-book'], ['proposal', 'proposal'], ['midterm', 'midterm']]) {
    const buffer = read(file), profile = inspectTemplate(type, buffer)
    const { collegeName, ...withoutCollege } = record
    const text = plain(renderTemplate(buffer, profile, {}, withoutCollege))
    assert.match(text, /视觉传达设计学院/)
  }
})

test('server recalculates original text from the chosen range instead of trusting the browser', () => {
  const buffer = read('midterm'), profile = inspectTemplate('midterm', buffer)
  const fixed = profile.fields.find(f => f.source === 'fixed')
  const original = fixed.original
  fixed.original = '客户端过期原文'
  const canonical = canonicalTemplateProfile(profile, buffer)
  assert.equal(canonical.fields.find(f => f.id === fixed.id).original, original)
})

test('student values exclude fixed fields, enforce template required fields and bound title length', () => {
  const profile = inspectTemplate('task_book', read('task-book'))
  assert.throws(() => materialValues(profile, { title: '长'.repeat(201) }, false), /200字/)
  assert.throws(() => materialValues(profile, {}, true), /请填写/)
  const values = materialValues(profile, { requirements: '伪造固定要求', title: '标题' }, false)
  assert.equal(values.requirements, undefined)
  assert.equal(values.title, '标题')
})
