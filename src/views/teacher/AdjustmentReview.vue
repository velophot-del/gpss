<template>
  <div class="page-container">
    <el-card shadow="never" v-loading="loading">
      <template #header><div class="header"><div><h2>调剂遴选</h2><p>按课题保存教师名单，提交后由系统统一结算。</p></div><el-button @click="loadTopics">刷新</el-button></div></template>
      <el-alert v-if="errorMessage" :title="errorMessage" type="warning" :closable="false" class="mb-4" />
      <el-empty v-if="!topics.length && !loading" description="当前调剂阶段没有待处理课题" />
      <template v-else>
        <el-select v-model="topicId" placeholder="选择课题" class="topic-select" @change="loadDraft">
          <el-option v-for="topic in topics" :key="topic.id" :label="`${topic.title}（${topic.volunteer_count} 人）`" :value="topic.id" />
        </el-select>
        <template v-if="draft">
          <el-alert :title="`截止时间：${formatDeadline(draft.deadline)}；名额 ${draft.topic.maxStudents}；已录取 ${draft.teacherAcceptedCount}；教师指导上限 ${draft.teacherStudentLimit || '未设置'}`" type="info" :closable="false" class="mb-4" />
          <el-table :data="draft.volunteers" stripe empty-text="暂无调剂学生">
            <el-table-column prop="priority" label="学生志愿" width="90"><template #default="{ row }">第 {{ row.priority }} 志愿</template></el-table-column>
            <el-table-column prop="studentCode" label="学号" width="120" />
            <el-table-column prop="studentName" label="姓名" width="90" />
            <el-table-column prop="className" label="班级" width="140" />
            <el-table-column prop="major" label="专业" width="130" />
            <el-table-column label="技能 / 兴趣" min-width="180"><template #default="{ row }">{{ row.skills.join('、') || '—' }}<br><span class="muted">兴趣：{{ row.interests.join('、') || '—' }}</span></template></el-table-column>
            <el-table-column label="匹配提示" width="140"><template #default="{ row }"><el-tooltip :content="hintText(row.match)"><el-tag :type="row.match.score >= 50 ? 'success' : 'info'">{{ row.match.score }} 分</el-tag></el-tooltip></template></el-table-column>
            <el-table-column prop="motivation" label="调剂理由" min-width="180" show-overflow-tooltip />
            <el-table-column label="教师决定" width="145"><template #default="{ row }"><el-select v-model="row.decision" :disabled="readOnly" clearable placeholder="未处理" @change="rebuildRanks"><el-option label="拟录取" value="proposed" /><el-option label="候补" value="reserve" /><el-option label="不录取" value="reject" /></el-select></template></el-table-column>
            <el-table-column label="排序" width="100"><template #default="{ row }"><el-input-number v-if="['proposed','reserve'].includes(row.decision)" v-model="row.decisionRank" :min="1" :max="draft.volunteers.length" :disabled="readOnly" controls-position="right" size="small" /></template></el-table-column>
            <el-table-column label="备注" min-width="160"><template #default="{ row }"><el-input v-model="row.comment" :disabled="readOnly" placeholder="可选备注" /></template></el-table-column>
          </el-table>
          <div class="actions"><el-tag v-if="readOnly" type="success">名单已提交，等待统一结算</el-tag><el-button :disabled="readOnly" :loading="saving" @click="saveDraft">保存草稿</el-button><el-button type="primary" :disabled="readOnly" :loading="submitting" @click="submitBatch">提交本课题名单</el-button></div>
        </template>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adjustmentVolunteerApi } from '@/api'

const topics = ref<any[]>([])
const topicId = ref('')
const draft = ref<any>(null)
const loading = ref(false)
const saving = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const readOnly = computed(() => !draft.value || draft.value.batch.status !== 'draft')
function formatDeadline(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function hintText(match: any) { return `技能匹配：${match.skillMatches.join('、') || '无'}；兴趣匹配：${match.interestMatches.join('、') || '无'}。仅供教师参考，不参与自动录取。` }
function rebuildRanks() {
  for (const decision of ['proposed', 'reserve']) {
    draft.value.volunteers.filter((row: any) => row.decision === decision).forEach((row: any, index: number) => { row.decisionRank = index + 1 })
  }
  draft.value.volunteers.forEach((row: any) => { if (!['proposed', 'reserve'].includes(row.decision)) row.decisionRank = null })
}
async function loadTopics() {
  loading.value = true
  errorMessage.value = ''
  try {
    const response: any = await adjustmentVolunteerApi.getTeacherTopics()
    topics.value = response.data || []
    if (!topicId.value && topics.value.length) topicId.value = topics.value[0].id
    if (topicId.value) await loadDraft()
  } catch (cause: any) { errorMessage.value = cause?.response?.data?.message || '课题列表加载失败' }
  finally { loading.value = false }
}
async function loadDraft() {
  if (!topicId.value) return
  loading.value = true
  try {
    const response: any = await adjustmentVolunteerApi.getTeacherDraft(topicId.value)
    draft.value = response.data
  } catch (cause: any) { errorMessage.value = cause?.response?.data?.message || '调剂名单加载失败'; draft.value = null }
  finally { loading.value = false }
}
function payload() { return draft.value.volunteers.map((row: any) => ({ volunteerId: row.id, decision: row.decision, decisionRank: row.decisionRank, comment: row.comment })) }
async function saveDraft() {
  saving.value = true
  try {
    const response: any = await adjustmentVolunteerApi.saveTeacherDraft(topicId.value, draft.value.batch.version, payload())
    draft.value = response.data
    ElMessage.success('草稿已保存')
  } catch (cause: any) { ElMessage.error(cause?.response?.data?.message || '保存失败'); await loadDraft() }
  finally { saving.value = false }
}
async function submitBatch() {
  try { await ElMessageBox.confirm('提交后本课题名单将锁定，等待所有课题提交或调剂截止后统一结算。', '提交调剂名单', { type: 'warning' }) }
  catch { return }
  submitting.value = true
  try {
    const response: any = await adjustmentVolunteerApi.submitTeacherBatch(topicId.value, draft.value.batch.version)
    draft.value = response.data
    ElMessage.success('名单已提交')
  } catch (cause: any) { ElMessage.error(cause?.response?.data?.message || '提交失败'); await loadDraft() }
  finally { submitting.value = false }
}
onMounted(loadTopics)
</script>

<style scoped>
.header,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.header h2{margin:0 0 6px}.header p,.muted{color:#909399}.topic-select{width:min(100%,480px);margin-bottom:18px}.actions{justify-content:flex-end;margin-top:18px}
</style>
