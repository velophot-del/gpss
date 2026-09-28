<template>
  <div class="selection-review page-container">
    <div class="card-container">
      <div class="page-header">
        <div><h2 class="section-title">学生遴选</h2><p>先保存草稿，再按课题提交名单；正式结果由系统统一结算。</p></div>
        <el-button @click="refreshAll">刷新状态</el-button>
      </div>

      <el-alert v-if="!isTeacherReview" :title="`当前为${cycleStore.phaseInfo.label}`" description="当前阶段为只读状态，可查看课题、学生申报状态和学生信息；遴选操作仅在教师遴选阶段开放。" type="info" :closable="false" show-icon class="state-alert" />
      <el-empty v-if="!myTopics.length" description="暂无可查看课题" />
      <el-tabs v-if="myTopics.length" v-model="activeTopicId" @tab-change="loadTopic" class="topic-tabs">
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
            <el-alert v-if="blockedCount" type="warning" :closable="false" show-icon class="state-alert" :title="`有 ${blockedCount} 名学生已被更高志愿拟录取或候补：当前课题的原有意见已暂停生效，不占用名额，也不能修改。`" />

            <div class="rank-columns">
              <section class="rank-card">
                <h3>拟录取顺序</h3>
                <el-empty v-if="!proposedItems.length" description="尚未设置拟录取" :image-size="48" />
                <div v-for="(item, index) in proposedItems" :key="item.id" class="rank-row" :draggable="!readOnly && !hasBlockedRank('proposed')"
                  @dragstart="onDragStart('proposed', index)" @dragover.prevent @drop="onDrop('proposed', index)">
                  <span class="rank-number">{{ index + 1 }}</span><span>{{ item.studentName }}</span><small>{{ formatPriority(item.priority) }}</small>
                  <small v-if="item.blockedByHigherPriority">已暂停</small><div class="rank-actions"><el-button link :disabled="readOnly || hasBlockedRank('proposed') || index === 0" @click="move('proposed', index, -1)">上移</el-button><el-button link :disabled="readOnly || hasBlockedRank('proposed') || index === proposedItems.length - 1" @click="move('proposed', index, 1)">下移</el-button></div>
                </div>
              </section>
              <section class="rank-card">
                <h3>候补顺序</h3>
                <el-empty v-if="!reserveItems.length" description="尚未设置候补" :image-size="48" />
                <div v-for="(item, index) in reserveItems" :key="item.id" class="rank-row" :draggable="!readOnly && !hasBlockedRank('reserve')"
                  @dragstart="onDragStart('reserve', index)" @dragover.prevent @drop="onDrop('reserve', index)">
                  <span class="rank-number reserve">{{ index + 1 }}</span><span>{{ item.studentName }}</span><small>{{ formatPriority(item.priority) }}</small>
                  <small v-if="item.blockedByHigherPriority">已暂停</small><div class="rank-actions"><el-button link :disabled="readOnly || hasBlockedRank('reserve') || index === 0" @click="move('reserve', index, -1)">上移</el-button><el-button link :disabled="readOnly || hasBlockedRank('reserve') || index === reserveItems.length - 1" @click="move('reserve', index, 1)">下移</el-button></div>
                </div>
              </section>
            </div>

            <el-table :data="currentDraft.applications" stripe empty-text="暂无申请">
              <el-table-column label="志愿" width="105" align="center"><template #default="{ row }"><el-tag :type="priorityTagType(row.priority)">{{ formatPriority(row.priority) }}</el-tag></template></el-table-column>
              <el-table-column prop="studentName" label="学生姓名" width="110"><template #default="{ row }"><el-button link type="primary" @click="showStudentDetail(row.studentId)">{{ row.studentName }}</el-button></template></el-table-column>
              <el-table-column prop="studentCode" label="学号" width="120" />
              <el-table-column prop="className" label="班级" width="120" />
              <el-table-column prop="major" label="专业" min-width="130" />
              <el-table-column prop="motivation" label="申请理由" min-width="180" show-overflow-tooltip />
              <el-table-column label="学生申请状态" width="130" align="center"><template #default="{ row }"><el-tag :type="applicationStatusType[row.status] || 'info'">{{ applicationStatusLabel[row.status] || row.status }}</el-tag></template></el-table-column>
              <el-table-column label="遴选草稿" width="150" align="center"><template #default="{ row }"><el-tag v-if="row.status === 'accepted'" type="success">既有录取</el-tag><el-tooltip v-else-if="row.blockedByHigherPriority" :content="`第${row.blockingPriority}志愿《${row.blockingTopicTitle}》已${decisionLabel[row.blockingDecision]}`"><el-tag type="warning">高志愿暂停</el-tag></el-tooltip><el-tag v-else :type="decisionType[row.decision] || 'info'">{{ decisionLabel[row.decision] || '未处理' }}</el-tag></template></el-table-column>
              <el-table-column label="操作" min-width="310" fixed="right"><template #default="{ row }">
                <el-button-group v-if="['pending', 'submitted', 'pending_review'].includes(row.status)">
                  <el-button size="small" type="success" :plain="row.decision !== 'proposed'" :disabled="readOnly || row.blockedByHigherPriority" @click="setDecision(row.id, 'proposed')">拟录取</el-button>
                  <el-button size="small" type="warning" :plain="row.decision !== 'reserve'" :disabled="readOnly || row.blockedByHigherPriority" @click="setDecision(row.id, 'reserve')">候补</el-button>
                  <el-button size="small" type="danger" :plain="row.decision !== 'reject'" :disabled="readOnly || row.blockedByHigherPriority" @click="setDecision(row.id, 'reject')">不录取</el-button>
                  <el-button size="small" :disabled="readOnly || row.blockedByHigherPriority || !row.decision" @click="setDecision(row.id, null)">清除</el-button>
                </el-button-group>
              </template></el-table-column>
            </el-table>

            <div class="footer-actions">
              <el-button :disabled="readOnly" :loading="saving" @click="saveDraft">保存草稿</el-button>
              <el-button type="primary" :disabled="readOnly" :loading="submitting" @click="submitDraft">提交本课题名单</el-button>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-dialog v-model="detailVisible" title="学生详细信息" width="700px">
      <div v-loading="detailLoading"><el-descriptions v-if="selectedStudentProfile" :column="2" border>
        <el-descriptions-item label="姓名">{{ selectedStudentProfile.realName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="学号">{{ selectedStudentProfile.studentId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="班级">{{ selectedStudentProfile.className || '-' }}</el-descriptions-item>
        <el-descriptions-item label="专业">{{ selectedStudentProfile.major || '-' }}</el-descriptions-item>
        <el-descriptions-item label="GPA">{{ Number(selectedStudentProfile.gpa || 0).toFixed(2) }}</el-descriptions-item>
        <el-descriptions-item label="技能标签" :span="2">
          <el-space v-if="selectedStudentProfile.skills?.length" wrap>
            <el-tag v-for="skill in selectedStudentProfile.skills" :key="skill">{{ skill }}</el-tag>
          </el-space>
          <span v-else>未填写</span>
        </el-descriptions-item>
        <el-descriptions-item label="兴趣方向" :span="2">
          <el-space v-if="selectedStudentProfile.interests?.length" wrap>
            <el-tag v-for="interest in selectedStudentProfile.interests" :key="interest" type="info">{{ interest }}</el-tag>
          </el-space>
          <span v-else>未填写</span>
        </el-descriptions-item>
        <el-descriptions-item label="个人陈述" :span="2">{{ selectedStudentProfile.personalStatement || '未填写' }}</el-descriptions-item>
      </el-descriptions></div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
const submitting = computed(() => draftStore.submittingTopicIds.includes(activeTopicId.value))
const isTeacherReview = computed(() => cycleStore.currentPhase === 'teacher_review')
const readOnly = computed(() => !isTeacherReview.value || !currentDraft.value || currentDraft.value.batch.status !== 'draft')
const undecidedCount = computed(() => currentDraft.value?.applications.filter(item => ['pending', 'submitted', 'pending_review'].includes(item.status) && !item.decision && !item.blockedByHigherPriority).length || 0)
const blockedCount = computed(() => currentDraft.value?.applications.filter(item => item.blockedByHigherPriority).length || 0)
const batchStatusLabel = computed(() => ({ draft: '草稿可继续修改，学生看不到当前决定', submitted: '已提交，等待统一结算', auto_submitted: '已到截止时间，系统已自动提交', settled: '统一录取已完成' }[currentDraft.value?.batch.status || 'draft']))
const batchAlertType = computed(() => currentDraft.value?.batch.status === 'settled' ? 'success' : currentDraft.value?.batch.status === 'draft' ? 'info' : 'warning')
const decisionLabel: Record<string, string> = { proposed: '拟录取', reserve: '候补', reject: '不录取' }
const decisionType: Record<string, string> = { proposed: 'success', reserve: 'warning', reject: 'danger' }
const applicationStatusLabel: Record<string, string> = { pending: '待审核', submitted: '已提交', pending_review: '待审核', accepted: '已录取', rejected: '未录取', waitlisted: '候补', withdrawn: '已撤回', cancelled: '已取消' }
const applicationStatusType: Record<string, string> = { accepted: 'success', rejected: 'danger', waitlisted: 'warning', withdrawn: 'info', cancelled: 'info' }

onMounted(async () => {
  try {
    await Promise.all([cycleStore.fetchCurrentCycle(), topicStore.fetchMyTopics()])
    if (myTopics.value.length) {
      activeTopicId.value = myTopics.value[0].id
      await draftStore.load(activeTopicId.value)
      void Promise.allSettled(myTopics.value.slice(1).map(topic => draftStore.load(topic.id)))
    }
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '读取遴选名单失败')
  }
})

async function loadTopic(topicId: string | number) { activeTopicId.value = String(topicId); await draftStore.load(activeTopicId.value) }
function decisionCount(decision: SelectionDraftDecision) { return currentDraft.value?.applications.filter(item => item.effectiveDecision === decision).length || 0 }
function hasBlockedRank(decision: 'proposed' | 'reserve') { return currentDraft.value?.applications.some(item => item.decision === decision && item.blockedByHigherPriority) || false }
function setDecision(applicationId: string, decision: SelectionDraftDecision | null) { draftStore.setDecision(activeTopicId.value, applicationId, decision) }
function formatDateTime(value: string) { return dayjs(value).format('YYYY-MM-DD HH:mm') }

function onDragStart(decision: 'proposed' | 'reserve', index: number) { if (!readOnly.value && !hasBlockedRank(decision)) dragState.value = { decision, index } }
function onDrop(decision: 'proposed' | 'reserve', index: number) {
  if (!dragState.value || dragState.value.decision !== decision || readOnly.value || hasBlockedRank(decision)) return
  const list = (decision === 'proposed' ? proposedItems.value : reserveItems.value).map(item => item.id)
  const [moved] = list.splice(dragState.value.index, 1)
  list.splice(index, 0, moved)
  draftStore.reorder(activeTopicId.value, decision, list)
  dragState.value = null
}
function move(decision: 'proposed' | 'reserve', index: number, offset: number) {
  const list = (decision === 'proposed' ? proposedItems.value : reserveItems.value).map(item => item.id)
  const target = index + offset
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target], list[index]]
  draftStore.reorder(activeTopicId.value, decision, list)
}

async function saveDraft() {
  try { await draftStore.save(activeTopicId.value); ElMessage.success('草稿已保存') }
  catch (error: any) { ElMessage.error(error?.response?.data?.message || '保存失败；如版本冲突，页面已刷新为最新草稿') }
}
async function submitDraft() {
  const draft = currentDraft.value
  if (!draft) return
  try {
    await ElMessageBox.confirm(`拟录取 ${decisionCount('proposed')} 人，候补 ${decisionCount('reserve')} 人，未处理 ${undecidedCount.value} 人。提交后只能由管理员退回。`, '确认提交名单', { type: 'warning', confirmButtonText: '确认提交' })
    await draftStore.submit(activeTopicId.value)
    ElMessage.success('名单已提交，等待统一结算')
  }
  catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(error?.response?.data?.message || '提交失败')
  }
}
async function refreshAll() {
  await cycleStore.fetchCurrentCycle()
  const results = await Promise.allSettled(myTopics.value.map(topic => draftStore.load(topic.id)))
  if (results.some(result => result.status === 'rejected')) return ElMessage.warning('部分课题状态未能刷新，请切换课题查看提示')
  ElMessage.success('状态已更新')
}
async function showStudentDetail(studentId: string) {
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
</style>
