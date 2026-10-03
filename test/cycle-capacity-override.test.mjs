import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {getReviewDeadline,getTeacherStudentLimit} from '../server/dist/utils/policies.js'
import {buildSettlementPlan} from '../server/dist/services/selectionMatcher.js'
const source=readFileSync(new URL('../server/src/services/selectionSettlementService.ts',import.meta.url),'utf8')
const fn=source.slice(source.indexOf('export async function getSelectionConfigurationError'),source.indexOf('async function countPendingTopics'))
const module={exports:{}}
let queries=0
const code=ts.transpileModule(fn,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
new Function('exports','getReviewDeadline','getTeacherStudentLimit','query',code)(module.exports,getReviewDeadline,getTeacherStudentLimit,async()=>{queries++;return [{teacher_id:'t',teacher_name:'Teacher',capacity:10}]})
const base={teacher_review:{end:'2026-10-20'},teacher_student_limit:2}
test('cycle capacity override skips aggregate conflict but retains deadline validation',async()=>{
 queries=0
 assert.equal(await module.exports.getSelectionConfigurationError(1,{...base,ignore_capacity_conflicts:true}),null)
 assert.equal(queries,0)
 assert.match(await module.exports.getSelectionConfigurationError(1,{ignore_capacity_conflicts:true}),/截止/)
})
test('other cycles and nonboolean override still enforce aggregate capacity',async()=>{
 assert.match(await module.exports.getSelectionConfigurationError(2,base),/10/)
 assert.match(await module.exports.getSelectionConfigurationError(2,{...base,ignore_capacity_conflicts:'true'}),/10/)
})
test('actual final admissions stay within teacher limit despite aggregate topic capacity',()=>{
 const plan=buildSettlementPlan({teacherLimit:1,lockedAssignments:[],topics:[{topicId:'a',teacherId:'t',capacity:5},{topicId:'b',teacherId:'t',capacity:5}],candidates:[
 {applicationId:'1',studentId:'s1',topicId:'a',teacherId:'t',priority:1,decision:'proposed',decisionRank:1,appliedAt:'2026-10-01'},
 {applicationId:'2',studentId:'s2',topicId:'b',teacherId:'t',priority:1,decision:'proposed',decisionRank:1,appliedAt:'2026-10-01'}]})
 assert.equal(plan.acceptedApplicationIds.length,1)
})
const applySource=source.slice(source.indexOf('async function applySettlement'),source.indexOf('export async function runSelectionSettlement'))
const applyCode=ts.transpileModule(applySource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const apply=new Function('getReviewDeadline','getTeacherStudentLimit','safeParseJson','SelectionSettlementError',applyCode+';return applySettlement')(getReviewDeadline,getTeacherStudentLimit, v=>JSON.parse(v),Error)
test('settlement aggregate barrier respects the cycle override',async()=>{
 async function attempt(override){
  const conn={query:async sql=>{
   if(sql.includes('FROM cycles')) return [[{id:1,phase:'teacher_review',phases_config:JSON.stringify({...base,ignore_capacity_conflicts:override})}]]
   if(sql.includes('unsubmitted') || sql.includes('sb.status IS NULL')) return [[]]
   if(sql.includes('SELECT DISTINCT t.id')) return [[{id:'a',teacher_id:'t',max_students:10,status:'published'}]]
   if(sql.includes("a.status = 'accepted'")) throw new Error('reached actual assignment checks')
   throw new Error('unexpected query')
  }}
  return apply(conn,1,'all_submitted')
 }
 await assert.rejects(attempt(true),/reached actual assignment checks/)
 await assert.rejects(attempt(false),/超过指导上限/)
})
