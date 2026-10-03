import test from 'node:test'
import assert from 'node:assert/strict'
const mod = await import('../server/dist/utils/cycleSchedule.js')
const config = {topic_publish:{start:'2026-10-01'},student_apply:{start:'2026-10-02'},teacher_review:{start:'2026-10-04',end:'2026-10-05'},result_announce:'2026-10-06',adjustment:{start:'2026-10-07',end:'2026-10-08'}}
test('Shanghai midnight opens review at the exact boundary',()=>{
 assert.equal(mod.nextScheduledPhase('student_apply',config,new Date('2026-10-03T15:59:59Z')),null)
 assert.equal(mod.nextScheduledPhase('student_apply',config,new Date('2026-10-03T16:00:00Z')),'teacher_review')
})
test('restart advances one stage at a time without skipping review',()=>{
 assert.equal(mod.nextScheduledPhase('topic_submission',config,new Date('2026-10-07T00:00:00Z')),'student_apply')
})
test('manual later stages never rewind and missing starts never advance',()=>{
 assert.equal(mod.nextScheduledPhase('adjustment',config,new Date('2026-10-09')),null)
 assert.equal(mod.nextScheduledPhase('teacher_review',{},new Date('2026-10-09')),null)
})
test('timezone offsets are respected and invalid dates are rejected',()=>{
 assert.equal(mod.parseScheduleDate('2026-10-04T00:00:00+08:00')?.toISOString(),'2026-10-03T16:00:00.000Z')
 assert.equal(mod.parseScheduleDate('2026-02-30'),null)
})

import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { getReviewDeadline, getAdjustmentDeadline } from '../server/dist/utils/policies.js'
import { safeParseJson } from '../server/dist/utils/json.js'
const source = readFileSync(new URL('../server/dist/services/cycleScheduleService.js', import.meta.url), 'utf8').replace(/^import .*;?\n/gm, '').replace('export async function', 'async function')
async function runCycle(phase, options = {}) {
 const row = {id:1, phase, status:options.inactive ? 'draft' : 'review', phases_config:options.manual ? {...config, phase_switch_mode:'manual'} : config, updated_at:'2026-10-01'}
 const events = []
 const context = vm.createContext({Date, nextScheduledPhase:mod.nextScheduledPhase, parseScheduleDate:mod.parseScheduleDate, safeParseJson, getReviewDeadline, getAdjustmentDeadline,
  getSelectionConfigurationError:async()=>options.conflict || null,
  requestSettlementIfReady:async()=>{events.push('settle');if(options.failed) throw new Error('settlement failed'); return {status:'completed'}},
  query:async(sql,params)=>{
   if(sql.startsWith('SELECT id FROM')) return [{id:1}]
   if(sql.startsWith('SELECT *')) return [{...row}]
   if(sql.startsWith('SELECT status')) return [{status:options.incomplete ? 'failed':'completed'}]
   if(sql.startsWith('UPDATE')) {events.push(params[0]);row.phase=params[0];row.status=params[1];return {affectedRows:1}}
   throw new Error(sql)
  }})
 vm.runInContext(source,context)
 const errors = await context.advanceScheduledCycles(new Date(options.now || '2026-10-07T01:00:00Z'))
 return {row,events,errors}
}
test('capacity conflict keeps cycle in student application with a visible error',async()=>{
 const result=await runCycle('student_apply',{conflict:'capacity conflict'})
 assert.equal(result.row.phase,'student_apply');assert.equal(result.events.length,0);assert.match(result.errors[0],/capacity conflict/)
})
test('failed settlement prevents publication and adjustment',async()=>{
 const result=await runCycle('teacher_review',{failed:true})
 assert.equal(result.row.phase,'teacher_review');assert.deepEqual(result.events,['settle']);assert.match(result.errors[0],/settlement failed/)
})
test('restart settles before publication and then opens adjustment',async()=>{
 const result=await runCycle('student_apply')
 assert.deepEqual(result.events,['teacher_review','settle','result_announce','adjustment']);assert.equal(result.errors.length,0)
})
test('draft cycle remains untouched even when all dates have passed',async()=>{
 const result=await runCycle('topic_publish',{inactive:true})
 assert.equal(result.row.phase,'topic_publish');assert.equal(result.events.length,0)
})
test('manual mode prevents time from overriding the administrator stage',async()=>{
 const result=await runCycle('student_apply',{manual:true})
 assert.equal(result.row.phase,'student_apply');assert.equal(result.events.length,0)
})
