<template>
  <div class="page-container">
    <el-card shadow="never" v-loading="loading">
      <template #header><div class="header"><div><h2>调剂结算</h2><p>{{ data?.cycle?.name || '当前周期' }} · {{ data?.cycle?.phase || '未进入调剂阶段' }}</p></div><el-button @click="load">刷新</el-button></div></template>
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" class="mb-4" />
      <el-alert v-if="data?.configurationError" :title="data.configurationError" type="warning" :closable="false" class="mb-4" />
      <el-empty v-if="!data" description="暂无可查看的调剂周期" />
      <template v-else>
        <el-row :gutter="16" class="stats">
          <el-col :span="6" :xs="12"><el-statistic title="符合资格学生" :value="data.counts?.students || 0" /></el-col>
          <el-col :span="6" :xs="12"><el-statistic title="补录志愿" :value="data.counts?.volunteers || 0" /></el-col>
          <el-col :span="6" :xs="12"><el-statistic title="本轮自动录取" :value="data.counts?.accepted || 0" /></el-col>
          <el-col :span="6" :xs="12"><el-statistic title="本轮未匹配学生" :value="data.counts?.unmatchedStudents || 0" /></el-col>
        </el-row>
        <el-alert v-if="data.settlement" :title="`结算状态：${settlementLabel(data.settlement.status)}${data.settlement.error_message ? ' · ' + data.settlement.error_message : ''}`" :type="data.settlement.status === 'failed' ? 'error' : data.settlement.status === 'completed' ? 'success' : 'info'" :closable="false" class="mb-4" />
        <el-alert v-else title="学生可在截止前修改志愿；截止后系统自动匹配并写入结果。" type="info" :closable="false" class="mb-4" />
        <div v-if="data.settlement?.status === 'completed' && data.cycle.phase === 'adjustment'" class="actions">
          <span>仅修改周期时间不会重新开放；请先设置未来的截止时间，再开启新一轮。</span>
          <el-button type="primary" :disabled="deadlineReached || !data.cycle.deadline" :loading="running" @click="reopen">重新开放补录</el-button>
        </div>
        <el-table :data="data.topics" stripe empty-text="暂无补录志愿">
          <el-table-column prop="title" label="课题" min-width="210" />
          <el-table-column prop="teacher_name" label="指导教师" width="110" />
          <el-table-column prop="volunteer_count" label="补录志愿数" width="110" />
          <el-table-column label="调剂录取" width="100"><template #default="{ row }">{{ row.adjustment_accepted_count || 0 }}</template></el-table-column>
          <el-table-column label="当前占用 / 课题容量" width="155"><template #default="{ row }">{{ row.current_accepted_count || 0 }} / {{ row.max_students }}</template></el-table-column>
        </el-table>
        <el-collapse v-if="data.archives?.length">
          <el-collapse-item title="历史补录结算（已归档）" name="history">
            <el-table :data="data.archives">
              <el-table-column prop="reopened_at" label="归档时间" min-width="180" />
              <el-table-column prop="reason" label="重新开放原因" min-width="200" />
              <el-table-column label="当轮录取" width="100"><template #default="{ row }">{{ row.result_json?.accepted ?? '—' }}</template></el-table-column>
              <el-table-column label="当轮未匹配" width="110"><template #default="{ row }">{{ row.result_json?.unmatchedStudents ?? '—' }}</template></el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>
        <div v-if="data.cycle.deadline" class="deadline">自动匹配截止时间：{{ formatDeadline(data.cycle.deadline) }}</div>
        <div v-if="data.settlement?.status === 'failed'" class="actions"><el-button type="warning" :disabled="!deadlineReached || !!data.configurationError" :loading="running" @click="retry">重试失败的自动匹配</el-button></div>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { cycleApi, adjustmentAdminApi } from '@/api'

const data = ref<any>(null)
const loading = ref(false)
const running = ref(false)
const errorMessage = ref('')
const deadlineReached = computed(() => !!data.value?.cycle?.deadline && Date.now() >= new Date(data.value.cycle.deadline).getTime())
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
function settlementLabel(status: string) { return ({ running: '自动匹配中', completed: '自动匹配完成', failed: '自动匹配失败，可重试' } as any)[status] || status }
async function retry() {
  try { await ElMessageBox.confirm('仅重试截止后失败的自动匹配，不会覆盖已完成结果。', '重试自动匹配', { type: 'warning' }) }
  catch { return }
  running.value = true
  try { await adjustmentAdminApi.run(data.value.cycle.id); ElMessage.success('自动匹配重试完成'); await load() }
  catch (cause: any) { ElMessage.error(cause?.response?.data?.message || '自动匹配暂未执行'); await load() }
  finally { running.value = false }
}
async function reopen() {
  const cycleId = data.value.cycle.id
  const settlementId = data.value.settlement.id
  const deadline = data.value.cycle.deadline
  let reason: string
  try {
    const answer = await ElMessageBox.prompt(
      `已录取结果保留。上一轮结算和志愿将归档，未录取学生必须重新提交1–6个志愿。新截止时间：${formatDeadline(deadline)}。请填写重新开放原因。`,
      '重新开放补录', { type: 'warning', confirmButtonText: '确认重新开放', cancelButtonText: '取消', inputValidator: value => !!value?.trim() && value.trim().length <= 500 || '请填写1–500字原因' },
    )
    reason = answer.value.trim()
  } catch { return }
  running.value = true
  try {
    await adjustmentAdminApi.reopen(cycleId, { settlementId, deadline, reason })
    ElMessage.success('已重新开放，请通知未录取学生刷新页面并重新填报')
    await load()
  } catch (cause: any) { ElMessage.error(cause?.response?.data?.message || '重新开放失败'); await load() }
  finally { running.value = false }
}
onMounted(load)
</script>

<style scoped>
.header,.actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.header h2{margin:0 0 6px}.header p{margin:0;color:#909399}.stats{margin:20px 0 28px}.actions{justify-content:flex-end;margin-top:18px}.deadline{text-align:right;color:#606a78;margin-top:16px}
</style>
