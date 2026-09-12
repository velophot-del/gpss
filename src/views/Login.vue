<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-header">
        <img :src="logoUrl" alt="山东工艺美术学院" class="logo" />
        <h1 class="title-first">GPSS系统</h1>
        <h1 class="title-second">毕业设计管理系统 <span class="version-tag">V3.0</span></h1>
      </div>

    <el-form ref="formRef" :model="form" :rules="rules" class="login-form">
      <el-form-item prop="username">
        <el-input v-model="form.username" placeholder="用户名" prefix-icon="User" size="large" />
      </el-form-item>
      <el-form-item prop="password">
        <el-input v-model="form.password" type="password" placeholder="密码" prefix-icon="Lock" size="large" show-password />
      </el-form-item>
      <el-form-item>
        <el-button
          type="primary"
          size="large"
          class="login-button"
          :loading="loading"
          @click="handleFormalLogin"
        >
          登 录
        </el-button>
      </el-form-item>
    </el-form>

    <div v-if="isDev" class="dev-mode-link">
      <a :href="debugUrl" target="_blank">开发模式登录</a>
    </div>
    </div>

    <div class="footer">
      <p>毕业设计管理系统 V3.0 @视觉传达</p>
      <a class="icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">鲁ICP备2026052694号-1</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()

// 内嵌到 /gpss/ 子路径时，静态资源与路由需前缀 BASE_URL
const logoUrl = import.meta.env.BASE_URL + 'suad-logo.png'
const debugUrl = import.meta.env.BASE_URL + 'debug'

const formRef = ref<FormInstance>()
const loading = ref(false)
const isDev = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === 'true'

const form = reactive({
  username: '',
  password: ''
})

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function handleFormalLogin() {
  formRef.value?.validate(async (valid) => {
    if (valid) {
      loading.value = true
      try {
        const success = await userStore.login(form.username, form.password)
        loading.value = false
        if (success) {
          ElMessage.success(`欢迎回来，${userStore.currentUser?.realName}！`)
          router.push('/')
        } else {
          ElMessage.error('用户名或密码错误')
        }
      } catch (error: any) {
        loading.value = false
        const msg = error?.response?.data?.message || error?.message || '登录失败'
        console.error('登录请求失败:', error)
        ElMessage.error(msg)
      }
    }
  })
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eef2f5;
  position: relative;
}

.login-container {
  width: 440px;
  background: #fff;
  border-radius: 14px;
  padding: 36px 40px 40px;
  box-shadow: 0 20px 60px rgba(23, 50, 77, 0.14);
  border: 1px solid #dbe3ea;
}

@media (max-width: 768px) {
  .login-container {
    width: 90vw;
    padding: 28px 24px 32px;
    border-radius: 12px;
  }
}

@media (max-width: 480px) {
  .login-container {
    width: 95vw;
    padding: 20px 16px 24px;
    border-radius: 8px;
  }
}

.login-header {
  text-align: center;
  margin-bottom: 30px;
}

.logo {
  display: block;
  width: auto;
  height: 64px;
  margin: 0 auto 16px;
}

.title-first {
  font-size: 22px;
  color: #303133;
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
}

.title-second {
  font-size: 20px;
  color: #17324d;
  font-weight: 600;
  line-height: 1.2;
  margin: 6px 0 0;
}

.version-tag {
  font-size: 12px;
  color: #909399;
  font-weight: 400;
  margin-left: 4px;
  padding: 2px 8px;
  background: #f5f7fa;
  border-radius: 10px;
}

.subtitle {
  color: #909399;
  font-size: 13px;
  margin-top: 8px;
}

@media (max-width: 480px) {
  .logo {
    height: 48px;
    margin: 0 auto 12px;
  }
  
  .login-header h1 {
    font-size: 18px;
  }
  
  .subtitle {
    font-size: 11px;
    margin-top: 6px;
  }
  
  .login-header {
    margin-bottom: 20px;
  }
}

.login-form .login-button {
  width: 100%;
  height: 44px;
  font-size: 16px;
  border-radius: 8px;
  margin-top: 8px;
  background: #c66a32;
  border-color: #c66a32;
}

.login-form .login-button:hover {
  background: #a95525;
  border-color: #a95525;
}

.dev-mode-link {
  text-align: center;
  margin-top: 12px;
}

.dev-mode-link a {
  font-size: 11px;
  color: #c0c4cc;
  text-decoration: none;
  transition: color 0.2s;
}

.dev-mode-link a:hover {
  color: #909399;
}

.footer {
  position: absolute;
  bottom: 24px;
  color: #909399;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.footer p {
  margin: 0;
}

.icp-link {
  color: #909399;
  transition: color 0.2s ease;
}

.icp-link:hover {
  color: #409eff;
}
</style>
