import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User, UserRole } from '../types'
import { authApi, userApi as api } from '../api'

export const useUserStore = defineStore('user', () => {
  const currentUser = ref<User | null>(null)
  const token = ref<string>('')
  const isDemoMode = ref(false)

  // 从 localStorage 恢复登录状态
  function initFromStorage() {
    try {
      const savedToken = localStorage.getItem('gpss_token')
      const savedUser = localStorage.getItem('gpss_user')
      const savedDemoMode = localStorage.getItem('gpss_demo_mode')
      if (savedToken && savedUser) {
        token.value = savedToken
        currentUser.value = JSON.parse(savedUser)
        isDemoMode.value = savedDemoMode === 'true'
      }
    } catch {
      // localStorage 数据损坏，清除并重新开始
      localStorage.removeItem('gpss_token')
      localStorage.removeItem('gpss_user')
      localStorage.removeItem('gpss_demo_mode')
      localStorage.removeItem('gpss_last_activity')
      token.value = ''
      currentUser.value = null
      isDemoMode.value = false
    }
  }

  const isLoggedIn = computed(() => !!currentUser.value && !!token.value)
  const userRole = computed<UserRole | null>(() => currentUser.value?.role || null)

  // 正式登录 - 调用 API
  async function login(username: string, password: string): Promise<boolean> {
    try {
      const res: any = await authApi.login({ username, password })
      const { token: newToken, user } = res.data

      // 保存到内存
      token.value = newToken
      currentUser.value = {
        id: user.id,
        username: user.username,
        realName: user.realName || user.real_name || '',
        role: user.role,
        avatar: user.avatar,
        email: user.email,
        ...(user.role === 'student' && { studentId: user.student_id, className: user.class_name, major: user.major }),
        ...(user.role === 'teacher' && { title: user.title, department: user.department })
      }
      isDemoMode.value = false

      // 持久化
      localStorage.setItem('gpss_token', newToken)
      localStorage.setItem('gpss_user', JSON.stringify(currentUser.value))
      localStorage.setItem('gpss_demo_mode', 'false')

      return true
    } catch (error) {
      console.error('登录失败:', error)
      return false
    }
  }

  // 演示模式快速登录（自动重置演示密码，无需传密码）
  async function demoLogin(username: string, password?: string): Promise<boolean> {
    try {
      // 优先使用新的演示登录接口（自动重置密码为 123456）
      const res: any = await authApi.demoLogin(username)
      const { token: newToken, user } = res.data

      token.value = newToken
      currentUser.value = {
        id: user.id,
        username: user.username,
        realName: user.realName || user.real_name || '',
        role: user.role,
        avatar: user.avatar,
        email: user.email,
        ...(user.role === 'student' && { studentId: user.student_id, className: user.class_name, major: user.major }),
        ...(user.role === 'teacher' && { title: user.title, department: user.department })
      }
      isDemoMode.value = true

      localStorage.setItem('gpss_token', newToken)
      localStorage.setItem('gpss_user', JSON.stringify(currentUser.value))
      localStorage.setItem('gpss_demo_mode', 'true')

      return true
    } catch (error) {
      console.error('演示登录失败:', error)
      return false
    }
  }

  function logout() {
    currentUser.value = null
    token.value = ''
    isDemoMode.value = false
    localStorage.removeItem('gpss_token')
    localStorage.removeItem('gpss_user')
    localStorage.removeItem('gpss_demo_mode')
    localStorage.removeItem('gpss_last_activity')
  }

  // 退出演示模式（回到登录页）
  function exitDemoMode() {
    logout()
  }

  // 获取当前用户详情（从服务器刷新）
  async function fetchCurrentUser() {
    try {
      const res: any = await api.getProfile()
      const user = res.data
      currentUser.value = {
        id: user.id,
        username: user.username,
        realName: user.realName || user.real_name || '',
        role: user.role,
        avatar: user.avatar,
        email: user.email,
        ...(user.role === 'student' && { studentId: user.student_id, className: user.class_name, major: user.major }),
        ...(user.role === 'teacher' && { title: user.title, department: user.department })
      }
      localStorage.setItem('gpss_user', JSON.stringify(currentUser.value))
    } catch (error) {
      console.error('获取用户信息失败:', error)
    }
  }

  // 切换角色（演示用）：通过演示登录接口，密码自动重置为 123456
  async function switchRole(role: 'admin' | 'teacher' | 'student') {
    const demoAccounts: Record<string, string> = {
      admin: 'admin',
      teacher: 'chen',
      student: 'zhangyi'
    }

    const username = demoAccounts[role]
    if (!username) return false

    try {
      const res: any = await authApi.demoLogin(username)
      const { token: newToken, user } = res.data

      token.value = newToken
      currentUser.value = {
        id: user.id,
        username: user.username,
        realName: user.realName || user.real_name || '',
        role: user.role,
        avatar: user.avatar,
        email: user.email,
        ...(user.role === 'student' && { studentId: user.student_id, className: user.class_name, major: user.major }),
        ...(user.role === 'teacher' && { title: user.title, department: user.department })
      }
      isDemoMode.value = true

      localStorage.setItem('gpss_token', newToken)
      localStorage.setItem('gpss_user', JSON.stringify(currentUser.value))
      localStorage.setItem('gpss_demo_mode', 'true')
      return true
    } catch (e) {
      console.error('切换角色失败:', e)
      return false
    }
  }

  return {
    currentUser,
    token,
    isDemoMode,
    isLoggedIn,
    userRole,
    initFromStorage,
    login,
    demoLogin,
    logout,
    exitDemoMode,
    fetchCurrentUser,
    switchRole
  }
})
