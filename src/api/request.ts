import axios from 'axios'
import { ElMessage } from 'element-plus'
import { touchActivity } from '../utils/idleTimeout'

const request = axios.create({
  baseURL: import.meta.env.BASE_URL + 'api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' }
})

// 请求拦截器 - 自动附加 Token
request.interceptors.request.use(
  (config) => {
    // 发起请求也算“有操作”，刷新空闲计时
    touchActivity()
    const token = localStorage.getItem('gpss_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// 响应拦截器 - 统一错误处理
request.interceptors.response.use(
  (response) => {
    const res = response.data
    // 后端返回 code !== 200 视为业务错误
    if (res.code && res.code !== 200) {
      ElMessage.error(res.message || '请求失败')
      return Promise.reject(new Error(res.message || '请求失败'))
    }
    return res
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('gpss_token')
      localStorage.removeItem('gpss_user')
      localStorage.removeItem('gpss_last_activity')
      ElMessage.error('登录已过期，请重新登录')
      window.location.href = import.meta.env.BASE_URL + 'login'
    } else if (error.response?.status === 403) {
      const url = error.config?.url || 'unknown'
      console.error(`[403] 权限不足: ${url}`, error.response?.data)
      ElMessage.error(`没有权限执行此操作 (${url})`)
    } else if (error.response?.status === 400) {
      const url = error.config?.url || 'unknown'
      console.error(`[400] 参数错误: ${url}`, error.response?.data)
      ElMessage.error(error.response?.data?.message || '请求参数错误')
    } else if (error.code === 'ECONNABORTED') {
      ElMessage.error('请求超时，请稍后重试')
    } else {
      console.error('[网络异常]', error.config?.url, error.response?.data || error.message)
      ElMessage.error(error.response?.data?.message || error.message || '网络异常')
    }
    return Promise.reject(error)
  }
)

export default request
