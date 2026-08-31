<template>
  <el-container class="main-layout" :class="{ 'has-demo-banner': userStore.isDemoMode }">
    <!-- 演示模式标识条 -->
    <div v-if="userStore.isDemoMode" class="demo-mode-banner">
      <div class="demo-banner-content">
        <el-icon class="demo-icon"><InfoFilled /></el-icon>
        <span class="demo-text">当前为 <strong>演示模式</strong> — 数据仅供展示，操作不会影响正式数据</span>
        <el-button type="danger" size="small" plain @click="handleExitDemo" class="exit-btn">退出演示</el-button>
      </div>
    </div>

    <!-- 移动端菜单遮罩 -->
    <div v-if="showMobileMenu" class="mobile-overlay" @click="closeMobileMenu"></div>

    <!-- 侧边栏 -->
    <el-aside :width="isCollapse ? '64px' : '220px'" :class="{ 'sidebar-mobile': isMobile && showMobileMenu }" class="sidebar">
      <div class="logo">
        <img :src="logoUrl" alt="山东工艺美术学院" v-show="!isCollapse" style="height: 36px; object-fit: contain;" />
        <span v-show="!isCollapse">视觉传达设计学院</span>
        <el-icon v-show="isCollapse"><DataAnalysis /></el-icon>
      </div>

      <el-menu
        :default-active="$route.path"
        :collapse="isCollapse"
        router
        background-color="#17324d"
        text-color="#ffffffa6"
        active-text-color="#409eff"
      >
        <!-- 首页 -->
        <el-menu-item index="/">
          <el-icon><HomeFilled /></el-icon>
          <template #title>工作台</template>
        </el-menu-item>

        <!-- 管理员菜单 -->
        <template v-if="userStore.userRole === 'admin'">
          <el-sub-menu index="admin">
            <template #title>
              <el-icon><Setting /></el-icon>
              <span>系统管理</span>
            </template>
            <el-menu-item index="/admin/library">选题库管理</el-menu-item>
            <el-menu-item index="/admin/cycles">选题周期</el-menu-item>
            <el-menu-item index="/admin/users">用户管理</el-menu-item>
            <el-menu-item index="/admin/stats">数据统计</el-menu-item>
          </el-sub-menu>
          <el-sub-menu index="admin-data">
            <template #title>
              <el-icon><DataAnalysis /></el-icon>
              <span>数据总览</span>
            </template>
            <el-menu-item index="/admin/teachers">教师申报状态</el-menu-item>
            <el-menu-item index="/admin/students">学生选课状态</el-menu-item>
            <el-menu-item index="/admin/applications">选课申请数据</el-menu-item>
          </el-sub-menu>
          <el-sub-menu index="admin-process">
            <template #title>
              <el-icon><FolderOpened /></el-icon>
              <span>毕业全流程</span>
            </template>
            <el-menu-item index="/process/overview">全流程看板</el-menu-item>
            <el-menu-item index="/process/defense">答辩管理</el-menu-item>
            <el-menu-item index="/process/grades">成绩评定</el-menu-item>
            <el-menu-item index="/process/announcements">公告管理</el-menu-item>
          </el-sub-menu>
        </template>

        <!-- 教师菜单 -->
        <template v-if="userStore.userRole === 'teacher'">
          <el-menu-item index="/teacher/topics">
            <el-icon><Document /></el-icon>
            <template #title>我的课题</template>
          </el-menu-item>
          <el-menu-item index="/teacher/topics/create">
            <el-icon><Plus /></el-icon>
            <template #title>发布课题</template>
          </el-menu-item>
          <el-menu-item index="/teacher/review">
            <el-icon><UserFilled /></el-icon>
            <template #title>遴选学生</template>
          </el-menu-item>
          <el-menu-item index="/teacher/results">
            <el-icon><TrendCharts /></el-icon>
            <template #title>选课结果</template>
          </el-menu-item>
          <el-sub-menu index="teacher-process">
            <template #title>
              <el-icon><Notebook /></el-icon>
              <span>毕业指导</span>
            </template>
            <el-menu-item index="/process/task-book">任务书下达</el-menu-item>
            <el-menu-item index="/process/proposal/review">开题审核</el-menu-item>
            <el-menu-item index="/process/midterm/review">中期检查</el-menu-item>
            <el-menu-item index="/process/thesis/review">论文批阅</el-menu-item>
            <el-menu-item index="/process/design/review">作品批阅</el-menu-item>
            <el-menu-item index="/process/guidance">指导记录</el-menu-item>
            <el-menu-item index="/process/defense">答辩评分</el-menu-item>
            <el-menu-item index="/process/grades">成绩评定</el-menu-item>
            <el-menu-item index="/process/announcements">公告</el-menu-item>
          </el-sub-menu>
        </template>

        <!-- 学生菜单 -->
        <template v-if="userStore.userRole === 'student'">
          <el-menu-item index="/student/browse">
            <el-icon><Search /></el-icon>
            <template #title>选题工作台</template>
          </el-menu-item>
          <el-menu-item index="/student/profile">
            <el-icon><User /></el-icon>
            <template #title>个人档案</template>
          </el-menu-item>
          <el-menu-item index="/student/result">
            <el-icon><CircleCheck /></el-icon>
            <template #title>选课结果</template>
          </el-menu-item>
          <el-menu-item index="/student/adjustment" v-if="cycleStore.currentPhase === 'adjustment'">
            <el-icon><RefreshRight /></el-icon>
            <template #title>调剂申请</template>
          </el-menu-item>
          <el-sub-menu index="student-process">
            <template #title>
              <el-icon><Reading /></el-icon>
              <span>毕业流程</span>
            </template>
            <el-menu-item index="/process/task-book">任务书</el-menu-item>
            <el-menu-item index="/process/proposal">开题报告</el-menu-item>
            <el-menu-item index="/process/midterm">中期检查</el-menu-item>
            <el-menu-item index="/process/thesis">毕业论文</el-menu-item>
            <el-menu-item index="/process/design">设计作品</el-menu-item>
            <el-menu-item index="/process/guidance">指导记录</el-menu-item>
            <el-menu-item index="/process/defense">我的答辩</el-menu-item>
            <el-menu-item index="/process/grades">我的成绩</el-menu-item>
            <el-menu-item index="/process/announcements">公告</el-menu-item>
          </el-sub-menu>
        </template>
      </el-menu>
    </el-aside>

    <!-- 主体区域 -->
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-icon class="collapse-btn" @click="isMobile ? toggleMobileMenu() : (isCollapse = !isCollapse)">
            <Menu v-if="isMobile && isCollapse" />
            <Fold v-else-if="!isCollapse" />
            <Expand v-else />
          </el-icon>

          <!-- 当前阶段指示器 -->
          <div class="phase-info">
            <el-tag :color="cycleStore.phaseInfo.color" effect="dark" round class="phase-tag">
              {{ cycleStore.phaseInfo.label }}
            </el-tag>
            <span class="phase-desc">{{ cycleStore.phaseInfo.description }}</span>
          </div>
        </div>

        <div class="header-right">
          <el-badge :value="unreadCount" :hidden="unreadCount === 0" :max="99" class="notif-bell">
            <el-icon class="bell-icon" @click="goNotifications"><Bell /></el-icon>
          </el-badge>
          <el-dropdown trigger="click">
            <div class="user-info">
              <el-avatar :size="32" :icon="UserFilled" />
              <span class="username">{{ userStore.currentUser?.realName || '用户' }}</span>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="showChangePwDialog = true">修改密码</el-dropdown-item>
                <el-dropdown-item disabled>{{ userStore.currentUser?.email }}</el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>

      <el-footer class="app-footer">
        毕业设计管理系统 V2 @视觉传达设计学院
      </el-footer>
    </el-container>

    <!-- 修改密码对话框 -->
    <el-dialog v-model="showChangePwDialog" title="修改密码" width="400px" :close-on-click-modal="false">
      <el-form label-width="90px" @submit.prevent>
        <el-form-item label="原密码">
          <el-input v-model="changePwForm.oldPassword" type="password" show-password placeholder="请输入原密码" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="changePwForm.newPassword" type="password" show-password placeholder="至少6位" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="changePwForm.confirmPassword" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showChangePwDialog = false">取消</el-button>
        <el-button type="primary" :loading="changingPw" @click="handleChangePassword">确认修改</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '../stores/user'
import { useCycleStore } from '../stores/cycle'
import { userApi, notificationApi } from '../api'
import {
  HomeFilled, Setting, Document, Plus, UserFilled, TrendCharts,
  Search, User, CircleCheck, RefreshRight,
  Fold, Expand, DataAnalysis, InfoFilled, Menu,
  FolderOpened, Notebook, Reading, Calendar, Picture, ChatDotRound,
  Medal, Trophy, Bell, Tickets
} from '@element-plus/icons-vue'

const router = useRouter()
const userStore = useUserStore()
const cycleStore = useCycleStore()

// 内嵌到 /gpss/ 子路径时，静态资源需前缀 BASE_URL
const logoUrl = import.meta.env.BASE_URL + 'suad-logo.png'
const isCollapse = ref(false)
const isMobile = ref(false)
const showMobileMenu = ref(false)
const unreadCount = ref(0)

async function fetchUnread() {
  try {
    const res: any = await notificationApi.getUnreadCount()
    unreadCount.value = res.data?.count || 0
  } catch (e) {
    // 忽略
  }
}

function goNotifications() {
  router.push('/process/notifications')
}

function checkMobile() {
  isMobile.value = window.innerWidth < 768
  if (isMobile.value) {
    isCollapse.value = true
    showMobileMenu.value = false
  }
}

function toggleMobileMenu() {
  showMobileMenu.value = !showMobileMenu.value
}

function closeMobileMenu() {
  if (isMobile.value) {
    showMobileMenu.value = false
  }
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
  fetchUnread()
  watch(() => router.currentRoute.value.path, () => fetchUnread())
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})

function handleLogout() {
  userStore.logout()
  router.push('/login')
}

function handleExitDemo() {
  userStore.exitDemoMode()
  router.push('/login')
}

// ===== 修改密码 =====
const showChangePwDialog = ref(false)
const changingPw = ref(false)
const changePwForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

async function handleChangePassword() {
  if (!changePwForm.oldPassword || !changePwForm.newPassword || !changePwForm.confirmPassword) {
    return ElMessage.warning('请填写完整所有字段')
  }
  if (changePwForm.newPassword.length < 6) {
    return ElMessage.warning('新密码不能少于6位')
  }
  if (changePwForm.newPassword !== changePwForm.confirmPassword) {
    return ElMessage.warning('两次输入的新密码不一致')
  }

  changingPw.value = true
  try {
    await userApi.updatePassword({
      oldPassword: changePwForm.oldPassword,
      newPassword: changePwForm.newPassword
    })
    ElMessage.success('密码修改成功，请重新登录')
    showChangePwDialog.value = false
    userStore.logout()
    router.push('/login')
  } catch (e: any) {
    console.error('修改密码失败:', e)
  } finally {
    changingPw.value = false
  }
}
</script>

<style scoped>
.main-layout {
  height: 100vh;
  background: var(--bg-color);
}

.main-layout.has-demo-banner {
  padding-top: 36px;
}

/* 演示模式横幅 */
.demo-mode-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 200;
  background: #fff7ed;
  border-bottom: 1px solid #f1d4b9;
  padding: 7px 20px;
  display: flex;
  justify-content: center;
}

.demo-banner-content {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #7c4322;
  font-size: 13px;
}

.demo-icon {
  font-size: 16px;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.demo-text strong {
  font-weight: 600;
}

.exit-btn {
  margin-left: 16px;
  --el-button-border-color: rgba(255,255,255,0.6);
  --el-button-text-color: #9b4f23;
  --el-button-hover-text-color: #7c4322;
  --el-button-hover-border-color: #c66a32;
}

.sidebar {
  background-color: var(--primary-color);
  transition: width 0.3s;
  overflow-x: hidden;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid #ffffff1a;
  padding: 0 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.logo img {
  width: 32px;
  height: 32px;
}

.sidebar :deep(.el-menu) {
  border-right: none;
}

.header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 4px rgba(23, 50, 77, 0.1);
  padding: 0 20px;
  height: 60px;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.collapse-btn {
  font-size: 20px;
  cursor: pointer;
  color: #606266;
  transition: color 0.3s;
}

.collapse-btn:hover {
  color: #409eff;
}

.phase-info {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.phase-tag {
  font-size: 12px;
  flex-shrink: 0;
}

.phase-desc {
  font-size: 13px;
  color: #909399;
  line-height: 1;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.notif-bell {
  display: flex;
  align-items: center;
}

.bell-icon {
  font-size: 20px;
  color: #606266;
  cursor: pointer;
  transition: color 0.3s;
}

.bell-icon:hover {
  color: #409eff;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.username {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}

.main-content {
  background-color: var(--bg-color);
  overflow-y: auto;
}

.app-footer {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-top: 1px solid #e4e7ed;
  color: #909399;
  font-size: 12px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 移动端适配 */
@media (max-width: 768px) {
  .main-layout.has-demo-banner {
    padding-top: 42px;
  }

  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    width: 220px !important;
  }

  .sidebar-mobile {
    transform: translateX(0);
  }

  .mobile-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 99;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .header {
    padding: 0 12px;
    height: 56px;
  }

  .header-left {
    gap: 10px;
  }

  .phase-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .phase-tag {
    font-size: 11px;
    padding: 2px 8px;
  }

  .phase-desc {
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
    line-height: 1;
  }

  .header-right {
    gap: 8px;
  }

  .username {
    display: none;
  }

  .demo-mode-banner {
    padding: 6px 10px;
  }

  .demo-banner-content {
    gap: 8px;
    font-size: 12px;
    justify-content: space-between;
    width: 100%;
  }

  .exit-btn {
    margin-left: 8px;
    padding: 2px 10px;
    font-size: 11px;
  }
}

@media (max-width: 480px) {
  .header {
    padding: 0 8px;
  }

  .phase-desc {
    max-width: 120px;
  }

  .collapse-btn {
    font-size: 18px;
  }
}
</style>
