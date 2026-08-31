<template>
  <div class="debug-login page-container">
    <el-card class="card-container">
      <template #header>
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span>调试模式 - 演示登录</span>
          <el-tag type="warning">仅开发环境</el-tag>
        </div>
      </template>

      <p class="demo-desc">使用预设账号快速体验系统功能（数据为演示数据）</p>
      <div class="account-list">
        <div class="account-card" @click="quickDemoLogin('admin')">
          <el-avatar :size="40" style="background-color: #f56c6c;">
            <el-icon><UserFilled /></el-icon>
          </el-avatar>
          <div class="account-info">
            <span class="account-role">管理员</span>
            <span class="account-cred">admin / 123456</span>
          </div>
          <el-tag effect="plain" type="danger" size="small">admin</el-tag>
        </div>

        <div class="account-card" @click="quickDemoLogin('chen')">
          <el-avatar :size="40" style="background-color: #67c23a;">
            <el-icon><UserFilled /></el-icon>
          </el-avatar>
          <div class="account-info">
            <span class="account-role">教师</span>
            <span class="account-cred">chen / 123456</span>
          </div>
          <el-tag effect="plain" type="success" size="small">teacher</el-tag>
        </div>

        <div class="account-card" @click="quickDemoLogin('zhangyi')">
          <el-avatar :size="40" style="background-color: #e6a23c;">
            <el-icon><UserFilled /></el-icon>
          </el-avatar>
          <div class="account-info">
            <span class="account-role">学生</span>
            <span class="account-cred">zhangyi / 123456</span>
          </div>
          <el-tag effect="plain" type="warning" size="small">student</el-tag>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/user'
import { ElMessage } from 'element-plus'
import { UserFilled } from '@element-plus/icons-vue'

const router = useRouter()
const userStore = useUserStore()

async function quickDemoLogin(username: string) {
  try {
    const success = await userStore.demoLogin(username)
    if (success) {
      ElMessage.success(`欢迎回来，${userStore.currentUser?.realName}！`)
      router.push('/')
    }
  } catch (error: any) {
    ElMessage.error(error.message || '演示登录失败')
  }
}
</script>

<style scoped>
.page-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eef2f5;
}

.card-container {
  width: 90vw;
  max-width: 500px;
}

.demo-desc {
  color: #606266;
  margin-bottom: 24px;
}

.account-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.account-card {
  display: flex;
  align-items: center;
  padding: 16px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s;
}

.account-card:hover {
  border-color: #c66a32;
  background-color: #ecf5ff;
  transform: translateX(4px);
}

.account-info {
  margin-left: 12px;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.account-role {
  font-weight: 600;
  color: #303133;
}

.account-cred {
  font-size: 13px;
  color: #909399;
}
</style>
