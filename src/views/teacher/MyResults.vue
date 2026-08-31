<template>
  <div class="my-results page-container">
    <div class="card-container">
      <h2 class="section-title">选课结果</h2>

      <!-- 统计概览 -->
      <el-row :gutter="20" style="margin-bottom: 20px;">
        <el-col :span="8">
          <el-statistic title="我的课题数" :value="myTopics.length" />
        </el-col>
        <el-col :span="8">
          <el-statistic title="已录取学生" :value="totalAccepted" />
        </el-col>
        <el-col :span="8">
          <el-statistic title="总申请量" :value="totalApps" />
        </el-col>
      </el-row>

      <!-- 结果表格 -->
      <el-tabs v-model="activeTab">
        <el-tab-pane label="按课题查看" name="by-topic">
          <el-table :data="resultsByTopic" stripe>
            <el-table-column prop="title" label="课题名称" min-width="250" show-overflow-tooltip />
            <el-table-column label="指导教师" width="100">
              <template #default="{ row }">{{ row.teacherName }}</template>
            </el-table-column>
            <el-table-column label="录取学生" min-width="200">
              <template #default="{ row }">
                <div v-if="row.students.length > 0">
                  <el-button
                    v-for="s in row.students"
                    :key="s.studentId"
                    link
                    type="primary"
                    size="small"
                    @click="showStudentDetail(s.studentId, s.studentName)"
                    style="margin-right: 6px; margin-bottom: 4px;"
                  >
                    {{ s.studentName }}
                  </el-button>
                </div>
                <span v-else class="text-muted">暂无录取</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120" align="center">
              <template #default="{ row }">
                <el-tag :type="row.students.length >= row.maxStudents ? 'success' : 'warning'">
                  {{ row.students.length }}/{{ row.maxStudents }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="按学生查看" name="by-student">
          <el-table :data="allResults" stripe>
            <el-table-column label="学生姓名" width="110">
              <template #default="{ row }">
                <el-button link type="primary" @click="showStudentDetail(row.studentId, row.studentName)">
                  {{ row.studentName }}
                </el-button>
              </template>
            </el-table-column>
            <el-table-column prop="studentClass" label="班级" width="140" />
            <el-table-column prop="topicTitle" label="录取课题" min-width="250" show-overflow-tooltip />
            <el-table-column prop="teacherName" label="指导教师" width="100" />
            <el-table-column label="状态" width="100" align="center">
              <template #default="{ row }">
                <el-tag type="success" v-if="row.status === 'confirmed'">已确认</el-tag>
                <el-tag type="warning" v-else-if="row.status === 'adjusting'">调剂中</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="confirmedAt" label="确认时间" width="170">
              <template #default="{ row }">{{ formatDateTime(row.confirmedAt) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>

      <div style="margin-top: 20px; text-align: right;">
        <el-button type="primary" icon="Download" @click="handleExport">导出Excel</el-button>
      </div>
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
          <el-descriptions-item label="排名">
            {{ selectedStudentProfile.ranking || 0 }} / {{ selectedStudentProfile.totalStudents || 0 }}
          </el-descriptions-item>
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
            {{ selectedStudentProfile.personalStatement || selectedStudentProfile.selfIntro || '未填写' }}
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
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'

const userStore = useUserStore()
const topicStore = useTopicStore()
const applicationStore = useApplicationStore()
const studentStore = useStudentStore()
const activeTab = ref('by-topic')
const detailVisible = ref(false)
const selectedStudentProfile = ref<any>(null)
const selectedStudentName = ref('')
const detailLoading = ref(false)

onMounted(async () => {
  await Promise.all([
    topicStore.fetchMyTopics(),
    applicationStore.fetchApplications(),
    studentStore.fetchProfiles()
  ])
})

const myTopics = computed(() => {
  if (!userStore.currentUser) return []
  return topicStore.getTopicsByTeacher(userStore.currentUser.id)
})

const resultsByTopic = computed(() => {
  return myTopics.value.map(topic => ({
    ...topic,
    students: applicationStore.finalResults.filter(r => r.topicId === topic.id)
  }))
})

const allResults = computed(() => {
  return applicationStore.finalResults.filter(r =>
    myTopics.value.some(t => t.id === r.topicId)
  )
})

const totalAccepted = computed(() => {
  return resultsByTopic.value.reduce((sum, t) => sum + t.students.length, 0)
})
const totalApps = computed(() => {
  return myTopics.value.reduce((sum, t) => sum + t.applyCount, 0)
})

function handleExport() {
  ElMessage.success('Excel导出功能演示 - 实际项目中会生成文件下载')
}

function formatDateTime(dateStr: string): string {
  return dayjs(dateStr).format('YYYY-MM-DD HH:mm')
}

function getStudentProfile(studentId: string) {
  return studentStore.profiles.find(p =>
    p.userId === studentId || p.studentId === studentId
  )
}

async function showStudentDetail(studentId: string, studentName: string) {
  selectedStudentName.value = studentName
  detailVisible.value = true
  detailLoading.value = true
  let profile = getStudentProfile(studentId)
  if (!profile) {
    profile = await studentStore.fetchProfileByUserId(studentId)
  }
  selectedStudentProfile.value = profile
  detailLoading.value = false
}

const portfolioTypeLabel: Record<string, string> = {
  image: '图片', pdf: 'PDF', link: '链接'
}
</script>

<style scoped>
.text-muted { color: #c0c4cc; }
</style>
