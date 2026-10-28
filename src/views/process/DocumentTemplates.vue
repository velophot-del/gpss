<template>
  <div class="template-page">
    <div class="page-header">
      <div>
        <h2>{{ isAdmin ? '毕业资料库' : '毕业资料' }}</h2>
        <p>{{ isAdmin ? '上传后核对填写区域及固定内容，下载预览并确认后发布。' : '正式选题确定后，可下载所属周期的已发布模板。' }}</p>
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
        <el-table-column label="操作" width="410" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="download(row)">下载原件</el-button>
            <el-button v-if="isOnlineType(row.documentType)" link type="primary" @click="openMapping(row)">核对填写区域</el-button>
            <el-button v-if="row.status !== 'published'" link type="success" @click="isOnlineType(row.documentType) ? openMapping(row) : changeStatus(row, 'published')">发布</el-button>
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
        <el-alert :title="`当前课题：${selection.topic_title}`" description="以下为本周期已发布模板；个人材料请在对应毕业流程中填写并下载，已有材料可能绑定较早版本。" type="success" :closable="false" show-icon />
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

    <el-dialog v-model="mappingVisible" :title="`核对模板：${mappingItem?.title || ''} · ${mappingItem?.version || ''}`" width="95%" :close-on-click-modal="false">
      <el-alert type="info" :closable="false" title="固定区保留模板原文；学生区显示为填写项；系统区填入个人信息；教师区填入审核意见。请保留签名区域。" />
      <el-alert v-if="mappingLocked" type="warning" :closable="false" title="此版本已确认，配置只读。修改内容请上传新版本；已绑定材料继续使用原版本。" />
      <el-alert v-for="message in mappingErrors" :key="message" type="error" :closable="false" :title="message" />
      <template v-if="profile">
        <el-table :data="profile.fields" border max-height="460" class="mapping-table">
          <el-table-column type="expand"><template #default="{ row }">
            <div class="mapping-detail">
              <p class="original-content">原文：{{ row.original || '（空白）' }}</p>
              <el-form label-width="100px">
                <el-form-item label="段落范围">
                  <el-input-number :model-value="row.start + 1" :min="1" :max="profile.paragraphCount" :disabled="mappingLocked" @update:model-value="row.start = Number($event) - 1" />
                  <span> 至 </span>
                  <el-input-number :model-value="row.end + 1" :min="1" :max="profile.paragraphCount" :disabled="mappingLocked" @update:model-value="row.end = Number($event) - 1" />
                </el-form-item>
                <el-form-item v-if="row.source === 'fixed'" label="固定内容">
                  <el-input :model-value="row.value ?? row.original" type="textarea" :rows="4" :disabled="mappingLocked" @update:model-value="row.value = $event" />
                  <span>保持原文时无需修改；阶段计划的内容、年份及日期可在这里统一调整。</span>
                </el-form-item>
                <el-form-item v-else label="保留前缀"><el-input v-model="row.prefix" :disabled="mappingLocked" placeholder="如封面字段前的“学院”，无则留空" /></el-form-item>
              </el-form>
            </div>
          </template></el-table-column>
          <el-table-column label="栏目名称" min-width="230"><template #default="{ row }"><el-input v-model="row.label" :disabled="mappingLocked" /></template></el-table-column>
          <el-table-column label="内容来源" width="150"><template #default="{ row }">
            <el-select v-model="row.source" :disabled="mappingLocked"><el-option label="管理员固定" value="fixed" /><el-option label="学生填写" value="student" /><el-option label="系统信息" value="system" /><el-option label="教师意见" value="teacher" /></el-select>
          </template></el-table-column>
          <el-table-column label="填写项" width="190"><template #default="{ row }">
            <el-select v-if="row.source === 'system'" v-model="row.key" :disabled="mappingLocked"><el-option v-for="(label, key) in systemFields" :key="key" :label="label" :value="key" /></el-select>
            <el-select v-else-if="row.source === 'teacher'" v-model="row.key" :disabled="mappingLocked"><el-option label="指导意见" value="teacherComment" /></el-select>
            <el-input v-else-if="row.source === 'student'" v-model="row.key" :disabled="mappingLocked" placeholder="同一填写项保持同一标识" />
            <span v-else>保留或统一编辑原文</span>
          </template></el-table-column>
          <el-table-column label="必填" width="75"><template #default="{ row }"><el-checkbox v-model="row.required" :disabled="mappingLocked || row.source !== 'student'" /></template></el-table-column>
          <el-table-column label="范围" width="95"><template #default="{ row }">{{ row.start + 1 }}—{{ row.end + 1 }}</template></el-table-column>
          <el-table-column v-if="!mappingLocked" width="75"><template #default="{ $index }"><el-button link type="danger" @click="profile.fields.splice($index, 1)">取消映射</el-button></template></el-table-column>
        </el-table>
        <el-button v-if="!mappingLocked" @click="addMapping">新增填写区域</el-button>
        <p>展开行可查看原文、调整范围或统一内容；取消映射后该范围保留原文。系统不会自动修改上传原件。</p>
        <el-checkbox v-model="mappingConfirmed">我已核对栏目和固定内容，并检查了生成预览，确认可用于学生填写</el-checkbox>
        <el-divider>历史材料版本关联</el-divider>
        <p>已提交的历史材料不会自动采用本模板。仅在明确核对后选择关联，原始填写数据保留。</p>
        <el-table :data="unboundRecords" max-height="200" @selection-change="historySelection = $event.map((row: any) => row.id)">
          <el-table-column type="selection" width="50" /><el-table-column prop="studentName" label="学生" /><el-table-column prop="title" label="材料标题" /><el-table-column prop="status" label="状态" />
        </el-table>
        <el-button :disabled="!mappingLocked || !historySelection.length" :loading="mappingSaving" @click="bindHistory">关联所选历史材料到此版本</el-button>
      </template>
      <template #footer>
        <el-button @click="mappingVisible = false">关闭</el-button>
        <el-button v-if="mappingLocked && mappingItem" @click="download(mappingItem, true)">下载生效空白模板</el-button>
        <el-button :loading="mappingSaving" @click="previewMapping">下载生成预览</el-button>
        <el-button v-if="!mappingLocked" :loading="mappingSaving" @click="saveMapping">保存配置</el-button>
        <el-button v-if="mappingItem?.status !== 'published'" type="primary" :disabled="!mappingConfirmed" :loading="mappingSaving" @click="publishMapping">确认并发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { cycleApi, documentTemplateApi } from '../../api'
import { useUserStore } from '../../stores/user'
import type { DocumentTemplate, DocumentTemplateType, TemplateProfile } from '../../types'

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
const mappingVisible = ref(false)
const mappingSaving = ref(false)
const mappingLocked = ref(false)
const mappingConfirmed = ref(false)
const mappingItem = ref<DocumentTemplate | null>(null)
const mappingErrors = ref<string[]>([])
const profile = ref<TemplateProfile | null>(null)
const unboundRecords = ref<any[]>([])
const historySelection = ref<string[]>([])
const systemFields = { collegeName: '学院', major: '专业', className: '班级', studentName: '姓名', studentCode: '学号', teacherName: '指导教师', topicTitle: '正式课题题目', title: '材料标题' }
const isOnlineType = (type: string) => ['task_book', 'proposal', 'midterm'].includes(type)

async function openMapping(item: DocumentTemplate) {
  mappingVisible.value = false
  mappingItem.value = item
  mappingConfirmed.value = false
  historySelection.value = []
  const [result, history]: any[] = await Promise.all([documentTemplateApi.inspect(item.id), documentTemplateApi.getUnbound(item.id)])
  profile.value = result.data.profile
  mappingLocked.value = result.data.locked
  mappingErrors.value = result.data.errors || []
  unboundRecords.value = history.data || []
  mappingVisible.value = true
}
function addMapping() {
  if (!profile.value) return
  const id = `custom_${Date.now()}`
  profile.value.fields.push({ id, start: 0, end: 0, label: '新增栏目', source: 'student', key: id, required: true, original: '' })
}
async function saveMapping() {
  if (!mappingItem.value || !profile.value) return
  mappingSaving.value = true
  try { const result: any = await documentTemplateApi.saveProfile(mappingItem.value.id, profile.value); profile.value = result.data.profile; mappingErrors.value = []; ElMessage.success('配置已保存，原模板文件保持不变') }
  finally { mappingSaving.value = false }
}
async function previewMapping() {
  if (!mappingItem.value || !profile.value) return
  mappingSaving.value = true
  try {
    const blob: any = await documentTemplateApi.preview(mappingItem.value.id, profile.value)
    saveBlob(blob, `预览_${mappingItem.value.originalName}`)
  } finally { mappingSaving.value = false }
}
async function publishMapping() {
  if (!mappingItem.value || !profile.value || !mappingConfirmed.value) return
  mappingSaving.value = true
  try {
    if (!mappingLocked.value) {
      const result: any = await documentTemplateApi.saveProfile(mappingItem.value.id, profile.value)
      profile.value = result.data.profile
    }
    await documentTemplateApi.updateStatus(mappingItem.value.id, 'published', true)
    mappingLocked.value = true
    mappingItem.value.status = 'published'
    ElMessage.success('模板已确认并发布，已保存材料继续使用其绑定版本')
    await loadAdminTemplates()
  } finally { mappingSaving.value = false }
}
async function bindHistory() {
  if (!mappingItem.value) return
  try { await ElMessageBox.confirm('将所选历史材料明确关联到本模板版本。原填写记录保留，后续导出使用此模板；关联后不再随新版变更。确认继续？', '关联历史材料', { type: 'warning' }) } catch { return }
  mappingSaving.value = true
  try {
    await documentTemplateApi.bindHistory(mappingItem.value.id, historySelection.value)
    ElMessage.success('关联完成')
    await openMapping(mappingItem.value)
  } finally { mappingSaving.value = false }
}
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url)
}

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

async function download(item: DocumentTemplate, effective = !isAdmin.value) {
  const blob: any = await documentTemplateApi.download(item.id, effective)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = effective ? `发布版_${item.version}_${item.originalName}` : item.originalName
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
.mapping-table { margin: 16px 0; }
.mapping-detail { padding: 12px 24px; }
.original-content { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 767px) { .page-header { flex-direction: column; } }
</style>
