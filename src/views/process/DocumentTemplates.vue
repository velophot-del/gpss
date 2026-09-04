<template>
  <div class="template-page">
    <div class="page-header">
      <div>
        <h2>{{ isAdmin ? '毕业资料库' : '毕业资料' }}</h2>
        <p>{{ isAdmin ? '按选题周期维护并发布正式模板。' : '正式选题确定后，可下载所属周期的已发布模板。' }}</p>
      </div>
      <el-button v-if="isAdmin" type="primary" @click="openCreate"><el-icon><Plus /></el-icon>上传模板</el-button>
    </div>

    <template v-if="isAdmin">
      <el-card shadow="never" class="filter-card">
        <el-select v-model="selectedCycleId" clearable placeholder="全部选题周期" @change="loadAdminTemplates">
          <el-option v-for="cycle in cycles" :key="cycle.id" :label="`${cycle.name}（${cycle.year}）`" :value="Number(cycle.id)" />
        </el-select>
      </el-card>

      <el-table v-loading="loading" :data="templates" empty-text="暂无资料模板">
        <el-table-column prop="cycleName" label="选题周期" min-width="180" />
        <el-table-column label="资料类型" width="120"><template #default="{ row }">{{ typeLabel[row.documentType] }}</template></el-table-column>
        <el-table-column prop="title" label="名称" min-width="160" />
        <el-table-column prop="version" label="版本" width="110" />
        <el-table-column prop="originalName" label="文件" min-width="160" show-overflow-tooltip />
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType[row.status]">{{ statusLabel[row.status] }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="download(row)">下载</el-button>
            <el-button v-if="row.status !== 'published'" link type="success" @click="changeStatus(row, 'published')">发布</el-button>
            <el-button v-if="row.status === 'published'" link type="warning" @click="changeStatus(row, 'archived')">归档</el-button>
            <el-button v-if="row.status === 'archived'" link @click="changeStatus(row, 'draft')">恢复草稿</el-button>
            <el-popconfirm
              title="删除后不可恢复（含已上传文件），确认删除？"
              confirm-button-text="删除"
              cancel-button-text="取消"
              @confirm="handleDelete(row)"
            >
              <template #reference>
                <el-button link type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <template v-else>
      <el-alert v-if="!selection" title="尚未正式确定课题" description="选题被正式录取后，系统将自动显示所属周期的毕业资料模板。" type="info" :closable="false" show-icon />
      <template v-else>
        <el-alert :title="`当前课题：${selection.topic_title}`" :description="'以下为本周期已发布的通用资料模板；导师下达的个人任务书请在“任务书”中查看。'" type="success" :closable="false" show-icon />
        <el-row v-loading="loading" :gutter="16" class="template-list">
          <el-col v-for="item in templates" :key="item.id" :xs="24" :sm="12" :lg="8">
            <el-card shadow="hover" class="template-card">
              <div class="card-top"><el-tag>{{ typeLabel[item.documentType] }}</el-tag><span>v{{ item.version }}</span></div>
              <h3>{{ item.title }}</h3>
              <p>{{ item.description || '暂无补充说明' }}</p>
              <div class="file-name">{{ item.originalName }}</div>
              <el-button type="primary" plain @click="download(item)">下载模板</el-button>
            </el-card>
          </el-col>
        </el-row>
        <el-empty v-if="!loading && templates.length === 0" description="当前周期暂未发布毕业资料模板" />
      </template>
    </template>

    <el-dialog v-model="dialogVisible" title="上传毕业资料模板" width="560px" :close-on-click-modal="false">
      <el-form label-width="92px">
        <el-form-item label="选题周期" required>
          <el-select v-model="form.cycleId" placeholder="请选择选题周期" class="full-width"><el-option v-for="cycle in cycles" :key="cycle.id" :label="`${cycle.name}（${cycle.year}）`" :value="Number(cycle.id)" /></el-select>
        </el-form-item>
        <el-form-item label="资料类型" required><el-select v-model="form.documentType" class="full-width"><el-option v-for="(label, value) in typeLabel" :key="value" :label="label" :value="value" /></el-select></el-form-item>
        <el-form-item label="资料名称" required><el-input v-model="form.title" placeholder="如：本科毕业设计开题报告书" /></el-form-item>
        <el-form-item label="版本号" required><el-input v-model="form.version" placeholder="如：2026-v1.0" /></el-form-item>
        <el-form-item label="资料说明"><el-input v-model="form.description" type="textarea" :rows="3" placeholder="说明适用范围、填写要求等" /></el-form-item>
        <el-form-item label="模板文件" required>
          <el-upload :auto-upload="false" :limit="1" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip" :on-change="selectFile" :on-remove="clearFile">
            <el-button plain type="primary">选择文件</el-button>
            <template #tip><div class="el-upload__tip">支持 PDF、Office 文档或 ZIP，单个不超过 50MB</div></template>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="createTemplate">保存草稿</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { cycleApi, documentTemplateApi } from '../../api'
import { useUserStore } from '../../stores/user'
import type { DocumentTemplate, DocumentTemplateType } from '../../types'

const userStore = useUserStore()
const isAdmin = computed(() => userStore.userRole === 'admin')
const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const templates = ref<DocumentTemplate[]>([])
const cycles = ref<any[]>([])
const selectedCycleId = ref<number>()
const selection = ref<any>(null)
const selectedFile = ref<File | null>(null)
const typeLabel: Record<DocumentTemplateType, string> = { task_book: '任务书', proposal: '开题报告书', midterm: '中期检查表', thesis: '毕业设计报告（论文）', other: '其他资料' }
const statusLabel: Record<DocumentTemplate['status'], string> = { draft: '草稿', published: '已发布', archived: '已归档' }
const statusType: Record<DocumentTemplate['status'], 'info' | 'success' | 'warning'> = { draft: 'info', published: 'success', archived: 'warning' }
const form = reactive<{ cycleId?: number; documentType: DocumentTemplateType; title: string; version: string; description: string }>({ cycleId: undefined, documentType: 'task_book', title: '', version: '', description: '' })

async function loadCycles() {
  const res: any = await cycleApi.getAll()
  cycles.value = res.data || []
}

async function loadAdminTemplates() {
  loading.value = true
  try {
    const res: any = await documentTemplateApi.getAll(selectedCycleId.value)
    templates.value = res.data || []
  } finally { loading.value = false }
}

async function loadStudentTemplates() {
  loading.value = true
  try {
    const res: any = await documentTemplateApi.getMine()
    selection.value = res.data?.selection || null
    templates.value = res.data?.templates || []
  } finally { loading.value = false }
}

function openCreate() {
  Object.assign(form, { cycleId: selectedCycleId.value, documentType: 'task_book', title: '', version: '', description: '' })
  selectedFile.value = null
  dialogVisible.value = true
}

function selectFile(file: any) { selectedFile.value = file.raw || null }
function clearFile() { selectedFile.value = null }

async function createTemplate() {
  if (!form.cycleId || !form.title.trim() || !form.version.trim() || !selectedFile.value) return ElMessage.warning('请完整填写并选择模板文件')
  saving.value = true
  try {
    const data = new FormData()
    data.append('cycleId', String(form.cycleId))
    data.append('documentType', form.documentType)
    data.append('title', form.title.trim())
    data.append('version', form.version.trim())
    data.append('description', form.description.trim())
    data.append('file', selectedFile.value)
    await documentTemplateApi.create(data)
    ElMessage.success('模板草稿已保存')
    dialogVisible.value = false
    await loadAdminTemplates()
  } finally { saving.value = false }
}

async function changeStatus(item: DocumentTemplate, status: DocumentTemplate['status']) {
  await documentTemplateApi.updateStatus(item.id, status)
  ElMessage.success(status === 'published' ? '模板已发布' : status === 'archived' ? '模板已归档' : '模板已恢复为草稿')
  await loadAdminTemplates()
}

async function handleDelete(item: DocumentTemplate) {
  try {
    await documentTemplateApi.remove(item.id)
    ElMessage.success(`「${item.title}」已删除`)
    await loadAdminTemplates()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '删除失败')
  }
}

async function download(item: DocumentTemplate) {
  const blob: any = await documentTemplateApi.download(item.id)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = item.originalName
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  if (isAdmin.value) {
    await loadCycles()
    await loadAdminTemplates()
  } else {
    await loadStudentTemplates()
  }
})
</script>

<style scoped>
.template-page { max-width: 1200px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
.page-header h2 { margin: 0 0 8px; font-size: 20px; }
.page-header p { margin: 0; color: #909399; }
.filter-card { margin-bottom: 16px; }
.full-width { width: 100%; }
.template-list { margin-top: 18px; }
.template-card { min-height: 220px; margin-bottom: 16px; }
.card-top { display: flex; justify-content: space-between; color: #909399; font-size: 13px; }
.template-card h3 { margin: 16px 0 8px; font-size: 16px; }
.template-card p { min-height: 42px; margin: 0 0 12px; color: #606266; line-height: 1.6; }
.file-name { margin-bottom: 14px; color: #909399; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 767px) { .page-header { flex-direction: column; } }
</style>
