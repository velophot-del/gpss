<template>
  <div class="selection-review page-container">
    <div class="card-container">
      <div class="page-header">
        <h2 class="section-title">学生遴选</h2>
        <div class="review-summary">
          <span>待处理 <strong>{{ pendingReviewCount }}</strong></span>
          <span>当前课题剩余 <strong>{{ remainingSlots }}</strong> 个名额</span>
        </div>
        <div class="header-actions">
          <el-button type="success" @click="refreshReview">
            刷新遴选状态
          </el-button>
          <el-button type="primary" icon="Download" @click="exportResults">
            导出名单
          </el-button>
        </div>
      </div>

      <!-- 课题选择 -->
      <el-tabs v-model="activeTopicId" @tab-change="handleTabChange" class="topic-tabs" style="margin-top: 16px;">
        <el-tab-pane
          v-for="topic in myTopics"
          :key="topic.id"
          :label="`${topic.title} (${topic.applyCount}人申请)`"
          :name="topic.id"
        >
          <div class="topic-info-bar">
            <span>招收名额: <strong>{{ topic.maxStudents }}</strong> 人</span>
            <span>已录取: <strong style="color: #67c23a;">{{ topic.currentCount }}</strong> 人</span>
            <el-divider direction="vertical" />
            <el-tag :type="topic.currentCount >= topic.maxStudents ? 'danger' : 'success'" size="small">
              {{ topic.currentCount >= topic.maxStudents ? '已满员' : '还可选' + (topic.maxStudents - topic.currentCount) + '人' }}
            </el-tag>
            <el-tooltip
              content="确认本课题名单：未被选中的申请将自动落选，学生进入下一志愿/调剂"
              placement="top"
            >
              <el-button
                type="warning"
                size="small"
                style="margin-left: auto;"
                :loading="finalizingTopicId === topic.id"
                @click="handleFinalizeTopic(topic)"
              >提交本课题名单</el-button>
            </el-tooltip>
          </div>

          <!-- 学生申请列表 -->
          <el-table
            :data="currentApplications"
            stripe
            v-loading="loading"
            style="margin-top: 16px;"
            empty-text="暂无申请"
          >
            <el-table-column label="志愿" width="70" align="center">
              <template #default="{ row }">
                <el-tag :type="priorityType[row.priority]" effect="dark" round>
                  第{{ priorityLabel[row.priority] }}志愿
                </el-tag>
              </template>
            </el-table-column>

            <el-table-column label="学生姓名" width="110">
              <template #default="{ row }">
                <el-button link type="primary" @click="showStudentDetail(row.studentId)">
                  {{ row.studentName }}
                </el-button>
              </template>
            </el-table-column>

            <el-table-column label="专业" width="140">
              <template #default="{ row }">
                <span v-if="getStudentProfile(row.studentId)">{{ getStudentProfile(row.studentId)?.major || '-' }}</span>
                <span v-else class="no-profile">-</span>
              </template>
            </el-table-column>

            <el-table-column prop="motivation" label="申请理由" min-width="180" show-overflow-tooltip />

            <el-table-column label="遴选状态" width="130" align="center">
              <template #default="{ row }">
                <span class="status-text" :class="'status-' + row.status">{{ appStatusLabel[row.status] || row.status }}</span>
              </template>
            </el-table-column>

            <el-table-column prop="submittedAt" label="提交时间" width="160">
              <template #default="{ row }">{{ formatDateTime(row.submittedAt) }}</template>
            </el-table-column>

            <el-table-column label="操作" width="260" fixed="right">
              <template #default="{ row }">
                <template v-if="isPending(row.status)">
                  <el-button
                    size="small"
                    :icon="row.status === 'accepted' ? 'Check' : 'Select'"
                    :type="row.status === 'accepted' ? 'info' : 'success'"
                    :disabled="isFull && row.status !== 'accepted'"
                    @click="handleAccept(row)"
                  >
                    接受
                  </el-button>
                  <el-button
                    type="warning"
                    size="small"
                    icon="Clock"
                    @click="handleWaitlist(row)"
                  >
                    待定
                  </el-button>
                  <el-popconfirm
                    title="确定拒绝该学生？"
                    @confirm="handleReject(row)"
                  >
                    <template #reference>
                      <el-button
                        type="danger"
                        size="small"
                        :icon="row.status === 'rejected' ? 'CloseBold' : 'Close'"
                      >拒绝</el-button>
                    </template>
                  </el-popconfirm>
                  <el-button link type="primary" size="small" icon="View" @click="showStudentDetail(row.studentId)">
                    详情
                  </el-button>
                </template>
                <template v-else>
                  <el-tag :type="appStatusType[row.status] || 'info'" size="small">{{ appStatusLabel[row.status] || row.status }}</el-tag>
                  <el-button link type="primary" size="small" icon="View" @click="showStudentDetail(row.studentId)">查看详情</el-button>
                </template>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 学生详情弹窗 -->
    <el-dialog v-model="detailVisible" title="学生详细信息" width="700px">
      <div v-loading="detailLoading" style="min-height: 100px;">
      <template v-if="selectedStudentProfile">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{ selectedStudentName }}</el-descriptions-item>
          <el-descriptions-item label="学号">{{ selectedStudentProfile.studentId || '-' }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ selectedStudentProfile.className || '-' }}</el-descriptions-item>
          <el-descriptions-item label="专业">{{ selectedStudentProfile.major || '-' }}</el-descriptions-item>
          <el-descriptions-item label="年级">{{ selectedStudentProfile.grade || '-' }}</el-descriptions-item>
          <el-descriptions-item label="GPA">{{ (selectedStudentProfile.gpa || 0).toFixed(2) }}</el-descriptions-item>
          <el-descriptions-item label="联系邮箱" :span="2">
            {{ selectedStudentProfile.contactEmail || '未填写' }}
          </el-descriptions-item>
          <el-descriptions-item label="联系电话" :span="2">
            {{ selectedStudentProfile.contactPhone || '未填写' }}
          </el-descriptions-item>
          <el-descriptions-item label="技能标签" :span="2">
            <el-space wrap>
              <el-tag v-for="s in (selectedStudentProfile.skills || [])" :key="s">{{ s }}</el-tag>
            </el-space>
          </el-descriptions-item>
          <el-descriptions-item label="兴趣方向" :span="2">
            <el-space wrap>
              <el-tag type="info" v-for="i in (selectedStudentProfile.interests || [])" :key="i">{{ i }}</el-tag>
            </el-space>
          </el-descriptions-item>
          <el-descriptions-item label="个人陈述" :span="2">
            {{ selectedStudentProfile.personalStatement || '未填写' }}
          </el-descriptions-item>
        </el-descriptions>

        <h4 style="margin: 20px 0 12px;">作品集</h4>
        <el-table v-if="(selectedStudentProfile.portfolio || []).length > 0" :data="selectedStudentProfile.portfolio" size="small">
          <el-table-column prop="title" label="作品名称" />
          <el-table-column prop="type" label="类型" width="80">
            <template #default="{ row }">
              <el-tag size="small">{{ portfolioTypeLabel[row.type] || row.type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="url" label="链接" show-overflow-tooltip>
            <template #default="{ row }">
              <el-link v-if="row.url !== '#'" :href="row.url" target="_blank" type="primary">查看</el-link>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column prop="description" label="说明" show-overflow-tooltip />
        </el-table>
        <el-empty v-else description="暂无作品集" :image-size="60" />
      </template>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useUserStore } from '../../stores/user'
import { useTopicStore } from '../../stores/topic'
import { useApplicationStore } from '../../stores/application'
import { useStudentStore } from '../../stores/student'
import type { Application } from '../../types'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

const userStore = useUserStore()
const topicStore = useTopicStore()
const applicationStore = useApplicationStore()
const studentStore = useStudentStore()

const loading = ref(false)
const activeTopicId = ref('')
const detailVisible = ref(false)
const selectedStudentId = ref('')
const selectedStudentProfile = ref<any>(null)
const detailLoading = ref(false)

const myTopics = computed(() => {
  if (!userStore.currentUser) return []
  return topicStore.getTopicsByTeacher(userStore.currentUser.id)
})

// 加载数据
onMounted(async () => {
  await Promise.all([
    topicStore.fetchMyTopics(),
    applicationStore.fetchApplications(),
    studentStore.fetchProfiles()
  ])
  if (myTopics.value.length > 0) {
    activeTopicId.value = myTopics.value[0].id
  }
})

const currentApplications = computed(() => {
  if (!activeTopicId.value) return []
  return applicationStore.getApplicationsByTopic(activeTopicId.value)
})

const pendingReviewCount = computed(() => applicationStore.applications.filter(app => isPending(app.status)).length)
const remainingSlots = computed(() => {
  const topic = topicStore.getTopicById(activeTopicId.value)
  return topic ? Math.max(0, topic.maxStudents - topic.currentCount) : 0
})

function isPending(status: string) {
  return status === 'pending' || status === 'submitted' || status === 'pending_review'
}

const isFull = computed(() => {
  const topic = topicStore.getTopicById(activeTopicId.value)
  return topic ? topic.currentCount >= topic.maxStudents : false
})

function getStudentProfile(studentId: string) {
  // 根据 studentId（实际是 user.id）查找档案
  return studentStore.profiles.find(p =>
    p.userId === studentId ||
    p.studentId === studentId
  )
}

const finalizingTopicId = ref<string>('')

async function handleFinalizeTopic(topic: any) {
  finalizingTopicId.value = topic.id
  try {
    const res: any = await applicationStore.finalizeTopic(topic.id)
    ElMessage.success(res?.message || '名单已提交，未选中学生自动进入下一志愿')
    await topicStore.fetchMyTopics()
  } catch (e: any) {
    ElMessage.error(e?.message || '提交名单失败')
  } finally {
    finalizingTopicId.value = ''
  }
}

function handleTabChange(topicId: string) {
  activeTopicId.value = topicId
}

const selectedStudentName = computed(() => {
  if (!selectedStudentProfile.value) return '-'
  return selectedStudentProfile.value.realName || selectedStudentProfile.value.studentName || '-'
})

const priorityType: Record<number, string> = { 1: '', 2: 'warning', 3: 'info' }
const priorityLabel: Record<number, string> = { 1: '一', 2: '二', 3: '三' }
const appStatusType: Record<string, string> = {
  pending: 'warning', submitted: 'warning', pending_review: 'warning',
  accepted: 'success', rejected: 'danger', waitlisted: '', withdrawn: 'info'
}
const appStatusLabel: Record<string, string> = {
  pending: '等待遴选中', submitted: '等待遴选中', pending_review: '等待遴选中',
  accepted: '已录取', rejected: '未录取', waitlisted: '候补待定', withdrawn: '已撤回'
}

const portfolioTypeLabel: Record<string, string> = {
  image: '图片', pdf: 'PDF', link: '链接'
}

async function handleAccept(app: Application) {
  try {
    const { value: comment } = await ElMessageBox.prompt('请输入评语（可选）', '接受学生', {
      confirmButtonText: '确认接受',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '可选：填写对该学生的评价或备注...'
    })

    await applicationStore.reviewApplication(app.id, 'accepted', comment || undefined)
    ElMessage.success(`已接受 ${app.studentName}`)
    await Promise.all([
      applicationStore.fetchApplications(),
      topicStore.fetchMyTopics()
    ])
  } catch {
    // 用户取消
  }
}

async function handleWaitlist(app: Application) {
  await applicationStore.reviewApplication(app.id, 'waitlisted')
  ElMessage.success(`已将 ${app.studentName} 设为待定`)
  await Promise.all([
    applicationStore.fetchApplications(),
    topicStore.fetchMyTopics()
  ])
}

async function handleReject(app: Application) {
  await applicationStore.reviewApplication(app.id, 'rejected')
  ElMessage.success(`已拒绝 ${app.studentName}`)
  await Promise.all([
    applicationStore.fetchApplications(),
    topicStore.fetchMyTopics()
  ])
}

async function showStudentDetail(studentId: string) {
  selectedStudentId.value = studentId
  detailVisible.value = true
  detailLoading.value = true

  // 先尝试从缓存中查找
  let profile: any = getStudentProfile(studentId)

  // 如果缓存中没有，从后端获取单个学生完整档案
  if (!profile) {
    profile = await studentStore.fetchProfileByUserId(studentId)
  }

  selectedStudentProfile.value = profile
  detailLoading.value = false
}

async function refreshReview() {
  await Promise.all([applicationStore.fetchApplications(), topicStore.fetchMyTopics()])
  ElMessage.success('遴选状态已更新')
}

/**
 * 导出选课名单为 Excel 文件
 * 导出当前教师所有课题的已录取学生名单
 */
async function exportResults() {
  // 收集该教师所有课题的已录取申请
  const rows: Record<string, any>[] = []
  const teacherName = userStore.currentUser?.realName || '未知教师'

  for (const topic of myTopics.value) {
    const apps = applicationStore.getApplicationsByTopic(topic.id).filter(a => a.status === 'accepted')
    for (const app of apps) {
      const profile = getStudentProfile(app.studentId)
      rows.push({
        '课题名称': topic.title,
        '课题分类': topic.category,
        '指导教师': teacherName,
        '学号': app.studentId || profile?.studentId || '-',
        '学生姓名': (app as any).student_name || app.studentName || '-',
        '专业': profile?.major || '-',
        'GPA': profile?.gpa?.toFixed(2) || '-',
        '志愿': `第${app.priority || 1}志愿`,
        '申请理由': app.motivation || '-',
        '审批时间': app.reviewedAt ? dayjs(app.reviewedAt).format('YYYY-MM-DD HH:mm') : '-',
        '状态': appStatusLabel[app.status] || app.status,
      })
    }
  }

  if (rows.length === 0) {
    ElMessage.warning('暂无已录取的学生数据，无法导出')
    return
  }

  // 生成工作簿
  const ws = XLSX.utils.json_to_sheet(rows)

  // 设置列宽
  ws['!cols'] = [
    { wch: 35 }, // 课题名称
    { wch: 18 }, // 课题分类
    { wch: 10 }, // 指导教师
    { wch: 8 },  // 学号
    { wch: 10 }, // 学生姓名
    { wch: 22 }, // 专业
    { wch: 6 },  // GPA
    { wch: 8 },  // 志愿
    { wch: 30 }, // 申请理由
    { wch: 18 }, // 审批时间
    { wch: 8 },  // 状态
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '选课名单')

  // 导出文件名：教师姓名_选课名单_日期.xlsx
  const fileName = `${teacherName}_选课名单_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  saveAs(blob, fileName)

  ElMessage.success(`已导出 ${rows.length} 条录取记录`)
}

function formatDateTime(dateStr: string): string {
  return dayjs(dateStr).format('YYYY-MM-DD HH:mm')
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.review-summary {
  display: flex;
  gap: 16px;
  color: #64748b;
  font-size: 13px;
}

.review-summary strong {
  color: #c66a32;
  font-size: 18px;
  margin-left: 4px;
}

.topic-info-bar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 16px;
  background: #f6f8fa;
  border: 1px solid #dbe3ea;
  border-radius: 6px;
  font-size: 14px;
  color: #606266;
}

@media (max-width: 768px) {
  .page-header { align-items: flex-start; flex-direction: column; gap: 10px; }
  .review-summary { flex-wrap: wrap; gap: 8px 14px; }
  .header-actions { width: 100%; }
  .header-actions .el-button { flex: 1; }
  .topic-info-bar { flex-wrap: wrap; gap: 10px; }
  .topic-tabs :deep(.el-tabs__nav-wrap) { overflow-x: auto; }
}

.no-profile {
  color: #c0c4cc;
  font-style: italic;
}

/* 遴选状态文字 */
.status-text {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}
.status-pending,
.status-submitted,
.status-pending_review {
  color: #e6a23c;
  background: #fdf6ec;
}
.status-accepted {
  color: #67c23a;
  background: #f0f9eb;
}
.status-rejected {
  color: #f56c6c;
  background: #fef0f0;
}
.status-waitlisted {
  color: #409eff;
  background: #ecf5ff;
}
.status-withdrawn {
  color: #909399;
  background: #f4f4f5;
}
</style>
