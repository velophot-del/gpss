<template>
  <div class="statistics page-container">
    <div class="card-container">
      <h2 class="section-title">数据统计</h2>

      <!-- 概览卡片 -->
      <el-row :gutter="20" style="margin-bottom: 20px;">
        <el-col :span="6" :xs="12" :sm="6">
          <el-card shadow="hover">
            <el-statistic title="课题总数" :value="statisticsTopics.length">
              <template #prefix><el-icon color="#409eff"><Document /></el-icon></template>
            </el-statistic>
          </el-card>
        </el-col>
        <el-col :span="6" :xs="12" :sm="6">
          <el-card shadow="hover">
            <el-statistic title="参与学生" :value="participantCount">
              <template #prefix><el-icon color="#67c23a"><User /></el-icon></template>
            </el-statistic>
          </el-card>
        </el-col>
        <el-col :span="6" :xs="12" :sm="6">
          <el-card shadow="hover">
            <el-statistic title="申请总数" :value="applicationCount">
              <template #prefix><el-icon color="#e6a23c"><Tickets /></el-icon></template>
            </el-statistic>
          </el-card>
        </el-col>
        <el-col :span="6" :xs="12" :sm="6">
          <el-card shadow="hover">
            <el-statistic title="匹配完成率" :value="matchRate" suffix="%">
              <template #prefix><el-icon :color="matchRate > 80 ? '#67c23a' : '#e6a23c'"><TrendCharts /></el-icon></template>
            </el-statistic>
          </el-card>
        </el-col>
      </el-row>

      <el-row :gutter="20">
        <el-col :span="12" :xs="24">
          <el-card shadow="never">
            <template #header><strong>各方向课题分布</strong></template>
            <div class="chart-container">
              <div class="mock-chart">
                <div v-for="(count, cat) in categoryStats" :key="cat" class="bar-item">
                  <span class="cat-name">{{ cat }}</span>
                  <div class="bar-wrapper">
                    <div class="bar" :style="{ width: `${(count / maxCategoryCount) * 100}%` }"></div>
                    <span class="bar-value">{{ count }}</span>
                  </div>
                </div>
              </div>
            </div>
          </el-card>
        </el-col>

        <el-col :span="12" :xs="24">
          <el-card shadow="never">
            <template #header><strong>申请热度排行 Top 10</strong></template>
            <el-table :data="hotTopics" size="small" stripe>
              <el-table-column type="index" label="#" width="40" />
              <el-table-column prop="title" label="课题名称" show-overflow-tooltip min-width="180" />
              <el-table-column prop="applyCount" label="申请数" width="80" align="center">
                <template #default="{ row }">
                  <el-progress
                    :percentage="Math.round((row.applyCount / maxApplyCount) * 100)"
                    :stroke-width="6"
                    :show-text="false"
                  />
                </template>
              </el-table-column>
              <el-table-column prop="applyCount" label="" width="50" align="center">
                <template #default="{ row }">{{ row.applyCount }}</template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-col>
      </el-row>

      <el-row :gutter="20" style="margin-top: 20px;">
        <el-col :span="12" :xs="24">
          <el-card shadow="never">
            <template #header><strong>难度分布</strong></template>
            <div style="padding: 20px 0;">
              <div class="difficulty-row" v-for="(d, key) in difficultyStats" :key="key">
                <span class="diff-label">{{ difficultyLabel[key] }}</span>
                <el-progress
                  :percentage="statisticsTopics.length ? (d / statisticsTopics.length) * 100 : 0"
                  :color="difficultyColor[key]"
                  :stroke-width="14"
                  style="flex: 1;"
                >
                  <span>{{ d }}个</span>
                </el-progress>
              </div>
            </div>
          </el-card>
        </el-col>

        <el-col :span="12" :xs="24">
          <el-card shadow="never">
            <template #header><strong>教师工作量统计</strong></template>
            <el-table :data="teacherWorkload" size="small" stripe>
              <el-table-column prop="name" label="教师" width="100" />
              <el-table-column prop="topicCount" label="课题数" width="80" align="center" />
              <el-table-column prop="totalApps" label="总申请" width="80" align="center" />
              <el-table-column prop="accepted" label="已录取" width="80" align="center" />
              <el-table-column label="满员率" width="120" align="center">
                <template #default="{ row }">
                  <el-tag :type="row.fullRate >= 80 ? 'success' : 'warning'" size="small">
                    {{ row.fullRate.toFixed(0) }}%
                  </el-tag>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminApi } from '../../api'
import { Document, User, Tickets, TrendCharts } from '@element-plus/icons-vue'

const statisticsTopics = ref<any[]>([])
const participantCount = ref(0)
const matchedParticipantCount = ref(0)
const applicationCount = ref(0)

onMounted(async () => {
  const [topicsResult, statisticsResult] = await Promise.all([
    adminApi.getAllTopics(),
    adminApi.getStatistics()
  ])
  const summary = statisticsResult.data || {}
  participantCount.value = Number(summary.students?.applied) || 0
  matchedParticipantCount.value = Number(summary.students?.matched) || 0
  applicationCount.value = Number(summary.applications?.total) || 0
  statisticsTopics.value = (topicsResult.data || []).map((topic: any) => ({
    ...topic,
    teacherId: topic.teacher_id,
    teacherName: topic.teacher_name,
    maxStudents: Number(topic.max_students),
    currentCount: Number(topic.accepted_count),
    applyCount: Number(topic.apply_count)
  }))
})

// 匹配率
const matchRate = computed(() => {
  if (participantCount.value === 0) return 0
  return Math.round((matchedParticipantCount.value / participantCount.value) * 100)
})

// 分类统计
const categoryStats = computed(() => {
  const stats: Record<string, number> = {}
  for (const t of statisticsTopics.value) {
    const category = String(t.category || '').trim() || '未分类'
    stats[category] = (stats[category] || 0) + 1
  }
  return Object.fromEntries(Object.entries(stats).sort(([, a], [, b]) => b - a))
})
const maxCategoryCount = computed(() => Math.max(...Object.values(categoryStats.value), 1))

// 热门课题
const hotTopics = computed(() =>
  [...statisticsTopics.value].sort((a, b) => b.applyCount - a.applyCount).slice(0, 10)
)
const maxApplyCount = computed(() => Math.max(...statisticsTopics.value.map(t => t.applyCount), 1))

// 难度分布
const difficultyStats = computed(() => {
  const stats: Record<string, number> = { easy: 0, medium: 0, hard: 0 }
  for (const t of statisticsTopics.value) {
    stats[t.difficulty]++
  }
  return stats
})
const difficultyLabel: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }
const difficultyColor: Record<string, string> = { easy: '#67c23a', medium: '#e6a23c', hard: '#f56c6c' }

// 教师工作量
const teacherWorkload = computed(() => {
  const map = new Map<string, any>()
  for (const t of statisticsTopics.value) {
    if (!map.has(t.teacherId)) {
      map.set(t.teacherId, { name: t.teacherName, topicCount: 0, totalApps: 0, accepted: 0, totalSlots: 0 })
    }
    const info = map.get(t.teacherId)!
    info.topicCount++
    info.totalApps += t.applyCount
    info.accepted += t.currentCount
    info.totalSlots += t.maxStudents
  }
  return Array.from(map.values()).map(v => ({
    ...v,
    fullRate: v.totalSlots > 0 ? (v.accepted / v.totalSlots) * 100 : 0
  }))
})
</script>

<style scoped>
.mock-chart {
  width: 100%;
  padding: 0 12px;
}
.chart-container {
  padding: 12px 0;
}
.bar-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.cat-name {
  width: 120px;
  font-size: 13px;
  flex-shrink: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
.bar-wrapper {
  flex: 1;
  position: relative;
  height: 28px;
}
.bar {
  height: 100%;
  background: linear-gradient(90deg, #409eff, #66b1ff);
  border-radius: 4px;
  transition: width 0.5s ease;
}
.bar-value {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  font-weight: 600;
  color: #303133;
}

.difficulty-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.diff-label {
  width: 60px;
  font-size: 14px;
}
</style>
