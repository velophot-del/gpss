<template>
  <div class="page-container">
    <div class="card-container">
      <div class="page-header">
        <div><h2 class="section-title">录取结算</h2><p>查看教师名单提交进度，并按课题退回或恢复未处理状态。</p></div>
        <div><el-button @click="load">刷新</el-button><el-button type="primary" :loading="running" @click="runSettlement">{{ data?.settlement?.status === 'failed' ? '重试结算' : '立即检查' }}</el-button></div>
      </div>

      <el-alert v-if="!cycleId" title="当前没有进行中的选题周期" type="warning" :closable="false" show-icon />
      <template v-else>
        <div class="summary-grid" v-loading="loading">
          <div><span>当前周期</span><strong>{{ data?.cycle?.name || '-' }}</strong></div>
          <div><span>审核截止</span><strong>{{ formatDate(data?.cycle?.deadline) }}</strong></div>
          <div><span>提交进度</span><strong>{{ submittedCount }}/{{ requiredCount }}</strong></div>
          <div><span>结算状态</span><strong>{{ settlementLabel }}</strong></div>
          <div><span>定时任务最后检查</span><strong>{{ formatDate(data?.worker?.checkedAt) }}</strong></div>
        </div>
        <el-alert v-if="data?.configurationError" :title="data.configurationError" type="error" :closable="false" show-icon class="alert" />
        <el-alert v-if="data?.settlement?.error_message" :title="data.settlement.error_message" type="error" :closable="false" show-icon class="alert" />
        <el-alert v-if="data?.settlement?.status === 'completed'" :title="resultSummary" type="success" :closable="false" show-icon class="alert" />

        <div class="filters"><el-radio-group v-model="filter"><el-radio-button value="all">全部</el-radio-button><el-radio-button value="draft">未提交</el-radio-button><el-radio-button value="submitted">已提交</el-radio-button></el-radio-group></div>
        <el-table :data="filteredTopics" stripe empty-text="暂无课题">
          <el-table-column prop="teacher_name" label="教师" width="120" />
          <el-table-column prop="title" label="课题" min-width="240" show-overflow-tooltip />
          <el-table-column prop="max_students" label="名额" width="70" />
          <el-table-column prop="application_count" label="申请" width="70" />
          <el-table-column label="草稿进度" width="110"><template #default="{ row }">{{ row.decided_count }}/{{ row.application_count }}</template></el-table-column>
          <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="statusType(row.batch_status)">{{ statusLabel(row.batch_status) }}</el-tag></template></el-table-column>
          <el-table-column label="最后保存" width="170"><template #default="{ row }">{{ formatDate(row.last_saved_at) }}</template></el-table-column>
          <el-table-column label="操作" width="190"><template #default="{ row }"><el-button v-if="['submitted','auto_submitted'].includes(row.batch_status)" link type="warning" :disabled="data?.settlement?.status === 'completed' || data?.settlement?.status === 'running'" @click="unlock(row)">退回修改</el-button><el-button link type="danger" :loading="resettingTopicId === row.id" :disabled="data?.settlement?.status === 'completed' || data?.settlement?.status === 'running'" @click="resetTopic(row)">恢复未处理</el-button></template></el-table-column>
        </el-table>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { selectionAdminApi } from '../../api'
import { useCycleStore } from '../../stores/cycle'

const cycleStore = useCycleStore()
const data = ref<any>(null)
const loading = ref(false)
const running = ref(false)
const resettingTopicId = ref('')
const filter = ref('all')
const cycleId = computed(() => cycleStore.currentCycle?.id)
const requiredCount = computed(() => data.value?.topics?.filter((item: any) => item.batch_status !== 'not_required').length || 0)
const submittedCount = computed(() => data.value?.topics?.filter((item: any) => ['submitted','auto_submitted','settled'].includes(item.batch_status)).length || 0)
const filteredTopics = computed(() => (data.value?.topics || []).filter((item: any) => filter.value === 'all' || (filter.value === 'draft' ? item.batch_status === 'draft' : ['submitted','auto_submitted','settled'].includes(item.batch_status))))
const settlementLabel = computed(() => ({ pending: '等待结算', running: '结算中', completed: '已完成', failed: '失败，可重试' }[data.value?.settlement?.status] || '尚未开始'))
const resultSummary = computed(() => { const r = data.value?.settlement?.result_json; return r ? `结算完成：新录取 ${r.accepted} 人，未录取学生 ${r.unmatchedStudents} 人。` : '统一录取已完成' })

onMounted(async () => { await cycleStore.fetchCurrentCycle(); await load() })
async function load() {
  if (!cycleId.value) return
  loading.value = true
  try { const response: any = await selectionAdminApi.getProgress(cycleId.value); data.value = response.data }
  catch (error: any) { ElMessage.error(error?.response?.data?.message || '读取结算进度失败') }
  finally { loading.value = false }
}
async function unlock(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('退回后教师可继续修改原草稿，请填写原因。', `退回：${row.title}`, { inputPattern: /\S+/, inputErrorMessage: '必须填写退回原因' })
    await selectionAdminApi.unlock(row.id, value)
    ElMessage.success('已退回教师修改')
    await load()
  } catch (error: any) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error?.response?.data?.message || '退回失败') }
}
async function runSettlement() {
  if (!cycleId.value) return
  running.value = true
  try { await selectionAdminApi.run(cycleId.value); ElMessage.success('统一录取检查已完成'); await load() }
  catch (error: any) { ElMessage.error(error?.response?.data?.message || '当前不能执行结算') }
  finally { running.value = false }
}
async function resetTopic(row: any) {
  try {
    await ElMessageBox.confirm(`将清除“${row.title}”的教师遴选草稿和提交状态；该课题已产生的录取、未录取或候补结果会恢复为“待审核”。其他课题不受影响。`, '恢复该课题未处理状态', { type: 'warning', confirmButtonText: '继续恢复', cancelButtonText: '取消' })
    const { value } = await ElMessageBox.prompt('请输入恢复原因。统一结算开始前的任意阶段均可恢复；结算开始或完成后不能恢复。', '填写恢复原因', { inputPattern: /\S+/, inputErrorMessage: '必须填写恢复原因', confirmButtonText: '确认恢复' })
    resettingTopicId.value = row.id
    await selectionAdminApi.resetTopic(row.id, value)
    ElMessage.success('该课题已恢复为未处理状态')
    await load()
  } catch (error: any) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error?.response?.data?.message || '恢复失败')
  } finally { resettingTopicId.value = '' }
}
function formatDate(value?: string | null) { return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-' }
function statusLabel(status: string) { return ({ draft: '未提交', submitted: '教师提交', auto_submitted: '系统提交', settled: '已结算', not_required: '无需提交' } as any)[status] || status }
function statusType(status: string) { return ({ draft: 'warning', submitted: 'primary', auto_submitted: 'warning', settled: 'success', not_required: 'info' } as any)[status] || 'info' }
</script>

<style scoped>
.page-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
.page-header p { color:#64748b; margin-top:6px; }
.summary-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; }
.summary-grid div { padding:14px; background:#f6f8fa; border-radius:8px; }
.summary-grid span,.summary-grid strong { display:block; }
.summary-grid span { color:#64748b; font-size:12px; }
.summary-grid strong { color:#17324d; margin-top:6px; }
.alert,.filters { margin:14px 0; }
@media(max-width:900px){.summary-grid{grid-template-columns:repeat(2,1fr)}.page-header{flex-direction:column}}
</style>
