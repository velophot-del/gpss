import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
const contract = await import('../server/dist/utils/templateContract.js')
const buffer = fs.readFileSync(new URL('../server/src/assets/process-templates/task-book.docx', import.meta.url))
const profile = contract.inspectTemplate('task_book', buffer)
const clone = value => structuredClone(value)

function fixture({ bound = 0, failLog = false } = {}) {
  const rows = new Map([['source', { id: 'source', cycle_id: 1, document_type: 'task_book', title: '任务书', version: '2027-1', description: null, original_name: '任务书.docx', storage_key: 'source.docx', mime_type: 'application/docx', size: buffer.length, status: 'published', published_at: '2026-11-01', updated_at: '2026-11-01' }]])
  const contracts = new Map([['source', { profile: clone(profile), confirmed_at: '2026-11-01' }]])
  const files = new Map([['source.docx', buffer]])
  const logs = [], statements = []
  let bindings = bound, sequence = 0
  const readRow = id => rows.has(id) ? [{ ...clone(rows.get(id)), ...clone(contracts.get(id) || {}) }] : []
  async function sql(statement, params = []) {
    statements.push(statement)
    if (statement.includes('SELECT dt.*')) return readRow(params[0])
    if (statement.includes('COUNT(*)')) return [{ total: bindings }]
    if (statement.includes('SELECT version')) return [...rows.values()].filter(r => r.id !== params[2]).map(r => ({ version: r.version }))
    if (statement.startsWith('UPDATE document_templates')) {
      const [title, version, description, id] = params
      Object.assign(rows.get(id), { title, version, description, updated_at: '2026-11-06' }); return []
    }
    if (statement.includes('INSERT INTO document_templates')) {
      const [id, cycle_id, document_type, title, version, description, original_name, storage_key, mime_type, size, status, created_by] = params
      if ([...rows.values()].some(r => r.cycle_id === cycle_id && r.document_type === document_type && r.version === version)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
      rows.set(id, { id, cycle_id, document_type, title, version, description, original_name, storage_key, mime_type, size, status, created_by }); return []
    }
    if (statement.includes('INSERT INTO document_template_contracts')) {
      const [id, json, actor] = params; contracts.set(id, { profile: JSON.parse(json), confirmed_at: '2026-11-06', confirmed_by: actor }); return []
    }
    if (statement.includes('INSERT INTO operation_logs')) {
      if (failLog) throw new Error('audit unavailable')
      logs.push(params);return []
    }
    throw new Error('unhandled SQL: '+statement)
  }
  const deps = {
    'node:crypto': { default: crypto }, 'node:path': { default: path },
    'node:fs': { default: { constants: { COPYFILE_EXCL: 1 }, copyFileSync: (from, to) => { assert.ok(files.has(path.basename(from)));assert.ok(!files.has(path.basename(to)));files.set(path.basename(to), files.get(path.basename(from))) }, unlinkSync: file => files.delete(path.basename(file)) } },
    uuid: { v4: () => 'copy-'+(++sequence) },
    '../config/database.js': { query: sql, transaction: async fn => {
      const beforeRows = clone(rows), beforeContracts = clone(contracts), beforeLogs = clone(logs)
      try { return await fn({ query: async (s,p) => [await sql(s,p)] }) }
      catch(e){ rows.clear();for(const [k,v]of beforeRows)rows.set(k,v);contracts.clear();for(const [k,v]of beforeContracts)contracts.set(k,v);logs.splice(0,logs.length,...beforeLogs);throw e }
    } },
    '../utils/privateTemplates.js': { privateTemplateRoot: () => '/private' },
    '../utils/templateContract.js': contract,
    './materialTemplateService.js': { isTemplateType: type => ['task_book','proposal','midterm'].includes(type), parseProfile: value => typeof value === 'string' ? JSON.parse(value) : value, readUploadedTemplate: row => files.get(row.storage_key) },
  }
  const source = fs.readFileSync(new URL('../server/src/services/templateEditingService.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const module = {exports:{}}
  new Function('require','module','exports',code)(name=>{assert.ok(deps[name],name);return deps[name]},module,module.exports)
  const service=module.exports
  async function input(){const state=await service.getTemplateEditState('source');return {title:'任务书修订',version:'2027-1',description:'新说明',profile:clone(state.profile),revision:state.revision,confirmMapping:true}}
  return {service,input,rows,contracts,files,logs,statements,setBindings:n=>{bindings=n}}
}

test('unbound published templates update metadata and fixed content in place',async()=>{
 const f=fixture(),input=await f.input(); const fixed=input.profile.fields.find(x=>x.source==='fixed');fixed.value='新固定内容'
 const result=await f.service.editPublishedTemplate('source',input,{id:'admin'})
 assert.equal(result.mode,'updated');assert.equal(result.id,'source');assert.equal(f.rows.get('source').title,'任务书修订');assert.equal(f.rows.get('source').status,'published')
 assert.equal(f.contracts.get('source').profile.fields.find(x=>x.id===fixed.id).value,'新固定内容');assert.equal(f.files.size,1);assert.equal(f.logs.length,1)
})

test('bound templates produce independent published versions and preserve the source',async()=>{
 const f=fixture({bound:1}),input=await f.input(),before=clone(f.rows.get('source')),oldProfile=clone(f.contracts.get('source'))
 const result=await f.service.editPublishedTemplate('source',input,{id:'admin'})
 assert.equal(result.mode,'versioned');assert.notEqual(result.id,'source');assert.equal(result.version,'2027-1-r2');assert.deepEqual(f.rows.get('source'),before);assert.deepEqual(f.contracts.get('source'),oldProfile)
 const newKey=f.rows.get(result.id).storage_key;assert.notEqual(newKey,'source.docx');assert.deepEqual(f.files.get(newKey),buffer)
 f.files.delete(newKey);assert.deepEqual(f.files.get('source.docx'),buffer)
})

test('binding created while the editor is open changes saving to versioned mode',async()=>{
 const f=fixture(),input=await f.input();f.setBindings(1)
 assert.equal((await f.service.editPublishedTemplate('source',input,{id:'admin'})).mode,'versioned')
 assert.ok(f.statements.some(s=>s.includes('FOR UPDATE')))
})

test('stale editors cannot overwrite a saved change',async()=>{
 const f=fixture(),input=await f.input();await f.service.editPublishedTemplate('source',input,{id:'admin'})
 await assert.rejects(f.service.editPublishedTemplate('source',{...input,title:'过期覆盖'},{id:'admin'}),/变化|刷新/)
 assert.equal(f.rows.get('source').title,'任务书修订')
})

test('invalid metadata, unconfirmed profile and mismatched template type are rejected',async()=>{
 for(const change of [{title:''},{version:'x'.repeat(51)},{description:3},{confirmMapping:false},{profile:{...clone(profile),type:'proposal'}}]){
  const f=fixture(),input=await f.input();await assert.rejects(f.service.editPublishedTemplate('source',{...input,...change},{id:'admin'}));assert.equal(f.rows.size,1);assert.equal(f.logs.length,0)
 }
})

test('failed version creation rolls back data and removes only its copied file',async()=>{
 const f=fixture({bound:1,failLog:true}),input=await f.input()
 await assert.rejects(f.service.editPublishedTemplate('source',input,{id:'admin'}),/audit/)
 assert.equal(f.rows.size,1);assert.equal(f.files.size,1);assert.ok(f.files.has('source.docx'))
})

test('duplicate versions are rejected and automatic revisions skip existing labels',async()=>{
 const f=fixture({bound:1}),input=await f.input()
 f.rows.set('other',{...clone(f.rows.get('source')),id:'other',version:'2027-1-r2'})
 await assert.rejects(f.service.editPublishedTemplate('source',{...input,version:'2027-1-r2'},{id:'admin'}),/版本已存在/)
 assert.equal(f.files.size,1)
 assert.equal((await f.service.editPublishedTemplate('source',input,{id:'admin'})).version,'2027-1-r3')
})

test('status or configuration changes invalidate an open editor even when metadata is unchanged',async()=>{
 for(const kind of ['status','profile']){
  const f=fixture(),input=await f.input()
  if(kind==='status')f.rows.get('source').status='archived'
  else f.contracts.get('source').profile.fields[0].value='另一管理员已修改'
  await assert.rejects(f.service.editPublishedTemplate('source',input,{id:'admin'}),/变化|修改/)
  assert.equal(f.logs.length,0)
 }
})

test('failed in-place edits restore metadata and configuration together',async()=>{
 const f=fixture({failLog:true}),input=await f.input(),before=clone(f.contracts.get('source'))
 await assert.rejects(f.service.editPublishedTemplate('source',input,{id:'admin'}),/audit/)
 assert.equal(f.rows.get('source').title,'任务书');assert.deepEqual(f.contracts.get('source'),before)
})

test('non-DOCX published documents support metadata editing without an online profile',async()=>{
 const f=fixture();Object.assign(f.rows.get('source'),{document_type:'other',original_name:'参考.pdf'})
 const input=await f.input();assert.equal(input.profile,null)
 const result=await f.service.editPublishedTemplate('source',input,{id:'admin'})
 assert.equal(result.mode,'updated');assert.equal(f.rows.get('source').title,'任务书修订')
})

test('both editing routes require administrators; teacher and student roles cannot pass the real role middleware',()=>{
 const route=fs.readFileSync(new URL('../server/src/routes/documentTemplates.ts',import.meta.url),'utf8')
 for(const verb of ['get','put'])assert.ok(route.includes(`router.${verb}('/:id/edit', requireRole(['admin'])`))
 const source=fs.readFileSync(new URL('../server/src/middleware/auth.ts',import.meta.url),'utf8')
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
 const module={exports:{}}
 const deps={jsonwebtoken:{default:{}},'../config/database.js':{},'../utils/policies.js':{resolveJwtSecret:()=> 'test-only-secret'}}
 new Function('require','module','exports',code)(name=>deps[name],module,module.exports)
 for(const role of ['student','teacher','admin']){
  let next=false,status
  const res={status(code){status=code;return this},json(){}}
  module.exports.requireRole(['admin'])({user:{id:'user',role}},res,()=>{next=true})
  assert.equal(next,role==='admin');if(role!=='admin')assert.equal(status,403)
 }
})
