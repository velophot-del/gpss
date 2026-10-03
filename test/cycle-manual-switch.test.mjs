import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('../src/views/admin/CycleManagement.vue',import.meta.url),'utf8')
const body=source.slice(source.indexOf('async function changeStatus'),source.indexOf('async function handleEdit'))
const code=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
async function switchCycle(status,ignore=false){
 let payload
 const fn=new Function('cycleStore','cycleApi','configurationError','ElMessage','fetchCycles','cycleStatusLabel',code+';return changeStatus')(
 {cycles:[{id:1,status,ignoreCapacityConflicts:ignore}]},{update:async(_,data)=>{payload=data}}, {value:''},{success:()=>{},error:()=>{}},async()=>{},{review:'审核中'})
 await fn(1,'review')
 return payload
}
test('manual switching current cycle persists capacity exception in the same request',async()=>{
 const p=await switchCycle('selection')
 assert.equal(p.phasesConfig.ignore_capacity_conflicts,true)
 assert.equal(p.phasesConfig.phase_switch_mode,'manual')
 assert.equal(p.phase,'teacher_review')
})
test('manual switch does not give a new cycle an unrequested capacity exception',async()=>{
 assert.equal((await switchCycle('draft')).phasesConfig.ignore_capacity_conflicts,false)
})
