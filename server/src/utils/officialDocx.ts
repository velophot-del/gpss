import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Response } from 'express'
import PizZip from 'pizzip'
import { query } from '../config/database.js'
import { privateTemplateRoot } from './privateTemplates.js'
import { safeParseJson } from './json.js'

export type OfficialDocumentType = 'task-book' | 'proposal' | 'midterm'

const templateDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/process-templates')

const documentTypeByExport: Record<OfficialDocumentType, string> = {
  'task-book': 'task_book', proposal: 'proposal', midterm: 'midterm'
}

// 模板文件缓存：避免每次导出都走同步磁盘 I/O；按 mtime 失效以兼容开发环境热更新
const templateCache = new Map<string, { mtimeMs: number; buffer: Buffer }>()

function readTemplateCached(filePath: string): Buffer {
  const stat = fs.statSync(filePath)
  const cached = templateCache.get(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.buffer
  const buffer = fs.readFileSync(filePath)
  templateCache.set(filePath, { mtimeMs: stat.mtimeMs, buffer })
  return buffer
}

export async function resolvePublishedTemplate(type: OfficialDocumentType, cycleId?: number | string | null) {
  const id = Number(cycleId)
  if (!Number.isInteger(id) || id < 1) return undefined
  const rows = await query<any>(`
    SELECT storage_key FROM document_templates
    WHERE cycle_id = ? AND document_type = ? AND status = 'published'
    ORDER BY published_at DESC, updated_at DESC
    LIMIT 1`, [id, documentTypeByExport[type]])
  const storageKey = rows[0]?.storage_key
  if (!storageKey) return undefined
  const filePath = path.join(privateTemplateRoot(), path.basename(storageKey))
  try { return readTemplateCached(filePath) } catch { return undefined }
}

function escapeXml(value: unknown) {
  return String(value ?? '').replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]!))
}

function textOf(xml: string) {
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')).join('')
}

function valueOf(value: unknown) {
  const chinesePunctuation = String(value ?? '').trim()
    .replace(/\r?\n+/g, '；')
    .replace(/,/g, '，').replace(/;/g, '；').replace(/:/g, '：')
    .replace(/\?/g, '？').replace(/!/g, '！')
    .replace(/\(/g, '（').replace(/\)/g, '）')
    .replace(/\[/g, '【').replace(/\]/g, '】')
  return escapeXml(chinesePunctuation)
}

function blackTextRun(run: string) {
  if (/<w:rPr(?: [^>]*)?>[\s\S]*?<w:color\b/.test(run)) {
    return run.replace(/(<w:color\b[^>]*w:val=")[^"]*("[^>]*>)/, (_match, prefix, suffix) => `${prefix}000000${suffix}`)
  }
  if (/<w:rPr(?: [^>]*)?>/.test(run)) {
    return run.replace(/<\/w:rPr>/, '<w:color w:val="000000"/></w:rPr>')
  }
  return run.replace(/(<w:r(?: [^>]*)?>)/, '$1<w:rPr><w:color w:val="000000"/></w:rPr>')
}

function blackenFirstTextRun(xml: string) {
  let done = false
  return xml.replace(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g, run => {
    if (done || !/<w:t(?: [^>]*)?>/.test(run)) return run
    done = true
    return blackTextRun(run)
  })
}

function replaceTextRuns(paragraph: string, value: unknown) {
  const replacement = valueOf(value)
  let replaced = false
  const output = paragraph.replace(/<w:t( [^>]*)?>([\s\S]*?)<\/w:t>/g, (run, attrs = '') => {
    if (replaced) return `<w:t${attrs}></w:t>`
    replaced = true
    const textAttrs = attrs.includes('xml:space=') ? attrs : `${attrs} xml:space="preserve"`
    return `<w:t${textAttrs}>${replacement}</w:t>`
  })
  return replaced
    ? blackenFirstTextRun(output)
    : output.replace('</w:p>', `<w:r><w:rPr><w:color w:val="000000"/></w:rPr><w:t xml:space="preserve">${replacement}</w:t></w:r></w:p>`)
}

function appendValueToCell(cell: string, value: unknown) {
  const replacement = valueOf(value)
  const paragraphs = [...cell.matchAll(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g)]
  const empty = [...paragraphs].reverse().find(paragraph => !textOf(paragraph[0]).trim())
  if (empty) {
    const filled = replaceTextRuns(empty[0], value)
    return `${cell.slice(0, empty.index)}${filled}${cell.slice((empty.index || 0) + empty[0].length)}`
  }
  return cell.replace('</w:tc>', `<w:p><w:r><w:rPr><w:color w:val="000000"/></w:rPr><w:t xml:space="preserve">${replacement}</w:t></w:r></w:p></w:tc>`)
}

function replaceCellAfterLabel(xml: string, label: string, value: unknown) {
  const cells = [...xml.matchAll(/<w:tc(?: [^>]*)?>[\s\S]*?<\/w:tc>/g)]
  const normalizedLabel = label.replace(/\s/g, '')
  const index = cells.findIndex(cell => textOf(cell[0]).replace(/\s/g, '') === normalizedLabel)
  const target = cells[index + 1]
  if (index < 0 || !target || !valueOf(value)) return xml
  const cell = target[0]
  const filled = /<w:t(?: [^>]*)?>/.test(cell)
    ? replaceTextRuns(cell, value)
    : cell.replace('</w:tc>', `<w:p><w:r><w:t xml:space="preserve">${valueOf(value)}</w:t></w:r></w:p></w:tc>`)
  return `${xml.slice(0, target.index)}${filled}${xml.slice((target.index || 0) + cell.length)}`
}

function appendToCell(xml: string, label: string, value: unknown) {
  if (!valueOf(value)) return xml
  const cells = [...xml.matchAll(/<w:tc(?: [^>]*)?>[\s\S]*?<\/w:tc>/g)]
  const target = cells.find(cell => textOf(cell[0]).replace(/\s/g, '').includes(label.replace(/\s/g, '')))
  if (!target) return xml
  const filled = appendValueToCell(target[0], value)
  return `${xml.slice(0, target.index)}${filled}${xml.slice((target.index || 0) + target[0].length)}`
}

function appendToParagraph(xml: string, label: string, value: unknown) {
  if (!valueOf(value)) return xml
  const paragraphs = [...xml.matchAll(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g)]
  const target = paragraphs.find(paragraph => textOf(paragraph[0]).replace(/\s/g, '') === label.replace(/\s/g, ''))
  if (!target) return xml
  const filled = target[0].replace('</w:p>', `<w:r><w:rPr><w:color w:val="000000"/></w:rPr><w:t xml:space="preserve"> ${valueOf(value)}</w:t></w:r></w:p>`)
  return `${xml.slice(0, target.index)}${filled}${xml.slice((target.index || 0) + target[0].length)}`
}

/**
 * 封面字段与正文表格不同：标签、下划线和填写区在同一段落中。
 * 不能把值追加到段末，否则会继承标签样式并破坏封面版式。
 */
function replaceCoverField(xml: string, label: string, value: unknown) {
  const replacement = valueOf(value)
  if (!replacement) return xml
  const normalizedLabel = label.replace(/\s/g, '')
  const paragraphs = [...xml.matchAll(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g)]
  const target = paragraphs.find(paragraph => textOf(paragraph[0]).replace(/\s/g, '').startsWith(normalizedLabel))
  if (!target) return xml

  const paragraph = target[0]
  const pPr = paragraph.match(/<w:pPr(?: [^>]*)?>[\s\S]*?<\/w:pPr>/)?.[0] || ''
  const runs = [...paragraph.matchAll(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g)].map(run => run[0])
  const labelRun = runs[0] || '<w:r><w:rPr><w:sz w:val="30"/></w:rPr><w:t/></w:r>'
  const valueRun = [...runs].reverse().find(run => /<w:u\b/.test(run)) || runs.at(-1) || labelRun
  const rawText = textOf(paragraph)
  let significant = 0
  let labelEnd = rawText.length
  for (let index = 0; index < rawText.length; index += 1) {
    if (!/\s/.test(rawText[index])) significant += 1
    if (significant === normalizedLabel.length) { labelEnd = index + 1; break }
  }
  const labelText = rawText.slice(0, labelEnd).replace(/\s+$/, '')
  const rewriteRun = (run: string, text: string) => {
    const rPr = run.match(/<w:rPr(?: [^>]*)?>[\s\S]*?<\/w:rPr>/)?.[0] || ''
    return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  }
  const filled = paragraph.replace(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/, match => {
    const open = match.match(/^<w:p(?: [^>]*)?>/)?.[0] || '<w:p>'
    return `${open}${pPr}${rewriteRun(labelRun, `${labelText}  `)}${rewriteRun(valueRun, replacement)}</w:p>`
  })
  return `${xml.slice(0, target.index)}${filled}${xml.slice((target.index || 0) + paragraph.length)}`
}

function parseSchedules(value: unknown): Array<{ startDate?: string, endDate?: string, start?: string, end?: string, phase?: string, month?: number | string }> {
  const parsed = safeParseJson<Array<{ startDate?: string, endDate?: string, start?: string, end?: string, phase?: string, month?: number | string }>>(value, [])
  return Array.isArray(parsed) ? parsed : []
}

function formatSchedule(value?: { startDate?: string, endDate?: string, start?: string, end?: string }) {
  const startDate = value?.startDate || value?.start
  const endDate = value?.endDate || value?.end
  if (!startDate && !endDate) return ''
  const format = (date?: string) => date ? date.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$1年$2月$3日') : ''
  const start = format(startDate)
  const end = format(endDate)
  return start && end && start !== end ? `${start}—${end}` : start || end
}

function fillTaskBookSchedule(xml: string, record: Record<string, any>) {
  const schedules = parseSchedules(record.topicSchedules)
  const selected = parseSchedules(record.schedule)
  const phaseConfig = (safeParseJson<Record<string, any>>(record.phasesConfig, {}) || {})
  const phase = (name: string) => formatSchedule(phaseConfig[name])
  const selectedValue = (label: string) => {
    const item = selected.find((entry: any) => entry.phase === label)
    return item?.month ? `${item.month}月份` : ''
  }
  const values: Array<[string, string]> = [
    ['选题、下达任务书', selectedValue('选题、下达任务书') || phase('task_book')],
    ['实施研究、收集资料', selectedValue('实施研究、收集资料') || formatSchedule(schedules[0])],
    ['开题报告', selectedValue('开题报告') || phase('proposal')],
    ['撰写设计报告、完成初稿', selectedValue('撰写设计报告、完成初稿') || formatSchedule(schedules[1])],
    ['毕业设计中期检查', selectedValue('毕业设计中期检查') || phase('midterm')],
    ['完成修改、定稿', selectedValue('完成修改、定稿') || phase('thesis_design')],
    ['学术不端检测', selectedValue('学术不端检测') || phase('thesis_design')],
    ['答辩、展览', selectedValue('答辩、展览') || phase('defense')],
  ]
  return values.reduce((result, [label, value]) => value ? replaceCellAfterLabel(result, label, value) : result, xml)
}

function fillMetadata(xml: string, record: Record<string, any>) {
  const cellFields = [
    ['学院名称', record.collegeName || '视觉传达设计学院'], ['学       院', record.collegeName || '视觉传达设计学院'], ['专业（方向）', record.major], ['班       级', record.className],
    ['年级专业班级', record.className], ['学生姓名', record.studentName], ['姓       名', record.studentName],
    ['学号', record.studentCode], ['指导教师', record.teacherName], ['指 导 教 师', record.teacherName]
  ]
  return cellFields.reduce((result, [label, value]) => replaceCellAfterLabel(result, label, value), xml)
}

function taskBook(xml: string, record: Record<string, any>) {
  let output = fillMetadata(xml, record)
  output = [
    ['学       院', record.collegeName || '视觉传达设计学院'], ['专 业（方向）', record.major], ['班       级', record.className], ['姓       名', record.studentName],
    ['学       号', record.studentCode], ['指 导 教 师', record.teacherName]
  ].reduce((result, [label, value]) => replaceCoverField(result, label, value), output)
  output = replaceCellAfterLabel(output, '题目', record.title || record.topicTitle)
  output = replaceCoverField(output, '毕业设计题目', record.title || record.topicTitle)
  output = replaceCellAfterLabel(output, '设计目的和意义', record.content)
  output = replaceCellAfterLabel(output, '设计主要内容', record.mainContent)
  output = appendToCell(output, '二、具体要求', record.specificRequirements || record.requirements)
  return fillTaskBookSchedule(output, record)
}

function proposal(xml: string, record: Record<string, any>) {
  let output = fillMetadata(xml, record)
  output = replaceCellAfterLabel(output, '任务书题目', record.topicTitle)
  output = replaceCellAfterLabel(output, '开题报告题目', record.title)
  output = replaceCellAfterLabel(output, '设计的目的和意义（市场价值等）', record.background)
  output = replaceCellAfterLabel(output, '设计内容和预期成果', record.objectives)
  output = replaceCellAfterLabel(output, '拟采取的设计方法和手段（技术）', record.methods)
  output = replaceCellAfterLabel(output, '毕业设计方案（步骤）或毕业设计报告提纲', record.plan)
  output = replaceCellAfterLabel(output, '指导教师意见', record.teacherComment)
  return output
}

function midterm(xml: string, record: Record<string, any>) {
  let output = fillMetadata(xml, record)
  output = replaceCellAfterLabel(output, '题目', record.topicTitle)
  output = appendToCell(output, '目前已完成工作', record.completedWork)
  output = appendToCell(output, '目前存在的主要问题', record.problems)
  output = appendToCell(output, '下一步的主要任务', record.nextPlan)
  output = appendToCell(output, '指导教师意见', record.teacherComment)
  return output
}

export function createOfficialDocx(type: OfficialDocumentType, record: Record<string, any>, templateBuffer?: Buffer) {
  const templatePath = path.join(templateDir, `${type}.docx`)
  const zip = new PizZip(templateBuffer || readTemplateCached(templatePath))
  const documentXml = zip.file('word/document.xml')
  if (!documentXml) throw new Error('导出模板损坏：缺少 word/document.xml')
  const xml = documentXml.asText()
  const output = type === 'task-book' ? taskBook(xml, record) : type === 'proposal' ? proposal(xml, record) : midterm(xml, record)
  zip.file('word/document.xml', output)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export function officialFilename(type: OfficialDocumentType, record: Record<string, any>) {
  const label = type === 'task-book' ? '毕业设计任务书' : type === 'proposal' ? '毕业设计开题报告' : '毕业设计中期检查表'
  return `${record.studentName || '学生'}_${label}.docx`
}

// 供 createSubmissionRouter 与 taskBooks 路由共用的导出发送逻辑
export async function sendOfficialDocx(
  res: Response,
  type: OfficialDocumentType,
  record: Record<string, any>,
  status: string,
  passStatus: string,
) {
  const template = await resolvePublishedTemplate(type, record.cycle_id ?? record.cycleId)
  const filename = `${status === passStatus ? '' : '预览版_'}${officialFilename(type, record)}`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.send(createOfficialDocx(type, record, template))
}
