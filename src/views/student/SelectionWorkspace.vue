<template>
  <div class="selection-workspace page-container">
    <section class="workspace-intro card-container">
      <div>
        <p class="eyebrow">学生选题工作台</p>
        <h1>找到适合自己的毕业设计方向</h1>
        <p class="intro-copy">先浏览和收藏，再排好志愿顺序。每一步都可以回看，不用一次记住所有规则。</p>
      </div>
      <div class="deadline-card">
        <span>填报截止</span>
        <strong>{{ deadlineLabel }}</strong>
        <small>{{ cycleStore.phaseInfo.label }}</small>
      </div>
    </section>

    <section class="progress-strip card-container" aria-label="选题进度">
      <div v-for="(step, index) in steps" :key="step.label" class="progress-step" :class="{ active: currentStep >= index, current: currentStep === index }">
        <span class="step-number">{{ index + 1 }}</span>
        <span>{{ step.label }}</span>
      </div>
    </section>

    <el-alert v-if="!isActivePhase" :title="`当前为「${cycleStore.phaseInfo.label}」阶段：可先浏览并整理志愿清单，正式提交需等到志愿填报阶段`" type="warning" :closable="false" show-icon class="phase-alert">
      你仍可以查看已收藏和已提交的记录；开放后再回来继续即可。
    </el-alert>
    <el-alert v-if="hasSubmittedVolunteers" :title="'已提交志愿：已锁定，仅可浏览课题与查看结果'" type="success" :closable="false" show-icon class="phase-alert">
      如需调整请联系管理员。
    </el-alert>
    <el-alert v-if="loadError" title="课题暂时加载失败" type="error" show-icon class="phase-alert" :closable="false">
      <template #default><el-button link type="danger" @click="loadData">重新加载</el-button></template>
    </el-alert>

    <div class="workspace-tabs" role="tablist" aria-label="选题内容">
      <el-button :type="activePanel === 'catalog' ? 'primary' : 'default'" @click="activePanel = 'catalog'">浏览课题</el-button>
      <el-button :type="activePanel === 'submitted' ? 'primary' : 'default'" @click="activePanel = 'submitted'">已提交志愿（{{ submittedApplications.length }}）</el-button>
    </div>

    <div v-if="activePanel === 'catalog'" class="catalog-layout">
      <main class="catalog-panel card-container">
        <div class="panel-heading">
          <div>
            <h2>浏览课题</h2>
            <p>把感兴趣的方向加入清单，再从中选择至少 3 个、至多 6 个不重复的课题作为志愿。</p>
          </div>
          <span class="result-count">{{ topicStore.filteredTopics.length }} 个结果</span>
        </div>
        <div class="filter-section">
          <el-input v-model="topicStore.searchKeyword" placeholder="搜索名称、方向或关键词" prefix-icon="Search" clearable size="large" />
          <el-select v-model="topicStore.selectedMajor" placeholder="专业方向" clearable size="large">
            <el-option v-for="major in availableMajorOptions" :key="major.value" :label="major.label" :value="major.value" />
          </el-select>
          <el-select v-model="topicStore.selectedCategory" placeholder="研究方向（随所选专业）" clearable size="large">
            <el-option v-for="cat in researchCategories" :key="cat" :label="cat" :value="cat" />
          </el-select>
          <el-select v-model="topicStore.selectedDifficulty" placeholder="难度" clearable size="large">
            <el-option label="简单" value="easy" /><el-option label="中等" value="medium" /><el-option label="困难" value="hard" />
          </el-select>
        </div>

        <div v-loading="topicStore.loading" class="topic-grid" aria-live="polite">
          <article v-for="topic in topicStore.filteredTopics" :key="topic.id" class="topic-card" :class="{ shortlisted: shortlistedIds.includes(topic.id) }">
            <div class="topic-topline"><el-tag :type="difficultyType[topic.difficulty]" size="small">{{ difficultyLabel[topic.difficulty] }}</el-tag><span class="quota">剩余 {{ Math.max(0, topic.maxStudents - topic.currentCount) }} 个名额</span></div>
            <h3>{{ topic.title }}</h3>
            <p class="topic-summary">{{ topic.description?.slice(0, 92) || '暂无简介' }}{{ topic.description?.length > 92 ? '…' : '' }}</p>
            <div class="topic-meta"><span>{{ topic.teacherName || '指导教师待定' }}</span><span>{{ topic.category }}</span></div>
            <div class="topic-actions">
              <el-button link type="primary" @click="openDetail(topic.id)">查看详情</el-button>
              <el-button v-if="shortlistedIds.includes(topic.id)" type="success" plain size="small" @click="focusBasket">已在清单</el-button>
              <el-button v-else type="primary" plain size="small" :disabled="hasSubmittedVolunteers" @click="addToShortlist(topic.id)">加入清单</el-button>
            </div>
          </article>
        </div>
        <el-empty v-if="!topicStore.loading && topicStore.filteredTopics.length === 0" description="没有匹配的课题，试试减少筛选条件" />
      </main>

      <aside class="basket-panel card-container" :class="{ 'locked-panel': hasSubmittedVolunteers }" aria-label="我的志愿清单">
        <div class="panel-heading compact"><div><h2>我的志愿清单</h2><p>已收藏 {{ shortlist.length }} 个</p></div><el-tag :type="selectedList.length >= VOLUNTEER_MIN ? 'success' : 'warning'">{{ selectedList.length }}/{{ VOLUNTEER_LIMIT }}</el-tag></div>
        <div v-if="shortlist.length === 0" class="basket-empty"><el-empty description="还没有收藏课题" :image-size="86"><el-button type="primary" plain @click="focusCatalog">从浏览开始</el-button></el-empty></div>
        <div v-else class="basket-list">
          <div v-for="item in shortlist" :key="item.id" class="basket-item" :class="{ chosen: isSelected(item.topic_id) }">
            <el-checkbox :model-value="isSelected(item.topic_id)" @change="toggleSelect(item.topic_id)">{{ isSelected(item.topic_id) ? `第${getPriority(item.topic_id)}志愿` : '加入志愿' }}</el-checkbox>
            <span class="basket-title">{{ item.title }}</span>
            <el-button text type="danger" size="small" aria-label="移除课题" @click="removeFromShortlist(item.id)">移除</el-button>
          </div>
        </div>
        <div class="submit-summary">
          <p v-if="selectedList.length < VOLUNTEER_MIN">至少还需选择 {{ VOLUNTEER_MIN - selectedList.length }} 个志愿（至多可填 {{ VOLUNTEER_LIMIT }} 个）。</p>
          <p v-else>已满足至少 {{ VOLUNTEER_MIN }} 个志愿，还可补至 {{ VOLUNTEER_LIMIT }} 个提高命中；拖动可调整志愿顺序，提交前请确认。</p>
          <p v-if="selectedList.length >= VOLUNTEER_MIN" class="rank-hint">按下面顺序录取：第 1 行为「第一志愿」（最优先），越靠上越优先。</p>
          <div v-if="selectedList.length" class="priority-list">
            <div
              v-for="(item, index) in selectedList"
              :key="item.topic_id"
              class="priority-item"
              :class="{ 'drag-over': dragOverIndex === index }"
              draggable="true"
              @dragstart="onDragStart(index, $event)"
              @dragover.prevent="onDragOver(index)"
              @dragleave="onDragLeave"
              @drop.prevent="onDrop(index)"
              @dragend="onDragEnd"
            >
              <el-icon class="drag-handle"><Rank /></el-icon>
              <span class="vol-rank" :class="{ first: index === 0 }">第{{ index + 1 }}志愿</span>
              <span class="priority-title">{{ item.title }}</span>
            </div>
          </div>
          <el-button type="primary" class="submit-button" :loading="submitting" :disabled="selectedList.length < VOLUNTEER_MIN" @click="confirmSubmit">确认并提交志愿</el-button>
          <el-button text class="full-width" @click="activePanel = 'submitted'">查看提交记录</el-button>
        </div>
      </aside>
    </div>

    <section v-else class="submitted-panel card-container">
      <div class="panel-heading"><div><h2>已提交志愿</h2><p>提交成功后会生成记录，教师审批结果将在“选课结果”中更新。</p></div><el-button type="primary" plain @click="activePanel = 'catalog'">继续浏览</el-button></div>
      <div v-if="successReceipt" class="success-receipt"><el-icon><CircleCheck /></el-icon><div><strong>志愿已提交</strong><p>凭证号：{{ successReceipt }}</p></div><el-button type="primary" @click="$router.push('/student/result')">查看结果</el-button></div>
      <el-empty v-if="submittedApplications.length === 0" description="还没有提交记录"><el-button type="primary" @click="activePanel = 'catalog'">去选择志愿</el-button></el-empty>
      <div v-else class="submitted-list">
        <div
          v-for="application in sortedSubmittedApplications"
          :key="application.id"
          class="submitted-item"
          :class="{ first: application.priority === 1 }"
        >
          <span class="vol-rank" :class="{ first: application.priority === 1 }">第{{ application.priority }}志愿</span>
          <div><strong>{{ application.topicTitle || application.topic_title }}</strong><p>{{ statusLabel[application.status] || application.status }}</p></div>
          <el-tag :type="statusType[application.status] || 'info'">{{ statusLabel[application.status] || '处理中' }}</el-tag>
        </div>
      </div>
    </section>

    <el-drawer v-model="detailVisible" title="课题详情" size="min(560px, 94vw)" @closed="onDetailClosed">
      <div v-if="currentDetail" v-loading="detailLoading" class="topic-detail">
        <h2 class="dd-title">{{ currentDetail.title }}</h2>
        <div class="dd-meta">
          <el-tag size="small">{{ currentDetail.category }}</el-tag>
          <el-tag :type="difficultyType[currentDetail.difficulty] || 'info'" size="small">{{ difficultyLabel[currentDetail.difficulty] || currentDetail.difficulty }}</el-tag>
          <el-tag :type="shortlistedIds.includes(currentDetail.id) ? 'success' : 'info'" size="small">
            {{ shortlistedIds.includes(currentDetail.id) ? '已在清单' : '未加入' }}
          </el-tag>
        </div>
        <el-descriptions :column="1" border class="dd-desc-items">
          <el-descriptions-item label="指导教师">
            {{ currentDetail.teacherName || '-' }}{{ currentDetail.teacherTitle ? `（${currentDetail.teacherTitle}）` : '' }}
          </el-descriptions-item>
          <el-descriptions-item label="专业方向">{{ currentDetail.major || '-' }}</el-descriptions-item>
          <el-descriptions-item label="招收名额">{{ currentDetail.maxStudents }} 人</el-descriptions-item>
        </el-descriptions>
        <h4 class="dd-h4">课题简介</h4>
        <p class="dd-text">{{ currentDetail.description || '暂无简介' }}</p>
        <h4 class="dd-h4">课题要求</h4>
        <p class="dd-text">{{ currentDetail.requirements || '详见发布说明' }}</p>
        <div v-if="currentDetail.tags?.length" class="dd-tags">
          <el-tag v-for="t in currentDetail.tags" :key="t" size="small" type="info">{{ t }}</el-tag>
        </div>
        <div class="dd-actions">
          <el-button
            v-if="!shortlistedIds.includes(currentDetail.id)"
            type="primary"
            :disabled="hasSubmittedVolunteers"
            @click="addToShortlist(currentDetail.id)"
          >加入志愿清单</el-button>
          <el-button
            v-else
            type="success"
            plain
            @click="goToBasketFromDetail"
          >已在清单 · 去整理志愿</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleCheck, Rank } from '@element-plus/icons-vue'
import { shortlistApi, applicationApi, cycleConfigApi } from '@/api'
import type { MajorConfig } from '../../types'
import { MAJOR_OPTIONS, RESEARCH_CATEGORIES, resolveTopicMajorCode } from '../../types'
import { useTopicStore } from '../../stores/topic'
import { useCycleStore } from '../../stores/cycle'

const topicStore = useTopicStore()
const cycleStore = useCycleStore()
const route = useRoute()
const router = useRouter()

// 当期“毕业专业/研究方向”配置（来自周期配置；接口不可用时用本地常量兜底）
const cycleMajors = ref<MajorConfig[] | null>(null)
const cycleResearch = ref<Record<string, string[]> | null>(null)
async function loadCycleConfig() {
  try {
    const cfgRes: any = await cycleConfigApi.get()
    cycleMajors.value = cfgRes?.data?.majors?.length ? cfgRes.data.majors : null
    cycleResearch.value = cfgRes?.data?.researchCategories || null
  } catch {
    cycleMajors.value = null
    cycleResearch.value = null
  }
}
const majorsOptions = computed(() => {
  const m = cycleMajors.value
  if (m?.length) return m.map(x => ({ value: x.code, label: `${x.name} (${x.code})`, code: x.code }))
  // 兜底：默认 4 专业（value=code 语义）
  return MAJOR_OPTIONS.map(o => ({ value: o.code, label: o.label, code: o.code }))
})

// 专业下拉 = 后端按周期“查看选题规则”算好的允许专业（不再依赖返回课题是否恰好带专业码）
const availableMajorOptions = computed(() => {
  const allowed = topicStore.allowedMajors
  if (allowed?.length) return allowed
  // 老后端未下发 allowedMajors 时兜底：按当前课题实际专业推算（名称→代码解析）
  const codes = new Set<string>()
  topicStore.topics.forEach((t: any) => { const c = resolveTopicMajorCode(t); if (c) codes.add(c) })
  return majorsOptions.value.filter(o => codes.has(o.code))
})
// 每名学生填报志愿的数量区间：至少 3 个、至多 6 个（不重复）
const VOLUNTEER_MIN = 3
const VOLUNTEER_LIMIT = 6
const shortlist = ref<any[]>([])
const selectedList = ref<any[]>([])
const submittedApplications = ref<any[]>([])
const submitting = ref(false)
const loadError = ref(false)
const activePanel = ref<'catalog' | 'submitted'>('catalog')
const successReceipt = ref(localStorage.getItem('gpss_selection_receipt') || '')
const steps = [{ label: '浏览' }, { label: '排顺序' }, { label: '提交' }, { label: '等结果' }]
const isActivePhase = computed(() => cycleStore.currentPhase === 'student_apply')
// 研究方向选项：随所选专业（代码）联动，来源为当期周期配置的研究方向
const researchCategories = computed(() => {
  const code = topicStore.selectedMajor
  if (code) {
    const list = (cycleResearch.value || {})[code] || RESEARCH_CATEGORIES[code]
    if (list?.length) return list
  }
  // 未选专业/该专业暂无方向：展示周期内全部方向
  const union = new Set<string>()
  const src = cycleResearch.value && Object.keys(cycleResearch.value).length ? cycleResearch.value : RESEARCH_CATEGORIES
  Object.values(src).forEach((arr: any) => (arr || []).forEach((c: string) => union.add(c)))
  return [...union]
})
// 切换专业时清空已选研究方向，避免“包装工程配视觉的方向”
watch(() => topicStore.selectedMajor, () => { topicStore.selectedCategory = '' })

// 仅能看到一个专业（同专业/单专业矩阵）时自动选中，避免空下拉或切到无课题专业
watch([() => topicStore.topics, () => topicStore.allowedMajors], () => {
  if (topicStore.selectedMajor) return
  const single = availableMajorOptions.value
  if (single.length === 1) topicStore.selectedMajor = single[0].value
})

// 已提交志愿（≥3 个在途）后进入“仅浏览”冻结态
const hasSubmittedVolunteers = computed(() =>
  submittedApplications.value.filter(a => ['pending', 'submitted', 'pending_review'].includes(a.status)).length >= VOLUNTEER_MIN
)
function assertNotSubmitted(): boolean {
  if (!hasSubmittedVolunteers.value) return true
  ElMessage.info('已提交志愿，仅可浏览；其他操作已锁定（如需调整请联系管理员）')
  return false
}
const shortlistedIds = computed(() => shortlist.value.map(item => item.topic_id))
const currentStep = computed(() => submittedApplications.value.length ? 3 : selectedList.value.length ? 1 : 0)
const deadlineLabel = computed(() => cycleStore.currentCycle?.studentApplyEnd ? String(cycleStore.currentCycle.studentApplyEnd).slice(0, 10) : '以系统阶段为准')
const difficultyLabel: Record<string, string> = { easy: '入门友好', medium: '适中', hard: '挑战型' }
const difficultyType: Record<string, any> = { easy: 'success', medium: 'warning', hard: 'danger' }
const statusLabel: Record<string, string> = { pending: '等待教师处理', submitted: '等待教师处理', pending_review: '等待教师处理', accepted: '已录取', rejected: '未录取', waitlisted: '候补待定', withdrawn: '已撤回' }
const statusType: Record<string, any> = { pending: 'warning', submitted: 'warning', pending_review: 'warning', accepted: 'success', rejected: 'danger', waitlisted: 'info', withdrawn: 'info' }

// 已提交志愿按志愿序号(第1志愿→第6志愿)排列，方便看清录取顺序
const sortedSubmittedApplications = computed(() =>
  [...submittedApplications.value].sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))
)

async function loadData() {
  loadError.value = false
  try {
    await topicStore.fetchTopics({ page: 1, pageSize: 100 })
    const [shortlistRes, applicationRes] = await Promise.all([shortlistApi.getList(), applicationApi.getList()])
    shortlist.value = shortlistRes.data || []
    submittedApplications.value = applicationRes.data || []
  } catch (error) {
    console.error('选题工作台加载失败:', error)
    loadError.value = true
  }
}

function isSelected(topicId: string) { return selectedList.value.some(item => item.topic_id === topicId) }
function getPriority(topicId: string) { return selectedList.value.findIndex(item => item.topic_id === topicId) + 1 }
function toggleSelect(topicId: string) {
  if (!assertNotSubmitted()) return
  const item = shortlist.value.find(entry => entry.topic_id === topicId)
  if (!item) return
  if (isSelected(topicId)) selectedList.value = selectedList.value.filter(entry => entry.topic_id !== topicId)
  else if (selectedList.value.length < VOLUNTEER_LIMIT) selectedList.value = [...selectedList.value, item]
  else ElMessage.info(`每个学生最多填报 ${VOLUNTEER_LIMIT} 个志愿`)
}

// 拖拽调整志愿顺序
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
function onDragStart(index: number, e: DragEvent) {
  if (!assertNotSubmitted()) return
  dragIndex.value = index
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }
}
function onDragOver(index: number) { dragOverIndex.value = index }
function onDragLeave() { dragOverIndex.value = null }
function onDrop(index: number) {
  if (dragIndex.value === null || dragIndex.value === index) {
    dragOverIndex.value = null
    return
  }
  const list = [...selectedList.value]
  const [moved] = list.splice(dragIndex.value, 1)
  list.splice(index, 0, moved)
  selectedList.value = list
  dragIndex.value = null
  dragOverIndex.value = null
}
function onDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}
async function addToShortlist(topicId: string) {
  if (!assertNotSubmitted()) return
  try { await shortlistApi.add(topicId); await loadData(); ElMessage.success('已加入志愿清单') }
  catch (error: any) { ElMessage.error(error?.response?.data?.message || '加入失败，请稍后重试') }
}

// 右侧抽屉查看课题详情（不跳转）
const detailVisible = ref(false)
const detailLoading = ref(false)
const currentDetail = computed(() => topicStore.currentTopic)
async function openDetail(topicId: string) {
  detailVisible.value = true
  detailLoading.value = true
  try { await topicStore.fetchTopicDetail(topicId) } finally { detailLoading.value = false }
}
function onDetailClosed() { topicStore.currentTopic = null }
function goToBasketFromDetail() {
  detailVisible.value = false
  focusBasket()
}
async function removeFromShortlist(id: string) {
  if (!assertNotSubmitted()) return
  try { await shortlistApi.remove(id); shortlist.value = shortlist.value.filter(item => item.id !== id); selectedList.value = selectedList.value.filter(item => shortlist.value.some(entry => entry.topic_id === item.topic_id)); ElMessage.success('已从清单移除') }
  catch (error: any) { ElMessage.error(error?.response?.data?.message || '移除失败，请重试') }
}
function focusBasket() { document.querySelector('.basket-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
function focusCatalog() { document.querySelector('.catalog-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
async function confirmSubmit() {
  if (!isActivePhase.value) {
    ElMessage.warning('当前不是志愿填报阶段，无法提交；请等周期进入选课阶段后再提交')
    return
  }
  if (!assertNotSubmitted()) return
  await ElMessageBox.confirm(`提交后将按当前顺序生成 ${selectedList.value.length} 个志愿（要求不少于 ${VOLUNTEER_MIN} 个、至多 ${VOLUNTEER_LIMIT} 个），确认顺序无误后再提交。`, '确认志愿顺序', { confirmButtonText: '确认提交', cancelButtonText: '再检查一下', type: 'info' })
  submitting.value = true
  try {
    // 原子整批提交：全部成功才算提交成功；任一失败则整批不写入，保留清单可重试
    const volunteers = selectedList.value.map((item, index) => ({ topicId: item.topic_id, priority: index + 1 }))
    await applicationApi.submitVolunteers(volunteers)
    successReceipt.value = `SEL-${Date.now().toString(36).toUpperCase()}`
    localStorage.setItem('gpss_selection_receipt', successReceipt.value)
    await loadData()
    selectedList.value = []
    ElMessage.success(`志愿提交成功（${volunteers.length} 个），已生成提交凭证`)
    router.push('/student/result')
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.message || '提交失败，请检查后重试（未提交任何志愿）')
  }
  finally { submitting.value = false }
}
onMounted(async () => {
  loadCycleConfig()
  await loadData()
  // 支持从“热门课题”等入口 ?open=课题id 直达详情抽屉（统一到新工作台）
  const openId = route.query.open
  if (openId) {
    const ok = await topicStore.fetchTopicDetail(String(openId))
    if (ok) detailVisible.value = true
  }
})
// 支持 ?panel=submitted 直达「已提交志愿」面板（合并入口后，原“我的志愿”跳转落点）
watch(() => route.query.panel, (panel) => {
  if (panel === 'submitted' || panel === 'catalog') activePanel.value = panel
}, { immediate: true })
watch([() => topicStore.selectedCategory, () => topicStore.selectedDifficulty, () => topicStore.selectedMajor], () => topicStore.fetchTopics({ page: 1, pageSize: 100 }))
</script>

<style scoped>
.selection-workspace { max-width: 1440px; }
.workspace-intro { display: flex; justify-content: space-between; gap: 24px; align-items: center; background: #fff; }
.eyebrow { color: var(--accent-color); font-weight: 700; letter-spacing: .08em; font-size: 12px; margin-bottom: 8px; }
.workspace-intro h1 { color: var(--primary-color); font-size: clamp(24px, 3vw, 34px); margin-bottom: 8px; }
.intro-copy, .panel-heading p { color: var(--text-secondary); line-height: 1.6; }
.deadline-card { min-width: 170px; padding: 16px; border-radius: 10px; background: #f6f0e9; color: #7c4322; }
.deadline-card span, .deadline-card small { display: block; font-size: 12px; }
.deadline-card strong { display: block; font-size: 20px; margin: 6px 0; }
.progress-strip { display: flex; gap: 0; justify-content: space-between; margin-top: 16px; padding: 16px 24px; }
.progress-step { display: flex; align-items: center; gap: 8px; color: #94a3b8; font-size: 14px; position: relative; flex: 1; }
.progress-step:not(:last-child)::after { content: ''; height: 2px; background: #e2e8f0; flex: 1; margin: 0 12px; }
.progress-step.active { color: var(--primary-color); font-weight: 600; }
.progress-step.active:not(:last-child)::after { background: #c9d8e4; }
.step-number { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; background: #e2e8f0; color: #64748b; }
.active .step-number { background: var(--primary-color); color: #fff; }
.phase-alert { margin-top: 16px; }
.workspace-tabs { display: flex; gap: 8px; margin: 18px 0 12px; }
.catalog-layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 18px; align-items: start; }
.panel-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
.panel-heading.compact { margin-bottom: 12px; }
.panel-heading h2 { color: var(--primary-color); font-size: 20px; margin-bottom: 4px; }
.result-count { color: var(--text-secondary); font-size: 13px; }
.filter-section { display: grid; grid-template-columns: minmax(180px, 1fr) 150px 150px 120px; gap: 10px; margin-bottom: 18px; }
.topic-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; min-height: 120px; }
.topic-card { border: 1px solid var(--border-color); border-radius: 10px; padding: 16px; background: #fff; transition: border-color .2s, box-shadow .2s; }
.topic-card:hover, .topic-card.shortlisted { border-color: #c4d5e2; box-shadow: 0 8px 22px rgba(23, 50, 77, .08); }
.topic-topline, .topic-meta, .topic-actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.quota { color: var(--success-color); font-size: 12px; }
.topic-card h3 { color: var(--text-primary); line-height: 1.45; font-size: 16px; margin: 12px 0 8px; }
.topic-summary { color: var(--text-secondary); font-size: 13px; line-height: 1.6; min-height: 42px; }
.topic-meta { color: var(--text-secondary); font-size: 12px; margin: 12px 0; }
.topic-actions { border-top: 1px solid #edf1f4; padding-top: 10px; }
.basket-panel { position: sticky; top: 16px; }
.basket-empty { padding: 20px 0; }
.basket-list { display: flex; flex-direction: column; gap: 8px; }
.basket-item { padding: 10px; border: 1px solid #e6edf2; border-radius: 8px; background: #fafcfd; }
.basket-item.chosen { border-color: #bed8d2; background: #f1f8f6; }
.basket-title { display: block; margin: 7px 0 4px; color: var(--text-primary); font-size: 13px; line-height: 1.45; }
.submit-summary { border-top: 1px solid var(--border-color); margin-top: 16px; padding-top: 14px; color: var(--text-secondary); font-size: 13px; }
.priority-list { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; }
.priority-item { display: flex; align-items: center; gap: 8px; color: var(--text-primary); padding: 8px 10px; background: #fff; border: 1px dashed transparent; border-radius: 6px; cursor: grab; transition: background .15s, border-color .15s; }
.priority-item:hover { background: #f5f7fa; }
.priority-item:active { cursor: grabbing; }
.priority-item.drag-over { border-color: var(--primary-color); background: #eaf2f8; }
.priority-item .drag-handle { color: #b0b8c1; font-size: 16px; flex-shrink: 0; cursor: grab; }
.priority-list b, .priority-badge { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; color: #fff; background: var(--primary-color); font-size: 12px; flex-shrink: 0; }
.priority-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rank-hint { margin: 6px 0 2px; font-size: 12px; color: #e6a23c; }
.vol-rank { display: inline-flex; align-items: center; justify-content: center; min-width: 70px; padding: 2px 10px; border-radius: 999px; font-size: 12px; line-height: 1.7; color: var(--text-secondary); background: #f2f3f5; flex-shrink: 0; }
.vol-rank.first { color: #fff; background: #f56c6c; font-weight: 600; }
.submitted-item.first { background: #fef6f6; }
.topic-detail { padding: 2px 6px 24px; }
.dd-title { margin: 0 0 10px; font-size: 20px; line-height: 1.4; color: var(--text-primary); }
.dd-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.dd-desc-items { margin-bottom: 6px; }
.dd-h4 { margin: 18px 0 6px; color: var(--text-primary); }
.dd-text { color: var(--text-secondary); font-size: 13px; line-height: 1.7; white-space: pre-wrap; margin: 0; }
.dd-tags { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
.dd-actions { margin-top: 24px; display: flex; }
.locked-panel { pointer-events: none; opacity: 0.72; filter: grayscale(0.3); }
.submit-button, .full-width { width: 100%; }
.submitted-panel { margin-top: 16px; }
.success-receipt { display: flex; align-items: center; gap: 14px; border: 1px solid #c6e5dc; background: #f1f8f6; color: var(--success-color); border-radius: 10px; padding: 16px; margin-bottom: 16px; }
.success-receipt .el-icon { font-size: 28px; }
.success-receipt div { flex: 1; }.success-receipt p { font-size: 12px; margin-top: 4px; }
.submitted-list { display: flex; flex-direction: column; gap: 10px; }
.submitted-item { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #edf1f4; padding: 12px 0; }
.submitted-item > div { flex: 1; }.submitted-item p { color: var(--text-secondary); font-size: 12px; margin-top: 4px; }
@media (max-width: 1024px) { .catalog-layout { grid-template-columns: 1fr; }.basket-panel { position: static; }.filter-section { grid-template-columns: 1fr 1fr; } }
@media (max-width: 600px) { .workspace-intro { flex-direction: column; align-items: stretch; }.deadline-card { min-width: 0; }.progress-strip { padding: 12px; }.progress-step { font-size: 11px; }.progress-step:not(:last-child)::after { margin: 0 4px; }.filter-section { grid-template-columns: 1fr; }.catalog-panel, .basket-panel, .submitted-panel { padding: 14px; }.submitted-item { align-items: flex-start; flex-wrap: wrap; }.submitted-item > .el-tag { margin-left: 36px; } }
</style>
