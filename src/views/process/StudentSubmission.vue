<template>
  <div class="process-page">
    <el-card shadow="never">
      <template #header>
        <div class="page-header">
          <span class="title">{{ cfg.pageTitle }}</span>
          <el-tag v-if="record" :type="statusTagType(record.status)" effect="dark" round>
            {{ statusLabel(record.status) }}
          </el-tag>
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

      <el-form label-width="110px" :model="form">
        <el-form-item v-if="cfg.hasTitle" :label="cfg.titleLabel">
          <el-input v-model="form.title" maxlength="200" placeholder="请输入" :disabled="locked" />
        </el-form-item>
        <el-form-item v-for="f in cfg.fields" :key="f.key" :label="f.label">
          <el-input v-if="f.type === 'input'" v-model="form[f.key]" :placeholder="'请输入' + f.label" :disabled="locked" />
          <el-input v-else v-model="form[f.key]" type="textarea" :rows="f.rows || 3" :placeholder="'请输入' + f.label" :disabled="locked" />
        </el-form-item>
        <el-form-item label="附件材料">
          <FileUploadList v-model="form.fileUrls" :category="cfg.category" :accept="cfg.accept" :tip="cfg.uploadTip" />
        </el-form-item>
      </el-form>

      <div v-if="!locked" class="actions">
        <el-button :loading="saving" @click="save(false)">保存草稿</el-button>
        <el-button type="primary" :loading="submitting" @click="save(true)">提交</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import FileUploadList from '../../components/FileUploadList.vue'
import { STAGE_CONFIGS } from './processConfig'
import { SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_TAG, type FileItem } from '../../types'

const props = defineProps<{ stage: string }>()

const cfg = computed(() => STAGE_CONFIGS[props.stage] || STAGE_CONFIGS.proposal)

const loading = ref(false)
const saving = ref(false)
const submitting = ref(false)
const record = ref<any>(null)

const form = reactive<Record<string, any>>({ title: '', fileUrls: [] as FileItem[] })

// 初始化动态字段
for (const f of cfg.value.fields) form[f.key] = ''

const locked = computed(() => {
  if (!record.value) return false
  return [cfg.value.reviewPass, 'final'].includes(record.value.status)
})

function statusLabel(s: string) { return SUBMISSION_STATUS_LABELS[s] || s }
function statusTagType(s: string): any { return SUBMISSION_STATUS_TAG[s] || 'info' }

async function load() {
  loading.value = true
  try {
    const res: any = await cfg.value.api.getList()
    const list = res.data || []
    record.value = list[0] || null
    if (record.value) {
      form.title = record.value.title || ''
      for (const f of cfg.value.fields) form[f.key] = record.value[f.key] || ''
      form.fileUrls = record.value.fileUrls || []
    }
  } catch (e) {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}

async function save(submit: boolean) {
  if (submit) {
    if (cfg.value.hasTitle && !form.title) return ElMessage.warning('请填写' + cfg.value.titleLabel)
    for (const f of cfg.value.fields) {
      if (f.required && !form[f.key]) return ElMessage.warning('请填写' + f.label)
    }
  }
  const body: any = { submit }
  if (cfg.value.hasTitle) body.title = form.title
  for (const f of cfg.value.fields) body[f.key] = form[f.key]
  body.fileUrls = form.fileUrls

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
