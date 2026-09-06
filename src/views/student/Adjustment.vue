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
          调剂阶段仅面向未被录取的学生开放。您可以在此期间申请仍有名额的课题。教师将根据剩余名额进行二次遴选。
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
            <el-button type="warning" size="small" icon="Position" @click="showApplyDialog(row)">
              申请调剂
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 我的调剂记录 -->
      <h3 style="margin-top: 32px; margin-bottom: 16px; color: #303133;">我的调剂记录</h3>
      <el-table :data="myAdjustments" stripe empty-text="暂无调剂记录">
        <el-table-column prop="topicTitle" label="申请课题" min-width="220" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'accepted' ? 'success' : row.status === 'pending_review' ? 'warning' : 'danger'" size="small">
              {{ adjustmentStatusLabel[row.status] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="motivation" label="调剂理由" show-overflow-tooltip />
        <el-table-column prop="submittedAt" label="申请时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
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
import type { Topic, Application } from '../../types'
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'

const topicStore = useTopicStore()
const applicationStore = useApplicationStore()
const userStore = useUserStore()

const loading = ref(false)
const submitting = ref(false)
const applyDialogVisible = ref(false)
const selectedTopic = ref<Topic | null>(null)
const adjustForm = ref({ motivation: '' })

// 可调剂课题：还有名额的
const availableTopics = computed(() => {
  return topicStore.topics.filter(t =>
    t.status === 'published' &&
    t.currentCount < t.maxStudents
  )
})

// 该学生的调剂申请记录
const myAdjustments = computed((): Application[] => {
  if (!userStore.currentUser) return []
  return applicationStore.applications.filter(
    a => a.studentId === userStore.currentUser!.id &&
    ['pending_review', 'accepted'].includes(a.status) &&
    // 判断是否为调剂申请（通过时间或标记）
    a.priority === 1 && !applicationStore.finalResults.find(r => r.studentId === a.studentId)
  )
})

function showApplyDialog(topic: Topic) {
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
  } catch (err: any) {
    ElMessage.error(err?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}

const difficultyType: Record<string, string> = { easy: 'success', medium: 'warning', hard: 'danger' }
const difficultyLabel: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }

const adjustmentStatusLabel: Record<string, string> = {
  pending_review: '待审核',
  accepted: '已接受',
  rejected: '已拒绝'
}

function formatDateTime(dateStr: string): string {
  return dayjs(dateStr).format('YYYY-MM-DD HH:mm')
}

onMounted(async () => {
  loading.value = true
  await Promise.all([
    topicStore.fetchTopics(),
    applicationStore.fetchApplications()
  ])
  loading.value = false
})
</script>
