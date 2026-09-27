<template>
  <div class="dashboard page-container">
    <!-- 欢迎信息 -->
    <div class="welcome-section card-container">
      <h2>{{ greeting }}，{{ userStore.currentUser?.realName }}！</h2>
      <p class="welcome-desc">{{ roleDescriptions[userStore.userRole || 'student'] }}</p>
    </div>

    <div v-if="userStore.userRole === 'student'" class="focus-card card-container">
      <div><span class="focus-label">下一步建议</span><h3>{{ myApplications.length >= 3 ? '志愿已提交，等待教师审核' : '先浏览课题，再完成 3 个志愿' }}</h3><p>{{ myApplications.length >= 3 ? '你可以在“已提交志愿”中查看凭证，在结果页查看后续状态。' : '把感兴趣的方向加入选题工作台，系统会帮你保留进度。' }}</p></div>
      <el-button type="primary" @click="$router.push(myApplications.length >= 3 ? '/student/browse?panel=submitted' : '/student/browse')">{{ myApplications.length >= 3 ? '查看提交记录' : '进入选题工作台' }}</el-button>
    </div>
    <div v-else-if="userStore.userRole === 'teacher'" class="focus-card teacher-focus card-container">
      <div><span class="focus-label">审批待办</span><h3>{{ pendingReviewCount ? `有 ${pendingReviewCount} 份申请等待处理` : '当前没有待处理申请' }}</h3><p>{{ pendingReviewCount ? '先处理待办申请，再查看已经完成的记录。' : '可以先检查课题名额，或发布新的课题。' }}</p></div>
      <el-button type="primary" @click="$router.push('/teacher/review')">{{ pendingReviewCount ? '处理待办' : '查看遴选' }}</el-button>
    </div>

    <!-- 阶段进度 -->
    <el-row :gutter="20" class="stats-row">
      <el-col :xs="12" :sm="12" :md="6">
        <el-card shadow="hover" class="stat-card phase-card" :style="{ borderTopColor: cycleStore.phaseInfo.color }">
          <div class="stat-icon" :style="{ backgroundColor: cycleStore.phaseInfo.color + '20', color: cycleStore.phaseInfo.color }">
            <el-icon :size="28"><Timer /></el-icon>
          </div>
          <div class="stat-info">
            <p class="stat-value">{{ cycleStore.phaseInfo.label }}</p>
            <p class="stat-label">当前阶段</p>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="12" :sm="12" :md="6" v-if="userStore.userRole === 'admin'">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon blue">
            <el-icon :size="28"><Document /></el-icon>
          </div>
          <div class="stat-info">
            <p class="stat-value">{{ adminTopicCount }}</p>
            <p class="stat-label">课题总数</p>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="12" :sm="12" :md="6" v-if="userStore.userRole !== 'admin'">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon green">
            <el-icon :size="28"><Document /></el-icon>
          </div>
          <div class="stat-info">
            <p class="stat-value">{{ topicStore.topics.length }}</p>
            <p class="stat-label">可用课题</p>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="12" :sm="12" :md="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon orange">
            <el-icon :size="28"><UserFilled /></el-icon>
          </div>
          <div class="stat-info">
            <p class="stat-value">{{ applicationStore.stats.totalApplications }}</p>
            <p class="stat-label">申请总数</p>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="12" :sm="12" :md="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-icon purple">
            <el-icon :size="28"><CircleCheck /></el-icon>
          </div>
          <div class="stat-info">
            <p class="stat-value">{{ applicationStore.stats.finalMatched }}</p>
            <p class="stat-label">已匹配</p>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 时间线/流程展示 -->
    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :xs="24" :sm="24" :md="16">
        <el-card shadow="never" class="card-container timeline-card">
          <template #header>
            <div class="card-header">
              <span class="section-title" style="border: none; padding: 0;">选题工作流程</span>
              <el-tag size="small" v-if="cycleStore.currentCycle" style="white-space: normal; text-align: center; line-height: 1.6; height: auto; padding: 6px 10px; margin-top: 4px; margin-bottom: 4px;">{{ cycleStore.currentCycle.name }}</el-tag>
            </div>
          </template>

          <el-steps :active="currentStep" finish-status="success" align-center>
            <el-step title="课题发布" />
            <el-step title="志愿填报" />
            <el-step title="教师遴选" />
            <el-step title="结果公示" />
            <el-step title="调剂补录" />
          </el-steps>

          <div class="timeline-detail" v-if="cycleStore.currentCycle">
            <div class="time-list" style="margin-top: 24px;">
              <div class="time-item">
                <span class="time-label">课题发布期</span>
                <span class="time-value">{{ formatDate(cycleStore.currentCycle.topicPublishStart) }} ~ {{ formatDate(cycleStore.currentCycle.topicPublishEnd) }}</span>
              </div>
              <div class="time-item">
                <span class="time-label">填报时间</span>
                <span class="time-value">{{ formatDate(cycleStore.currentCycle.studentApplyStart) }} ~ {{ formatDate(cycleStore.currentCycle.studentApplyEnd) }}</span>
              </div>
              <div class="time-item">
                <span class="time-label">遴选时间</span>
                <span class="time-value">{{ formatDate(cycleStore.currentCycle.teacherReviewStart) }} ~ {{ formatDate(cycleStore.currentCycle.teacherReviewEnd) }}</span>
              </div>
              <div class="time-item">
                <span class="time-label">结果公布</span>
                <span class="time-value">{{ formatDate(cycleStore.currentCycle.resultAnnounceTime) }}</span>
              </div>
              <div class="time-item">
                <span class="time-label">调剂时间</span>
                <span class="time-value">{{ formatDate(cycleStore.currentCycle.adjustmentStart) }} ~ {{ formatDate(cycleStore.currentCycle.adjustmentEnd) }}</span>
              </div>
              <div class="time-item">
                <span class="time-label">当前状态</span>
                <el-tag :type="statusTypeMap[cycleStore.currentPhase]" size="small">{{ cycleStore.phaseInfo.label }}</el-tag>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :xs="24" :sm="24" :md="8">
        <el-card shadow="never" class="card-container">
          <template #header>
            <span class="section-title" style="border: none; padding: 0;">快捷操作</span>
          </template>

          <div class="quick-actions">
            <template v-if="userStore.userRole === 'admin'">
              <el-button type="primary" icon="Plus" @click="$router.push('/admin/cycles')" style="width: 100%;">
                创建选题周期
              </el-button>
              <el-button icon="DataAnalysis" @click="$router.push('/admin/stats')" style="width: 100%; margin-top: 12px;">
                查看统计数据
              </el-button>
              <el-button icon="UserFilled" @click="$router.push('/admin/users')" style="width: 100%; margin-top: 12px;">
                管理用户
              </el-button>
              <el-divider />
              <el-alert
                title="管理员操作提示"
                type="info"
                :closable="false"
                show-icon
                style="margin-bottom: 12px;"
              >
                <template #default>
                  可通过右上角切换角色查看不同端的功能界面。
                </template>
              </el-alert>
            </template>

            <template v-if="userStore.userRole === 'teacher'">
              <el-button type="primary" icon="Plus" @click="$router.push('/teacher/topics/create')" style="width: 100%;">
                发布新课题
              </el-button>
              <el-button icon="Document" @click="$router.push('/teacher/topics')" style="width: 100%; margin-top: 12px;">
                管理我的课题
              </el-button>
              <el-button icon="UserFilled" @click="$router.push('/teacher/review')" style="width: 100%; margin-top: 12px;">
                遴选学生
                <el-badge v-if="pendingReviewCount > 0" :value="pendingReviewCount" style="margin-left: 8px;" />
              </el-button>
              <el-button icon="TrendCharts" @click="$router.push('/teacher/results')" style="width: 100%; margin-top: 12px;">
                查看选课结果
              </el-button>
            </template>

            <template v-if="userStore.userRole === 'student'">
              <el-button type="primary" icon="Search" @click="$router.push('/student/browse')" style="width: 100%;">
                浏览课题
              </el-button>
              <el-button icon="EditPen" @click="$router.push('/student/profile')" style="width: 100%; margin-top: 12px;">
                完善个人档案
                <el-tag v-if="!profileComplete" type="danger" size="small" style="margin-left: 8px;">未完成</el-tag>
              </el-button>
              <el-button icon="Tickets" @click="$router.push('/student/browse?panel=submitted')" style="width: 100%; margin-top: 12px;">
                我的志愿（已填 {{ myApplications.length }} 个，至少 3 个、最多 6 个）
              </el-button>
              <el-button icon="CircleCheck" @click="$router.push('/student/result')" style="width: 100%; margin-top: 12px;">
                查看选课结果
              </el-button>
            </template>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 学生选题推荐 / 管理端综合热度 -->
    <div v-if="userStore.userRole === 'student'" style="margin-top: 20px;">
      <el-card shadow="never" class="card-container">
        <template #header>
          <div class="recommendation-header">
            <div>
              <span class="section-title" style="border: none; padding: 0;">选题推荐</span>
              <p>优先展示申请较少、浏览较少的课题，并在不同教师之间轮换。</p>
            </div>
            <div class="recommendation-actions">
              <el-button :disabled="recommendedTopics.length <= recommendationPageSize" @click="changeRecommendations">换一批</el-button>
              <el-button type="primary" plain @click="$router.push('/student/browse')">查看全部选题</el-button>
            </div>
          </div>
        </template>
        <el-empty v-if="visibleRecommendations.length === 0" description="当前没有可推荐的课题" />
        <el-table v-else :data="visibleRecommendations" stripe size="small">
          <el-table-column prop="title" label="课题名称" min-width="200">
            <template #default="{ row }">
              <router-link :to="`/student/browse?open=${row.id}`" class="topic-link">{{ row.title }}</router-link>
            </template>
          </el-table-column>
          <el-table-column label="申请/名额" width="100" align="center">
            <template #default="{ row }">
              {{ row.applyCount }} / {{ row.maxStudents || '—' }}
            </template>
          </el-table-column>
          <el-table-column label="竞争程度" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="competitionType(row)" size="small">{{ competitionLabel(row) }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>

    <div v-else style="margin-top: 20px;">
      <el-card shadow="never" class="card-container">
        <template #header>
          <span class="section-title" style="border: none; padding: 0;">综合热度 Top 5</span>
        </template>
        <el-table :data="hotTopics" stripe size="small">
          <el-table-column prop="title" label="课题名称" min-width="200" />
          <el-table-column prop="teacherName" label="指导教师" width="100" />
          <el-table-column prop="applyCount" label="申请数" width="80" align="center" />
          <el-table-column prop="viewCount" label="浏览量" width="80" align="center" />
          <el-table-column label="竞争程度" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="competitionType(row)" size="small">{{ competitionLabel(row) }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useUserStore } from '../stores/user'
import { useCycleStore } from '../stores/cycle'
import { useTopicStore } from '../stores/topic'
import { useApplicationStore } from '../stores/application'
import { useStudentStore } from '../stores/student'
import { useSelectionDraftStore } from '../stores/selectionDraft'
import { adminApi, statisticsApi } from '../api'
import dayjs from 'dayjs'
import {
  Timer, Document, UserFilled, CircleCheck,
  Plus, DataAnalysis, EditPen, Tickets, Search, TrendCharts
} from '@element-plus/icons-vue'

const userStore = useUserStore()
const cycleStore = useCycleStore()
const topicStore = useTopicStore()
const applicationStore = useApplicationStore()
const studentStore = useStudentStore()
const selectionDraftStore = useSelectionDraftStore()
const adminTopicCount = ref(0)
const hotTopics = ref<any[]>([])
const recommendedTopics = ref<any[]>([])
const recommendationOffset = ref(0)
const recommendationPageSize = 5
const visibleRecommendations = computed(() => {
  if (recommendedTopics.value.length <= recommendationPageSize) return recommendedTopics.value
  return Array.from({ length: recommendationPageSize }, (_, index) =>
    recommendedTopics.value[(recommendationOffset.value + index) % recommendedTopics.value.length]
  )
})

// 问候语
const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

const roleDescriptions: Record<string, string> = {
  admin: '您可以管理选题周期、用户账号、查看全局统计等',
  teacher: '您可以发布课题、管理已发布课题、遴选学生等',
  student: '您可以浏览课题、完善个人档案、填报志愿、查看结果等'
}

// 流程步骤
const currentStep = computed(() => {
  const phaseMap: Record<string, number> = {
    topic_submission: 0,
    topic_publish: 0,
    student_apply: 1,
    student_selection: 1,
    teacher_review: 2,
    result_announce: 3,
    completed: 4,
    adjustment: 4,
    none: -1
  }
  return phaseMap[cycleStore.currentPhase] ?? -1
})

const statusTypeMap: Record<string, any> = {
  topic_submission: 'success',
  topic_publish: 'success',
  student_apply: 'success',
  student_selection: 'success',
  teacher_review: 'warning',
  result_announce: 'success',
  adjustment: 'danger',
  completed: 'info',
  none: 'info'
}

const difficultyTypeMap: Record<string, any> = {
  easy: 'success',
  medium: 'warning',
  hard: 'danger'
}
const difficultyLabels: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难'
}

// 待遴选数量
const pendingReviewCount = computed(() => {
  if (userStore.currentUser?.role !== 'teacher' && userStore.currentUser?.role !== 'admin') return 0
  if (userStore.currentUser?.role === 'teacher') return selectionDraftStore.pendingTopicCount
  const myTopics = topicStore.getTopicsByTeacher(userStore.currentUser.id)
  let count = 0
  for (const topic of myTopics) {
    count += applicationStore.getApplicationsByTopic(topic.id).filter(
      a => a.status === 'submitted' || a.status === 'pending_review'
    ).length
  }
  return count
})

// 学生相关数据
const profileComplete = computed(() => {
  if (userStore.currentUser?.role !== 'student') return false
  const profile = studentStore.profile
  return profile?.isComplete ?? false
})

const myApplications = computed(() => {
  if (userStore.currentUser?.role !== 'student') return []
  return applicationStore.getApplicationsByStudent(userStore.currentUser.id).filter(
    a => Number(a.cycleId) === Number(cycleStore.currentCycle?.id) &&
      ['pending', 'submitted', 'pending_review', 'waitlisted', 'accepted'].includes(a.status)
  )
})

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  return dayjs(dateStr).format('YYYY-MM-DD')
}

function changeRecommendations() {
  recommendationOffset.value = (recommendationOffset.value + recommendationPageSize) % recommendedTopics.value.length
}

function competitionRatio(topic: any): number {
  const capacity = Number(topic.maxStudents) || 0
  return capacity > 0 ? Number(topic.applyCount) / capacity : 0
}

function competitionLabel(topic: any): string {
  const ratio = competitionRatio(topic)
  if (Number(topic.applyCount) === 0) return '暂无竞争'
  if (ratio <= 1) return '竞争适中'
  if (ratio <= 2) return '竞争较高'
  return '竞争激烈'
}

function competitionType(topic: any): 'success' | 'info' | 'warning' | 'danger' {
  const ratio = competitionRatio(topic)
  if (Number(topic.applyCount) === 0) return 'success'
  if (ratio <= 1) return 'info'
  if (ratio <= 2) return 'warning'
  return 'danger'
}

// 加载数据
onMounted(async () => {
  await Promise.all([
    topicStore.topics.length === 0 ? topicStore.fetchTopics() : Promise.resolve(),
    userStore.currentUser?.role === 'student' ? studentStore.fetchProfile() : Promise.resolve(),
    applicationStore.fetchApplications(),
    loadDashboardTopicData()
  ])
  if (userStore.currentUser?.role === 'teacher') {
    const ownTopics = topicStore.getTopicsByTeacher(userStore.currentUser.id)
    await Promise.all(ownTopics.map(topic => selectionDraftStore.load(topic.id).catch(() => null)))
  }
})

async function loadDashboardTopicData() {
  const [topicStatsResult, adminStatsResult] = await Promise.allSettled([
    statisticsApi.getTopicStats(),
    userStore.userRole === 'admin' ? adminApi.getStatistics() : Promise.resolve(null)
  ])
  if (topicStatsResult.status === 'fulfilled') {
    const mapTopic = (topic: any) => ({
      ...topic,
      teacherName: topic.teacher_name,
      applyCount: Number(topic.apply_count) || 0,
      viewCount: Number(topic.view_count) || 0,
      maxStudents: Number(topic.max_students) || 0
    })
    hotTopics.value = (topicStatsResult.value.data?.hotTopics || []).slice(0, 5).map(mapTopic)
    recommendedTopics.value = (topicStatsResult.value.data?.recommendedTopics || []).map(mapTopic)
    recommendationOffset.value = 0
  } else {
    console.error('获取工作台热门课题失败:', topicStatsResult.reason)
  }
  if (adminStatsResult.status === 'fulfilled' && adminStatsResult.value) {
    adminTopicCount.value = Number(adminStatsResult.value.data?.topics?.total) || 0
  } else if (adminStatsResult.status === 'rejected') {
    console.error('获取管理员课题总数失败:', adminStatsResult.reason)
  }
}
</script>

<style scoped>
.welcome-section {
  background: var(--primary-color);
  color: #fff;
  margin-bottom: 20px;
}

.focus-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  border-left: 4px solid var(--accent-color);
}

.focus-label { color: var(--accent-color); font-size: 12px; font-weight: 700; }
.focus-card h3 { color: var(--primary-color); margin: 6px 0; font-size: 18px; }
.focus-card p { color: var(--text-secondary); font-size: 13px; }

.welcome-section h2 {
  font-size: 22px;
  font-weight: 600;
}

.welcome-desc {
  margin-top: 8px;
  opacity: 0.85;
  font-size: 14px;
}

.recommendation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.recommendation-header p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.recommendation-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

@media (max-width: 640px) {
  .recommendation-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .recommendation-actions {
    width: 100%;
  }

  .recommendation-actions .el-button {
    flex: 1;
  }
}

.stats-row .el-col {
  margin-bottom: 0;
}

.stat-card {
  border-top: 3px solid transparent;
  transition: transform 0.3s;
}

.stat-card:hover {
  transform: translateY(-4px);
}

.stat-card :deep(.el-card__body) {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
}

.stat-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-icon.blue { background-color: #409eff20; color: #409eff; }
.stat-icon.green { background-color: #67c23a20; color: #67c23a; }
.stat-icon.orange { background-color: #e6a23c20; color: #e6a23c; }
.stat-icon.purple { background-color: #2f7d7320; color: #2f7d73; }

.stat-info .stat-value {
  font-size: 24px;
  font-weight: 700;
  color: #303133;
  line-height: 1.2;
}

.stat-info .stat-label {
  font-size: 13px;
  color: #909399;
  margin-top: 4px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.timeline-card :deep(.el-card__body) {
  padding: 20px 24px;
}

.time-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.time-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
  gap: 16px;
}

.time-item:last-child {
  border-bottom: none;
}

.time-label {
  color: #606266;
  font-size: 14px;
  flex-shrink: 0;
  width: 90px;
}

.time-value {
  color: #303133;
  font-size: 14px;
  text-align: left;
  word-break: break-all;
  flex: 1;
}

.quick-actions {
  display: flex;
  flex-direction: column;
}

/* 响应式 */
@media (max-width: 992px) {
  .stats-row .el-col { margin-bottom: 12px; }
  .stat-card:hover { transform: none; }
  .stat-card :deep(.el-card__body) { padding: 14px; gap: 12px; }
  .stat-icon { width: 44px; height: 44px; border-radius: 10px; flex-shrink: 0; }
  .stat-icon :deep(.el-icon) { font-size: 22px !important; }
  .stat-info .stat-value { font-size: 20px; }
  .stat-info .stat-label { font-size: 12px; }

  /* 时间线描述信息窄屏单列 */
  .timeline-card :deep(.el-descriptions) {
    --el-descriptions-column: 1;
  }
}

@media (max-width: 768px) {
  .focus-card { align-items: flex-start; flex-direction: column; }
  .focus-card .el-button { width: 100%; }
  .welcome-section h2 { font-size: 18px; }
  .welcome-desc { font-size: 13px; }

  /* 统计卡片紧凑布局 */
  .stat-card :deep(.el-card__body) { padding: 10px 14px; gap: 10px; flex-wrap: wrap; }
  .stat-icon { width: 40px; height: 40px; border-radius: 8px; }
  .stat-info .stat-value { font-size: 18px; }
  .stat-info .stat-label { font-size: 11px; }

  /* 步骤条文字缩小或隐藏 */
  .timeline-card :deep(.el-step__description) { font-size: 11px; }

  /* 步骤条标签缩小 */
  .timeline-card :deep(.el-step__title) { font-size: 12px; }
}

@media (max-width: 480px) {
  .welcome-section h2 { font-size: 16px; }
  .welcome-desc { font-size: 12px; }

  .stat-card :deep(.el-card__body) { padding: 8px 12px; gap: 8px; }
  .stat-icon { width: 36px; height: 36px; border-radius: 6px; }
  .stat-icon :deep(.el-icon) { font-size: 18px !important; }
  .stat-info .stat-value { font-size: 16px; }
  .stat-info .stat-label { font-size: 10px; }

  /* 步骤条只显示图标 */
  .timeline-card :deep(.el-step__description) { display: none; }
  .timeline-card :deep(.el-step__title) { font-size: 11px; }

  /* 描述信息文字缩小 */
  .timeline-card :deep(.el-descriptions-item__label) { font-size: 11px; }
  .timeline-card :deep(.el-descriptions-item__content) { font-size: 11px; }

  /* 快捷操作按钮紧凑 */
  .quick-actions :deep(.el-button) {
    font-size: 12px;
    padding: 8px 12px;
  }

  /* 热门课题表格缩小 */
  .hot-topics-table :deep(.el-table) { font-size: 11px; }
  .hot-topics-table :deep(.el-table th) { font-size: 11px; }
  .hot-topics-table :deep(.el-table td) { padding: 6px 8px; }

  /* 课题链接样式 */
  .topic-link {
    color: #409eff;
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
