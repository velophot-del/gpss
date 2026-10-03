<template>
  <div class="selection-review page-container">
    <div class="card-container">
      <div class="page-header">
        <div><h2 class="section-title">学生遴选</h2><p>一次审核全部申请并提交；系统按第一至第六志愿录取，有空额时自动递补。</p></div>
        <el-button :disabled="busy" @click="refreshAll">刷新状态</el-button>
      </div>

      <el-alert v-if="!isTeacherReview" :title="`当前为${cycleStore.phaseInfo.label}`" description="当前阶段为只读状态，可查看课题、学生申报状态和学生信息；遴选操作仅在教师遴选阶段开放。" type="info" :closable="false" show-icon class="state-alert" />
      <el-empty v-if="!myTopics.length" description="暂无可查看课题" />
      <el-select v-if="isMobile && myTopics.length" :model-value="activeTopicId" aria-label="选择课题" class="mobile-topic-select" :disabled="busy" @change="loadTopic">
        <el-option v-for="topic in myTopics" :key="topic.id" :label="`${topic.title}（${topic.applyCount || 0}人）`" :value="topic.id" />
      </el-select>
      <el-tabs v-if="myTopics.length" :model-value="activeTopicId" @tab-change="loadTopic" :before-leave="beforeTopicLeave" class="topic-tabs" :class="{ 'mobile-tabs': isMobile }">
        <el-tab-pane v-for="topic in myTopics" :key="topic.id" :name="topic.id" :label="`${topic.title}（${topic.applyCount || 0}人）`">
          <div v-if="currentDraft" v-loading="loading" class="draft-body">
            <div class="summary-grid">
              <div><span>课题名额</span><strong>{{ currentDraft.topic.maxStudents }}</strong></div>
              <div><span>拟录取</span><strong>{{ decisionCount('proposed') }}</strong></div>
              <div><span>候补</span><strong>{{ decisionCount('reserve') }}</strong></div>
              <div><span>未处理</span><strong>{{ undecidedCount }}</strong></div>
              <div><span>教师指导上限</span><strong>{{ currentDraft.teacherStudentLimit || '未设置' }}</strong></div>
              <div><span>审核截止</span><strong class="deadline">{{ currentDraft.deadline ? formatDateTime(currentDraft.deadline) : '未配置' }}</strong></div>
            </div>

            <el-alert :type="batchAlertType" :closable="false" show-icon class="state-alert">
              <template #title>{{ batchStatusLabel }}</template>
            </el-alert>

            <el-alert type="info" :closable="false" show-icon class="state-alert" title="拟录取与候补均为接收意见，不占正式名额；请审核全部愿意接收的学生。先按志愿轮次，同志愿内拟录取优先候补，再按教师排序。高志愿最终未录取后，低志愿自动参与递补。" />
            <div class="rank-columns">
              <section class="rank-card">
                <h3>拟录取顺序</h3>
                <el-empty v-if="!proposedItems.length" description="尚未设置拟录取" :image-size="48" />
                <div v-for="(item, index) in proposedItems" :key="item.id" class="rank-row" :draggable="!editingDisabled && !isMobile"
                  @dragstart="onDragStart('proposed', index)" @dragover.prevent @drop="onDrop('proposed', index)">
                  <span class="rank-number">{{ index + 1 }}</span><span>{{ item.studentName }}</span><small>{{ formatPriority(item.priority) }}</small>
                  <div class="rank-actions"><el-button link :disabled="editingDisabled || index === 0" @click="move('proposed', index, -1)">上移</el-button><el-button link :disabled="editingDisabled || index === proposedItems.length - 1" @click="move('proposed', index, 1)">下移</el-button></div>
                </div>
              </section>
              <section class="rank-card">
                <h3>候补顺序</h3>
                <el-empty v-if="!reserveItems.length" description="尚未设置候补" :image-size="48" />
                <div v-for="(item, index) in reserveItems" :key="item.id" class="rank-row" :draggable="!editingDisabled && !isMobile"
                  @dragstart="onDragStart('reserve', index)" @dragover.prevent @drop="onDrop('reserve', index)">
                  <span class="rank-number reserve">{{ index + 1 }}</span><span>{{ item.studentName }}</span><small>{{ formatPriority(item.priority) }}</small>
                  <div class="rank-actions"><el-button link :disabled="editingDisabled || index === 0" @click="move('reserve', index, -1)">上移</el-button><el-button link :disabled="editingDisabled || index === reserveItems.length - 1" @click="move('reserve', index, 1)">下移</el-button></div>
                </div>
              </section>
            </div>

            <div class="application-filters">
              <el-input v-model="searchText" placeholder="搜索姓名或学号" clearable aria-label="搜索姓名或学号" />
              <el-select v-model="priorityFilter" aria-label="按志愿筛选">
                <el-option label="全部志愿" :value="0" /><el-option v-for="n in 6" :key="n" :label="formatPriority(n)" :value="n" />
              </el-select>
              <el-select v-model="decisionFilter" aria-label="按审核状态筛选">
                <el-option label="全部状态" value="all" /><el-option label="未处理" value="undecided" />
                <el-option label="拟录取" value="proposed" /><el-option label="候补" value="reserve" />
                <el-option label="不录取" value="reject" /><el-option label="既有录取" value="accepted" />
              </el-select>
              <span class="filter-count" aria-live="polite">显示 {{ filteredApplications.length }} / {{ currentDraft.applications.length }} 人</span>
            </div>
            <div v-if="isMobile" class="student-cards">
              <el-empty v-if="!filteredApplications.length" description="没有符合筛选条件的学生" :image-size="64" />
              <article v-for="row in filteredApplications" :key="row.id" class="student-card">
                <div class="student-card-heading">
                  <el-button link type="primary" class="student-name" @click="showStudentDetail(row.studentId)">{{ row.studentName }}</el-button>
                  <el-tag :type="priorityTagType(row.priority)">{{ formatPriority(row.priority) }}</el-tag>
                </div>
                <p class="student-meta">{{ row.studentCode || '未提供学号' }} · {{ row.className || '未提供班级' }}</p>
                <p class="student-meta">{{ row.major || '未提供专业' }}</p>
                <div class="student-status"><el-tag :type="applicationStatusType[row.status] || 'info'">{{ applicationStatusLabel[row.status] || row.status }}</el-tag>
                  <el-tag :type="row.status === 'accepted' ? 'success' : decisionType[row.decision] || 'info'">{{ row.status === 'accepted' ? '既有录取' : decisionLabel[row.decision] || '未处理' }}</el-tag></div>
                <details class="student-motivation"><summary>查看申请理由</summary><p>{{ row.motivation || '未填写申请理由' }}</p></details>
                <div v-if="['pending', 'submitted', 'pending_review'].includes(row.status)" class="student-decision-actions" :aria-label="`${row.studentName}的审核操作`">
                  <el-button type="success" :plain="row.decision !== 'proposed'" :aria-pressed="row.decision === 'proposed'" :disabled="editingDisabled" @click="setDecision(row.id, 'proposed')">拟录取</el-button>
                  <el-button type="warning" :plain="row.decision !== 'reserve'" :aria-pressed="row.decision === 'reserve'" :disabled="editingDisabled" @click="setDecision(row.id, 'reserve')">候补</el-button>
                  <el-button type="danger" :plain="row.decision !== 'reject'" :aria-pressed="row.decision === 'reject'" :disabled="editingDisabled" @click="setDecision(row.id, 'reject')">不录取</el-button>
                  <el-button :disabled="editingDisabled || !row.decision" @click="setDecision(row.id, null)">清除</el-button>
                </div>
              </article>
            </div>
            <el-table v-else :data="filteredApplications" stripe empty-text="没有符合筛选条件的学生">
              <el-table-column label="志愿" width="105" align="center"><template #default="{ row }"><el-tag :type="priorityTagType(row.priority)">{{ formatPriority(row.priority) }}</el-tag></template></el-table-column>
              <el-table-column prop="studentName" label="学生姓名" width="110"><template #default="{ row }"><el-button link type="primary" @click="showStudentDetail(row.studentId)">{{ row.studentName }}</el-button></template></el-table-column>
              <el-table-column prop="studentCode" label="学号" width="120" />
              <el-table-column prop="className" label="班级" width="120" />
              <el-table-column prop="major" label="专业" min-width="130" />
              <el-table-column prop="motivation" label="申请理由" min-width="180" show-overflow-tooltip />
              <el-table-column label="学生申请状态" width="130" align="center"><template #default="{ row }"><el-tag :type="applicationStatusType[row.status] || 'info'">{{ applicationStatusLabel[row.status] || row.status }}</el-tag></template></el-table-column>
              <el-table-column label="遴选草稿" width="150" align="center"><template #default="{ row }"><el-tag v-if="row.status === 'accepted'" type="success">既有录取</el-tag><el-tag v-else :type="decisionType[row.decision] || 'info'">{{ decisionLabel[row.decision] || '未处理' }}</el-tag></template></el-table-column>
              <el-table-column label="操作" min-width="310" fixed="right"><template #default="{ row }">
                <el-button-group v-if="['pending', 'submitted', 'pending_review'].includes(row.status)">
                  <el-button size="small" type="success" :plain="row.decision !== 'proposed'" :disabled="editingDisabled" @click="setDecision(row.id, 'proposed')">拟录取</el-button>
                  <el-button size="small" type="warning" :plain="row.decision !== 'reserve'" :disabled="editingDisabled" @click="setDecision(row.id, 'reserve')">候补</el-button>
                  <el-button size="small" type="danger" :plain="row.decision !== 'reject'" :disabled="editingDisabled" @click="setDecision(row.id, 'reject')">不录取</el-button>
                  <el-button size="small" :disabled="editingDisabled || !row.decision" @click="setDecision(row.id, null)">清除</el-button>
                </el-button-group>
              </template></el-table-column>
            </el-table>

            <div class="footer-actions"><span class="save-status" role="status">{{ hasUnsavedChanges ? '有未保存修改' : '当前名单已保存' }}</span>
              <el-button :disabled="editingDisabled" :loading="saving" @click="saveDraft">保存草稿</el-button>
              <el-button type="primary" :disabled="editingDisabled" :loading="submitting" @click="submitDraft">提交本课题名单</el-button>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-dialog v-model="detailVisible" title="学生详细信息" class="selection-detail" :width="isMobile ? '100%' : '700px'" :fullscreen="isMobile">
      <div v-loading="detailLoading"><el-descriptions v-if="selectedStudentProfile" :column="isMobile ? 1 : 2" border>
        <el-descriptions-item label="姓名">{{ selectedStudentProfile.realName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="学号">{{ selectedStudentProfile.studentId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="班级">{{ selectedStudentProfile.className || '-' }}</el-descriptions-item>
        <el-descriptions-item label="专业">{{ selectedStudentProfile.major || '-' }}</el-descriptions-item>
        <el-descriptions-item label="GPA">{{ Number(selectedStudentProfile.gpa || 0).toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="技能标签" :span="isMobile ? 1 : 2">
          <el-space v-if="selectedStudentProfile.skills?.length" wrap>
            <el-tag v-for="skill in selectedStudentProfile.skills" :key="skill">{{ skill }}</el-tag>
          </el-space>
          <span v-else>未填写</span>
        </el-descriptions-item>
        <el-descriptions-item label="兴趣方向" :span="isMobile ? 1 : 2">
          <el-space v-if="selectedStudentProfile.interests?.length" wrap>
            <el-tag v-for="interest in selectedStudentProfile.interests" :key="interest" type="info">{{ interest }}</el-tag>
          </el-space>
          <span v-else>未填写</span>
        </el-descriptions-item>
        <el-descriptions-item label="个人陈述" :span="isMobile ? 1 : 2">{{ selectedStudentProfile.personalStatement || '未填写' }}</el-descriptions-item>
      </el-descriptions></div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { useTopicStore } from '../../stores/topic'
import { useStudentStore } from '../../stores/student'
import { useSelectionDraftStore } from '../../stores/selectionDraft'
import { useCycleStore } from '../../stores/cycle'
import type { SelectionDraftDecision } from '../../types'
import { formatPriority, priorityTagType } from '../../utils/volunteerRules'

const topicStore = useTopicStore()
const studentStore = useStudentStore()
const draftStore = useSelectionDraftStore()
const cycleStore = useCycleStore()
const activeTopicId = ref('')
const isMobile = ref(window.innerWidth <= 768)
const searchText = ref('')
const priorityFilter = ref(0)
const decisionFilter = ref('all')
const savedViews = ref<Record<string, string>>({})
const switchingTopic = ref(false)
function updateViewport() { isMobile.value = window.innerWidth <= 768 }
function rememberSaved(topicId: string) { savedViews.value[topicId] = JSON.stringify(draftStore.drafts[topicId]) }
const hasUnsavedChanges = computed(() => Boolean(currentDraft.value && savedViews.value[activeTopicId.value] && JSON.stringify(currentDraft.value) !== savedViews.value[activeTopicId.value]))
const filteredApplications = computed(() => (currentDraft.value?.applications || []).filter(item => {
  const query = searchText.value.trim().toLowerCase()
  const matchesSearch = !query || `${item.studentName} ${item.studentCode || ''}`.toLowerCase().includes(query)
  const editable = ['pending', 'submitted', 'pending_review'].includes(item.status)
  const matchesDecision = decisionFilter.value === 'all' || (decisionFilter.value === 'accepted' ? item.status === 'accepted' : editable && (decisionFilter.value === 'undecided' ? !item.decision : item.decision === decisionFilter.value))
  return matchesSearch && (!priorityFilter.value || item.priority === priorityFilter.value) && matchesDecision
}))
const detailVisible = ref(false)
const detailLoading = ref(false)
const selectedStudentProfile = ref<any>(null)
const dragState = ref<{ decision: 'proposed' | 'reserve'; index: number } | null>(null)

const myTopics = computed(() => topicStore.topics)
const currentDraft = computed(() => draftStore.drafts[activeTopicId.value])
const proposedItems = computed(() => activeTopicId.value ? draftStore.ordered(activeTopicId.value, 'proposed') : [])
const reserveItems = computed(() => activeTopicId.value ? draftStore.ordered(activeTopicId.value, 'reserve') : [])
const loading = computed(() => draftStore.loadingTopicIds.includes(activeTopicId.value))
const saving = computed(() => draftStore.savingTopicIds.includes(activeTopicId.value))
const confirmingSubmit = ref(false)
const submitting = computed(() => confirmingSubmit.value || draftStore.submittingTopicIds.includes(activeTopicId.value))
const refreshing = ref(false)
const busy = computed(() => loading.value || saving.value || submitting.value || switchingTopic.value || refreshing.value)
const isTeacherReview = computed(() => cycleStore.currentPhase === 'teacher_review')
const readOnly = computed(() => !isTeacherReview.value || !currentDraft.value || currentDraft.value.batch.status !== 'draft')
const editingDisabled = computed(() => readOnly.value || busy.value)
const undecidedCount = computed(() => currentDraft.value?.applications.filter(item => ['pending', 'submitted', 'pending_review'].includes(item.status) && !item.decision).length || 0)
const batchStatusLabel = computed(() => ({ draft: '草稿可继续修改，学生看不到当前决定', submitted: '已提交，等待统一结算', auto_submitted: '已到截止时间，系统已自动提交', settled: '统一录取已完成' }[currentDraft.value?.batch.status || 'draft']))
const batchAlertType = computed(() => currentDraft.value?.batch.status === 'settled' ? 'success' : currentDraft.value?.batch.status === 'draft' ? 'info' : 'warning')
const decisionLabel: Record<string, string> = { proposed: '拟录取', reserve: '候补', reject: '不录取' }
const decisionType: Record<string, string> = { proposed: 'success', reserve: 'warning', reject: 'danger' }
const applicationStatusLabel: Record<string, string> = { pending: '待审核', submitted: '已提交', pending_review: '待审核', accepted: '已录取', rejected: '未录取', waitlisted: '候补', withdrawn: '已撤回', cancelled: '已取消' }
const applicationStatusType: Record<string, string> = { accepted: 'success', rejected: 'danger', waitlisted: 'warning', withdrawn: 'info', cancelled: 'info' }

function beforeUnload(event: BeforeUnloadEvent) { if (hasUnsavedChanges.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(async () => {
  window.addEventListener('resize', updateViewport)
  window.addEventListener('beforeunload', beforeUnload)
  try {
    await Promise.all([cycleStore.fetchCurrentCycle(), topicStore.fetchMyTopics()])
    if (myTopics.value.length) {
      activeTopicId.value = myTopics.value[0].id
      await draftStore.load(activeTopicId.value)
      rememberSaved(activeTopicId.value)
    }
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '读取遴选名单失败')
  }
})

onUnmounted(() => { window.removeEventListener('resize', updateViewport); window.removeEventListener('beforeunload', beforeUnload) })
async function confirmDiscard() {
  if (!hasUnsavedChanges.value) return true
  try { await ElMessageBox.confirm('有未保存修改，继续将丢弃这些修改。', '未保存提醒', { type: 'warning', customClass: 'selection-confirm', confirmButtonText: '丢弃并继续', cancelButtonText: '返回编辑' }); return true }
  catch { return false }
}
onBeforeRouteLeave(async () => {
  if (busy.value) { ElMessage.warning('正在处理名单，请稍后再离开'); return false }
  if (!await confirmDiscard()) return false
  if (hasUnsavedChanges.value) draftStore.drafts[activeTopicId.value] = JSON.parse(savedViews.value[activeTopicId.value])
  return true
})
async function beforeTopicLeave() {
  if (busy.value) return false
  switchingTopic.value = true
  try {
    if (!await confirmDiscard()) return false
    if (hasUnsavedChanges.value) draftStore.drafts[activeTopicId.value] = JSON.parse(savedViews.value[activeTopicId.value])
    return true
  } finally { switchingTopic.value = false }
}
async function loadTopic(topicId: string | number) {
  const nextId = String(topicId)
  if (busy.value || nextId === activeTopicId.value) return
  switchingTopic.value = true
  try {
    if (!await confirmDiscard()) return
    if (hasUnsavedChanges.value) draftStore.drafts[activeTopicId.value] = JSON.parse(savedViews.value[activeTopicId.value])
    activeTopicId.value = nextId
    searchText.value = ''; priorityFilter.value = 0; decisionFilter.value = 'all'
    await draftStore.load(nextId); rememberSaved(nextId)
  } catch { ElMessage.error('读取课题失败，请刷新后重试') }
  finally { switchingTopic.value = false }
}
function decisionCount(decision: SelectionDraftDecision) { return currentDraft.value?.applications.filter(item => item.decision === decision).length || 0 }
function setDecision(applicationId: string, decision: SelectionDraftDecision | null) { if (editingDisabled.value) return; draftStore.setDecision(activeTopicId.value, applicationId, decision) }
function formatDateTime(value: string) { return dayjs(value).format('YYYY-MM-DD HH:mm') }

function onDragStart(decision: 'proposed' | 'reserve', index: number) { if (!editingDisabled.value && !isMobile.value) dragState.value = { decision, index } }
function onDrop(decision: 'proposed' | 'reserve', index: number) {
  if (!dragState.value || dragState.value.decision !== decision || editingDisabled.value) return
  const list = (decision === 'proposed' ? proposedItems.value : reserveItems.value).map(item => item.id)
  const [moved] = list.splice(dragState.value.index, 1)
  list.splice(index, 0, moved)
  draftStore.reorder(activeTopicId.value, decision, list)
  dragState.value = null
}
function move(decision: 'proposed' | 'reserve', index: number, offset: number) {
  if (editingDisabled.value) return
  const list = (decision === 'proposed' ? proposedItems.value : reserveItems.value).map(item => item.id)
  const target = index + offset
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target], list[index]]
  draftStore.reorder(activeTopicId.value, decision, list)
}

async function saveDraft() {
  if (editingDisabled.value) return
  try { await draftStore.save(activeTopicId.value); rememberSaved(activeTopicId.value); ElMessage.success('草稿已保存') }
  catch (error: any) {
    if (error?.response?.status === 409) rememberSaved(activeTopicId.value)
    ElMessage.error(error?.response?.data?.message || '保存失败；如版本冲突，页面已刷新为最新草稿')
  }
}
async function submitDraft() {
  if (editingDisabled.value) return
  confirmingSubmit.value = true
  const draft = currentDraft.value
  if (!draft) { confirmingSubmit.value = false; return }
  try {
    await ElMessageBox.confirm(`拟录取 ${decisionCount('proposed')} 人，候补 ${decisionCount('reserve')} 人，未处理 ${undecidedCount.value} 人。提交后只能由管理员退回。`, '确认提交名单', { type: 'warning', customClass: 'selection-confirm', confirmButtonText: '确认提交' })
    const result = await draftStore.submit(activeTopicId.value)
    rememberSaved(activeTopicId.value)
    if (result.settlementWarning) ElMessage.warning(result.settlementWarning)
    else ElMessage.success(result.batch.status === 'settled' ? '名单已提交，统一结算已完成' : '名单已提交，等待统一结算')
  }
  catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    const saved = savedViews.value[activeTopicId.value]
    if (saved && currentDraft.value?.batch.version !== JSON.parse(saved).batch.version) rememberSaved(activeTopicId.value)
    ElMessage.error(error?.response?.data?.message || '提交失败')
  } finally { confirmingSubmit.value = false }
}
async function refreshAll() {
  if (busy.value) return
  refreshing.value = true
  try {
    if (!await confirmDiscard()) return
    await cycleStore.fetchCurrentCycle()
    const results = await Promise.allSettled(myTopics.value.map(async topic => { await draftStore.load(topic.id); rememberSaved(topic.id) }))
    if (results.some(result => result.status === 'rejected')) return ElMessage.warning('部分课题状态未能刷新，请切换课题查看提示')
    ElMessage.success('状态已更新')
  } catch { ElMessage.error('刷新失败，请稍后重试') }
  finally { refreshing.value = false }
}
async function showStudentDetail(studentId: string) {
  selectedStudentProfile.value = null
  detailVisible.value = true
  detailLoading.value = true
  try { selectedStudentProfile.value = await studentStore.fetchProfileByUserId(studentId) }
  catch { ElMessage.error('读取学生信息失败') }
  finally { detailLoading.value = false }
}
</script>

<style scoped>
.page-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.page-header p { color:#64748b; margin-top:6px; }
.topic-tabs { margin-top:18px; }
.summary-grid { display:grid; grid-template-columns:repeat(6,minmax(110px,1fr)); gap:10px; }
.summary-grid div { background:#f6f8fa; border:1px solid #e2e8f0; border-radius:8px; padding:12px; }
.summary-grid span,.summary-grid strong { display:block; }
.summary-grid span { color:#64748b; font-size:12px; }
.summary-grid strong { color:#17324d; font-size:20px; margin-top:5px; }
.summary-grid .deadline { font-size:13px; }
.state-alert { margin:14px 0; }
.rank-columns { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:16px; }
.rank-card { border:1px solid #e2e8f0; border-radius:8px; padding:14px; min-height:130px; }
.rank-card h3 { color:#17324d; font-size:15px; margin-bottom:10px; }
.rank-row { display:flex; align-items:center; gap:9px; padding:8px; margin-top:6px; background:#f8fafc; border-radius:6px; cursor:grab; }
.rank-row small { color:#64748b; }
.rank-number { width:24px; height:24px; display:grid; place-items:center; border-radius:50%; color:#fff; background:#67c23a; }
.rank-number.reserve { background:#e6a23c; }
.rank-actions { margin-left:auto; white-space:nowrap; }
.footer-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }
@media (max-width:900px) { .summary-grid { grid-template-columns:repeat(2,1fr); } .rank-columns { grid-template-columns:1fr; } }

.application-filters { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:18px 0; }
.application-filters .el-input { width:220px; }
.application-filters .el-select { width:140px; }
.filter-count,.save-status { color:#64748b; font-size:13px; }
.save-status { margin-right:auto; align-self:center; }
.mobile-topic-select { width:100%; margin-top:16px; }
.student-card { padding:14px; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:12px; overflow-wrap:anywhere; }
.student-card-heading,.student-status { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.student-card-heading { justify-content:space-between; }
.student-name { max-width:100%; height:auto; min-height:44px; white-space:normal; text-align:left; font-size:17px; }
.student-meta { color:#64748b; margin:7px 0; font-size:13px; }
.student-motivation { margin:12px 0; }
.student-motivation summary { min-height:44px; display:list-item; cursor:pointer; line-height:44px; }
.student-motivation p { line-height:1.7; white-space:pre-wrap; }
.student-decision-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.student-decision-actions .el-button { margin:0; min-height:44px; }
@media (max-width:768px) {
  :global(.selection-detail.is-fullscreen) { width:100vw !important; height:100dvh; overflow-wrap:anywhere; }
  :global(.selection-confirm) { max-width:calc(100vw - 32px); box-sizing:border-box; }
  .selection-review { min-width:0; padding-bottom:calc(130px + env(safe-area-inset-bottom)); }
  .page-header { flex-wrap:wrap; gap:8px; }
  .page-header p { font-size:13px; line-height:1.6; }
  .mobile-tabs :deep(.el-tabs__header) { display:none; }
  .summary-grid div { min-width:0; padding:10px; overflow-wrap:anywhere; }
  .rank-card { min-width:0; padding:10px; }
  .rank-row { flex-wrap:wrap; cursor:default; overflow-wrap:anywhere; }
  .rank-row > span:nth-child(2) { flex:1; min-width:0; }
  .rank-actions { width:100%; display:flex; justify-content:flex-end; gap:12px; }
  .rank-actions .el-button { min-width:60px; min-height:44px; }
  .application-filters { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
  .application-filters .el-input,.filter-count { grid-column:1/-1; }
  .application-filters .el-input,.application-filters .el-select { width:100%; min-width:0; }
  .application-filters :deep(.el-input__wrapper),.application-filters :deep(.el-select__wrapper) { min-height:44px; box-sizing:border-box; }
  .footer-actions { position:fixed; bottom:0; left:0; right:0; z-index:90; margin:0; padding:12px 16px calc(12px + env(safe-area-inset-bottom)); background:#fff; border-top:1px solid #e2e8f0; box-shadow:0 -4px 16px #17324d12; display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .footer-actions .save-status { grid-column:1/-1; }
  .footer-actions .el-button { min-height:44px; margin:0; width:100%; }
}
</style>
