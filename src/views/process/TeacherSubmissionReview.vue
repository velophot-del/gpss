<template>
  <div class="process-page">
    <el-card shadow="never">
      <template #header>
        <div class="page-header"><span class="title">{{ cfg.reviewLabel }} · 审核</span></div>
      </template>

      <el-table :data="list" v-loading="loading" border>
        <el-table-column label="学生" min-width="130">
          <template #default="{ row }">{{ row.studentName }}（{{ row.studentCode }}）</template>
        </el-table-column>
        <el-table-column label="班级 / 专业" min-width="150">
          <template #default="{ row }">{{ row.className }} / {{ row.major }}</template>
        </el-table-column>
        <el-table-column prop="topicTitle" label="选题" min-width="200" show-overflow-tooltip />
        <el-table-column v-if="cfg.hasTitle" prop="title" label="标题" min-width="180" show-overflow-tooltip />
        <el-table-column v-if="cfg.hasScore" prop="score" label="评分" width="80">
          <template #default="{ row }">{{ row.score ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" effect="dark" round size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openReview(row)">查看 / 审核</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="'审核：' + (current?.studentName || '')" width="620px">
      <el-descriptions :column="1" border size="small" class="mb16">
        <el-descriptions-item v-if="cfg.hasTitle" label="标题">{{ current?.title }}</el-descriptions-item>
        <el-descriptions-item v-for="f in cfg.fields" :key="f.key" :label="f.label">
          <div class="pre">{{ current?.[f.key] || '—' }}</div>
        </el-descriptions-item>
      </el-descriptions>

      <el-form label-width="90px">
        <el-form-item v-if="cfg.hasScore" label="评分">
          <el-input-number v-model="reviewForm.score" :min="0" :max="100" />
        </el-form-item>
        <el-form-item label="审核结论">
          <el-radio-group v-model="reviewForm.status">
            <el-radio-button :label="cfg.reviewPass">通过</el-radio-button>
            <el-radio-button label="need_revision">退回修改</el-radio-button>
            <el-radio-button :label="cfg.reviewReject">不通过</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="评语">
          <el-input v-model="reviewForm.comment" type="textarea" :rows="3" placeholder="填写审核意见" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="reviewing" @click="submitReview">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { STAGE_CONFIGS } from './processConfig'
import { SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_TAG } from '../../types'

const props = defineProps<{ stage: string }>()
const cfg = computed(() => STAGE_CONFIGS[props.stage] || STAGE_CONFIGS.proposal)

const loading = ref(false)
const reviewing = ref(false)
const list = ref<any[]>([])
const dialogVisible = ref(false)
const current = ref<any>(null)

const reviewForm = reactive<{ status: string; comment: string; score: number | null }>({
  status: '',
  comment: '',
  score: null
})

function statusLabel(s: string) { return SUBMISSION_STATUS_LABELS[s] || s }
function statusTagType(s: string): any { return SUBMISSION_STATUS_TAG[s] || 'info' }

async function load() {
  loading.value = true
  try {
    const res: any = await cfg.value.api.getList()
    list.value = res.data || []
  } catch (e) {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}

function openReview(row: any) {
  current.value = row
  reviewForm.status = cfg.value.reviewPass
  reviewForm.comment = ''
  reviewForm.score = cfg.value.hasScore ? (row.score ?? null) : null
  dialogVisible.value = true
}

async function submitReview() {
  if (!current.value) return
  reviewing.value = true
  try {
    const body: any = { status: reviewForm.status, comment: reviewForm.comment }
    if (cfg.value.hasScore) body.score = reviewForm.score
    await cfg.value.api.review(current.value.id, body)
    ElMessage.success('审核完成')
    dialogVisible.value = false
    await load()
  } catch (e) {
    // 拦截器已提示
  } finally {
    reviewing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.process-page {
  max-width: 100%;
}
.page-header .title {
  font-size: 16px;
  font-weight: 600;
}
.mb16 {
  margin-bottom: 16px;
}
.mr8 {
  margin-right: 8px;
}
.pre {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
