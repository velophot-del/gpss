import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Topic, TopicStatus } from '../types'
import { resolveTopicMajorCode } from '../types'
import { topicApi as api } from '../api'
import { ElMessage } from 'element-plus'

export interface MajorOptionLike { value: string; label: string; code: string }

export const useTopicStore = defineStore('topic', () => {
  const topics = ref<Topic[]>([])
  const currentTopic = ref<Topic | null>(null)
  const searchKeyword = ref('')
  const selectedCategory = ref('')
  const selectedDifficulty = ref('')
  const selectedMajor = ref('')
  const loading = ref(false)
  const total = ref(0)
  // 当前学生被“查看选题规则”允许浏览的专业（由后端按策略算好下发）
  const allowedMajors = ref<MajorOptionLike[] | null>(null)

  // 获取已发布的课题列表（学生浏览用）
  async function fetchTopics(params?: { page?: number; pageSize?: number; keyword?: string; category?: string; difficulty?: string; major?: string }) {
    loading.value = true
    try {
      const res: any = await api.getList({
        page: params?.page || 1,
        pageSize: params?.pageSize || 12,
        keyword: params?.keyword ?? searchKeyword.value,
        category: params?.category ?? selectedCategory.value,
        difficulty: params?.difficulty ?? selectedDifficulty.value,
        major: params?.major ?? selectedMajor.value
      })
      if (res.data) {
        // 分页响应格式
        topics.value = Array.isArray(res.data.list) ? res.data.list : (Array.isArray(res.data) ? res.data : [])
        total.value = res.data.pagination?.total ?? res.data.total ?? 0
        allowedMajors.value = Array.isArray(res.data.allowedMajors) ? res.data.allowedMajors : null
        // 确保 tags 被解析为数组
        topics.value = topics.value.map((t: any) => ({
          ...t,
          tags: Array.isArray(t.tags) ? t.tags : (typeof t.tags === 'string' ? JSON.parse(t.tags || '[]') : [])
        }))
      }
    } catch (error) {
      console.error('获取课题列表失败:', error)
      ElMessage.error('获取课题列表失败，请检查网络连接')
    } finally {
      loading.value = false
    }
  }

  // 获取课题详情
  async function fetchTopicDetail(id: string) {
    try {
      const res: any = await api.getDetail(id)
      const data = res.data
      
      // 解析 JSON 字段（如果后端返回的是字符串）
      if (typeof data.schedules === 'string') {
        data.schedules = JSON.parse(data.schedules)
      }
      if (typeof data.attachments === 'string') {
        data.attachments = JSON.parse(data.attachments)
      }
      if (typeof data.tags === 'string') {
        data.tags = JSON.parse(data.tags)
      }
      
      currentTopic.value = data
      return data
    } catch (error) {
      console.error('获取课题详情失败:', error)
      ElMessage.error('获取课题详情失败')
      return null
    }
  }

  // 教师获取自己的课题
  async function fetchMyTopics() {
    loading.value = true
    allowedMajors.value = null
    try {
      const res: any = await api.getMyTopics({
        keyword: searchKeyword.value
      })
      topics.value = res.data || []
    } finally {
      loading.value = false
    }
  }

  // 创建课题
  async function addTopic(data: Partial<Topic>) {
    const res: any = await api.create(data)
    return res.data
  }

  // 更新课题
  async function updateTopic(topicId: string, data: Partial<Topic>) {
    await api.update(topicId, data)
  }

  // 更新课题状态
  async function updateTopicStatus(topicId: string, status: TopicStatus) {
    await api.updateStatus(topicId, status)
  }

  // 删除课题
  async function deleteTopic(topicId: string) {
    await api.delete(topicId)
    topics.value = topics.value.filter(t => t.id !== topicId)
  }

  // 增加浏览次数（由后端自动处理，前端仅保留接口兼容）
  async function incrementViewCount(_topicId: string) {
    // 后端在 getDetail 时自动增加
  }

  // 根据ID查找本地缓存
  function getTopicById(topicId: string): Topic | undefined {
    return topics.value.find(t => t.id === topicId)
  }

  // 所有分类（从当前列表提取）
  const categories = computed(() => [...new Set(topics.value.map(t => t.category).filter(Boolean))])

  // 过滤后的课题列表（根据搜索条件）
  // 只展示学院已发布的课题：草稿/待审/已满/已关闭一律不出现
  // （topics 是全局共享数组，可能被教师端的「我的课题」覆盖，故此处再兜一层）
  const filteredTopics = computed(() => {
    let result = topics.value.filter(t => t.status === 'published')
    if (searchKeyword.value) {
      const kw = searchKeyword.value.toLowerCase()
      result = result.filter(t =>
        t.title?.toLowerCase().includes(kw) ||
        t.description?.toLowerCase().includes(kw) ||
        t.tags?.some((tag: string) => tag.toLowerCase().includes(kw))
      )
    }
    if (selectedCategory.value) {
      result = result.filter(t => t.category === selectedCategory.value)
    }
    if (selectedDifficulty.value) {
      result = result.filter(t => t.difficulty === selectedDifficulty.value)
    }
    if (selectedMajor.value) {
      // selectedMajor 现为专业代码（value=code）；课题缺失 majorCode 时用名称别名兜底解析
      result = result.filter(t => resolveTopicMajorCode(t) === selectedMajor.value)
    }
    return result
  })

  // 获取教师的课题（本地过滤）
  function getTopicsByTeacher(teacherId: string): Topic[] {
    return topics.value.filter(t => t.teacherId === teacherId)
  }

  return {
    topics,
    filteredTopics,
    currentTopic,
    searchKeyword,
    selectedCategory,
    selectedDifficulty,
    selectedMajor,
    allowedMajors,
    loading,
    total,
    fetchTopics,
    fetchTopicDetail,
    fetchMyTopics,
    addTopic,
    updateTopic,
    updateTopicStatus,
    deleteTopic,
    incrementViewCount,
    getTopicById,
    getTopicsByTeacher,
    categories
  }
})
