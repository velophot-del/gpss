<template><div class="page-container"><div class="card-container"><h2 class="section-title">调剂结算</h2><el-alert v-if="data?.cycle?.phase !== 'adjustment'" title="当前不在调剂补录阶段。" type="warning" :closable="false"/><template v-else><p>调剂志愿学生：{{data?.eligibleStudents || 0}} 人；截止：{{data?.cycle?.deadline || '未配置'}}</p><el-table :data="data?.topics || []"><el-table-column prop="title" label="课题"/><el-table-column prop="teacher_name" label="教师"/><el-table-column prop="volunteer_count" label="申请数"/><el-table-column prop="batch_status" label="名单状态"/><el-table-column label="操作"><template #default="{row}"><el-button v-if="['submitted','auto_submitted'].includes(row.batch_status)" link type="warning" @click="unlock(row)">退回</el-button></template></el-table-column></el-table><p><el-button type="primary" @click="run">{{data?.settlement?.status==='failed'?'重试结算':'检查并结算'}}</el-button></p></template></div></div></template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adjustmentAdminApi } from '@/api'
import { useCycleStore } from '@/stores/cycle'
const cycle = useCycleStore()
const data = ref<any>(null)
async function load() {
  await cycle.fetchCurrentCycle()
  if (!cycle.currentCycle?.id) return
  const response: any = await adjustmentAdminApi.getProgress(cycle.currentCycle.id)
  data.value = response.data
}
async function unlock(row: any) { try { await adjustmentAdminApi.unlock(row.id); await load(); ElMessage.success('已退回') } catch (e: any) { ElMessage.error(e.response?.data?.message || '操作失败') } }
async function run() { try { if (!cycle.currentCycle?.id) return; await adjustmentAdminApi.run(cycle.currentCycle.id); await load(); ElMessage.success('已完成检查') } catch (e: any) { ElMessage.error(e.response?.data?.message || '无法结算') } }
onMounted(load)
</script>
