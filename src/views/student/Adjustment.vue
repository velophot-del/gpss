<template>
  <div class="adjustment page-container">
    <div class="card-container">
      <h2 class="section-title">调剂申请</h2>

      <el-alert
        title="调剂说明"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 20px;"
      >
        <template #default>
          调剂阶段面向未录取学生开放。您可申请有剩余名额的课题，管理员核对教师意见和名额后审批。每人同时只能有一条待处理申请。
        </template>
      </el-alert>

      <!-- 可调剂课题列表 -->
      <el-table :data="availableTopics" stripe v-loading="loading" empty-text="暂无可调剂的课题">
        <el-table-column prop="title" label="课题名称" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" @click="showApplyDialog(row)">{{ row.title }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="teacherName" label="指导教师" width="110" />
        <el-table-column prop="category" label="研究方向" width="130" />
        <el-table-column label="难度" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="difficultyType[row.difficulty]" size="small">{{ difficultyLabel[row.difficulty] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="剩余名额" width="100" align="center">
          <template #default="{ row }">
            <el-tag type="success">{{ Math.max(0, row.maxStudents - row.currentCount) }} 人</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button type="warning" size="small" icon="Position" :disabled="!canSubmitAdjustment" @click="showApplyDialog(row)">
              申请调剂
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 我的调剂记录 -->
      <h3 style="margin-top: 32px; margin-bottom: 16px; color: #303133;">我的调剂记录</h3>
      <el-table :data="myAdjustments" stripe empty-text="暂无调剂记录">
        <el-table-column prop="to_topic_title" label="申请课题" min-width="220" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'approved' ? 'success' : row.status === 'pending' ? 'warning' : 'danger'" size="small">
              {{ adjustmentStatusLabel[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="调剂理由" show-overflow-tooltip />
        <el-table-column prop="created_at" label="申请时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 调剂申请弹窗 -->
    <el-dialog v-model="applyDialogVisible" title="调剂申请" width="520px">
      <template v-if="selectedTopic">
        <p><strong>课题：</strong>{{ selectedTopic.title }}</p>
        <p><strong>教师：</strong>{{ selectedTopic.teacherName }}</p>
        <el-form :model="adjustForm" style="margin-top: 16px;">
          <el-form-item label="调剂理由" required>
            <el-input
              v-model="adjustForm.motivation"
              type="textarea"
              :rows="4"
              placeholder="请说明希望调剂到该课题的原因..."
            />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="applyDialogVisible = false">取消</el-button>
        <el-button type="warning" @click="handleAdjustApply" :loading="submitting">提交调剂申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTopicStore } from '../../stores/topic'
import { useApplicationStore } from '../../stores/application'
import { useUserStore } from '../../stores/user'
import { useCycleStore } from '../../stores/cycle'
import { applicationApi } from '../../api'
import type { Topic } from '../../types'
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'

const topicStore = useTopicStore()
const applicationStore = useApplicationStore()
const userStore = useUserStore()
const cycleStore = useCycleStore()

const loading = ref(false)
const submitting = ref(false)
const applyDialogVisible = ref(false)
const selectedTopic = ref<Topic | null>(null)
const adjustForm = ref({ motivation: '' })
const myAdjustments = ref<any[]>([])
const currentCycleApplications = computed(() => applicationStore.applications.filter(a =>
  String(a.cycleId) === String(cycleStore.currentCycle?.id)
))
const canSubmitAdjustment = computed(() => cycleStore.currentPhase === 'adjustment' &&
  !applicationStore.finalResults.some(a => String((a as any).cycleId) === String(cycleStore.currentCycle?.id)) &&
  currentCycleApplications.value.length > 0 &&
  currentCycleApplications.value.every(a => ['rejected', 'withdrawn', 'cancelled'].includes(a.status)) &&
  !myAdjustments.value.some(a => a.status === 'pending' && String(a.cycle_id) === String(cycleStore.currentCycle?.id)))

// 可调剂课题：还有名额的
const availableTopics = computed(() => {
  return topicStore.topics.filter(t =>
    t.status === 'published' &&
    t.currentCount < t.maxStudents
  )
})

function showApplyDialog(topic: Topic) {
  if (!canSubmitAdjustment.value) return
  selectedTopic.value = topic
  applyDialogVisible.value = true
  adjustForm.value.motivation = ''
}

async function handleAdjustApply() {
  if (!userStore.currentUser || !selectedTopic.value) return
  if (!adjustForm.value.motivation.trim()) {
    ElMessage.warning('请填写调剂理由')
    return
  }

  submitting.value = true
  try {
    await applicationStore.adjustApplication({
      toTopicId: selectedTopic.value!.id,
      reason: adjustForm.value.motivation
    })
    ElMessage.success('调剂申请已提交')
    applyDialogVisible.value = false
    await loadAdjustments()
  } catch (err: any) {
    ElMessage.error(err?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

const difficultyType: Record<string, string> = { easy: 'success', medium: 'warning', hard: 'danger' }
const difficultyLabel: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }

const adjustmentStatusLabel: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝'
}

async function loadAdjustments() {
  const res: any = await applicationApi.getAdjustments()
  myAdjustments.value = res.data || []
}

function formatDateTime(dateStr: string): string {
  return dayjs(dateStr).format('YYYY-MM-DD HH:mm')
}

onMounted(async () => {
  loading.value = true
  await Promise.all([
    topicStore.fetchTopics({ pageSize: 50 }),
    applicationStore.fetchApplications(),
    cycleStore.fetchCurrentCycle(),
    loadAdjustments()
  ])
  loading.value = false
})
</script>
