import crypto from 'node:crypto'
import PizZip from 'pizzip'

export type TemplateType = 'task_book' | 'proposal' | 'midterm'
export type TemplateSource = 'fixed' | 'student' | 'system' | 'teacher'
export interface TemplateField {
  id: string
  start: number
  end: number
  label: string
  source: TemplateSource
  key: string
  prefix?: string
  required: boolean
  value?: string
  original: string
}
export interface TemplateProfile {
  schemaVersion: 1
  type: TemplateType
  sha256: string
  paragraphCount: number
  fields: TemplateField[]
  warnings: string[]
}
export class TemplateError extends Error {
  status = 409
}
const textPattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
const paragraphPattern = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g
const normalize = (text: string) => text.replace(/\s/g, '')
export const templateHash = (buffer: Buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const decode = (text: string) => text.replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const escape = (text: unknown) => String(text ?? '').replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[char]!))
const textOf = (xml: string) => [...xml.matchAll(textPattern)].map(m => decode(m[1])).join('')

function readDocument(buffer: Buffer) {
  try {
    const zip = new PizZip(buffer)
    const xml = zip.file('word/document.xml')?.asText()
    if (!xml || !/<w:body\b/.test(xml) || !zip.file('[Content_Types].xml')) throw new Error()
    if (xml.length > 4_000_000) throw new TemplateError('模板正文过大，请精简后重新上传')
    // 内嵌表格会使段落所属单元格不明确，先拒绝，避免误写内容。
    let depth = 0
    for (const tag of xml.matchAll(/<\/?w:tbl(?:\s[^>]*)?>/g)) {
      depth += tag[0].startsWith('</') ? -1 : 1
      if (depth > 1) throw new TemplateError('模板包含嵌套表格，请改为普通表格后上传')
    }
    const cells = [...xml.matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)]
    const paragraphs = [...xml.matchAll(paragraphPattern)].map((m, i) => ({
      index: i, offset: m.index!, xml: m[0], text: textOf(m[0]),
      cell: cells.findIndex(c => m.index! >= c.index! && m.index! < c.index! + c[0].length),
    }))
    if (!paragraphs.length || paragraphs.length > 2000) throw new TemplateError('模板段落数不支持，请检查模板')
    return { zip, xml, paragraphs }
  } catch (cause) {
    if (cause instanceof TemplateError) throw cause
    throw new TemplateError('无法读取模板，请上传有效的 DOCX 文件')
  }
}

const definitions: Array<[string, string, TemplateSource, string[]]> = [
  ['collegeName', '学院名称', 'system', ['学院名称', '学 院']],
  ['major', '专业（方向）', 'system', ['专业（方向）']],
  ['className', '班级', 'system', ['年级专业班级', '班 级']],
  ['studentName', '学生姓名', 'system', ['学生姓名', '姓 名']],
  ['studentCode', '学号', 'system', ['学号', '学 号']],
  ['teacherName', '指导教师', 'system', ['指导教师', '指 导 教 师']],
  ['topicTitle', '任务书题目', 'system', ['任务书题目']],
  ['title', '毕业设计题目', 'student', ['题目', '开题报告题目']],
  ['content', '设计目的和意义', 'student', ['设计目的和意义']],
  ['mainContent', '设计主要内容', 'student', ['设计主要内容']],
  ['background', '设计的目的和意义（市场价值等）', 'student', ['设计的目的和意义（市场价值等）']],
  ['objectives', '设计内容和预期成果', 'student', ['设计内容和预期成果']],
  ['methods', '拟采取的设计方法和手段（技术）', 'student', ['拟采取的设计方法和手段（技术）']],
  ['plan', '毕业设计方案（步骤）或毕业设计报告提纲', 'student', ['毕业设计方案（步骤）或毕业设计报告提纲']],
]
const systemKeys = ['collegeName', 'major', 'className', 'studentName', 'studentCode', 'teacherName', 'topicTitle', 'title']

export function inspectTemplate(type: TemplateType, buffer: Buffer): TemplateProfile {
  const { paragraphs } = readDocument(buffer)
  const fields: TemplateField[] = []
  const occupied = new Set<number>()
  function add(start: number, end: number, key: string, label: string, source: TemplateSource, prefix?: string) {
    if (start > end || paragraphs.slice(start, end + 1).some(p => occupied.has(p.index))) return
    const original = paragraphs.slice(start, end + 1).map(p => p.text).join('\n')
    fields.push({ id: `p${start}`, start, end, key, label, source, required: source === 'student', original, ...(prefix ? { prefix } : {}) })
    for (let i = start; i <= end; i++) occupied.add(i)
  }
  const cells = [...new Set(paragraphs.filter(p => p.cell >= 0).map(p => p.cell))]
  for (const cell of cells) {
    const items = paragraphs.filter(p => p.cell === cell)
    const label = normalize(items.map(p => p.text).join(''))
    const def = definitions.find(d => d[3].some(s => normalize(s) === label))
    if (def) {
      const target = paragraphs.filter(p => p.cell === cell + 1)
      if (target.length) {
        const end = target.findIndex(p => /是否同意|签字|签名/.test(p.text))
        let key = def[0], source = def[2]
        if (type === 'midterm' && key === 'title') { key = 'topicTitle'; source = 'system' }
        add(target[0].index, end >= 0 ? target[Math.max(0, end - 1)].index : target.at(-1)!.index, key, def[1], source)
      }
    }
    for (let i = 0; i < items.length; i++) {
      const p = items[i], text = normalize(p.text)
      let key = '', label = '', source: TemplateSource = 'student'
      if (/^[一1、.]*基本要求/.test(text)) { key = 'requirements'; label = '基本要求'; source = 'fixed' }
      if (/^[二2、.]*具体要求/.test(text)) { key = 'specificRequirements'; label = '具体要求' }
      if (/^(?:一[、.]?)?目前已完成工作/.test(text)) { key = 'completedWork'; label = p.text.trim() }
      if (/^(?:二[、.]?)?目前存在的主要问题/.test(text)) { key = 'problems'; label = p.text.trim() }
      if (/^(?:三[、.]?)?下一步的主要任务/.test(text)) { key = 'nextPlan'; label = p.text.trim() }
      if (key) {
        let end = i + 1
        while (end < items.length && !/^[一二三四五六七八九十][、.．]|签字|签名|是否同意/.test(normalize(items[end].text))) end++
        if (i + 1 < end) add(items[i + 1].index, items[end - 1].index, key, label, source)
      }
      if (/^意见[：:]/.test(text)) {
        let end = i + 1
        while (end < items.length && !/签字|签名|是否同意/.test(items[end].text)) end++
        add(p.index, items[end - 1].index, 'teacherComment', '指导教师意见', 'teacher', '意见：')
      }
    }
  }
  // 封面没有单独标签单元格：保留标签的空格，仅替换填写值。
  for (const p of paragraphs.filter(p => p.cell < 0)) {
    for (const [key, label, , aliases] of definitions.filter(d => d[2] === 'system')) {
      const alias = aliases.find(a => normalize(p.text).startsWith(normalize(a)))
      if (!alias) continue
      let significant = 0, end = 0
      for (; end < p.text.length; end++) {
        if (!/\s/.test(p.text[end])) significant++
        if (significant === normalize(alias).length) { end++; break }
      }
      const prefix = p.text.slice(0, end) + '  '
      add(p.index, p.index, key, label, 'system', prefix)
      break
    }
  }
  if (type === 'task_book') {
    const heading = paragraphs.findIndex(p => p.cell < 0 && normalize(p.text) === '毕业设计任务书')
    const title = paragraphs.slice(heading + 1).find(p => p.cell < 0 && p.text.trim() && !occupied.has(p.index))
    if (heading >= 0 && title) add(title.index, title.index, 'title', '毕业设计题目', 'student')
  }
  for (const p of paragraphs) {
    if (!occupied.has(p.index) && p.text.trim()) add(p.index, p.index, `fixed_${p.index}`, p.text.trim().slice(0, 45), 'fixed')
  }
  fields.sort((a, b) => a.start - b.start)
  return { schemaVersion: 1, type, sha256: templateHash(buffer), paragraphCount: paragraphs.length, fields,
    warnings: ['请逐项核对填写区；未映射区域保持原样。新增或改名栏目可手动指定。签名区域请保持固定。'] }
}

export function validateTemplateProfile(profile: TemplateProfile, buffer: Buffer): string[] {
  const { paragraphs } = readDocument(buffer)
  const errors: string[] = [], occupied = new Set<number>(), ids = new Set<string>()
  if (profile?.schemaVersion !== 1 || !['task_book', 'proposal', 'midterm'].includes(profile.type)) return ['模板配置类型无效']
  if (profile.sha256 !== templateHash(buffer) || profile.paragraphCount !== paragraphs.length) errors.push('模板文件已变化，请重新识别')
  if (!Array.isArray(profile.fields) || profile.fields.length > 2000) return ['模板字段配置无效']
  for (const f of profile.fields) {
    if (!f || typeof f.id !== 'string' || ids.has(f.id)) { errors.push('字段编号重复或无效'); continue }
    ids.add(f.id)
    if (!Number.isInteger(f.start) || !Number.isInteger(f.end) || f.start < 0 || f.end < f.start || f.end >= paragraphs.length) { errors.push('填写范围无效'); continue }
    if (!['fixed', 'system', 'student', 'teacher'].includes(f.source) || typeof f.label !== 'string' || !f.label.trim() || f.label.length > 500) errors.push('字段来源或名称无效')
    if (typeof f.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(f.key) || ['__proto__', 'constructor', 'prototype'].includes(f.key)) errors.push('字段标识无效')
    if (typeof f.original !== 'string' || typeof f.required !== 'boolean') errors.push('字段原文或必填配置无效')
    if (f.source === 'system' && !systemKeys.includes(f.key)) errors.push(`不支持的系统字段：${f.key}`)
    if (f.source === 'teacher' && f.key !== 'teacherComment') errors.push('教师字段仅支持指导意见')
    if (f.prefix !== undefined && (typeof f.prefix !== 'string' || f.prefix.length > 500)) errors.push('字段前缀无效')
    if (f.value !== undefined && (typeof f.value !== 'string' || f.value.length > 50000)) errors.push('固定内容过长或无效')
    for (let i = f.start; i <= f.end; i++) {
      if (occupied.has(i)) errors.push('填写范围重叠，请调整后再发布')
      occupied.add(i)
    }
    if (f.source !== 'fixed' && paragraphs.slice(f.start, f.end + 1).some(p =>
      /<w:(?:object|fldChar|sdt|txbxContent)\b/.test(p.xml) ||
      [...p.xml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g)].some(m => /<w:t\b/.test(m[0]))
    )) errors.push(`${f.label}包含复杂对象，请将其保留为固定区域`)
  }
  if (!profile.fields.some(f => f.source === 'student')) errors.push('请至少指定一个学生填写区')
  return [...new Set(errors)]
}

export function studentTemplateFields(profile: TemplateProfile) {
  return profile.fields.filter((f, i, all) => f.source === 'student' && all.findIndex(x => x.source === 'student' && x.key === f.key) === i)
    .map(f => ({ ...f, required: profile.fields.some(x => x.source === 'student' && x.key === f.key && x.required) }))
}

export function canonicalTemplateProfile(profile: TemplateProfile, buffer: Buffer): TemplateProfile {
  const errors = validateTemplateProfile(profile, buffer)
  if (errors.length) throw new TemplateError(errors.join('；'))
  const { paragraphs } = readDocument(buffer)
  return { ...profile, fields: profile.fields.map(f => ({ ...f,
    original: paragraphs.slice(f.start, f.end + 1).map(p => p.text).join('\n'),
  })) }
}

function fillParagraph(xml: string, value: string) {
  // 保留 pPr/rPr 和其他节点；只替换文本，后续文字节点清空，避免残留示例文字。
  let placed = false
  const encoded = value.split(/\r?\n/).map(escape).join('</w:t><w:br/><w:t xml:space="preserve">')
  const result = xml.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, () => {
    if (placed) return '<w:t xml:space="preserve"></w:t>'
    placed = true
    return `<w:t xml:space="preserve">${encoded}</w:t>`
  })
  return placed ? result : result.replace('</w:p>', `<w:r><w:t xml:space="preserve">${encoded}</w:t></w:r></w:p>`)
}

export function renderTemplate(buffer: Buffer, profile: TemplateProfile, values: Record<string, unknown>, record: Record<string, any>) {
  const errors = validateTemplateProfile(profile, buffer)
  if (errors.length) throw new TemplateError(errors.join('；'))
  const { zip, xml, paragraphs } = readDocument(buffer)
  const replacements = new Map<number, string>()
  for (const f of profile.fields) {
    if (f.source === 'fixed' && f.value === undefined) continue
    const templateCollege = f.prefix ? normalize(f.original).slice(normalize(f.prefix).length) : f.original.trim()
    const raw = f.source === 'fixed' ? f.value : f.source === 'student' ? values[f.key]
      : f.key === 'collegeName' ? record.collegeName || templateCollege || '视觉传达设计学院' : record[f.key]
    const value = String(raw ?? (f.key === 'title' ? record.topicTitle || '' : ''))
    for (let i = f.start; i <= f.end; i++) replacements.set(i, fillParagraph(paragraphs[i].xml, i === f.start ? (f.source === 'fixed' ? '' : f.prefix || '') + value : ''))
  }
  let output = xml
  for (const p of [...paragraphs].reverse()) {
    const replacement = replacements.get(p.index)
    if (replacement !== undefined) output = output.slice(0, p.offset) + replacement + output.slice(p.offset + p.xml.length)
  }
  zip.file('word/document.xml', output)
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
