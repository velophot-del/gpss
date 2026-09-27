<template>
  <div class="page-container">
    <el-card shadow="never" v-loading="loading">
      <template #header><div class="header"><div><h2>调剂结算</h2><p>{{ data?.cycle?.name || '当前周期' }} · {{ data?.cycle?.phase || '未进入调剂阶段' }}</p></div><el-button @click="load">刷新</el-button></div></template>
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" class="mb-4" />
      <el-alert v-if="data?.configurationError" :title="data.configurationError" type="warning" :closable="false" class="mb-4" />
      <el-empty v-if="!data" description="暂无可查看的调剂周期" />
      <template v-else>
        <el-row :gutter="16" class="stats">
          <el-col :span="6" :xs="12"><el-statistic title="参与学生" :value="data.counts?.students || 0" /></el-col>
          <el-col :span="6" :xs="12"><el-statistic title="调剂志愿" :value="data.counts?.volunteers || 0" /></el-col>
          <el-col :span="6" :xs="12"><el-statistic title="需提交课题" :value="data.topics?.length || 0" /></el-col>
          <el-col :span="6" :xs="12"><el-statistic title="截止时间" :value="data.cycle?.deadline ? formatDeadline(data.cycle.deadline) : '未配置'" /></el-col>
        </el-row>
        <el-alert v-if="data.settlement" :title="`结算状态：${settlementLabel(data.settlement.status)}${data.settlement.error_message ? ' · ' + data.settlement.error_message : ''}`" :type="data.settlement.status === 'failed' ? 'error' : data.settlement.status === 'completed' ? 'success' : 'info'" :closable="false" class="mb-4" />
        <el-table :data="data.topics" stripe empty-text="暂无调剂志愿">
          <el-table-column prop="title" label="课题" min-width="210" />
          <el-table-column prop="teacher_name" label="指导教师" width="110" />
          <el-table-column prop="volunteer_count" label="申请人数" width="95" />
          <el-table-column prop="decided_count" label="已处理" width="85" />
          <el-table-column label="名单状态" width="130"><template #default="{ row }"><el-tag :type="batchType(row.batch_status)">{{ batchLabel(row.batch_status) }}</el-tag></template></el-table-column>
          <el-table-column prop="submitted_at" label="提交时间" min-width="160" />
          <el-table-column label="操作" width="100"><template #default="{ row }"><el-button v-if="['submitted','auto_submitted'].includes(row.batch_status) && !['running','completed'].includes(data.settlement?.status)" link type="warning" @click="unlock(row)">退回教师</el-button></template></el-table-column>
        </el-table>
        <div class="actions"><el-button type="primary" :disabled="data.cycle.phase !== 'adjustment' || data.configurationError" :loading="running" @click="run">检查并统一结算</el-button></div>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { cycleApi, adjustmentAdminApi } from '@/api'

const data = ref<any>(null)
const loading = ref(false)
const running = ref(false)
const errorMessage = ref('')
async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const cycleResponse: any = await cycleApi.getActive()
    const cycle = cycleResponse.data
    if (!cycle) { data.value = null; return }
    const response: any = await adjustmentAdminApi.getProgress(cycle.id)
    data.value = response.data
  } catch (cause: any) { errorMessage.value = cause?.response?.data?.message || '调剂进度加载失败' }
  finally { loading.value = false }
}
function formatDeadline(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }
function settlementLabel(status: string) { return ({ pending: '等待提交', running: '结算中', completed: '已完成', failed: '失败，可重试' } as any)[status] || status }
function batchLabel(status: string) { return ({ draft: '草稿', submitted: '教师已提交', auto_submitted: '截止自动提交', settled: '已结算' } as any)[status] || status }
function batchType(status: string) { return status === 'settled' || status === 'submitted' ? 'success' : status === 'auto_submitted' ? 'warning' : 'info' }
async function unlock(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('请输入退回原因', '退回教师修改', { inputPattern: /.+/, inputErrorMessage: '请填写退回原因' })
    await adjustmentAdminApi.unlock(row.id, value)
    ElMessage.success('名单已退回')
    await load()
  } catch (cause: any) { if (cause !== 'cancel' && cause !== 'close') ElMessage.error(cause?.response?.data?.message || '退回失败') }
}
async function run() {
  try { await ElMessageBox.confirm('满足“全部课题提交”或“已到截止时间”条件时，系统将统一写入正式结果。', '执行调剂结算', { type: 'warning' }) }
  catch { return }
  running.value = true
  try { await adjustmentAdminApi.run(data.value.cycle.id); ElMessage.success('结算检查已完成'); await load() }
  catch (cause: any) { ElMessage.error(cause?.response?.data?.message || '结算暂未执行'); await load() }
  finally { running.value = false }
}
onMounted(load)
</script>

<style scoped>
.header,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.header h2{margin:0 0 6px}.header p{margin:0;color:#909399}.stats{margin:20px 0 28px}.actions{justify-content:flex-end;margin-top:18px}
</style>
