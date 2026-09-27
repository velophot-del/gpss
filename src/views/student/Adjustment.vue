<template>
  <div class="page-container adjustment-page">
    <div class="card-container">
      <div class="page-heading">
        <div><h2 class="section-title">调剂志愿</h2><p>仅显示本专业仍有名额的已发布课题。请选择 3–6 项并覆盖至少两位教师。</p></div>
        <el-tag v-if="deadline" type="info">截止 {{ formatDeadline(deadline) }}</el-tag>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="warning" :closable="false" show-icon />
      <el-alert v-else-if="!adjustmentStore.mine.canEdit && adjustmentStore.mine.frozenReason" :title="adjustmentStore.mine.frozenReason" type="info" :closable="false" show-icon />
      <el-alert v-if="adjustmentStore.mine.settlement?.status === 'completed'" title="调剂结算已完成，请到选课结果查看结果。" type="success" :closable="false" show-icon />

      <div class="toolbar">
        <span>可选课题 {{ adjustmentStore.eligibleTopics.length }} 个</span>
        <el-tag :type="selected.length >= 3 ? 'success' : 'warning'">已选 {{ selected.length }}/6</el-tag>
        <el-tag :type="teacherCount >= 2 ? 'success' : 'warning'">覆盖教师 {{ teacherCount }}/至少 2 位</el-tag>
        <el-button type="primary" :disabled="!adjustmentStore.mine.canEdit" :loading="saving" @click="save">保存调剂志愿</el-button>
      </div>

      <el-table v-loading="adjustmentStore.loading" :data="adjustmentStore.eligibleTopics" row-key="id" stripe empty-text="当前没有符合条件的课题">
        <el-table-column label="选择" width="72" align="center">
          <template #default="{ row }"><el-checkbox :model-value="isSelected(row.id)" :disabled="!adjustmentStore.mine.canEdit || (!isSelected(row.id) && selected.length >= 6)" @change="toggle(row)" /></template>
        </el-table-column>
        <el-table-column prop="title" label="课题" min-width="200" />
        <el-table-column prop="category" label="方向" width="140" />
        <el-table-column prop="major" label="专业" width="140" />
        <el-table-column label="剩余名额" width="110"><template #default="{ row }">{{ Math.max(0, row.maxStudents - row.currentCount) }}</template></el-table-column>
        <el-table-column label="简介" min-width="230" show-overflow-tooltip><template #default="{ row }">{{ row.description || '—' }}</template></el-table-column>
      </el-table>

      <section v-if="selected.length" class="selected-section">
        <h3>我的调剂志愿（按顺序）</h3>
        <div v-for="(item, index) in selected" :key="item.topicId" class="selected-row">
          <div class="priority-controls">
            <el-tag type="primary">第 {{ index + 1 }} 志愿</el-tag>
            <el-button link :disabled="index === 0 || !adjustmentStore.mine.canEdit" @click="move(index, -1)">上移</el-button>
            <el-button link :disabled="index === selected.length - 1 || !adjustmentStore.mine.canEdit" @click="move(index, 1)">下移</el-button>
            <el-button link type="danger" :disabled="!adjustmentStore.mine.canEdit" @click="remove(index)">移除</el-button>
          </div>
          <div class="topic-title">{{ item.title }}</div>
          <el-input v-model="item.motivation" :disabled="!adjustmentStore.mine.canEdit" maxlength="500" show-word-limit type="textarea" :rows="2" placeholder="填写选择该课题的理由" />
        </div>
      </section>
      <el-empty v-else description="请从上方选择调剂课题" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAdjustmentVolunteerStore } from '@/stores/adjustmentVolunteer'
import { useCycleStore } from '@/stores/cycle'

const adjustmentStore = useAdjustmentVolunteerStore()
const cycleStore = useCycleStore()
const selected = ref<any[]>([])
const saving = ref(false)
const errorMessage = ref('')
const deadline = ref('')
const teacherCount = computed(() => new Set(selected.value.map(item => item.teacherGroupKey).filter(Boolean)).size)
const isSelected = (topicId: string) => selected.value.some(item => item.topicId === topicId)

function toggle(topic: any) {
  if (isSelected(topic.id)) return remove(selected.value.findIndex(item => item.topicId === topic.id))
  if (selected.value.length >= 6) return
  selected.value.push({ topicId: topic.id, title: topic.title, teacherGroupKey: topic.teacherGroupKey, motivation: '' })
}
function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= selected.value.length) return
  const [item] = selected.value.splice(index, 1)
  selected.value.splice(target, 0, item)
}
function remove(index: number) { if (index >= 0) selected.value.splice(index, 1) }
function formatDeadline(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }

async function save() {
  errorMessage.value = ''
  if (selected.value.length < 3 || selected.value.length > 6) return ElMessage.warning('请选择 3–6 个调剂志愿')
  if (teacherCount.value < 2) return ElMessage.warning('调剂志愿须至少覆盖两位不同教师')
  saving.value = true
  try {
    await adjustmentStore.save(selected.value.map(item => ({ topicId: item.topicId, motivation: item.motivation })))
    ElMessage.success('调剂志愿已保存')
  } catch (cause: any) {
    errorMessage.value = cause?.response?.data?.message || '保存失败，请刷新后重试'
    ElMessage.error(errorMessage.value)
    await adjustmentStore.loadMine().catch(() => null)
  } finally { saving.value = false }
}

onMounted(async () => {
  await cycleStore.fetchCurrentCycle()
  await adjustmentStore.loadMine().catch((cause: any) => { errorMessage.value = cause?.response?.data?.message || '无法读取调剂资格' })
  try {
    const data = await adjustmentStore.loadEligibleTopics()
    deadline.value = data?.deadline || ''
  } catch (cause: any) {
    if (!errorMessage.value) errorMessage.value = cause?.response?.data?.message || '当前无法加载可选课题'
  }
  selected.value = (adjustmentStore.mine.items || []).map((item: any) => ({
    topicId: item.topicId, title: item.title, teacherGroupKey: item.teacherGroupKey || adjustmentStore.eligibleTopics.find((topic: any) => topic.id === item.topicId)?.teacherGroupKey,
    motivation: item.motivation || '',
  }))
})
</script>

<style scoped>
.page-heading,.toolbar,.priority-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.page-heading{justify-content:space-between;margin-bottom:18px}.page-heading p{color:#7b8492;margin:0}.toolbar{justify-content:flex-end;margin:18px 0}.toolbar>span{margin-right:auto;color:#606a78}.selected-section{margin-top:26px}.selected-section h3{margin:0 0 14px}.selected-row{display:grid;grid-template-columns:minmax(250px,1fr) 2fr;gap:12px 18px;padding:14px 0;border-bottom:1px solid #ebeef5}.priority-controls{grid-column:1/-1}.topic-title{font-weight:600;align-self:start}@media(max-width:700px){.selected-row{grid-template-columns:1fr}.priority-controls{grid-column:auto}}
</style>
