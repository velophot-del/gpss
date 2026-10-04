import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import ts from 'typescript'
const require = createRequire(import.meta.url)
const vue = require('vue')
const source = readFileSync(new URL('../src/views/teacher/SelectionReview.vue', import.meta.url),'utf8')
function setup() {
 const hooks=[]; let leave; let rejectConfirm=false; let saves=0
 const rows=[{id:'a',studentId:'a',studentName:'张三',studentCode:'001',priority:1,status:'pending',decision:null},{id:'b',studentId:'b',studentName:'李四',studentCode:'002',priority:2,status:'pending',decision:'reserve'},{id:'c',studentId:'c',studentName:'王五',studentCode:'003',priority:1,status:'accepted',decision:'proposed'}]
 const view={applications:rows,batch:{status:'draft',version:0},topic:{maxStudents:3}}
 const drafts=vue.reactive({drafts:{},loadingTopicIds:[],savingTopicIds:[],submittingTopicIds:[],ordered(id,decision){return this.drafts[id]?.applications.filter(x=>x.decision===decision)||[]},async load(id){this.drafts[id]=structuredClone(view)},setDecision(id,student,decision){this.drafts[id].applications.find(x=>x.id===student).decision=decision},async save(id){saves++;this.drafts[id].batch.version++;return this.drafts[id]},reorder(){}})
 const dependencies={
 vue:{...vue,onMounted:fn=>hooks.push(fn),onUnmounted:()=>{}},
 'vue-router':{onBeforeRouteLeave:fn=>{leave=fn}},
 'element-plus':{ElMessage:{success(){},warning(){},error(){}},ElMessageBox:{async confirm(){if(rejectConfirm)throw 'cancel'}}},
 '../../stores/topic':{useTopicStore:()=>({topics:[{id:'t1'},{id:'t2'}],async fetchMyTopics(){}})},
 '../../stores/cycle':{useCycleStore:()=>({currentPhase:'teacher_review',async fetchCurrentCycle(){}})},
 '../../stores/student':{useStudentStore:()=>({})},'../../stores/selectionDraft':{useSelectionDraftStore:()=>drafts},
 '../../utils/volunteerRules':{formatPriority:()=>'',priorityTagType:()=>''},
 }
 const compiled=compileScript(parse(source).descriptor,{id:'selection-mobile'}).content
 const code=ts.transpileModule(compiled,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const module={exports:{}}
 new Function('require','module','exports',code)(name=>dependencies[name]||require(name),module,module.exports)
 const previous=globalThis.window
 globalThis.window={innerWidth:375,addEventListener(){},removeEventListener(){}}
 const state=module.exports.default.setup({}, {expose(){}})
 globalThis.window=previous
 return {state,drafts,async start(){globalThis.window={innerWidth:375,addEventListener(){},removeEventListener(){}};try{for(const fn of hooks)await fn()}finally{globalThis.window=previous}},setCancel(value){rejectConfirm=value},leave:()=>leave(),saveCount:()=>saves}
}
test('手机筛选按姓名学号、志愿和审核状态组合，已录取不混入拟录取候选',async()=>{
 const h=setup();await h.start();const s=h.state
 assert.equal(s.isMobile.value,true)
 s.searchText.value='002';assert.deepEqual(s.filteredApplications.value.map(x=>x.id),['b'])
 s.searchText.value='';s.priorityFilter.value=1;s.decisionFilter.value='undecided';assert.deepEqual(s.filteredApplications.value.map(x=>x.id),['a'])
 s.decisionFilter.value='proposed';assert.equal(s.filteredApplications.value.length,0)
 s.decisionFilter.value='accepted';assert.deepEqual(s.filteredApplications.value.map(x=>x.id),['c'])
})
test('未保存修改取消切换保留，确认切换丢弃旧修改；保存后清除提醒',async()=>{
 const h=setup();await h.start();const s=h.state
 s.setDecision('a','reserve');assert.equal(s.hasUnsavedChanges.value,true)
 h.setCancel(true);assert.equal(await s.beforeTopicLeave(),false);await s.loadTopic('t2');assert.equal(s.activeTopicId.value,'t1');assert.equal(h.drafts.drafts.t1.applications[0].decision,'reserve')
 assert.equal(await h.leave(),false)
 h.setCancel(false);await s.loadTopic('t2');assert.equal(s.activeTopicId.value,'t2');assert.equal(h.drafts.drafts.t1.applications[0].decision,null)
 s.setDecision('a','proposed');await s.saveDraft();assert.equal(h.saveCount(),1);assert.equal(s.hasUnsavedChanges.value,false)
})
test('名单处理期间不能切换课题、编辑或再次保存',async()=>{
 const h=setup();await h.start();const s=h.state
 h.drafts.savingTopicIds.push('t1');s.setDecision('a','reserve');await s.loadTopic('t2');await s.saveDraft()
 assert.equal(s.activeTopicId.value,'t1');assert.equal(h.drafts.drafts.t1.applications[0].decision,null);assert.equal(h.saveCount(),0)
})

test('加载和手机切换期间，标签必须能同步外部已选课题',async()=>{
 const h=setup();await h.start();const s=h.state
 h.drafts.loadingTopicIds.push('t1')
 assert.equal(await s.beforeTopicLeave('t1'),true)
 assert.equal(await s.beforeTopicLeave('t2'),false)
 h.drafts.loadingTopicIds.length=0;s.switchingTopic.value=true;s.activeTopicId.value='t2'
 assert.equal(await s.beforeTopicLeave('t2'),true)
 assert.equal(await s.beforeTopicLeave('t1'),false)
})

test('第二至第六志愿无法在遴选页面设为拟录取，第一志愿仍可操作',async()=>{
 const h=setup();await h.start();const s=h.state
 for (const priority of [2,3,4,5,6]) {
  const row=h.drafts.drafts.t1.applications.find(x=>x.id==='b')
  row.priority=priority;row.decision='reserve'
  s.setDecision('b','proposed')
  assert.equal(row.decision,'reserve')
 }
 s.setDecision('a','proposed')
 assert.equal(h.drafts.drafts.t1.applications.find(x=>x.id==='a').decision,'proposed')
})

test('桌面与手机低志愿行不渲染拟录取按钮',async()=>{
 const {compile}=require('@vue/compiler-dom')
 const buttons=source.match(/<el-button\b[^>]*@click="setDecision\(row.id, 'proposed'\)"[^>]*>拟录取<\/el-button>/g)
 assert.equal(buttons.length,2)
 for (const template of buttons) {
  const render=new Function('Vue',compile(template).code)({...vue,resolveComponent:()=> 'button'})
  for(const priority of [2,3,4,5,6]) {
   const vnode=render({row:{id:'b',priority,decision:'reserve'},editingDisabled:false,setDecision(){}},[])
   assert.equal(vnode.type,vue.Comment)
  }
  assert.notEqual(render({row:{id:'a',priority:1},editingDisabled:false,setDecision(){}},[]).type,vue.Comment)
 }
})
