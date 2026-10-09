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
              <el-button v-if="adjustableAcceptedIds.has(row.id)" type="primary" link
                :loading="adjustmentLoadingId === row.id || adjustmentSubmitting" @click="openAcceptedResultAdjustment(row)">
                调整录取
              </el-button>
              <el-button v-if="returnableApplicationIds.has(row.id)" type="warning" link
                :loading="returningStudentId === row.student_id" @click="returnVolunteers(row)">
                退回该生志愿
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <el-dialog v-model="adjustmentDialogVisible" title="调整正式录取结果" width="600px" :close-on-click-modal="false">
      <template v-if="adjustmentOptions">
        <p>学生：{{ adjustmentOptions.student.name || adjustmentOptions.student.id }}（{{ adjustmentOptions.cycle.name }}）</p>
        <p>当前录取：{{ adjustmentOptions.current.title }} — {{ adjustmentOptions.current.teacherName }}，第{{ adjustmentOptions.current.priority }}志愿</p>
        <el-form label-position="top">
          <el-form-item label="调整为">
            <el-radio-group v-model="adjustmentTargetId" class="adjustment-targets">
              <el-radio v-for="target in adjustmentOptions.targets" :key="target.applicationId"
                :label="target.applicationId" :value="target.applicationId" :disabled="!target.eligible">
                {{ target.title }} — {{ target.teacherName }}（第{{ target.priority }}志愿）
                · 课题 {{ target.acceptedCount }}/{{ target.topicLimit }}
                · 导师 {{ target.teacherAcceptedCount }}/{{ target.teacherLimit }}
                <span v-if="!target.eligible">· {{ target.reason }}</span>
              </el-radio>
              <el-radio v-if="adjustmentOptions.canCancel" label="__cancel__" value="__cancel__">取消该生当前录取</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="调整原因" required>
            <el-input v-model="adjustmentReason" type="textarea" :rows="3" maxlength="500" show-word-limit
              placeholder="请填写调整原因，学生和相关教师会收到通知" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="adjustmentDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="adjustmentSubmitting" :disabled="!adjustmentTargetId || !adjustmentReason.trim()"
          @click="submitAcceptedResultAdjustment">确认调整</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi, selectionAdminApi } from '@/api'
import { useCycleStore } from '@/stores/cycle'
import { formatPriority, priorityTagType } from '@/utils/volunteerRules'

const applications = ref<any[]>([])
const filterStatus = ref('')
const studentKeyword = ref('')
const returningStudentId = ref('')
const adjustmentDialogVisible = ref(false)
const adjustmentLoadingId = ref('')
const adjustmentSubmitting = ref(false)
const adjustmentApplicationId = ref('')
const adjustmentOptions = ref<any>(null)
const adjustmentTargetId = ref('')
const adjustmentReason = ref('')
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

const adjustableAcceptedIds = computed(() => {
  const cycleId = Number(cycleStore.currentCycle?.id)
  if (!cycleId) return new Set<string>()
  return new Set(applications.value.filter(app => Number(app.cycle_id) === cycleId && app.status === 'accepted').map(app => app.id))
})

const eligibleAdjustmentTargets = computed(() => adjustmentOptions.value?.targets.filter((target: any) => target.eligible) || [])

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
    if (pending.length >= 3 && pending.length <= 6) {
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

const openAcceptedResultAdjustment = async (row: any) => {
  adjustmentLoadingId.value = row.id
  try {
    const res = await selectionAdminApi.getAcceptedResultOptions(row.id)
    adjustmentApplicationId.value = row.id
    adjustmentOptions.value = res.data
    adjustmentTargetId.value = ''
    adjustmentReason.value = ''
    adjustmentDialogVisible.value = true
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '读取可调整志愿失败，请刷新后重试')
  } finally {
    adjustmentLoadingId.value = ''
  }
}

const submitAcceptedResultAdjustment = async () => {
  const reason = adjustmentReason.value.trim()
  if (!reason) { ElMessage.warning('请填写录取调整原因'); return }
  const targetId = adjustmentTargetId.value
  if (targetId !== '__cancel__' && !eligibleAdjustmentTargets.value.some((target: any) => target.applicationId === targetId)) {
    ElMessage.warning('请选择一个可用志愿或取消录取'); return
  }
  const current = adjustmentOptions.value?.current
  const target = eligibleAdjustmentTargets.value.find((item: any) => item.applicationId === targetId)
  const after = target ? `改录至「${target.title}」（${target.teacherName}）` : '取消当前录取'
  try {
    await ElMessageBox.confirm(
      `学生：${adjustmentOptions.value.student.name || adjustmentOptions.value.student.id}\n原结果：${current.title}（${current.teacherName}）\n调整后：${after}\n原因：${reason}`,
      '确认调整录取结果', { confirmButtonText: '确认调整', cancelButtonText: '返回修改', type: 'warning' },
    )
    adjustmentSubmitting.value = true
    await selectionAdminApi.adjustAcceptedResult(adjustmentApplicationId.value, {
      targetApplicationId: targetId === '__cancel__' ? null : targetId,
      reason,
    })
    adjustmentDialogVisible.value = false
    await loadApplications()
    ElMessage.success('录取结果已调整')
  } catch (err: any) {
    if (err !== 'cancel' && err !== 'close') ElMessage.error(err?.response?.data?.message || '调整失败，请刷新后重试')
  } finally {
    adjustmentSubmitting.value = false
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

.adjustment-targets {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.adjustment-targets :deep(.el-radio) {
  height: auto;
  margin-right: 0;
  white-space: normal;
}
</style>
