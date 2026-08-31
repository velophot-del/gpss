<template>
  <div class="teacher-status page-container">
    <div class="card-container">
      <div class="flex justify-between items-center mb-4">
        <h2 class="section-title">教师申报状态</h2>
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
              <span class="stat-label">教师总数</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box done">
              <span class="stat-value">{{ stats.withTopics }}</span>
              <span class="stat-label">已申报课题</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box warning">
              <span class="stat-value">{{ stats.withoutTopics }}</span>
              <span class="stat-label">未申报课题</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box draft">
              <span class="stat-value">{{ stats.withDraft }}</span>
              <span class="stat-label">有草稿</span>
            </div>
          </el-col>
        </el-row>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="flex justify-between items-center">
            <strong>教师列表
              <el-tag type="warning" size="small" v-if="stats.withoutTopics > 0">
                {{ stats.withoutTopics }} 人未申报
              </el-tag>
            </strong>
            <el-select v-model="filterStatus" placeholder="筛选状态" size="small" class="w-40">
              <el-option label="全部" value="" />
              <el-option label="已申报" value="done" />
              <el-option label="未申报" value="not_done" />
            </el-select>
          </div>
        </template>
        <el-table :data="filteredTeachers" stripe size="small">
          <el-table-column type="index" label="#" width="50" />
          <el-table-column prop="real_name" label="教师姓名" width="120">
            <template #default="{ row }">
              <span :class="{ 'highlight-warning': !row.total_topics }">
                {{ row.real_name }}
                <el-tag v-if="!row.total_topics" type="danger" size="small" class="ml-2">未申报</el-tag>
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="title" label="职称" width="100" />
          <el-table-column prop="department" label="所属部门" width="120" />
          <el-table-column prop="total_topics" label="课题总数" width="100" align="center" />
          <el-table-column prop="published_count" label="已发布" width="100" align="center" />
          <el-table-column prop="draft_count" label="草稿" width="100" align="center" />
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

const teachers = ref<any[]>([])
const filterStatus = ref('')

const stats = computed(() => ({
  total: teachers.value.length,
  withTopics: teachers.value.filter(t => t.total_topics > 0).length,
  withoutTopics: teachers.value.filter(t => t.total_topics === 0).length,
  withDraft: teachers.value.filter(t => t.draft_count > 0).length
}))

const filteredTeachers = computed(() => {
  if (!filterStatus.value) return teachers.value
  if (filterStatus.value === 'done') return teachers.value.filter(t => t.total_topics > 0)
  if (filterStatus.value === 'not_done') return teachers.value.filter(t => t.total_topics === 0)
  return teachers.value
})

const loadTeachers = async () => {
  const res = await adminApi.getTeachers()
  teachers.value = res.data
}

const exportData = () => {
  const headers = ['姓名', '职称', '部门', '课题总数', '已发布', '草稿', '账户状态', '注册时间']
  const rows = teachers.value.map(t => [
    t.real_name,
    t.title,
    t.department,
    t.total_topics,
    t.published_count,
    t.draft_count,
    t.status === 'active' ? '正常' : '禁用',
    t.created_at
  ])

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `教师申报状态_${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(loadTeachers)
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
.stat-box.draft { background: #f1f5f9; }

.stat-value {
  display: block;
  font-size: 28px;
  font-weight: bold;
  color: #1e293b;
}
.stat-box.done .stat-value { color: #059669; }
.stat-box.warning .stat-value { color: #dc2626; }
.stat-box.draft .stat-value { color: #64748b; }

.stat-label {
  font-size: 14px;
  color: #64748b;
}

.highlight-warning {
  color: #dc2626;
  font-weight: bold;
}
</style>
