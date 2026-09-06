import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Cycle } from '../types'
import { cycleApi as api } from '../api'

// 从 phases_config JSON 解析各阶段时间，补全扁平字段
function enrichCycle(raw: any): any {
  if (!raw) return raw
  let phases: any = {}
  // mysql2 会将 JSON 列解析为对象；如果是字符串则手动解析
  const rawPhases = raw.phases_config
  if (rawPhases) {
    if (typeof rawPhases === 'string') {
      try { phases = JSON.parse(rawPhases) } catch { phases = {} }
    } else if (typeof rawPhases === 'object' && !Array.isArray(rawPhases)) {
      phases = rawPhases
    }
  }
  // 显式构造干净对象：展平 phases_config，删除原始 JSON/Date 对象避免模板乱码
  const { phases_config, start_date, end_date, created_at, updated_at, ...clean } = raw
  return {
    ...clean,
    topicPublishStart: phases.topic_publish?.start || phases.topic_submission?.start || '',
    topicPublishEnd: phases.topic_publish?.end || phases.topic_submission?.end || '',
    studentApplyStart: phases.student_apply?.start || phases.student_selection?.start || '',
    studentApplyEnd: phases.student_apply?.end || phases.student_selection?.end || '',
    teacherReviewStart: phases.teacher_review?.start || '',
    teacherReviewEnd: phases.teacher_review?.end || '',
    resultAnnounceTime: phases.result_announce?.start || phases.result?.start || phases.result_announce || '',
    adjustmentStart: phases.adjustment?.start || '',
    adjustmentEnd: phases.adjustment?.end || '',
    teacherStudentLimit: Number(phases.teacher_student_limit ?? raw.teacher_student_limit ?? 0) || 0,
    startDate: start_date || null,
    endDate: end_date || null,
    createdAt: created_at || '',
    updatedAt: updated_at || ''
  }
}

export const useCycleStore = defineStore('cycle', () => {
  const currentCycleRaw = ref<any>(null)
  const cyclesRaw = ref<any[]>([])

  // 补全阶段时间后的当前周期
  const currentCycle = computed(() => enrichCycle(currentCycleRaw.value))
  // 补全阶段时间后的周期列表
  const cycles = computed(() => cyclesRaw.value.map(enrichCycle))

  async function fetchCurrentCycle() {
    try {
      const res: any = await api.getActive()
      currentCycleRaw.value = res.data
    } catch (error) {
      console.error('获取当前周期失败:', error)
    }
  }

  async function fetchAllCycles() {
    try {
      const res: any = await api.getAll()
      cyclesRaw.value = res.data || []
    } catch (error) {
      console.error('获取周期列表失败:', error)
    }
  }

  async function createCycle(data: Partial<Cycle>) {
    await api.create(data)
    await fetchAllCycles()
  }

  async function updateCycle(id: string, data: Partial<Cycle>) {
    await api.update(id, data)
    await fetchAllCycles()
  }

  // 当前阶段标识
  const currentPhase = computed(() => {
    const phaseAliases: Record<string, string> = {
      student_selection: 'student_apply',
      result: 'result_announce',
      ended: 'completed'
    }
    const phase = currentCycleRaw.value?.phase || 'none'
    return phaseAliases[phase] || phase
  })

  // 阶段展示信息
  const phaseInfo = computed(() => {
    const phaseMap: Record<string, { label: string; color: string; description: string }> = {
      topic_submission: { label: '课题发布阶段', color: '#409eff', description: '教师正在发布选题' },
      topic_publish: { label: '课题发布阶段', color: '#409eff', description: '教师正在发布选题' },
      student_apply: { label: '志愿填报阶段', color: '#67c23a', description: '学生可浏览并填报志愿' },
      teacher_review: { label: '教师遴选阶段', color: '#e6a23c', description: '教师正在审核学生志愿' },
      result_announce: { label: '结果公示阶段', color: '#909399', description: '选课结果已公布' },
      adjustment: { label: '调剂补录阶段', color: '#f56c6c', description: '未录取学生可参与调剂' },
      task_book: { label: '任务书阶段', color: '#409eff', description: '导师正在下达任务书' },
      proposal: { label: '开题阶段', color: '#409eff', description: '学生提交开题报告，导师审核' },
      midterm: { label: '中期检查阶段', color: '#67c23a', description: '学生提交中期检查，导师评分' },
      thesis_design: { label: '论文/作品提交', color: '#e6a23c', description: '学生提交毕业论文与设计作品' },
      defense: { label: '答辩阶段', color: '#f56c6c', description: '答辩分组与评分' },
      grading: { label: '成绩评定阶段', color: '#909399', description: '合成并发布最终成绩' },
      archive: { label: '归档阶段', color: '#909399', description: '材料归档' },
      completed: { label: '已完成', color: '#909399', description: '本周期工作已结束' },
      none: { label: '未开始', color: '#909399', description: '暂无活跃的周期' }
    }
    return phaseMap[currentPhase.value] || phaseMap.none
  })

  // 初始化时自动获取
  fetchCurrentCycle()

  return { currentCycle, cycles, currentPhase, phaseInfo, fetchCurrentCycle, fetchAllCycles, createCycle, updateCycle }
})
