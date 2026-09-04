<template>
  <div class="topic-manage page-container">
    <div class="card-container">
      <div class="page-header">
        <h2 class="section-title">我的课题</h2>
        <el-button type="primary" icon="Plus" @click="$router.push('/teacher/topics/create')">
          发布新课题
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
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" icon="View" @click="viewDetail(row)">查看</el-button>
            <el-tooltip :disabled="row.status !== 'published'" content="已发布选题已锁定，不能编辑；如需修改请管理员先撤回">
              <span>
                <el-button link type="primary" icon="Edit" :disabled="row.status === 'published'" @click="editTopic(row)">编辑</el-button>
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
import type { Topic } from '../../types'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'

const userStore = useUserStore()
const topicStore = useTopicStore()
const applicationStore = useApplicationStore()
const router = useRouter()

const loading = ref(false)
const searchText = ref('')
const statusFilter = ref('')
const detailVisible = ref(false)
const currentDetail = ref<Topic | null>(null)

const myTopics = computed(() => {
  if (!userStore.currentUser) return []
  return topicStore.getTopicsByTeacher(userStore.currentUser.id)
})

onMounted(() => {
  topicStore.fetchMyTopics()
})

const filteredTopics = computed(() => {
  let result = myTopics.value
  if (searchText.value) {
    const kw = searchText.value.toLowerCase()
    result = result.filter(t => t.title.toLowerCase().includes(kw))
  }
  if (statusFilter.value) {
    result = result.filter(t => t.status === statusFilter.value)
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
