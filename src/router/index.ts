import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '../stores/user'
import { hasExpiredSinceLastActivity } from '../utils/idleTimeout'
import type { UserRole } from '../types/index'

const isDev = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO === 'true'

const demoRoutes: RouteRecordRaw[] = isDev
  ? [
      {
        path: '/debug',
        name: 'DebugLogin',
        component: () => import('../views/DebugLogin.vue'),
        meta: { requiresAuth: false }
      }
    ]
  : []

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    roles?: UserRole[]
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('../views/Login.vue'),
      meta: { requiresAuth: false }
    },
    ...demoRoutes,
    {
      path: '/',
      component: () => import('../layouts/MainLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'Dashboard',
          component: () => import('../views/Dashboard.vue')
        },
        // 管理员路由
        {
          path: 'admin/cycles',
          name: 'AdminCycles',
          component: () => import('../views/admin/CycleManagement.vue'),
          meta: { roles: ['admin'] }
        },
        {
          path: 'admin/users',
          name: 'AdminUsers',
          component: () => import('../views/admin/UserManagement.vue'),
          meta: { roles: ['admin'] }
        },
        {
          path: 'admin/library',
          name: 'AdminTopicLibrary',
          component: () => import('../views/admin/TopicLibrary.vue'),
          meta: { roles: ['admin'] }
        },
        {
          path: 'admin/stats',
          name: 'AdminStats',
          component: () => import('../views/admin/Statistics.vue'),
          meta: { roles: ['admin'] }
        },
        {
          path: 'admin/topics',
          name: 'AdminTopicOverview',
          component: () => import('../views/admin/TopicOverview.vue'),
          meta: { roles: ['admin'] }
        },
        {
          path: 'admin/teachers',
          name: 'AdminTeacherStatus',
          component: () => import('../views/admin/TeacherStatus.vue'),
          meta: { roles: ['admin'] }
        },
        {
          path: 'admin/students',
          name: 'AdminStudentStatus',
          component: () => import('../views/admin/StudentStatus.vue'),
          meta: { roles: ['admin'] }
        },
        {
          path: 'admin/applications',
          name: 'AdminApplications',
          component: () => import('../views/admin/ApplicationData.vue'),
          meta: { roles: ['admin'] }
        },
        {
          path: 'admin/document-templates',
          name: 'DocumentTemplateAdmin',
          component: () => import('../views/process/DocumentTemplates.vue'),
          meta: { roles: ['admin'] }
        },
        { path: 'admin/profile-options', name: 'AdminProfileOptions', component: () => import('../views/admin/ProfileOptions.vue'), meta: { roles: ['admin'] } },
        { path: 'admin/topic-access', name: 'AdminTopicAccess', component: () => import('../views/admin/TopicAccess.vue'), meta: { roles: ['admin'] } },
        // 教师端路由
        {
          path: 'teacher/topics',
          name: 'TeacherTopics',
          component: () => import('../views/teacher/TopicManage.vue'),
          meta: { roles: ['teacher'] }
        },
        {
          path: 'teacher/topics/create',
          name: 'TopicCreate',
          component: () => import('../views/teacher/TopicForm.vue'),
          meta: { roles: ['teacher'] }
        },
        {
          path: 'teacher/topics/:id/edit',
          name: 'TopicEdit',
          component: () => import('../views/teacher/TopicForm.vue'),
          meta: { roles: ['teacher'] }
        },
        {
          path: 'teacher/review',
          name: 'TeacherReview',
          component: () => import('../views/teacher/SelectionReview.vue'),
          meta: { roles: ['teacher'] }
        },
        {
          path: 'teacher/results',
          name: 'TeacherResults',
          component: () => import('../views/teacher/MyResults.vue'),
          meta: { roles: ['teacher'] }
        },
        // 学生端路由
        {
          path: 'student/browse',
          name: 'StudentBrowse',
          component: () => import('../views/student/SelectionWorkspace.vue'),
          meta: { roles: ['student'] }
        },
        {
          path: 'student/topic/:id',
          name: 'TopicDetail',
          component: () => import('../views/student/TopicDetail.vue'),
          meta: { roles: ['student', 'admin'] }
        },
        {
          path: 'student/profile',
          name: 'StudentProfile',
          component: () => import('../views/student/ProfileEdit.vue'),
          meta: { roles: ['student'] }
        },
        { path: 'student/applications', redirect: '/student/browse' },
        {
          path: 'student/result',
          name: 'MyResult',
          component: () => import('../views/student/MyResult.vue'),
          meta: { roles: ['student'] }
        },
        {
          path: 'student/adjustment',
          name: 'Adjustment',
          component: () => import('../views/student/Adjustment.vue'),
          meta: { roles: ['student'] }
        },
        { path: 'student/shortlist', redirect: '/student/browse' },
        {
          path: 'student/document-templates',
          name: 'DocumentTemplateStudent',
          component: () => import('../views/process/DocumentTemplates.vue'),
          meta: { roles: ['student'] }
        },

        // ===== 毕业全流程路由 =====
        {
          path: 'process/overview',
          name: 'ProcessOverview',
          component: () => import('../views/process/ProcessOverview.vue'),
          meta: { roles: ['admin'] }
        },
        {
          path: 'process/task-book',
          name: 'TaskBook',
          component: () => import('../views/process/TaskBookView.vue'),
          meta: { roles: ['student', 'teacher'] }
        },
        // 开题
        {
          path: 'process/proposal',
          name: 'ProposalSubmit',
          component: () => import('../views/process/StudentSubmission.vue'),
          props: { stage: 'proposal' },
          meta: { roles: ['student'] }
        },
        {
          path: 'process/proposal/review',
          name: 'ProposalReview',
          component: () => import('../views/process/TeacherSubmissionReview.vue'),
          props: { stage: 'proposal' },
          meta: { roles: ['teacher'] }
        },
        // 中期
        {
          path: 'process/midterm',
          name: 'MidtermSubmit',
          component: () => import('../views/process/StudentSubmission.vue'),
          props: { stage: 'midterm' },
          meta: { roles: ['student'] }
        },
        {
          path: 'process/midterm/review',
          name: 'MidtermReview',
          component: () => import('../views/process/TeacherSubmissionReview.vue'),
          props: { stage: 'midterm' },
          meta: { roles: ['teacher'] }
        },
        // 指导记录
        {
          path: 'process/guidance',
          name: 'Guidance',
          component: () => import('../views/process/GuidanceView.vue'),
          meta: { roles: ['student', 'teacher'] }
        },
        // 答辩
        {
          path: 'process/defense',
          name: 'Defense',
          component: () => import('../views/process/DefenseView.vue'),
          meta: { roles: ['student', 'teacher', 'admin'] }
        },
        // 成绩
        {
          path: 'process/grades',
          name: 'Grades',
          component: () => import('../views/process/GradesView.vue'),
          meta: { roles: ['student', 'teacher', 'admin'] }
        },
        // 公告
        {
          path: 'process/announcements',
          name: 'Announcements',
          component: () => import('../views/process/AnnouncementView.vue'),
          meta: { roles: ['student', 'teacher', 'admin'] }
        },
        // 通知
        {
          path: 'process/notifications',
          name: 'Notifications',
          component: () => import('../views/process/NotificationView.vue'),
          meta: { roles: ['student', 'teacher', 'admin'] }
        }
      ]
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('../views/NotFound.vue'),
      meta: { requiresAuth: false }
    }
  ]
})

// 路由守卫
router.beforeEach((to, _from, next) => {
  const userStore = useUserStore()

  // 初始化：从 localStorage 恢复状态
  if (!userStore.isLoggedIn) {
    userStore.initFromStorage()
  }

  // 关闭浏览器/刷新期间已超过空闲阈值：登出并回登录页。
  // 必须在组件挂载前判断（守卫早于请求拦截器），否则页面首屏请求会刷新活动时间、掩盖“已超时”。
  if (userStore.isLoggedIn && hasExpiredSinceLastActivity()) {
    userStore.logout()
    ElMessage.warning('登录已超时，请重新登录')
    next('/login')
    return
  }

  if (to.meta.requiresAuth !== false && !userStore.isLoggedIn) {
    next('/login')
  } else if (to.path === '/login' && userStore.isLoggedIn) {
    next('/')
  } else if (to.name === 'TopicDetail' && userStore.userRole === 'student') {
    // 学生统一走“选题工作台”，旧 TopicDetail 只保留给管理员/教师只读预览
    next({ path: `/student/browse?open=${to.params.id}` })
  } else if (to.meta.roles && userStore.userRole) {
    // admin 继承 teacher 的所有路由权限
    const effectiveRoles = [userStore.userRole]
    if (userStore.userRole === 'admin') effectiveRoles.push('teacher')
    if (!to.meta.roles.some(r => effectiveRoles.includes(r))) {
      // 无权限时跳转到首页
      next('/')
      return
    }
    next()
  } else {
    next()
  }
})

export default router
