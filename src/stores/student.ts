import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { StudentProfile } from '../types'
import { studentApi as api, profileOptionsApi } from '../api'
import { DESIGN_SKILLS, TOPIC_CATEGORIES } from '../types'
import { ElMessage } from 'element-plus'

export const useStudentStore = defineStore('student', () => {
  const profile = ref<StudentProfile | null>(null)
  const profiles = ref<StudentProfile[]>([])

  // 技能列表 — 从 DESIGN_SKILLS 统一导入（覆盖4个专业共47项）
  const allSkills = ref([...DESIGN_SKILLS] as string[])

  // 兴趣方向选项 — 从 TOPIC_CATEGORIES 统一导入（4个专业24个大类）
  const interestOptions = ref([...TOPIC_CATEGORIES] as string[])

  // 归一化并过滤：仅保留当前有效选项中的值，剔除历史遗留的旧分类名
  function filterValid(list: unknown, valid: string[]): string[] {
    let arr: unknown[] = []
    if (Array.isArray(list)) {
      arr = list
    } else if (typeof list === 'string') {
      try { arr = JSON.parse(list || '[]') } catch { arr = [] }
    }
    return arr.filter((v): v is string => typeof v === 'string' && valid.includes(v))
  }

  async function fetchOptions() {
    try {
      const res: any = await profileOptionsApi.get()
      const options = Array.isArray(res.data) ? res.data : []
      if (options.length) {
        allSkills.value = options.filter((o: any) => o.type === 'skill').map((o: any) => o.label)
        interestOptions.value = options.filter((o: any) => o.type === 'interest').map((o: any) => o.label)
      }
    } catch (error) { console.warn('读取动态标签失败，使用默认标签', error) }
  }

  // 获取当前登录学生的档案
  async function fetchProfile() {
    try {
      await fetchOptions()
      const res: any = await api.getProfile()
      profile.value = res.data ? {
        ...res.data,
        // 映射 snake_case 数据库字段 → camelCase 前端字段
        contactEmail: res.data.contact_email || res.data.contactEmail || '',
        contactPhone: res.data.contact_phone || res.data.contactPhone || '',
        personalStatement: res.data.personalStatement || res.data.selfIntro || res.data.self_intro || '',
        skills: filterValid(res.data.skills, allSkills.value),
        interests: filterValid(res.data.interests, interestOptions.value),
        portfolio: Array.isArray(res.data.portfolio) ? res.data.portfolio : (typeof res.data.portfolio === 'string' ? JSON.parse(res.data.portfolio || '[]') : []),
        isComplete: !!(res.data.is_complete ?? res.data.isComplete) || !!(res.data.gpa != null && (res.data.personalStatement || res.data.selfIntro || res.data.self_intro) && (Array.isArray(res.data.skills) ? res.data.skills.length > 0 : false))
      } : null
    } catch (error) {
      console.error('获取学生档案失败:', error)
      ElMessage.error('获取学生档案失败，请检查网络连接')
    }
  }

  // 获取所有学生档案（供教师/管理员使用）
  async function fetchProfiles() {
    try {
      const res: any = await api.getList()
      if (res.data?.list) {
        profiles.value = res.data.list.map((item: any) => ({
          ...item,
          userId: item.id,
          // 映射用户表字段
          realName: item.real_name || item.realName || '',
          studentId: item.student_id || item.studentId || '',
          className: item.class_name || item.className || '',
          major: item.major || '',
          grade: item.grade || '',
          // 映射档案表字段
          gpa: item.gpa ?? 0,
          ranking: item.ranking ?? 0,
          totalStudents: item.total_students ?? item.totalStudents ?? 0,
          skills: filterValid(item.skills, allSkills.value),
          interests: filterValid(item.interests, interestOptions.value),
          portfolio: Array.isArray(item.portfolio) ? item.portfolio : (typeof item.portfolio === 'string' ? JSON.parse(item.portfolio || '[]') : []),
          personalStatement: item.self_intro || item.selfIntro || item.personalStatement || '',
          contactEmail: item.contact_email || item.contactEmail || '',
          contactPhone: item.contact_phone || item.contactPhone || '',
          isComplete: !!(item.is_complete) || !!(item.gpa != null && item.ranking != null && (item.self_intro || item.selfIntro))
        }))
      }
    } catch (error) {
      console.error('获取学生列表失败:', error)
      ElMessage.error('获取学生列表失败，请检查网络连接')
    }
  }

  // 保存当前学生档案（不包含 GPA，GPA 由管理员维护）
  async function saveProfile(data: Partial<StudentProfile>) {
    await api.updateProfile({
      skills: data.skills,
      interests: data.interests,
      selfIntro: data.personalStatement || data.selfIntro,
      portfolio: data.portfolio,
      contactEmail: (data as any).contactEmail,
      contactPhone: (data as any).contactPhone
    })
    const base = profile.value || {} as StudentProfile
    const currentGpa = base.gpa ?? 0
    profile.value = {
      ...base,
      ...data,
      gpa: currentGpa,  // 保持 GPA 不变，由管理员维护
      personalStatement: data.personalStatement || data.selfIntro,
      isComplete: !!(currentGpa > 0 && (data.personalStatement || data.selfIntro) && data.skills && data.skills.length > 0)
    } as StudentProfile
  }

  // 按用户ID查找学生档案
  function getProfileByUserId(userId: string): StudentProfile | undefined {
    return profiles.value.find(p => p.userId === userId)
  }

  // 按用户ID获取单个学生完整档案（教师/管理员用）
  async function fetchProfileByUserId(userId: string): Promise<StudentProfile | null> {
    try {
      const res: any = await api.getProfileByUserId(userId)
      if (res.data) {
        const profile: StudentProfile = {
          userId: res.data.userId || userId,
          realName: res.data.realName || '',
          studentId: res.data.studentId || '',
          className: res.data.className || '',
          major: res.data.major || '',
          grade: res.data.grade || '',
          gpa: res.data.gpa ?? 0,
          ranking: res.data.ranking ?? 0,
          totalStudents: res.data.totalStudents ?? 0,
          skills: filterValid(res.data.skills, allSkills.value),
          interests: filterValid(res.data.interests, interestOptions.value),
          portfolio: Array.isArray(res.data.portfolio) ? res.data.portfolio : [],
          personalStatement: res.data.personalStatement || '',
          contactEmail: res.data.contactEmail || '',
          contactPhone: res.data.contactPhone || '',
          isComplete: res.data.isComplete || false,
          updatedAt: res.data.updatedAt || ''
        }
        // 同时更新缓存
        const existingIdx = profiles.value.findIndex(p => p.userId === userId)
        if (existingIdx >= 0) {
          profiles.value[existingIdx] = profile
        } else {
          profiles.value.push(profile)
        }
        return profile
      }
      return null
    } catch (error) {
      console.error('获取学生档案失败:', error)
      ElMessage.error('获取学生档案失败')
      return null
    }
  }

  // 更新指定用户档案（教师/管理员用）
  async function updateProfile(_userId: string, data: Partial<StudentProfile>) {
    await saveProfile(data)
  }

  return {
    profile,
    profiles,
    allSkills,
    interestOptions,
    fetchOptions,
    fetchProfile,
    fetchProfiles,
    saveProfile,
    getProfileByUserId,
    fetchProfileByUserId,
    updateProfile
  }
})
