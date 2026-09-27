<template>
  <div class="adjustment page-container"><div class="card-container">
    <h2 class="section-title">调剂志愿</h2>
    <el-alert :title="frozen ? '教师名单已提交或结算已开始，调剂志愿已冻结。' : '请提交 3 至 6 个本专业课题，并至少覆盖两位教师。'" :type="frozen ? 'warning' : 'info'" :closable="false" show-icon style="margin-bottom:20px" />
    <el-table :data="topics" stripe v-loading="loading" empty-text="暂无可填报的本专业课题">
      <el-table-column prop="title" label="课题名称" min-width="260" />
      <el-table-column prop="category" label="研究方向" width="160" />
      <el-table-column label="剩余名额" width="100"><template #default="{ row }">{{ row.maxStudents - row.currentCount }} 人</template></el-table-column>
      <el-table-column label="操作" width="120"><template #default="{ row }"><el-button link type="primary" :disabled="frozen || isChosen(row.id)" @click="add(row)">{{ isChosen(row.id) ? '已加入' : '加入志愿' }}</el-button></template></el-table-column>
    </el-table>
    <h3 style="margin:28px 0 12px">我的调剂志愿（{{ items.length }}/6）</h3>
    <el-empty v-if="!items.length" description="请选择 3 至 6 个课题，并至少覆盖两位教师" />
    <div v-for="(item, index) in items" :key="item.topicId" class="volunteer-row">
      <strong>第 {{ index + 1 }} 志愿</strong><span>{{ item.title }}</span>
      <el-input v-model="item.motivation" :disabled="frozen" placeholder="填写调剂理由" maxlength="500" show-word-limit />
      <el-button link type="primary" :disabled="frozen || index === 0" @click="move(index, -1)">上移</el-button><el-button link type="primary" :disabled="frozen || index === items.length - 1" @click="move(index, 1)">下移</el-button><el-button link type="danger" :disabled="frozen" @click="items.splice(index, 1)">移除</el-button>
    </div>
    <p class="hint">提交后等待教师遴选和统一结算；不显示教师草稿决定。</p>
    <el-button type="primary" :loading="saving" :disabled="frozen || items.length < 3 || items.length > 6" @click="save">保存调剂志愿</el-button>
  </div></div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adjustmentVolunteerApi } from '@/api'
type TopicItem = { id: string; title: string; category: string; maxStudents: number; currentCount: number; teacherGroupKey: string }
type VolunteerItem = { topicId: string; title: string; motivation: string; teacherGroupKey: string }
const loading = ref(false), saving = ref(false), topics = ref<TopicItem[]>([]), items = ref<VolunteerItem[]>([]), version = ref(0), frozen = ref(false)
const isChosen = (id: string) => items.value.some(item => item.topicId === id)
function add(topic: TopicItem) { if (items.value.length >= 6) return ElMessage.warning('最多填报 6 个调剂志愿'); items.value.push({ topicId: topic.id, title: topic.title, teacherGroupKey: topic.teacherGroupKey, motivation: '' }) }
function move(index: number, direction: number) { const [item] = items.value.splice(index, 1); items.value.splice(index + direction, 0, item) }
async function load() { loading.value = true; try { const [topicRes, mineRes]: any[] = await Promise.all([adjustmentVolunteerApi.getEligibleTopics(), adjustmentVolunteerApi.getMine()]); topics.value = topicRes.data || []; version.value = Number(mineRes.data?.version || 0); frozen.value = Boolean(mineRes.data?.frozen); items.value = (mineRes.data?.items || []).map((item: any) => ({ topicId: item.topicId, title: item.title, motivation: item.motivation, teacherGroupKey: item.teacherGroupKey })) } catch (cause: any) { ElMessage.error(cause?.response?.data?.message || '调剂信息加载失败') } finally { loading.value = false } }
async function save() { if (new Set(items.value.map(item => item.teacherGroupKey)).size < 2) return ElMessage.warning('调剂志愿至少覆盖两位教师'); if (items.value.some(item => !item.motivation.trim())) return ElMessage.warning('请填写每个课题的调剂理由'); saving.value = true; try { const res: any = await adjustmentVolunteerApi.saveMine({ version: version.value, items: items.value.map((item, index) => ({ topicId: item.topicId, priority: index + 1, motivation: item.motivation })) }); version.value = Number(res.data?.version || items.value.length); frozen.value = Boolean(res.data?.frozen); ElMessage.success('调剂志愿已保存，等待教师遴选') } catch (cause: any) { ElMessage.error(cause?.response?.data?.message || '保存失败') } finally { saving.value = false } }
onMounted(load)
</script>
<style scoped>.volunteer-row{display:grid;grid-template-columns:90px minmax(150px,1fr) minmax(220px,2fr) auto auto auto;gap:10px;align-items:center;padding:12px 0;border-bottom:1px solid #ebeef5}.hint{color:#909399;font-size:13px}@media(max-width:800px){.volunteer-row{grid-template-columns:1fr}}</style>
