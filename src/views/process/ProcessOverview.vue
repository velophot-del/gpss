<template>
  <div class="process-overview">
    <!-- 阶段流程 -->
    <el-card shadow="never" class="mb16">
      <template #header>
        <div class="page-header">
          <span class="title">毕业全流程进度</span>
          <el-select v-if="graduationCycles.length" v-model="selectedCycleId" aria-label="选择毕业设计周期" placeholder="选择毕业设计周期" style="width: 280px">
            <el-option v-for="cycle in graduationCycles" :key="cycle.id" :label="cycle.name" :value="cycle.id" />
          </el-select>
        </div>
      </template>
      <el-empty v-if="!selectedCycle" description="暂无毕业设计周期" />
      <template v-else>
      <el-steps :active="activeStep" align-center finish-status="success">
        <el-step v-for="p in phases" :key="p.value" :title="p.label" />
      </el-steps>
      <div class="phase-tip">
        当前阶段：<el-tag effect="dark" round size="small">{{ currentPhaseLabel }}</el-tag>
        <span class="tip-desc">{{ selectedCycle.name }} · 由管理员在「毕业设计周期管理」中切换阶段</span>
      </div>
      </template>
    </el-card>

    <!-- 统计卡片 -->
    <el-row :gutter="16" v-loading="loading">
      <el-col v-for="c in cards" :key="c.label" :xs="12" :sm="8" :md="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-value" :style="{ color: c.color }">{{ c.value }}</div>
          <div class="stat-label">{{ c.label }}</div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useCycleStore } from '../../stores/cycle'
import { PROCESS_PHASES, PROCESS_PHASE_LABELS } from '../../types'
import { adminApi, proposalApi, midtermApi, defenseApi, gradeApi } from '../../api'

const cycleStore = useCycleStore()
const loading = ref(false)
const selectedCycleId = ref<string | number>('')
const graduationPhases = new Set(PROCESS_PHASES.slice(4).map(phase => phase.value).concat('ended'))
const graduationCycles = computed(() => cycleStore.cycles.filter(cycle => cycle.status === 'process' || graduationPhases.has(cycle.phase)))
const selectedCycle = computed(() => graduationCycles.value.find(cycle => String(cycle.id) === String(selectedCycleId.value)) || null)

const phases = PROCESS_PHASES
const activeStep = computed(() => {
  const aliases: Record<string, string> = { student_apply: 'student_selection', result_announce: 'result', completed: 'ended' }
  const phase = selectedCycle.value?.phase || 'none'
  const idx = PROCESS_PHASES.findIndex(p => p.value === (aliases[phase] || phase))
  return idx < 0 ? 0 : idx
})
const currentPhaseLabel = computed(() => PROCESS_PHASE_LABELS[selectedCycle.value?.phase || ''] || '未开始')

const stats = reactive({
  students: 0,
  accepted: 0,
  proposals: 0,
  midterm: 0,
  defenseGroups: 0,
  grades: 0
})
let loadVersion = 0

const cards = computed(() => [
  { label: '本周期学生', value: stats.students, color: '#409eff' },
  { label: '已录取', value: stats.accepted, color: '#67c23a' },
  { label: '开题提交', value: stats.proposals, color: '#e6a23c' },
  { label: '中期提交', value: stats.midterm, color: '#e6a23c' },
  { label: '答辩分组', value: stats.defenseGroups, color: '#909399' },
  { label: '成绩记录', value: stats.grades, color: '#909399' }
])

async function load() {
  if (!selectedCycle.value) return
  const cycleId = selectedCycleId.value
  const version = ++loadVersion
  loading.value = true
  try {
    const [stu, apps, props_, mid, groups, grades] = await Promise.allSettled([
      adminApi.getAllApplications(),
      proposalApi.getList(),
      midtermApi.getList(),
      defenseApi.getGroups(),
      gradeApi.getList()
    ])

    const v = (r: PromiseSettledResult<any>) => (r.status === 'fulfilled' ? r.value?.data : undefined)

    if (version !== loadVersion || String(selectedCycleId.value) !== String(cycleId)) return
    const cycleRows = (rows: any[]) => (rows || []).filter(row => String(row.cycle_id ?? row.cycleId) === String(cycleId))
    const accepted = cycleRows(v(apps)).filter((row: any) => row.status === 'accepted')
    stats.students = new Set(accepted.map((row: any) => row.student_id ?? row.studentId)).size
    stats.accepted = accepted.length
    stats.proposals = cycleRows(v(props_)).filter((row: any) => row.status === 'submitted' || row.status === 'approved').length
    stats.midterm = cycleRows(v(mid)).filter((row: any) => row.status === 'submitted' || row.status === 'passed').length
    stats.defenseGroups = cycleRows(v(groups)).length
    stats.grades = cycleRows(v(grades)).length
  } finally {
    if (version === loadVersion) loading.value = false
  }
}

watch(selectedCycleId, load)

onMounted(async () => {
  await cycleStore.fetchAllCycles()
  const initial = graduationCycles.value.find(cycle => cycle.status === 'process') || graduationCycles.value[0]
  if (initial) selectedCycleId.value = initial.id
})
</script>

<style scoped>
.mb16 {
  margin-bottom: 16px;
}
.page-header .title {
  font-size: 16px;
  font-weight: 600;
}
.page-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.phase-tip {
  margin-top: 20px;
  text-align: center;
  color: #606266;
  font-size: 14px;
}
.tip-desc {
  margin-left: 12px;
  color: #909399;
  font-size: 12px;
}
.stat-card {
  text-align: center;
  margin-bottom: 16px;
}
.stat-value {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.2;
}
.stat-label {
  color: #909399;
  font-size: 13px;
  margin-top: 6px;
}
</style>
