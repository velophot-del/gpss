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
        <el-alert type="info" :closable="false" class="mb16" title="任务书可随时保存草稿并下载预览版；提交导师审核后暂不可修改，退回后可继续修改，确认后可下载正式 Word。" />
        <el-form label-width="125px" :model="form">
          <el-form-item label="毕业设计题目"><el-input v-model="form.title" :disabled="locked" maxlength="200" placeholder="留空时自动使用已正式确定的课题题目" /></el-form-item>
          <el-form-item label="设计目的和意义"><el-input v-model="form.content" :disabled="locked" type="textarea" :rows="5" /></el-form-item>
          <el-form-item label="设计主要内容"><el-input v-model="form.mainContent" :disabled="locked" type="textarea" :rows="5" /></el-form-item>
          <el-form-item label="基本要求"><el-input v-model="form.requirements" :disabled="locked" type="textarea" :rows="5" /></el-form-item>
          <el-form-item label="具体要求"><el-input v-model="form.specificRequirements" :disabled="locked" type="textarea" :rows="5" /></el-form-item>
          <el-form-item label="阶段工作计划">
            <el-table :data="form.schedule" border size="small" class="schedule-table">
              <el-table-column prop="phase" label="阶段" min-width="230" />
              <el-table-column label="时间节点" width="180">
                <template #default="{ row }">
                  <el-select v-model="row.month" :disabled="locked" placeholder="请选择月份" style="width: 140px">
                    <el-option v-for="month in months" :key="month" :label="month + '月份'" :value="month" />
                  </el-select>
                </template>
              </el-table-column>
            </el-table>
            <div class="form-tip">请为模板中的 8 个固定阶段各选择一个月份，导出 Word 时自动写入原模板对应位置。</div>
          </el-form-item>
        </el-form>
        <div v-if="!locked" class="actions">
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
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="任务书题目">{{ current?.title }}</el-descriptions-item>
        <el-descriptions-item label="设计目的和意义"><div class="pre">{{ current?.content || '—' }}</div></el-descriptions-item>
        <el-descriptions-item label="设计主要内容"><div class="pre">{{ current?.mainContent || '—' }}</div></el-descriptions-item>
        <el-descriptions-item label="基本要求"><div class="pre">{{ current?.requirements || '—' }}</div></el-descriptions-item>
        <el-descriptions-item label="具体要求"><div class="pre">{{ current?.specificRequirements || '—' }}</div></el-descriptions-item>
        <el-descriptions-item label="阶段工作计划">
          <div v-if="parseSchedule(current?.schedule).length" class="review-schedule">
            <div v-for="item in parseSchedule(current?.schedule)" :key="item.phase">{{ item.phase }}：{{ item.month ? `${item.month}月份` : '未填写' }}</div>
          </div>
          <div v-else>—</div>
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
import { taskBookApi } from '../../api'

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
const phases = ['选题、下达任务书', '实施研究、收集资料', '开题报告', '撰写设计报告、完成初稿', '毕业设计中期检查', '完成修改、定稿', '学术不端检测', '答辩、展览']
const months = Array.from({ length: 12 }, (_, i) => i + 1)
const newSchedule = () => phases.map(phase => ({ phase, month: '' as number | '' }))
const form = reactive<{ title: string; content: string; mainContent: string; requirements: string; specificRequirements: string; schedule: Array<{ phase: string; month: number | '' }> }>({ title: '', content: '', mainContent: '', requirements: '', specificRequirements: '', schedule: newSchedule() })
const review = reactive<{ status: 'confirmed' | 'need_revision'; comment: string }>({ status: 'confirmed', comment: '' })
const locked = computed(() => ['submitted', 'confirmed', 'issued'].includes(record.value?.status))

const labels: Record<string, string> = { draft: '草稿', submitted: '待确认', need_revision: '待修改', confirmed: '已确认', issued: '历史已下达' }
function statusLabel(status: string) { return labels[status] || status }
function statusType(status: string) { return status === 'confirmed' ? 'success' : status === 'submitted' ? 'warning' : status === 'need_revision' ? 'danger' : 'info' }
function parseSchedule(value: unknown): Array<{ phase: string; month: number | '' }> {
  if (Array.isArray(value)) return value as Array<{ phase: string; month: number | '' }>
  if (typeof value !== 'string' || !value.trim()) return newSchedule()
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? phases.map(phase => ({ phase, month: parsed.find((item: any) => item.phase === phase)?.month || '' })) : newSchedule()
  } catch { return newSchedule() }
}
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
  try {
    const res: any = await taskBookApi.getList()
    list.value = res.data || []
    if (!isTeacher.value) {
      record.value = list.value[0] || null
      if (record.value) Object.assign(form, {
        title: record.value.title || '', content: record.value.content || '', mainContent: record.value.mainContent || '',
        requirements: record.value.requirements || '', specificRequirements: record.value.specificRequirements || '',
        schedule: parseSchedule(record.value.schedule)
      })
    }
  } finally { loading.value = false }
}

async function save(submit: boolean) {
  submit ? submitting.value = true : saving.value = true
  try {
    await taskBookApi.submit({ ...form, schedule: JSON.stringify(form.schedule), submit })
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
