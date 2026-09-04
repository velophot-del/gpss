<template>
  <div class="topic-library page-container">
    <div class="card-container">
      <div class="page-header">
        <h2 class="section-title">选题库管理</h2>
        <div class="header-actions">
          <el-button
            v-if="selectedTopics.length > 0"
            type="success"
            icon="Select"
            @click="batchApprove"
            :loading="batchLoading"
          >
            批量发布（{{ selectedTopics.length }}）
          </el-button>
          <el-button type="primary" icon="Download" @click="exportFullData">
            导出全部选题（含详情）
          </el-button>
        </div>
      </div>

      <!-- 统计卡片 -->
      <el-row :gutter="16" style="margin-bottom: 16px;">
        <el-col :span="6" :xs="12">
          <div class="stat-box" :class="{ active: filterStatus === '' }" @click="filterStatus = ''">
            <span class="stat-value">{{ stats.total }}</span>
            <span class="stat-label">全部</span>
          </div>
        </el-col>
        <el-col :span="6" :xs="12">
          <div class="stat-box pending" :class="{ active: filterStatus === 'pending' }" @click="filterStatus = 'pending'">
            <span class="stat-value">{{ stats.pending }}</span>
            <span class="stat-label">待审核</span>
          </div>
        </el-col>
        <el-col :span="6" :xs="12">
          <div class="stat-box published" :class="{ active: filterStatus === 'published' }" @click="filterStatus = 'published'">
            <span class="stat-value">{{ stats.published }}</span>
            <span class="stat-label">已发布</span>
          </div>
        </el-col>
        <el-col :span="6" :xs="12">
          <div class="stat-box draft" :class="{ active: filterStatus === 'draft' }" @click="filterStatus = 'draft'">
            <span class="stat-value">{{ stats.draft }}</span>
            <span class="stat-label">草稿</span>
          </div>
        </el-col>
      </el-row>

      <!-- 搜索与筛选 -->
      <div class="filter-bar">
        <el-input v-model="searchText" placeholder="搜索课题名称/教师姓名" prefix-icon="Search" clearable style="width: 280px;" />
        <el-select v-model="filterStatus" placeholder="全部状态" style="width: 120px;">
          <el-option label="全部" value="" />
          <el-option label="待审核" value="pending" />
          <el-option label="已发布" value="published" />
          <el-option label="草稿" value="draft" />
          <el-option label="已满员" value="full" />
          <el-option label="已关闭" value="closed" />
        </el-select>
      </div>

      <!-- 选题列表 -->
      <el-table
        :data="displayTopics"
        stripe
        v-loading="loading"
        style="margin-top: 16px;"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="40" />
        <el-table-column type="index" label="#" width="50" />
        <el-table-column label="课题名称" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">
            <router-link :to="`/student/topic/${row.id}`" class="topic-title-link">{{ row.title }}</router-link>
          </template>
        </el-table-column>
        <el-table-column prop="teacher_name" label="指导教师" width="100" />
        <el-table-column prop="department" label="院系" width="120" show-overflow-tooltip />
        <el-table-column prop="category" label="研究方向" width="130" show-overflow-tooltip />
        <el-table-column prop="major" label="专业" width="100" show-overflow-tooltip />
        <el-table-column label="难度" width="70" align="center">
          <template #default="{ row }">
            <el-tag :type="difficultyType[row.difficulty]" size="small">{{ difficultyLabel[row.difficulty] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="人数" width="80" align="center">
          <template #default="{ row }">
            {{ row.apply_count || 0 }} / {{ row.max_students }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusType[row.status]" size="small">{{ statusLabel[row.status] || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="110">
          <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right" align="center">
          <template #default="{ row }">
            <template v-if="row.status === 'pending'">
              <el-button link type="success" size="small" icon="Select" @click="approveOne(row)">发布</el-button>
              <el-button link type="danger" size="small" icon="Close" @click="rejectOne(row)">退回</el-button>
            </template>
            <template v-else-if="row.status === 'published' || row.status === 'full'">
              <el-button link type="warning" size="small" icon="RefreshLeft" @click="withdrawOne(row)">撤回发布</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { adminApi, topicApi } from '@/api'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

const loading = ref(false)
const batchLoading = ref(false)
const topics = ref<any[]>([])
const searchText = ref('')
const filterStatus = ref('pending')
const selectedTopics = ref<any[]>([])

const stats = computed(() => ({
  total: topics.value.length,
  pending: topics.value.filter(t => t.status === 'pending').length,
  published: topics.value.filter(t => t.status === 'published').length,
  draft: topics.value.filter(t => t.status === 'draft').length
}))

const displayTopics = computed(() => {
  let result = topics.value
  if (filterStatus.value) {
    result = result.filter(t => t.status === filterStatus.value)
  }
  if (searchText.value) {
    const kw = searchText.value.toLowerCase()
    result = result.filter(t =>
      t.title?.toLowerCase().includes(kw) ||
      t.teacher_name?.toLowerCase().includes(kw)
    )
  }
  return result
})

const difficultyLabel: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }
const difficultyType: Record<string, string> = { easy: 'success', medium: 'warning', hard: 'danger' }
const statusLabel: Record<string, string> = { pending: '待审核', published: '已发布', draft: '草稿', full: '已满员', closed: '已关闭' }
const statusType: Record<string, string> = { pending: 'warning', published: 'success', draft: 'info', full: 'danger', closed: 'info' }

function formatDate(dateStr: any): string {
  if (!dateStr) return '-'
  const d = dayjs(dateStr)
  return d.isValid() ? d.format('YYYY-MM-DD') : '-'
}

function handleSelectionChange(rows: any[]) {
  selectedTopics.value = rows
}

const loadTopics = async () => {
  loading.value = true
  try {
    const res = await adminApi.getAllTopics()
    topics.value = res.data
  } finally {
    loading.value = false
  }
}

// 单个发布
async function approveOne(topic: any) {
  try {
    await topicApi.updateStatus(topic.id, 'published')
    ElMessage.success(`「${topic.title}」已发布`)
    await loadTopics()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '操作失败')
  }
}

// 单个退回
async function rejectOne(topic: any) {
  try {
    await ElMessageBox.prompt('请输入退回原因或修改建议（可选）', '退回修改', {
      confirmButtonText: '确定退回',
      cancelButtonText: '取消',
      inputType: 'textarea'
    })
    await topicApi.updateStatus(topic.id, 'draft')
    ElMessage.success(`「${topic.title}」已退回`)
    await loadTopics()
  } catch {
    // 取消
  }
}

// 撤回已发布选题（回到草稿，教师可编辑后重新提交；学生已选数据保留不删除）
async function withdrawOne(topic: any) {
  try {
    await ElMessageBox.confirm(
      `确定撤回「${topic.title}」的发布？撤回后回到草稿状态，学生将不可再浏览；若有学生已填报/录取该选题，数据会保留，不会删除。`,
      '撤回发布',
      { confirmButtonText: '确认撤回', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  try {
    await topicApi.updateStatus(topic.id, 'draft')
    ElMessage.success(`「${topic.title}」已撤回发布`)
    await loadTopics()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '操作失败')
  }
}

// 批量发布
async function batchApprove() {
  try {
    await ElMessageBox.confirm(
      `确定批量发布 ${selectedTopics.value.length} 个选题？`,
      '批量发布',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'info' }
    )
  } catch { return }

  batchLoading.value = true
  let ok = 0
  for (const t of selectedTopics.value) {
    try { await topicApi.updateStatus(t.id, 'published'); ok++ } catch {}
  }
  batchLoading.value = false
  selectedTopics.value = []
  ElMessage.success(`已发布 ${ok} 个选题`)
  await loadTopics()
}

// 完整导出（含简介、要求等所有信息）
function exportFullData() {
  const rows = topics.value.map(t => ({
    '课题名称': t.title || '',
    '指导教师': t.teacher_name || '',
    '职称': t.teacher_title || '',
    '所属院系': t.department || '',
    '教师邮箱': t.teacher_email || '',
    '教师电话': t.teacher_phone || '',
    '研究方向': t.category || '',
    '专业': t.major || '',
    '难度': difficultyLabel[t.difficulty] || t.difficulty,
    '招收人数': t.max_students || 0,
    '申请人数': t.apply_count || 0,
    '课题简介': t.description || '',
    '具体要求': t.requirements || '',
    '标签': Array.isArray(t.tags) ? t.tags.join('；') : (typeof t.tags === 'string' ? JSON.parse(t.tags || '[]').join('；') : ''),
    '时间安排': formatSchedules(t.schedules),
    '状态': statusLabel[t.status] || t.status,
    '创建时间': formatDate(t.created_at),
    '更新时间': formatDate(t.updated_at)
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 42 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 16 },
    { wch: 26 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 50 }, { wch: 50 }, { wch: 30 }, { wch: 30 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '选题库')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  saveAs(blob, `选题库_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`)
  ElMessage.success(`已导出 ${rows.length} 条完整选题数据（含简介、要求等全部信息）`)
}

function formatSchedules(schedules: any): string {
  if (!schedules) return ''
  const s = Array.isArray(schedules) ? schedules : (typeof schedules === 'string' ? JSON.parse(schedules || '[]') : [])
  return s.map((i: any) => `${i.phase || ''}(${i.startDate || ''}~${i.endDate || ''})`).join('；')
}

onMounted(() => {
  loadTopics()
})
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.header-actions {
  display: flex;
  gap: 10px;
}
.filter-bar {
  display: flex;
  gap: 12px;
}
.stat-box {
  text-align: center;
  padding: 14px 0;
  background: #f8fafc;
  border-radius: 8px;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
}
.stat-box:hover { border-color: #409eff40; }
.stat-box.active { border-color: #409eff; background: #ecf5ff; }
.stat-box.pending { background: #fffbeb; }
.stat-box.pending.active { border-color: #e6a23c; background: #fdf6ec; }
.stat-box.published { background: #ecfdf5; }
.stat-box.published.active { border-color: #67c23a; background: #f0f9eb; }
.stat-box.draft { background: #f1f5f9; }
.stat-box.draft.active { border-color: #64748b; background: #e2e8f0; }

.stat-value { display: block; font-size: 26px; font-weight: bold; color: #1e293b; }
.stat-label { font-size: 13px; color: #64748b; margin-top: 2px; }

.topic-title-link {
  color: #409eff;
  text-decoration: none;
  font-weight: 500;
}
.topic-title-link:hover {
  color: #66b1ff;
  text-decoration: underline;
}
</style>
