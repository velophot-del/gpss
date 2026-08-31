<template>
  <div class="topic-overview page-container">
    <div class="card-container">
      <div class="flex justify-between items-center mb-4">
        <h2 class="section-title">课题总览</h2>
        <div class="flex gap-2">
          <el-button
            v-if="selectedTopics.length > 0"
            type="success"
            icon="Select"
            @click="batchApprove"
            :loading="batchLoading"
          >
            批量通过（{{ selectedTopics.length }}）
          </el-button>
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
              <span class="stat-label">课题总数</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box pending">
              <span class="stat-value">{{ stats.pending }}</span>
              <span class="stat-label">待审核</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box published">
              <span class="stat-value">{{ stats.published }}</span>
              <span class="stat-label">已发布</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box draft">
              <span class="stat-value">{{ stats.draft }}</span>
              <span class="stat-label">草稿</span>
            </div>
          </el-col>
        </el-row>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="flex justify-between items-center">
            <strong>所有选题列表</strong>
            <el-select v-model="filterStatus" placeholder="筛选状态" size="small" class="w-40" @change="handleFilterChange">
              <el-option label="全部" value="" />
              <el-option label="待审核" value="pending" />
              <el-option label="已发布" value="published" />
              <el-option label="草稿" value="draft" />
            </el-select>
          </div>
        </template>
        <el-table
          :data="filteredTopics"
          stripe
          size="small"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="40" />
          <el-table-column type="index" label="#" width="50" />
          <el-table-column prop="title" label="课题名称" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <a class="topic-link" @click="goToDetail(row.id)">{{ row.title }}</a>
            </template>
          </el-table-column>
          <el-table-column prop="teacher_name" label="指导教师" width="100" />
          <el-table-column prop="department" label="所属部门" width="120" />
          <el-table-column prop="category" label="研究方向" width="120" />
          <el-table-column prop="difficulty" label="难度" width="70" align="center">
            <template #default="{ row }">
              <el-tag :type="difficultyType[row.difficulty]" size="small">
                {{ difficultyLabel[row.difficulty] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="max_students" label="人数" width="60" align="center" />
          <el-table-column prop="status" label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="statusType[row.status]" size="small">
                {{ statusLabel[row.status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="提交时间" width="110">
            <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right" align="center">
            <template #default="{ row }">
              <template v-if="row.status === 'pending'">
                <el-button link type="success" icon="Select" size="small" @click="approveTopic(row)">通过</el-button>
                <el-button link type="danger" icon="Close" size="small" @click="rejectTopic(row)">退回</el-button>
              </template>
              <template v-else>
                <el-button link type="primary" icon="View" size="small" @click="goToDetail(row.id)">查看</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Download } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { adminApi, topicApi } from '@/api'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

const router = useRouter()

const topics = ref<any[]>([])
const filterStatus = ref('pending')
const selectedTopics = ref<any[]>([])
const batchLoading = ref(false)

const stats = computed(() => ({
  total: topics.value.length,
  published: topics.value.filter(t => t.status === 'published').length,
  draft: topics.value.filter(t => t.status === 'draft').length,
  pending: topics.value.filter(t => t.status === 'pending').length
}))

const filteredTopics = computed(() => {
  if (!filterStatus.value) return topics.value
  return topics.value.filter(t => t.status === filterStatus.value)
})

const difficultyLabel: Record<string, string> = {
  'easy': '简单', 'medium': '中等', 'hard': '困难'
}
const difficultyType: Record<string, string> = {
  'easy': 'success', 'medium': 'warning', 'hard': 'danger'
}
const statusLabel: Record<string, string> = {
  'published': '已发布', 'draft': '草稿', 'pending': '待审核', 'full': '已满员', 'closed': '已关闭'
}
const statusType: Record<string, string> = {
  'published': 'success', 'draft': 'info', 'pending': 'warning', 'full': 'danger', 'closed': 'info'
}

function handleFilterChange() {
  selectedTopics.value = []
}

function handleSelectionChange(rows: any[]) {
  selectedTopics.value = rows
}

function formatDate(dateStr: string): string {
  return dateStr ? dayjs(dateStr).format('YYYY-MM-DD') : '-'
}

const loadTopics = async () => {
  const res = await adminApi.getAllTopics()
  topics.value = res.data
}

const goToDetail = (topicId: string) => {
  router.push(`/student/topic/${topicId}`)
}

// 审核通过单个选题
async function approveTopic(topic: any) {
  try {
    await topicApi.updateStatus(topic.id, 'published')
    ElMessage.success(`选题「${topic.title}」已审核通过并发布`)
    await loadTopics()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '操作失败')
  }
}

// 退回单个选题
async function rejectTopic(topic: any) {
  try {
    const { value: reason } = await ElMessageBox.prompt('请输入退回原因（可选）', '退回修改', {
      confirmButtonText: '确定退回',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '可选的退回原因或修改建议...'
    })

    // 退回后状态变为 draft，教师可修改后重新提交
    await topicApi.updateStatus(topic.id, 'draft')
    ElMessage.success(`选题「${topic.title}」已退回${reason ? '：' + reason : ''}`)
    await loadTopics()
  } catch {
    // 用户取消
  }
}

// 批量审核通过
async function batchApprove() {
  try {
    await ElMessageBox.confirm(
      `确定批量审核通过 ${selectedTopics.value.length} 个选题？通过后将立即发布，学生可见。`,
      '批量审核确认',
      { confirmButtonText: '确定通过', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return
  }

  batchLoading.value = true
  let successCount = 0
  for (const topic of selectedTopics.value) {
    try {
      await topicApi.updateStatus(topic.id, 'published')
      successCount++
    } catch {
      // 跳过失败的
    }
  }
  batchLoading.value = false
  selectedTopics.value = []
  ElMessage.success(`批量审核完成：成功 ${successCount} / ${selectedTopics.value.length + successCount} 个`)
  await loadTopics()
}

// 导出为 Excel
const exportData = () => {
  const rows = topics.value.map(t => ({
    '课题名称': t.title,
    '指导教师': t.teacher_name,
    '所属部门': t.department || '-',
    '研究方向': t.category,
    '难度': difficultyLabel[t.difficulty] || t.difficulty,
    '招收人数': t.max_students,
    '申请人数': t.apply_count || 0,
    '状态': statusLabel[t.status] || t.status,
    '创建时间': formatDate(t.created_at)
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 40 }, { wch: 12 }, { wch: 20 }, { wch: 25 },
    { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '课题总览')
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  saveAs(blob, `课题总览_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`)
  ElMessage.success(`已导出 ${rows.length} 条课题数据`)
}

onMounted(() => {
  loadTopics()
})
</script>

<style scoped>
.stat-box {
  text-align: center;
  padding: 16px;
  background: #f8fafc;
  border-radius: 8px;
}
.stat-box.published { background: #ecfdf5; }
.stat-box.draft { background: #f1f5f9; }
.stat-box.pending { background: #fffbeb; }

.stat-value {
  display: block;
  font-size: 28px;
  font-weight: bold;
  color: #1e293b;
}
.stat-box.published .stat-value { color: #059669; }
.stat-box.draft .stat-value { color: #64748b; }
.stat-box.pending .stat-value { color: #d97706; }

.stat-label {
  font-size: 14px;
  color: #64748b;
}

.topic-link {
  color: #409eff;
  cursor: pointer;
  text-decoration: underline;
}
.topic-link:hover { color: #66b1ff; }
</style>
