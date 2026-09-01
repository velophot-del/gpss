<template>
  <div class="process-overview">
    <!-- 阶段流程 -->
    <el-card shadow="never" class="mb16">
      <template #header>
        <div class="page-header"><span class="title">毕业全流程进度</span></div>
      </template>
      <el-steps :active="activeStep" align-center finish-status="success">
        <el-step v-for="p in phases" :key="p.value" :title="p.label" />
      </el-steps>
      <div class="phase-tip">
        当前阶段：<el-tag effect="dark" round size="small">{{ currentPhaseLabel }}</el-tag>
        <span class="tip-desc">由管理员在「选题周期」中手动切换阶段</span>
      </div>
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
import { ref, reactive, computed, onMounted } from 'vue'
import { useCycleStore } from '../../stores/cycle'
import { PROCESS_PHASES, PROCESS_PHASE_LABELS } from '../../types'
import { adminApi, applicationApi, proposalApi, midtermApi, defenseApi, gradeApi } from '../../api'

const cycleStore = useCycleStore()
const loading = ref(false)

const phases = PROCESS_PHASES
const activeStep = computed(() => {
  const idx = PROCESS_PHASES.findIndex(p => p.value === cycleStore.currentPhase)
  return idx < 0 ? 0 : idx
})
const currentPhaseLabel = computed(() => PROCESS_PHASE_LABELS[cycleStore.currentPhase] || '未开始')

const stats = reactive({
  students: 0,
  accepted: 0,
  proposals: 0,
  midterm: 0,
  defenseGroups: 0,
  grades: 0
})

const cards = computed(() => [
  { label: '学生总数', value: stats.students, color: '#409eff' },
  { label: '已录取', value: stats.accepted, color: '#67c23a' },
  { label: '开题提交', value: stats.proposals, color: '#e6a23c' },
  { label: '中期提交', value: stats.midterm, color: '#e6a23c' },
  { label: '答辩分组', value: stats.defenseGroups, color: '#909399' },
  { label: '成绩记录', value: stats.grades, color: '#909399' }
])

async function load() {
  loading.value = true
  try {
    const [stu, apps, props_, mid, groups, grades] = await Promise.allSettled([
      adminApi.getStudents(),
      applicationApi.getList(),
      proposalApi.getList(),
      midtermApi.getList(),
      defenseApi.getGroups(),
      gradeApi.getList()
    ])

    const v = (r: PromiseSettledResult<any>) => (r.status === 'fulfilled' ? r.value?.data : undefined)

    stats.students = (v(stu) || []).length
    stats.accepted = (v(apps) || []).filter((a: any) => a.status === 'accepted').length
    stats.proposals = (v(props_) || []).filter((a: any) => a.status === 'submitted' || a.status === 'approved').length
    stats.midterm = (v(mid) || []).filter((a: any) => a.status === 'submitted' || a.status === 'passed').length
    stats.defenseGroups = (v(groups) || []).length
    stats.grades = (v(grades) || []).length
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.mb16 {
  margin-bottom: 16px;
}
.page-header .title {
  font-size: 16px;
  font-weight: 600;
}
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
