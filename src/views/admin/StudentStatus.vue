<template>
  <div class="student-status page-container">
    <div class="card-container">
      <div class="flex justify-between items-center mb-4">
        <h2 class="section-title">学生选课状态</h2>
        <div class="flex gap-2">
          <el-button @click="exportData" type="primary" size="small">
            <el-icon><Download /></el-icon> 导出数据
          </el-button>
        </div>
      </div>

      <el-card shadow="never" class="mb-4">
        <el-row :gutter="20">
          <el-col :span="6" :xs="12">
            <div class="stat-box">
              <span class="stat-value">{{ stats.total }}</span>
              <span class="stat-label">学生总数</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box done">
              <span class="stat-value">{{ stats.applied }}</span>
              <span class="stat-label">已完成选课</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box warning">
              <span class="stat-value">{{ stats.notApplied }}</span>
              <span class="stat-label">未完成选课</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box shortlist">
              <span class="stat-value">{{ stats.withShortlist }}</span>
              <span class="stat-label">有预选课题</span>
            </div>
          </el-col>
        </el-row>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="flex justify-between items-center">
            <strong>学生列表
              <el-tag type="danger" size="small" v-if="stats.notApplied > 0">
                {{ stats.notApplied }} 人未完成选课
              </el-tag>
            </strong>
            <el-select v-model="filterStatus" placeholder="筛选状态" size="small" class="w-40">
              <el-option label="全部" value="" />
              <el-option label="已选课" value="applied" />
              <el-option label="未选课" value="not_applied" />
            </el-select>
          </div>
        </template>
        <el-table :data="filteredStudents" stripe size="small">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div v-if="getStudentSelections(row.id).length > 0" class="expand-content">
                <h4 class="mb-2">选课详情</h4>
                <el-table :data="getStudentSelections(row.id)" size="mini" border>
                  <el-table-column prop="priority" label="志愿" width="60" align="center">
                    <template #default="{ row }">
                      <el-tag :type="getPriorityType(row.priority)" size="small">
                        {{ row.priority }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="topic_title" label="课题题目" min-width="300" />
                  <el-table-column prop="topic_category" label="类别" width="100" />
                  <el-table-column prop="teacher_name" label="指导教师" width="100" />
                  <el-table-column prop="application_status" label="状态" width="100" align="center">
                    <template #default="{ row }">
                      <el-tag :type="getStatusType(row.application_status)" size="small">
                        {{ getStatusText(row.application_status) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
              <div v-else class="expand-content text-gray-400">
                暂无选课记录
              </div>
            </template>
          </el-table-column>
          <el-table-column type="index" label="#" width="50" />
          <el-table-column prop="student_id" label="学号" width="120" />
          <el-table-column prop="real_name" label="学生姓名" width="120">
            <template #default="{ row }">
              <span :class="{ 'highlight-warning': !row.application_count }">
                {{ row.real_name }}
                <el-tag v-if="!row.application_count" type="danger" size="small" class="ml-2">未选课</el-tag>
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="class_name" label="班级" width="120" />
          <el-table-column prop="major" label="专业" width="100" />
          <el-table-column prop="application_count" label="申请数" width="80" align="center" />
          <el-table-column prop="accepted_count" label="已录取" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.accepted_count > 0 ? 'success' : 'info'" size="small">
                {{ row.accepted_count }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="shortlist_count" label="预选数" width="80" align="center" />
          <el-table-column prop="status" label="账户状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
                {{ row.status === 'active' ? '正常' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="注册时间" width="150" />
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Download } from '@element-plus/icons-vue'
import { adminApi } from '@/api'

const students = ref<any[]>([])
const studentSelections = ref<any[]>([])
const filterStatus = ref('')

const stats = computed(() => ({
  total: students.value.length,
  applied: students.value.filter(s => s.application_count > 0).length,
  notApplied: students.value.filter(s => s.application_count === 0).length,
  withShortlist: students.value.filter(s => s.shortlist_count > 0).length
}))

const filteredStudents = computed(() => {
  if (!filterStatus.value) return students.value
  if (filterStatus.value === 'applied') return students.value.filter(s => s.application_count > 0)
  if (filterStatus.value === 'not_applied') return students.value.filter(s => s.application_count === 0)
  return students.value
})

const getStudentSelections = (studentId: string) => {
  return studentSelections.value.filter(s => s.student_id === studentId)
}

const getPriorityType = (priority: number) => {
  if (priority === 1) return 'danger'
  if (priority === 2) return 'warning'
  if (priority === 3) return 'info'
  return 'info'
}

const getStatusType = (status: string) => {
  if (status === 'accepted') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'rejected') return 'danger'
  return 'info'
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    accepted: '已录取',
    pending: '待审核',
    rejected: '已拒绝'
  }
  return map[status] || status
}

const loadStudents = async () => {
  const [studentsRes, selectionsRes] = await Promise.all([
    adminApi.getStudents(),
    adminApi.getStudentSelections()
  ])
  students.value = studentsRes.data
  studentSelections.value = selectionsRes.data
}

const exportData = () => {
  const headers = ['学号', '姓名', '班级', '专业', '志愿优先级', '课题题目', '课题类别', '指导教师', '录取状态']
  const rows: string[][] = []
  
  studentSelections.value.forEach(s => {
    if (s.topic_title) {
      rows.push([
        s.student_code || '',
        s.student_name || '',
        s.class_name || '',
        s.major || '',
        s.priority ? `第${s.priority}志愿` : '',
        s.topic_title || '',
        s.topic_category || '',
        s.teacher_name || '',
        getStatusText(s.application_status)
      ])
    } else {
      rows.push([
        s.student_code || '',
        s.student_name || '',
        s.class_name || '',
        s.major || '',
        '',
        '未选课',
        '',
        '',
        ''
      ])
    }
  })

  const csv = [headers.join(','), ...rows.map(r => r.map(cell => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`
    }
    return cell
  }).join(','))].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `学生选题明细_${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(loadStudents)
</script>

<style scoped>
.stat-box {
  text-align: center;
  padding: 16px;
  background: #f8fafc;
  border-radius: 8px;
}
.stat-box.done { background: #ecfdf5; }
.stat-box.warning { background: #fef2f2; }
.stat-box.shortlist { background: #eff6ff; }

.stat-value {
  display: block;
  font-size: 28px;
  font-weight: bold;
  color: #1e293b;
}
.stat-box.done .stat-value { color: #059669; }
.stat-box.warning .stat-value { color: #dc2626; }
.stat-box.shortlist .stat-value { color: #3b82f6; }

.stat-label {
  font-size: 14px;
  color: #64748b;
}

.highlight-warning {
  color: #dc2626;
  font-weight: bold;
}

.expand-content {
  padding: 16px 0;
}

.text-gray-400 {
  color: #9ca3af;
}
</style>