<template>
  <div class="application-data page-container">
    <div class="card-container">
      <div class="flex justify-between items-center mb-4">
        <h2 class="section-title">选课申请数据</h2>
        <div class="flex gap-2">
          <el-button @click="exportData" type="primary" size="small">
            <el-icon><Download /></el-icon> 导出数据
          </el-button>
        </div>
      </div>

      <el-card shadow="never" class="mb-4">
        <el-row :gutter="20">
          <el-col :span="6" :xs="12">
            <div class="stat-box">
              <span class="stat-value">{{ stats.total }}</span>
              <span class="stat-label">申请总数</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box accepted">
              <span class="stat-value">{{ stats.accepted }}</span>
              <span class="stat-label">已录取</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box pending">
              <span class="stat-value">{{ stats.pending }}</span>
              <span class="stat-label">待审核</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box rejected">
              <span class="stat-value">{{ stats.rejected }}</span>
              <span class="stat-label">已拒绝</span>
            </div>
          </el-col>
        </el-row>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="flex justify-between items-center" style="flex-wrap: wrap; gap: 8px">
            <strong>所有选课申请记录</strong>
            <div class="flex gap-2" style="flex-wrap: wrap">
              <el-input v-model="studentKeyword" placeholder="搜索学号或姓名" clearable size="small" style="width: 180px" />
              <el-select v-model="filterStatus" placeholder="筛选状态" size="small" class="w-40">
                <el-option label="全部" value="" />
                <el-option label="待审核" value="pending" />
                <el-option label="已录取" value="accepted" />
                <el-option label="已拒绝" value="rejected" />
                <el-option label="已撤回" value="withdrawn" />
              </el-select>
            </div>
          </div>
        </template>
        <el-table :data="filteredApplications" stripe size="small">
          <el-table-column type="index" label="#" width="50" />
          <el-table-column prop="student_code" label="学号" width="120" />
          <el-table-column prop="student_name" label="学生姓名" width="120" />
          <el-table-column prop="student_class" label="班级" width="120" />
          <el-table-column prop="topic_title" label="课题名称" min-width="200" show-overflow-tooltip />
          <el-table-column prop="teacher_name" label="指导教师" width="120" />
          <el-table-column prop="topic_category" label="课题方向" width="100" />
          <el-table-column prop="priority" label="志愿优先级" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="priorityTagType(row.priority)" size="small">
                {{ formatPriority(row.priority) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="申请状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="statusType[row.status]" size="small">
                {{ statusLabel[row.status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="申请时间" width="150" />
          <el-table-column prop="comment" label="备注" min-width="150" show-overflow-tooltip />
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button v-if="returnableApplicationIds.has(row.id)" type="warning" link
                :loading="returningStudentId === row.student_id" @click="returnVolunteers(row)">
                退回该生志愿
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi } from '@/api'
import { useCycleStore } from '@/stores/cycle'
import { formatPriority, priorityTagType } from '@/utils/volunteerRules'

const applications = ref<any[]>([])
const filterStatus = ref('')
const studentKeyword = ref('')
const returningStudentId = ref('')
const cycleStore = useCycleStore()
const unresolvedStatuses = ['pending', 'submitted', 'pending_review']

const stats = computed(() => ({
  total: applications.value.length,
  accepted: applications.value.filter(a => a.status === 'accepted').length,
  pending: applications.value.filter(a => unresolvedStatuses.includes(a.status)).length,
  rejected: applications.value.filter(a => a.status === 'rejected').length
}))

const filteredApplications = computed(() => {
  const keyword = studentKeyword.value.trim().toLowerCase()
  return applications.value.filter(a => {
    const statusMatches = !filterStatus.value || (filterStatus.value === 'pending'
      ? unresolvedStatuses.includes(a.status) : a.status === filterStatus.value)
    const studentMatches = !keyword || String(a.student_code || '').toLowerCase().includes(keyword) ||
      String(a.student_name || '').toLowerCase().includes(keyword)
    return statusMatches && studentMatches
  })
})

const returnableApplicationIds = computed(() => {
  const ids = new Set<string>()
  if (cycleStore.currentPhase !== 'student_apply') return ids
  const cycleId = Number(cycleStore.currentCycle?.id)
  const byStudent = new Map<string, any[]>()
  for (const app of applications.value) {
    if (Number(app.cycle_id) !== cycleId) continue
    const group = byStudent.get(app.student_id) || []
    group.push(app)
    byStudent.set(app.student_id, group)
  }
  for (const group of byStudent.values()) {
    if (group.some(a => ['accepted', 'rejected', 'waitlisted', 'cancelled'].includes(a.status))) continue
    const pending = group.filter(a => unresolvedStatuses.includes(a.status))
    if (pending.length >= 3 && pending.length <= 6 && pending.every(a => !a.reviewed_by && !a.reviewed_at)) {
      ids.add(pending[0].id)
    }
  }
  return ids
})

const statusLabel: Record<string, string> = {
  'pending': '待审核',
  'submitted': '待审核',
  'pending_review': '待审核',
  'accepted': '已录取',
  'rejected': '已拒绝',
  'waitlisted': '等待统一录取（兼容）',
  'withdrawn': '已撤回',
  'cancelled': '已取消'
}

const statusType: Record<string, string> = {
  'pending': 'warning',
  'submitted': 'warning',
  'pending_review': 'warning',
  'accepted': 'success',
  'rejected': 'danger',
  'waitlisted': 'info',
  'withdrawn': 'info',
  'cancelled': 'info'
}

const loadApplications = async () => {
  const res = await adminApi.getAllApplications()
  applications.value = res.data
}

const returnVolunteers = async (row: any) => {
  try {
    const { value } = await ElMessageBox.prompt(
      `将退回 ${row.student_name} 在当前周期的整组未审核志愿，学生可重新填报。请说明原因：`,
      '退回重填',
      {
        inputType: 'textarea',
        inputValidator: value => {
          const length = value?.trim().length || 0
          return length >= 4 && length <= 500 || '请填写 4–500 字的退回原因'
        },
        confirmButtonText: '确认退回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    returningStudentId.value = row.student_id
    await adminApi.returnStudentVolunteers(row.student_id, value.trim())
    await loadApplications()
    ElMessage.success('整组志愿已退回，学生可重新填报')
  } catch (err: any) {
    if (err !== 'cancel' && err !== 'close') {
      ElMessage.error(err?.response?.data?.message || '退回失败，请刷新后重试')
    }
  } finally {
    returningStudentId.value = ''
  }
}

const exportData = () => {
  const headers = ['学号', '学生姓名', '班级', '课题名称', '指导教师', '课题方向', '志愿优先级', '申请状态', '申请时间', '备注']
  const rows = applications.value.map(a => [
    a.student_code,
    a.student_name,
    a.student_class,
    a.topic_title,
    a.teacher_name,
    a.topic_category,
    `第${a.priority}志愿`,
    statusLabel[a.status],
    a.created_at,
    a.comment || ''
  ])

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `选课申请数据_${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(() => { void Promise.all([cycleStore.fetchCurrentCycle(), loadApplications()]) })
</script>

<style scoped>
.stat-box {
  text-align: center;
  padding: 16px;
  background: #f8fafc;
  border-radius: 8px;
}
.stat-box.accepted { background: #ecfdf5; }
.stat-box.pending { background: #fffbeb; }
.stat-box.rejected { background: #fef2f2; }

.stat-value {
  display: block;
  font-size: 28px;
  font-weight: bold;
  color: #1e293b;
}
.stat-box.accepted .stat-value { color: #059669; }
.stat-box.pending .stat-value { color: #d97706; }
.stat-box.rejected .stat-value { color: #dc2626; }

.stat-label {
  font-size: 14px;
  color: #64748b;
}
</style>
