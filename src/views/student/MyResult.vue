<template>
  <div class="my-result page-container">
    <div class="card-container" style="max-width: 800px;">
      <h2 class="section-title">我的选题与毕业设计</h2>

      <template v-if="needsResubmit && !acceptedTopic">
        <div class="result-card warning">
          <div class="result-icon"><el-icon :size="64" color="#e6a23c"><WarningFilled /></el-icon></div>
          <h3 class="result-status">志愿已退回</h3>
          <p class="result-desc">请查看消息通知中的原因，重新整理并提交整组志愿。</p>
          <div class="result-actions"><el-button type="primary" size="large" @click="$router.push('/student/browse')">重新填报</el-button></div>
        </div>
      </template>

      <template v-else-if="result">
        <!-- 已录取 -->
        <div class="result-card success">
          <div class="result-icon">
            <el-icon :size="64" color="#67c23a"><CircleCheckFilled /></el-icon>
          </div>
          <h3 class="result-status">恭喜！您已被录取</h3>
          <el-descriptions :column="1" border class="result-info">
            <el-descriptions-item label="录取课题">
              <strong>{{ result.topicTitle }}</strong>
            </el-descriptions-item>
            <el-descriptions-item label="确认时间">{{ formatDateTime(result.confirmedAt || result.submittedAt) }}</el-descriptions-item>
          </el-descriptions>
          <el-descriptions :column="1" border class="result-info topic-details">
            <el-descriptions-item label="所属毕业设计周期">{{ result.cycleName || '—' }}</el-descriptions-item>
            <el-descriptions-item label="选题要求"><div class="pre">{{ result.requirements || result.description || '暂无要求说明' }}</div></el-descriptions-item>
            <el-descriptions-item label="指导教师">{{ result.teacherName || '—' }}{{ result.teacherTitle ? `（${result.teacherTitle}）` : '' }}</el-descriptions-item>
            <el-descriptions-item v-if="result.teacherEmail" label="教师邮箱">{{ result.teacherEmail }}</el-descriptions-item>
            <el-descriptions-item v-if="result.teacherPhone" label="教师电话">{{ result.teacherPhone }}</el-descriptions-item>
          </el-descriptions>
          <div v-if="result.phase !== 'ended'" class="result-actions">
            <el-button type="primary" @click="$router.push('/process/task-book')">进入任务书</el-button>
            <el-button @click="$router.push('/process/proposal')">开题报告</el-button>
            <el-button @click="$router.push('/process/midterm')">中期检查</el-button>
          </div>
          <el-alert :title="`毕业设计阶段：${phaseLabel}。可从左侧“毕业流程”进入任务书、开题报告等环节。`" type="success" :closable="false" show-icon style="margin-top: 20px;" />
        </div>
      </template>

      <template v-else-if="isUnmatchedAfterSettlement">
        <!-- 未录取/调剂中 -->
        <div class="result-card warning">
          <div class="result-icon">
            <el-icon :size="64" color="#e6a23c"><WarningFilled /></el-icon>
          </div>
          <h3 class="result-status">暂未匹配成功</h3>
          <p class="result-desc">
            您的志愿申请未能被录取。当前处于调剂阶段，您可以查看仍有名额的课题并提交调剂申请。
          </p>
          <div class="result-actions">
            <el-button v-if="cycleStore.currentPhase === 'adjustment'" type="warning" size="large" @click="$router.push('/student/adjustment')">
              参与调剂
            </el-button>
            <el-button size="large" @click="$router.push('/student/browse')">重新浏览课题</el-button>
          </div>
        </div>
      </template>

      <template v-else>
        <!-- 等待结果 -->
        <div class="result-card info">
          <div class="result-icon">
            <el-icon :size="64" color="#409eff"><Clock /></el-icon>
          </div>
          <h3 class="result-status">结果尚未公布</h3>
          <p class="result-desc">
            等待教师完成遴选并由系统统一录取。当前阶段：{{ cycleStore.phaseInfo.label }}
          </p>
          <el-timeline style="max-width: 400px; margin: 20px auto;">
            <el-timeline-item timestamp="志愿填报完成" :color="'#67c23a'" :done="true">
              您已完成志愿填报
            </el-timeline-item>
            <el-timeline-item
              timestamp="教师遴选"
              :color="cycleStore.currentPhase === 'teacher_review' ? '#409eff' : '#c0c4cc'"
              :done="['teacher_review', 'adjustment', 'completed'].includes(cycleStore.currentPhase)"
            >
              教师正在遴选学生
            </el-timeline-item>
            <el-timeline-item
              timestamp="结果公布"
              :color="cycleStore.currentPhase === 'completed' ? '#67c23a' : '#c0c4cc'"
              :done="cycleStore.currentPhase === 'completed'"
            >
              等待结果公布
            </el-timeline-item>
          </el-timeline>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useUserStore } from '../../stores/user'
import { useApplicationStore } from '../../stores/application'
import { useCycleStore } from '../../stores/cycle'
import { applicationApi } from '../../api'
import dayjs from 'dayjs'
import { CircleCheckFilled, WarningFilled, Clock } from '@element-plus/icons-vue'
import { PROCESS_PHASE_LABELS } from '../../types'

const userStore = useUserStore()
const applicationStore = useApplicationStore()
const cycleStore = useCycleStore()
const acceptedTopic = ref<any>(null)

onMounted(async () => {
  await Promise.all([
    applicationStore.fetchApplications(),
    applicationApi.getAcceptedTopic().then((res: any) => { acceptedTopic.value = res.data }).catch(() => { acceptedTopic.value = null }),
    cycleStore.fetchCurrentCycle()
  ])
})

const currentApplications = computed(() => {
  if (!userStore.currentUser) return []
  return applicationStore.getApplicationsByStudent(userStore.currentUser.id).filter(
    a => Number(a.cycleId) === Number(cycleStore.currentCycle?.id)
  )
})
const result = computed(() => acceptedTopic.value || currentApplications.value.find(a => a.status === 'accepted') || null)
const phaseLabel = computed(() => PROCESS_PHASE_LABELS[result.value?.phase] || '待开启')
const needsResubmit = computed(() => cycleStore.currentPhase === 'student_apply' &&
  currentApplications.value.length > 0 && currentApplications.value.every(a => a.status === 'withdrawn')
)

const isUnmatchedAfterSettlement = computed(() => currentApplications.value.length > 0 &&
  !result.value &&
  ['adjustment', 'result_announce', 'completed'].includes(cycleStore.currentPhase) &&
  currentApplications.value.every(a => ['rejected', 'withdrawn', 'cancelled'].includes(a.status))
)

function formatDateTime(dateStr: string): string {
  return dayjs(dateStr).format('YYYY年MM月DD日 HH:mm')
}
</script>

<style scoped>
.result-card {
  text-align: center;
  padding: 48px 40px;
  border-radius: 12px;
  margin-top: 20px;
}
.result-card.success {
  background: linear-gradient(135deg, #f0f9eb 0%, #e1f3d8 100%);
  border: 1px solid #e1f3d8;
}
.result-card.warning {
  background: linear-gradient(135deg, #fdf6ec 0%, #faecd8 100%);
  border: 1px solid #faecd8;
}
.result-card.info {
  background: linear-gradient(135deg, #ecf5ff 0%, #d9ecff 100%);
  border: 1px solid #d9ecff;
}

.result-icon { margin-bottom: 16px; }

.result-status {
  font-size: 22px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
}

.result-desc {
  font-size: 14px;
  color: #606266;
  line-height: 1.8;
  max-width: 500px;
  margin: 0 auto 24px;
}

.result-info {
  max-width: 500px;
  margin: 0 auto;
}
.topic-details { text-align: left; margin-top: 20px; }
.pre { white-space: pre-wrap; word-break: break-word; }

.result-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  margin-top: 28px;
}
</style>
