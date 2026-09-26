<template>
  <div class="topic-detail page-container">
    <div v-loading="loading" v-if="topic" class="topic-content">
      <div class="detail-header card-container">
        <el-page-header @back="$router.back()" :title="'返回'">
          <template #content>
            <h2 style="font-size: 22px;">{{ topic.title }}</h2>
          </template>
        </el-page-header>

        <div class="header-badges">
          <el-tag :type="difficultyType[topic.difficulty]" effect="dark" size="large">
            {{ difficultyLabel[topic.difficulty] }}
          </el-tag>
          <el-tag type="primary" size="large">{{ topic.major }}</el-tag>
          <el-tag type="info" size="large">{{ topic.category }}</el-tag>
          <el-tag :type="topic.currentCount >= topic.maxStudents ? 'danger' : 'success'" size="large">
            剩余 {{ Math.max(0, topic.maxStudents - topic.currentCount) }} 个名额
          </el-tag>
        </div>
      </div>

      <el-row :gutter="20" style="margin-top: 20px;">
        <el-col :span="16" :xs="24">
          <el-card shadow="never">
            <template #header><strong>课题简介</strong></template>
            <p class="desc-text">{{ topic.description }}</p>
          </el-card>

          <el-card shadow="never" style="margin-top: 16px;">
            <template #header><strong>具体要求</strong></template>
            <pre class="req-text">{{ topic.requirements }}</pre>
          </el-card>

          <el-card v-if="topic.schedules && topic.schedules.length > 0" shadow="never" style="margin-top: 16px;">
            <template #header><strong>时间安排</strong></template>
            <el-timeline>
              <el-timeline-item
                v-for="(s, i) in topic.schedules"
                :key="i"
                :timestamp="`${s.startDate} ~ ${s.endDate}`"
              >
                <strong>{{ s.phase }}</strong>: {{ s.description }}
              </el-timeline-item>
            </el-timeline>
          </el-card>

          <el-card v-if="topic.attachments && topic.attachments.length > 0" shadow="never" style="margin-top: 16px;">
            <template #header><strong>相关附件</strong></template>
            <div v-for="att in topic.attachments" :key="att.id" class="attachment-item">
              <el-icon><Document /></el-icon>
              <el-link type="primary" :href="att.url" target="_blank" download>{{ att.name }}</el-link>
              <span class="att-size">{{ formatSize(att.size) }}</span>
            </div>
          </el-card>
        </el-col>

        <el-col :span="8" :xs="24">
          <el-card shadow="never">
            <template #header><strong>教师信息</strong></template>
            <div class="teacher-info">
              <el-avatar :size="64" :src="topic.teacherAvatar" icon="UserFilled" />
              <div class="teacher-detail">
                <p class="teacher-name">{{ topic.teacherName }}</p>
                <p class="teacher-title">{{ topic.teacherTitle }}</p>
                <p class="teacher-dept">{{ topic.teacherDepartment }}</p>
              </div>
            </div>
            <div class="teacher-contact mt-3">
              <div v-if="topic.teacherEmail" class="contact-item">
                <el-icon size="16"><Message /></el-icon>
                <span>{{ topic.teacherEmail }}</span>
              </div>
              <div v-if="topic.teacherPhone" class="contact-item">
                <el-icon size="16"><Phone /></el-icon>
                <span>{{ topic.teacherPhone }}</span>
              </div>
            </div>
          </el-card>

          <el-card v-if="isStudent" shadow="never" style="margin-top: 16px;">
            <template #header><strong>加入预选</strong></template>
            <el-button
              @click="addToShortlist"
              :type="isShortlisted ? 'success' : 'warning'"
              plain
              size="large"
              :icon="ShoppingCart"
              style="width: 100%; margin-bottom: 8px;"
            >
              {{ isShortlisted ? '已加入预选列表' : '加入预选列表' }}
            </el-button>
            <p style="font-size: 12px; color: #909399; text-align: center;">
              可先收藏课题，再到选题工作台选择 3–6 个志愿；所选课题须覆盖至少两位不同指导教师。
            </p>
          </el-card>

          <el-card v-if="isStudent" shadow="never" style="margin-top: 16px;" id="apply-section">
            <template #header><strong>填报志愿</strong></template>
            <div class="apply-status">
              <p v-if="myApplication" class="already-applied">
                <el-icon color="#67c23a"><CircleCheckFilled /></el-icon>
                您已将此课题作为<strong>第{{ priorityLabel[myApplication.priority] }}志愿</strong>填报
              </p>
              <template v-else>
                <p>请在选题工作台统一排序并提交志愿，至少覆盖两位不同指导教师。</p>
                <el-button type="primary" style="width: 100%;" @click="router.push('/student/browse')">前往选题工作台</el-button>
              </template>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTopicStore } from '../../stores/topic'
import { useApplicationStore } from '../../stores/application'
import { useUserStore } from '../../stores/user'
import { ElMessage } from 'element-plus'
import { Document, UserFilled, CircleCheckFilled, ShoppingCart, Message, Phone } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { shortlistApi } from '@/api'

const route = useRoute()
const router = useRouter()
const topicStore = useTopicStore()
const applicationStore = useApplicationStore()
const userStore = useUserStore()

const loading = ref(false)
const shortlistedIds = ref<string[]>([])

const topic = computed(() => {
  const localTopic = topicStore.getTopicById(route.params.id as string)
  // 如果本地缓存没有，使用 currentTopic（从 fetchTopicDetail 获取）
  return localTopic || topicStore.currentTopic
})

// 当前用户对此课题的申请
const myApplication = computed(() => {
  if (!userStore.currentUser) return null
  return applicationStore.getApplicationsByStudent(userStore.currentUser.id)
    .find(a => a.topicId === route.params.id)
})

const difficultyType: Record<string, string> = { easy: 'success', medium: 'warning', hard: 'danger' }
const difficultyLabel: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }
const priorityLabel: Record<number, string> = { 1: '一', 2: '二', 3: '三' }

const isShortlisted = computed(() => shortlistedIds.value.includes(route.params.id as string))
const isStudent = computed(() => userStore.userRole === 'student')

const loadShortlist = async () => {
  try {
    const res = await shortlistApi.getList()
    shortlistedIds.value = res.data.map((item: any) => item.topic_id)
  } catch {
    shortlistedIds.value = []
  }
}

const addToShortlist = async () => {
  const topicId = route.params.id as string
  if (shortlistedIds.value.includes(topicId)) {
    ElMessage.warning('该课题已在预选列表中')
    return
  }
  try {
    await shortlistApi.add(topicId)
    shortlistedIds.value.push(topicId)
    ElMessage.success('已添加到预选列表')
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '添加失败')
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}



onMounted(async () => {
  loading.value = true
  const topicId = route.params.id as string

  if (!topicStore.getTopicById(topicId)) {
    await topicStore.fetchTopicDetail(topicId)
  }

  if (isStudent.value) {
    await Promise.all([
      loadShortlist(),
      applicationStore.fetchApplications()
    ])
  }

  topicStore.incrementViewCount(topicId)
  loading.value = false
})
</script>

<style scoped>
.detail-header {
  position: relative;
}

.header-badges {
  margin-top: 16px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.desc-text {
  line-height: 1.8;
  color: #303133;
  font-size: 14px;
}

.req-text {
  white-space: pre-wrap;
  line-height: 1.8;
  color: #606266;
  font-size: 14px;
  margin: 0;
  font-family: inherit;
}

.teacher-info {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.teacher-detail {
  flex: 1;
}
.teacher-name {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin: 0;
}
.teacher-title {
  font-size: 14px;
  color: #409eff;
  margin: 4px 0;
}
.teacher-dept {
  font-size: 13px;
  color: #909399;
  margin: 0;
}
.teacher-contact {
  border-top: 1px solid #f0f0f0;
  padding-top: 12px;
}
.contact-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}
.contact-item:last-child {
  margin-bottom: 0;
}

.already-applied {
  padding: 16px;
  background: #f0f9eb;
  border-radius: 8px;
  text-align: center;
  color: #67c23a;
  font-size: 14px;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}
.attachment-item:last-child {
  border-bottom: none;
}
.att-size {
  font-size: 12px;
  color: #c0c4cc;
  margin-left: auto;
}
</style>
