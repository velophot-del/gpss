<template>
  <div class="process-page">
    <el-card shadow="never">
      <template #header>
        <div class="page-header">
          <span class="title">任务书{{ isTeacher ? ' · 确认' : '' }}</span>
          <div v-if="!isTeacher" class="header-actions">
            <el-button type="primary" :disabled="!record" :loading="exporting" @click="downloadDocx">
              {{ record?.status === 'confirmed' ? '下载正式 Word' : '下载 Word（预览版）' }}
            </el-button>
          </div>
        </div>
      </template>

      <template v-if="!isTeacher">
        <el-alert v-if="record?.teacherComment" :title="'指导教师意见：' + record.teacherComment" type="warning" :closable="false" class="mb16" />
        <el-alert type="info" :closable="false" class="mb16" title="保存后可下载预览版；提交后暂不可修改，待教师退回修改后可继续填写。确认后可下载正式 Word。" />
        <el-alert v-if="templateError" :title="templateError" type="warning" :closable="false" />
        <TemplateMaterialForm v-if="materialTemplate" :template="materialTemplate" v-model="form" :readonly="locked" />
        <div v-if="!locked && materialTemplate" class="actions">
          <el-button :loading="saving" @click="save(false)">保存草稿</el-button>
          <el-button type="primary" :loading="submitting" @click="save(true)">提交教师确认</el-button>
        </div>
      </template>

      <el-table v-else :data="list" v-loading="loading" border>
        <el-table-column label="学生" min-width="150"><template #default="{ row }">{{ row.studentName }}（{{ row.studentCode }}）</template></el-table-column>
        <el-table-column prop="topicTitle" label="选题" min-width="220" show-overflow-tooltip />
        <el-table-column prop="title" label="任务书题目" min-width="200" show-overflow-tooltip />
        <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="120" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openReview(row)">查看 / 确认</el-button></template></el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="reviewVisible" :title="'确认任务书：' + (current?.studentName || '')" width="700px">
      <TemplateMaterialForm v-if="current?.template" :template="current.template" :model-value="current.templateValues || {}" readonly />
      <el-descriptions v-else :column="1" border size="small">
        <el-descriptions-item label="任务书题目">{{ current?.title }}</el-descriptions-item>
        <el-descriptions-item label="设计目的和意义"><div class="pre">{{ current?.content || '—' }}</div></el-descriptions-item>
        <el-descriptions-item label="设计主要内容"><div class="pre">{{ current?.mainContent || '—' }}</div></el-descriptions-item>
        <el-descriptions-item label="基本要求"><div class="pre">{{ current?.requirements || '—' }}</div></el-descriptions-item>
        <el-descriptions-item label="具体要求"><div class="pre">{{ current?.specificRequirements || '—' }}</div></el-descriptions-item>
        <el-descriptions-item label="阶段工作计划">
          <div>历史材料尚未绑定模板版本，请管理员在毕业资料库关联后核对。</div>
        </el-descriptions-item>
      </el-descriptions>
      <el-form label-width="90px" class="mt16">
        <el-form-item label="确认结论"><el-radio-group v-model="review.status"><el-radio-button label="confirmed">确认</el-radio-button><el-radio-button label="need_revision">退回修改</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="指导意见"><el-input v-model="review.comment" type="textarea" :rows="3" placeholder="填写确认意见或修改建议" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="reviewVisible = false">取消</el-button><el-button type="primary" :loading="reviewing" @click="submitReview">确认提交</el-button></template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { saveAs } from 'file-saver'
import { useUserStore } from '../../stores/user'
import { taskBookApi, documentTemplateApi } from '../../api'
import type { MaterialTemplate } from '../../types'
import TemplateMaterialForm from '../../components/TemplateMaterialForm.vue'

const userStore = useUserStore()
const isTeacher = computed(() => userStore.userRole === 'teacher' || userStore.userRole === 'admin')
const loading = ref(false)
const saving = ref(false)
const submitting = ref(false)
const reviewing = ref(false)
const list = ref<any[]>([])
const record = ref<any>(null)
const current = ref<any>(null)
const reviewVisible = ref(false)
const exporting = ref(false)
const form = ref<Record<string, string>>({})
const materialTemplate = ref<MaterialTemplate | null>(null)
const templateError = ref('')
const review = reactive<{ status: 'confirmed' | 'need_revision'; comment: string }>({ status: 'confirmed', comment: '' })
const locked = computed(() => ['submitted', 'confirmed', 'issued'].includes(record.value?.status))

const labels: Record<string, string> = { draft: '草稿', submitted: '待确认', need_revision: '待修改', confirmed: '已确认', issued: '历史已下达' }
function statusLabel(status: string) { return labels[status] || status }
function statusType(status: string) { return status === 'confirmed' ? 'success' : status === 'submitted' ? 'warning' : status === 'need_revision' ? 'danger' : 'info' }
async function downloadDocx() {
  if (!record.value) return
  exporting.value = true
  try {
    const blob: any = await taskBookApi.exportDocx(record.value.id)
    const prefix = record.value.status === 'confirmed' ? '' : '预览版_'
    saveAs(blob, `${prefix}${record.value.studentName || '学生'}_毕业设计任务书.docx`)
  } catch (e) {
    // 拦截器已提示
  } finally { exporting.value = false }
}

async function load() {
  loading.value = true
  materialTemplate.value = null
  templateError.value = ''
  try {
    const res: any = await taskBookApi.getList()
    list.value = res.data || []
    if (!isTeacher.value) {
      record.value = list.value[0] || null
      const templateRes: any = await documentTemplateApi.getForm('task_book', record.value?.id)
      materialTemplate.value = templateRes.data.template
      form.value = {}
      for (const f of materialTemplate.value!.profile.fields.filter(f => f.source === 'student')) {
        form.value[f.key] = templateRes.data.values?.[f.key] ?? record.value?.[f.key] ?? ''
      }
    }
  } catch (e: any) {
    templateError.value = e.response?.data?.message || '读取任务书模板失败，请刷新重试'
  } finally { loading.value = false }
}

async function save(submit: boolean) {
  submit ? submitting.value = true : saving.value = true
  try {
    if (!materialTemplate.value) return
    await taskBookApi.submit({ templateId: materialTemplate.value.id, templateValues: form.value, submit })
    ElMessage.success(submit ? '已提交教师确认' : '草稿已保存')
    await load()
  } finally { submitting.value = false; saving.value = false }
}

function openReview(row: any) {
  current.value = row
  review.status = 'confirmed'
  review.comment = row.teacherComment || ''
  reviewVisible.value = true
}

async function submitReview() {
  if (!current.value) return
  reviewing.value = true
  try {
    await taskBookApi.review(current.value.id, review)
    ElMessage.success(review.status === 'confirmed' ? '任务书已确认' : '已退回学生修改')
    reviewVisible.value = false
    await load()
  } finally { reviewing.value = false }
}

onMounted(load)
</script>

<style scoped>
.process-page { max-width: 1000px; }
.page-header { display: flex; align-items: center; justify-content: space-between; }
.header-actions { display: flex; gap: 10px; }
.title { font-size: 16px; font-weight: 600; }
.mb16 { margin-bottom: 16px; }.mt16 { margin-top: 16px; }.actions { padding-left: 125px; }.pre { white-space: pre-wrap; word-break: break-word; }.schedule-table { width: 430px; }.form-tip { color: #909399; font-size: 12px; margin-top: 6px; }.review-schedule div { line-height: 1.8; }
</style>
