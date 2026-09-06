import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Application, ApplicationStatus } from '../types'
import { applicationApi as api } from '../api'
import { ElMessage } from 'element-plus'

export const useApplicationStore = defineStore('application', () => {
  const applications = ref<Application[]>([])
  const myApplications = ref<Application[]>([])
  const isMatching = ref(false)

  // 统计数据
  const stats = computed(() => {
    const total = applications.value.length
    const finalMatched = applications.value.filter(a => a.status === 'accepted').length
    return {
      totalApplications: total,
      finalMatched,
      pendingCount: applications.value.filter(a => a.status === 'pending' || a.status === 'submitted').length,
      rejectedCount: applications.value.filter(a => a.status === 'rejected').length
    }
  })

  // 最终匹配结果（已通过的申请）
  const finalResults = computed(() => {
    return applications.value.filter(a => a.status === 'accepted')
  })

  // 获取申请列表
  async function fetchApplications() {
    try {
      const res: any = await api.getList()
      applications.value = res.data || []
      return res.data || []
    } catch (error) {
      console.error('获取申请列表失败:', error)
      ElMessage.error('获取申请列表失败，请检查网络连接')
      return []
    }
  }

  // 提交申请（学生）
  async function submitApplication(data: { topicId: string; priority?: number; motivation?: string }) {
    await api.submit(data)
    await fetchApplications()
  }

  // 撤销申请（学生）
  async function withdrawApplication(id: string) {
    await api.withdraw(id)
    applications.value = applications.value.filter(a => a.id !== id)
  }

  // 审批申请（教师 - 三参数版，兼容旧调用）
  async function reviewApplication(id: string, status: ApplicationStatus | string, comment?: string) {
    await api.review(id, { status, comment })
    await fetchApplications()
  }

  // 提交/确认本课题名单（未被选中的自动进入下一志愿）
  async function finalizeTopic(topicId: string) {
    const res: any = await api.finalizeTopic(topicId)
    await fetchApplications()
    return res
  }

  // 审批申请（两参数版，供视图使用）
  async function review(id: string, status: string) {
    await api.review(id, { status })
    await fetchApplications()
  }

  // 按课题筛选申请
  function getApplicationsByTopic(topicId: string): Application[] {
    return applications.value.filter(a => a.topicId === topicId)
  }

  // 按学生筛选申请
  function getApplicationsByStudent(studentId: string): Application[] {
    return applications.value.filter(a => a.studentId === studentId)
  }

  // 获取学生最终录取结果
  function getStudentResult(studentId: string): Application | undefined {
    return applications.value.find(a => a.studentId === studentId && a.status === 'accepted')
  }

  // 自动匹配（管理员功能）
  async function runMatching() {
    isMatching.value = true
    try {
      // 后端暂无匹配接口，刷新数据并统计当前状态
      await fetchApplications()
      const matched = applications.value.filter(a => a.status === 'accepted').length
      return { matched, total: applications.value.length }
    } finally {
      isMatching.value = false
    }
  }

  return {
    applications,
    myApplications,
    isMatching,
    stats,
    finalResults,
    fetchApplications,
    submitApplication,
    withdrawApplication,
    reviewApplication,
    review,
    finalizeTopic,
    getApplicationsByTopic,
    getApplicationsByStudent,
    getStudentResult,
    runMatching
  }
})
