<template>
  <div class="topic-manage page-container">
    <div class="card-container">
      <div class="page-header">
        <h2 class="section-title">选题记录</h2>
        <el-button type="primary" icon="FolderOpened" @click="$router.push('/teacher/library')">
          从选题库发布
        </el-button>
      </div>

      <!-- 筛选栏 -->
      <div class="filter-bar">
        <el-input
          v-model="searchText"
          placeholder="搜索课题名称"
          prefix-icon="Search"
          clearable
          style="width: 260px;"
        />
        <el-select v-model="statusFilter" placeholder="状态筛选" clearable style="width: 140px;">
          <el-option label="待审核" value="pending" />
          <el-option label="已发布" value="published" />
          <el-option label="草稿" value="draft" />
          <el-option label="已满员" value="full" />
          <el-option label="已关闭" value="closed" />
        </el-select>
        <el-select v-model="cycleFilter" placeholder="周期筛选" clearable style="width: 140px;">
          <el-option label="本周期" value="current" />
          <el-option label="往期" value="past" />
          <el-option label="未归属" value="none" />
        </el-select>
      </div>

      <!-- 课题列表 -->
      <el-table :data="filteredTopics" stripe v-loading="loading" style="margin-top: 16px;">
        <el-table-column prop="title" label="课题名称" min-width="250" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" @click="viewDetail(row)">{{ row.title }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="category" label="研究方向" width="120" />
        <el-table-column prop="major" label="专业" width="130" />
        <el-table-column label="周期" width="130">
          <template #default="{ row }">
            <el-tag :type="isCurrentCycleTopic(row) ? 'success' : 'info'" size="small">{{ cycleLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="难度" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="difficultyType[row.difficulty]" size="small">{{ difficultyLabel[row.difficulty] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="名额/已选" width="100" align="center">
          <template #default="{ row }">
            <span>{{ row.currentCount }} / {{ row.maxStudents }}</span>
            <el-progress
              :percentage="(row.currentCount / row.maxStudents) * 100"
              :stroke-width="4"
              :show-text="false"
              style="width: 60px; display: inline-block; vertical-align: middle; margin-left: 8px;"
              :color="row.currentCount >= row.maxStudents ? '#f56c6c' : '#409eff'"
            />
          </template>
        </el-table-column>
        <el-table-column prop="applyCount" label="申请人数" width="90" align="center">
          <template #default="{ row }">
            <el-badge :value="row.applyCount" :max="99" type="warning" />
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTypeMap[row.status]" size="small">{{ statusLabel[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="120">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="430" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" icon="View" @click="viewDetail(row)">查看</el-button>
            <el-tooltip :disabled="row.status !== 'published'" content="已发布选题已锁定，不能编辑；如需修改请管理员先撤回">
              <span>
                <el-button link type="primary" icon="Edit" :disabled="row.status === 'published'" @click="editTopic(row)">编辑</el-button>
              </span>
            </el-tooltip>
            <el-popconfirm
              v-if="row.status === 'pending'"
              title="撤回后将回到草稿，可重新编辑后再提交，确定？"
              @confirm="withdrawPending(row)"
            >
              <template #reference>
                <el-button link type="warning" icon="Close">撤回提交</el-button>
              </template>
            </el-popconfirm>
            <el-tooltip v-if="row.status === 'full'" :disabled="Number(row.currentCount) === 0" content="已有录取学生，不能重新开放">
              <span>
                <el-button link type="success" icon="RefreshRight" :disabled="Number(row.currentCount) > 0" @click="reopenFull(row)">重新开放</el-button>
              </span>
            </el-tooltip>
            <el-popconfirm
              title="确定删除此课题？"
              @confirm="handleDelete(row.id)"
            >
              <template #reference>
                <el-button
                  link
                  type="danger"
                  icon="Delete"
                  :disabled="row.status === 'published'"
                >删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <!-- 统计信息 -->
      <div class="topic-summary">
        <span>共 {{ myTopics.length }} 个课题</span>
        <el-divider direction="vertical" />
        <span>已发布: {{ myTopics.filter(t => t.status === 'published').length }}</span>
        <el-divider direction="vertical" />
        <span>总申请: {{ totalApplications }}</span>
      </div>
    </div>

    <!-- 课题详情弹窗 -->
    <el-dialog v-model="detailVisible" :title="currentDetail?.title" width="700px">
      <template v-if="currentDetail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="指导教师">{{ currentDetail.teacherName }}</el-descriptions-item>
          <el-descriptions-item label="研究方向">{{ currentDetail.category }}</el-descriptions-item>
          <el-descriptions-item label="难度">
            <el-tag :type="difficultyType[currentDetail.difficulty]" size="small">{{ difficultyLabel[currentDetail.difficulty] }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="招收人数">{{ currentDetail.maxStudents }} 人</el-descriptions-item>
          <el-descriptions-item label="简介" :span="2">{{ currentDetail.description }}</el-descriptions-item>
          <el-descriptions-item label="要求" :span="2">
            <pre style="white-space: pre-wrap; margin: 0;">{{ currentDetail.requirements }}</pre>
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="currentDetail.schedules && currentDetail.schedules.length > 0" style="margin-top: 20px;">
          <h4 style="margin-bottom: 12px;">时间安排</h4>
          <el-timeline>
            <el-timeline-item v-for="(s, i) in currentDetail.schedules" :key="i" :timestamp="`${s.startDate} ~ ${s.endDate}`">
              <strong>{{ s.phase }}</strong>: {{ s.description }}
            </el-timeline-item>
          </el-timeline>
        </div>

        <div v-if="currentDetail.tags && currentDetail.tags.length > 0" style="margin-top: 20px;">
          <h4 style="margin-bottom: 12px;">标签</h4>
          <el-space wrap>
            <el-tag v-for="tag in currentDetail.tags" :key="tag">{{ tag }}</el-tag>
          </el-space>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../../stores/user'
import { useTopicStore } from '../../stores/topic'
import { useApplicationStore } from '../../stores/application'
import { useCycleStore } from '../../stores/cycle'
import type { Topic } from '../../types'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'

const userStore = useUserStore()
const topicStore = useTopicStore()
const applicationStore = useApplicationStore()
const cycleStore = useCycleStore()
const router = useRouter()

const loading = ref(false)
const searchText = ref('')
const statusFilter = ref('')
const cycleFilter = ref('')
const detailVisible = ref(false)
const currentDetail = ref<Topic | null>(null)

const myTopics = computed(() => {
  if (!userStore.currentUser) return []
  return topicStore.getTopicsByTeacher(userStore.currentUser.id)
})

const currentCycleId = computed(() => cycleStore.currentCycle?.id ?? null)

onMounted(() => {
  cycleStore.fetchCurrentCycle()
  topicStore.fetchMyTopics({ cycleId: 'all' })
})

// 周期归属：本周期 / 往期 / 未归属
function cycleLabel(row: Topic): string {
  if (row.cycleId == null) return '未归属'
  if (String(row.cycleId) === String(currentCycleId.value)) return '本周期'
  return row.cycleName || '往期'
}

function isCurrentCycleTopic(row: Topic): boolean {
  return row.cycleId != null && String(row.cycleId) === String(currentCycleId.value)
}

const filteredTopics = computed(() => {
  let result = myTopics.value
  if (searchText.value) {
    const kw = searchText.value.toLowerCase()
    result = result.filter(t => t.title.toLowerCase().includes(kw))
  }
  if (statusFilter.value) {
    result = result.filter(t => t.status === statusFilter.value)
  }
  if (cycleFilter.value === 'current') {
    result = result.filter(t => isCurrentCycleTopic(t))
  } else if (cycleFilter.value === 'past') {
    result = result.filter(t => t.cycleId != null && String(t.cycleId) !== String(currentCycleId.value))
  } else if (cycleFilter.value === 'none') {
    result = result.filter(t => t.cycleId == null)
  }
  return result
})

const totalApplications = computed(() => {
  return myTopics.value.reduce((sum, t) => sum + t.applyCount, 0)
})

const difficultyType: Record<string, string> = { easy: 'success', medium: 'warning', hard: 'danger' }
const difficultyLabel: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }
const statusTypeMap: Record<string, string> = { pending: 'warning', published: '', draft: 'info', full: 'warning', closed: 'danger' }
const statusLabel: Record<string, string> = { pending: '待审核', published: '已发布', draft: '草稿', full: '已满员', closed: '已关闭' }

function viewDetail(topic: Topic) {
  currentDetail.value = topic
  detailVisible.value = true
}

function editTopic(topic: Topic) {
  topicStore.incrementViewCount(topic.id)
  // 跳转到编辑页面
  router.push(`/teacher/topics/${topic.id}/edit`)
}

async function handleDelete(id: string) {
  try {
    await topicStore.deleteTopic(id)
    ElMessage.success('删除成功')
  } catch (e: any) {
    ElMessage.error(e?.message || '删除失败')
  }
}

async function republish(topic: Topic) {
  try {
    await topicStore.republishTopic(topic.id)
    ElMessage.success('已复制为本周期课题（草稿）')
    await topicStore.fetchMyTopics({ cycleId: 'all' })
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '重新发布失败')
  }
}

async function withdrawPending(row: Topic) {
  try {
    await topicStore.updateTopicStatus(row.id, 'draft')
    ElMessage.success('已撤回为草稿')
    await topicStore.fetchMyTopics({ cycleId: 'all' })
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '撤回失败')
  }
}

async function reopenFull(row: Topic) {
  try {
    await topicStore.updateTopicStatus(row.id, 'published')
    ElMessage.success('已重新开放该选题')
    await topicStore.fetchMyTopics({ cycleId: 'all' })
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '重新开放失败')
  }
}

function formatDate(dateStr: string): string {
  return dayjs(dateStr).format('YYYY-MM-DD')
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.filter-bar {
  display: flex;
  gap: 12px;
  align-items: center;
}

.topic-summary {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #ebeef5;
  font-size: 13px;
  color: #909399;
}
</style>
