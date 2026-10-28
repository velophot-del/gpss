<template>
  <div class="process-page">
    <el-card shadow="never">
      <template #header>
        <div class="page-header">
          <span class="title">{{ cfg.pageTitle }}</span>
          <div class="header-actions">
            <el-button type="primary" :disabled="!record" :loading="exporting" @click="downloadDocx">
              {{ record?.status === cfg.reviewPass ? '下载正式 Word' : '下载 Word（预览版）' }}
            </el-button>
            <el-tag v-if="record" :type="statusTagType(record.status)" effect="dark" round>{{ statusLabel(record.status) }}</el-tag>
          </div>
        </div>
      </template>

      <el-descriptions v-if="record" :column="2" border size="small" class="mb16">
        <el-descriptions-item label="选题">{{ record.topicTitle || '—' }}</el-descriptions-item>
        <el-descriptions-item label="导师">{{ record.teacherName || '—' }}</el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="record && record.teacherComment"
        :title="'导师意见：' + record.teacherComment"
        type="warning"
        :closable="false"
        class="mb16"
      />
      <el-alert
        v-if="record && cfg.hasScore && record.score != null"
        :title="'评分：' + record.score"
        type="info"
        :closable="false"
        class="mb16"
      />

      <el-alert v-if="templateError" :title="templateError" type="warning" :closable="false" />
      <TemplateMaterialForm v-if="materialTemplate" :template="materialTemplate" v-model="form" :readonly="locked" />

      <div v-if="!locked && materialTemplate" class="actions">
        <el-button :loading="saving" @click="save(false)">保存草稿</el-button>
        <el-button type="primary" :loading="submitting" @click="save(true)">提交</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { saveAs } from 'file-saver'
import { STAGE_CONFIGS } from './processConfig'
import { SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_TAG } from '../../types'
import type { MaterialTemplate } from '../../types'
import { documentTemplateApi } from '../../api'
import TemplateMaterialForm from '../../components/TemplateMaterialForm.vue'

const props = defineProps<{ stage: string }>()

const cfg = computed(() => STAGE_CONFIGS[props.stage] || STAGE_CONFIGS.proposal)

const loading = ref(false)
const saving = ref(false)
const submitting = ref(false)
const record = ref<any>(null)
const exporting = ref(false)

const form = ref<Record<string, string>>({})
const materialTemplate = ref<MaterialTemplate | null>(null)
const templateError = ref('')

const locked = computed(() => {
  if (!record.value) return false
  return [cfg.value.submitStatus, cfg.value.reviewPass, cfg.value.reviewReject, 'final'].includes(record.value.status)
})

function statusLabel(s: string) { return SUBMISSION_STATUS_LABELS[s] || s }
function statusTagType(s: string): any { return SUBMISSION_STATUS_TAG[s] || 'info' }
async function downloadDocx() {
  if (!record.value) return
  exporting.value = true
  try {
    const blob: any = await cfg.value.api.exportDocx(record.value.id)
    const prefix = record.value.status === cfg.value.reviewPass ? '' : '预览版_'
    saveAs(blob, `${prefix}${record.value.studentName || '学生'}_${cfg.value.reviewLabel}.docx`)
  } catch (e) {
    // 拦截器已提示
  } finally { exporting.value = false }
}

async function load() {
  loading.value = true
  materialTemplate.value = null
  templateError.value = ''
  form.value = {}
  try {
    const res: any = await cfg.value.api.getList()
    const list = res.data || []
    record.value = list[0] || null
    const templateRes: any = await documentTemplateApi.getForm(props.stage, record.value?.id)
    materialTemplate.value = templateRes.data.template
    for (const f of materialTemplate.value!.profile.fields.filter(f => f.source === 'student')) {
      form.value[f.key] = templateRes.data.values?.[f.key] ?? record.value?.[f.key] ?? ''
    }
  } catch (e: any) {
    templateError.value = e.response?.data?.message || '读取模板失败，请刷新后重试'
  } finally {
    loading.value = false
  }
}

async function save(submit: boolean) {
  if (!materialTemplate.value) return
  const body = { submit, templateId: materialTemplate.value.id, templateValues: form.value }
  if (submit) submitting.value = true
  else saving.value = true
  try {
    await cfg.value.api.submit(body)
    ElMessage.success(submit ? '提交成功' : '已保存')
    await load()
  } catch (e) {
    // 拦截器已提示
  } finally {
    submitting.value = false
    saving.value = false
  }
}

onMounted(load)
watch(() => props.stage, load)
</script>

<style scoped>
.process-page {
  max-width: 860px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.header-actions { display: flex; align-items: center; gap: 10px; }
.page-header .title {
  font-size: 16px;
  font-weight: 600;
}
.mb16 {
  margin-bottom: 16px;
}
.actions {
  padding-left: 110px;
  margin-top: 8px;
}
</style>
