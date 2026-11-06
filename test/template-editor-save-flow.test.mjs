import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

function fixture({ previewReady=false, previewSucceeds=true, cancel=false, changeDuringConfirmation=false, failSave=false, online=true }={}) {
 const source=fs.readFileSync(new URL('../src/views/process/DocumentTemplates.vue',import.meta.url),'utf8')
 const start=source.indexOf('async function savePublishedTemplate()'),end=source.indexOf('\nfunction addMapping()',start)
 const functionSource=source.slice(start,end)
 const calls={preview:0,confirm:0,saves:[],messages:[]}
 const context={
  mappingItem:{value:{id:'template'}},mappingVisible:{value:true},editForm:{title:'修订任务书',version:'2027-1',description:'说明'},
  profile:{value:online?{fields:[]}:null},mappingConfirmed:{value:false},hasCurrentPreview:{value:previewReady},currentEditSignature:{value:'current'},
  mappingSaving:{value:false},publishedSaving:{value:false},editRevision:{value:'revision'},
  ElMessage:{warning:message=>calls.messages.push(message),success(){}},
  ElMessageBox:{confirm:async()=>{calls.confirm++;if(cancel)throw new Error('cancel');if(changeDuringConfirmation){context.currentEditSignature.value='changed';context.hasCurrentPreview.value=false}}},
  previewMapping:async()=>{calls.preview++;context.hasCurrentPreview.value=previewSucceeds;return previewSucceeds},
  documentTemplateApi:{editPublished:async(id,input)=>{calls.saves.push({id,input});if(failSave)throw new Error('save failed');return {data:{mode:'updated'}}}},
  loadAdminTemplates:async()=>{},
 }
 const compiled=ts.transpileModule(functionSource+'\nreturn savePublishedTemplate',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const save=new Function(...Object.keys(context),compiled)(...Object.values(context))
 return {calls,context,save}
}

test('save automatically generates a missing preview and asks for explicit confirmation',async()=>{
 const f=fixture();await f.save()
 assert.equal(f.calls.preview,1);assert.equal(f.calls.confirm,1);assert.equal(f.calls.saves.length,1)
 assert.equal(f.calls.saves[0].input.confirmMapping,true);assert.equal(f.context.mappingVisible.value,false);assert.equal(f.context.publishedSaving.value,false)
})

test('an existing current preview proceeds directly to the explicit save confirmation',async()=>{
 const f=fixture({previewReady:true});await f.save()
 assert.equal(f.calls.preview,0);assert.equal(f.calls.confirm,1);assert.equal(f.calls.saves.length,1)
})

test('cancel or preview failure keeps edits open and never submits',async()=>{
 for(const options of [{cancel:true},{previewSucceeds:false}]){
  const f=fixture(options);await f.save();assert.equal(f.calls.saves.length,0);assert.equal(f.context.mappingVisible.value,true)
  assert.equal(f.context.editForm.title,'修订任务书');assert.equal(f.context.publishedSaving.value,false)
 }
})

test('changes while confirmation is open require another preview instead of saving unreviewed content',async()=>{
 const f=fixture({previewReady:true,changeDuringConfirmation:true});await f.save()
 assert.equal(f.calls.confirm,1);assert.equal(f.calls.saves.length,0);assert.equal(f.context.mappingVisible.value,true)
})

test('save errors release the pending flag and keep entered content',async()=>{
 const f=fixture({failSave:true});await assert.rejects(f.save(),/save failed/)
 assert.equal(f.context.publishedSaving.value,false);assert.equal(f.context.mappingVisible.value,true);assert.equal(f.context.editForm.title,'修订任务书')
})

test('metadata-only documents save without a DOCX preview',async()=>{
 const f=fixture({online:false});await f.save()
 assert.equal(f.calls.preview,0);assert.equal(f.calls.confirm,0);assert.equal(f.calls.saves.length,1)
})

test('repeated clicks during confirmation create only one save request',async()=>{
 const f=fixture({previewReady:true});let confirm
 f.context.ElMessageBox.confirm=()=>new Promise(resolve=>{confirm=resolve})
 const first=f.save();await f.save();assert.equal(f.calls.saves.length,0)
 confirm();await first;assert.equal(f.calls.saves.length,1);assert.equal(f.context.publishedSaving.value,false)
})

test('closing the editor while preview is generating aborts the save',async()=>{
 const f=fixture();const pending=f.save();f.context.mappingVisible.value=false;await pending
 assert.equal(f.calls.confirm,0);assert.equal(f.calls.saves.length,0);assert.equal(f.context.publishedSaving.value,false)
})
