import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
const source=readFileSync(new URL('../server/src/services/selectionDraftService.ts',import.meta.url),'utf8')
const body=source.slice(source.indexOf('function validateRanks'),source.indexOf('export async function getSelectionDraft'))
const code=ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
const validate=new Function('SelectionDraftError',code+';return validateDraftItems')(Error)
test('lower preference cannot be proposed but can be a reserve',async()=>{
 const conn={query:async()=>[[{id:'a',priority:2}]]}
 await assert.rejects(validate(conn,{id:'t'},[{applicationId:'a',decision:'proposed',decisionRank:1}]),/第一志愿/)
 await assert.doesNotReject(validate(conn,{id:'t'},[{applicationId:'a',decision:'reserve',decisionRank:1}]))
})
test('first preference can be proposed',async()=>{
 await assert.doesNotReject(validate({query:async()=>[[{id:'a',priority:1}]]},{id:'t'},[{applicationId:'a',decision:'proposed',decisionRank:1}]))
})
const policyModule = await import('../server/dist/services/selectionSubmissionService.js')
test('submission explicitly rejects only undecided editable students and migrates old low-choice proposals',async()=>{
 const rows=[{id:'a',priority:1,decision:null},{id:'b',priority:2,decision:'reserve',decision_rank:1},{id:'c',priority:3,decision:'proposed',decision_rank:1}]
 const writes=[]
 const conn={query:async(sql,params)=>{if(sql.trim().startsWith('SELECT'))return [rows];writes.push(params);return [{}]}}
 assert.equal(typeof policyModule.finalizeSelectionDecisions,'function')
 const count=await policyModule.finalizeSelectionDecisions(conn,'batch')
 assert.equal(count,1)
 assert.equal(writes.length,2)
 assert.equal(writes[0].includes('a'),true)
 assert.equal(writes[1].includes('c'),true)
})
import {buildSettlementPlan} from '../server/dist/services/selectionMatcher.js'
const topics=[{topicId:'a',teacherId:'t',capacity:15},{topicId:'b',teacherId:'t',capacity:15}]
function candidates(firstCount){
 return [...Array.from({length:firstCount},(_,i)=>({applicationId:`f${i}`,studentId:`s${i}`,topicId:i%2?'a':'b',teacherId:'t',priority:1,decision:'proposed',decisionRank:i+1,appliedAt:'2026-10-01'})),
 ...Array.from({length:10},(_,i)=>({applicationId:`r${i}`,studentId:`x${i}`,topicId:'a',teacherId:'t',priority:2,decision:'reserve',decisionRank:i+1,appliedAt:'2026-10-01'}))]
}
test('15 first-choice admissions across topics leave no room for replenishment',()=>{
 const plan=buildSettlementPlan({topics,teacherLimit:15,lockedAssignments:[],candidates:candidates(15)})
 assert.equal(plan.acceptedApplicationIds.length,15)
 assert.equal(plan.acceptedApplicationIds.some(id=>id.startsWith('r')),false)
})
test('10 first-choice admissions replenish exactly five reserves across topics',()=>{
 const plan=buildSettlementPlan({topics,teacherLimit:15,lockedAssignments:[],candidates:candidates(10)})
 assert.equal(plan.acceptedApplicationIds.length,15)
 assert.equal(plan.acceptedApplicationIds.filter(id=>id.startsWith('r')).length,5)
})
test('existing admission consumes a seat before first-choice and reserve selection',()=>{
 const plan=buildSettlementPlan({topics,teacherLimit:15,lockedAssignments:[{applicationId:'locked',studentId:'old',topicId:'b',teacherId:'t'}],candidates:candidates(10)})
 assert.equal(plan.acceptedApplicationIds.length,14)
 assert.equal(plan.acceptedApplicationIds.filter(id=>id.startsWith('r')).length,4)
})
