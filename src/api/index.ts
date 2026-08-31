import request from './request'

// ===== 认证相关 =====
export const authApi = {
  login: (data: { username: string; password: string }) =>
    request.post('/auth/login', data),
  demoLogin: (username: string) =>
    request.post('/auth/demo-login', { username }),
  getCurrentUser: () => request.get('/auth/me')
}

// ===== 用户相关 =====
export const userApi = {
  // 当前用户
  getProfile: () => request.get('/users/me'),
  updatePassword: (data: { oldPassword: string; newPassword: string }) =>
    request.put('/users/password', data),
  updateProfile: (data: { email?: string; avatar?: string; phone?: string }) =>
    request.put('/users/profile', data),

  // 管理员：用户管理 CRUD
  getList: (params?: { page?: number; pageSize?: number; keyword?: string; role?: string; status?: string }) =>
    request.get('/users', { params }),
  create: (data: any) => request.post('/users', data),
  update: (id: string, data: any) => request.put(`/users/${id}`, data),
  updateStatus: (id: string, status: string) => request.put(`/users/${id}/status`, { status }),
  delete: (id: string) => request.delete(`/users/${id}`),
  batchDelete: (ids: string[]) => request.post('/users/batch-delete', { ids }),

  // 批量导入（FormData）
  batchImport: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return request.post('/users/batch-import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  // 管理员重置用户密码
  resetPassword: (id: string, newPassword: string) =>
    request.put(`/users/${id}/password`, { newPassword })
}

// ===== 课题相关 =====
export const topicApi = {
  // 公开接口 - 学生浏览
  getList: (params?: { page?: number; pageSize?: number; keyword?: string; category?: string; difficulty?: string; major?: string }) =>
    request.get('/topics', { params }),
  getDetail: (id: string) => request.get(`/topics/${id}`),

  // 教师接口
  create: (data: any) => request.post('/topics', data),
  update: (id: string, data: any) => request.put(`/topics/${id}`, data),
  delete: (id: string) => request.delete(`/topics/${id}`),
  updateStatus: (id: string, status: string) =>
    request.put(`/topics/${id}/status`, { status }),

  // 教师我的课题
  getMyTopics: (params?: { keyword?: string; status?: string }) =>
    request.get('/topics/teacher/mine', { params })
}

// ===== 申请相关 =====
export const applicationApi = {
  // 学生提交申请
  submit: (data: { topicId: string; priority?: number; motivation?: string }) =>
    request.post('/applications', data),
  // 获取申请列表（根据角色自动返回不同数据）
  getList: () => request.get('/applications'),
  // 撤销申请
  withdraw: (id: string) => request.delete(`/applications/${id}`),
  // 教师审批
  review: (id: string, data: { status: string; comment?: string }) =>
    request.put(`/applications/${id}`, data),

  // 调整相关
  submitAdjustment: (data: { fromTopicId?: string; toTopicId?: string; reason: string }) =>
    request.post('/applications/adjustments', data),
  getAdjustments: () => request.get('/applications/adjustments'),
  reviewAdjustment: (id: string, data: { status: string; adminComment?: string }) =>
    request.put(`/applications/adjustments/${id}`, data)
}

// ===== 周期管理 =====
export const cycleApi = {
  getAll: () => request.get('/cycles'),
  getActive: () => request.get('/cycles/active'),
  create: (data: any) => request.post('/cycles', data),
  update: (id: string, data: any) => request.put(`/cycles/${id}`, data),
  delete: (id: string) => request.delete(`/cycles/${id}`)
}

// ===== 统计数据 =====
export const statisticsApi = {
  getOverview: () => request.get('/statistics/overview'),
  getTopicStats: () => request.get('/statistics/topics')
}

// ===== 学生档案 =====
export const studentApi = {
  getProfile: () => request.get('/students/profile'),
  updateProfile: (data: any) => request.put('/students/profile', data),
  getList: (params?: any) => request.get('/students', { params }),
  getProfileByUserId: (userId: string) => request.get(`/students/${userId}`)
}

// ===== 文件上传 =====
export const uploadApi = {
  file: (file: File, category?: string) => {
    const formData = new FormData()
    if (category) formData.append('category', category)
    formData.append('file', file)
    return request.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  files: (files: File[], category?: string) => {
    const formData = new FormData()
    if (category) formData.append('category', category)
    files.forEach(f => formData.append('files', f))
    return request.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  }
}

// ===== 管理员数据管理 =====
export const adminApi = {
  getAllTopics: () => request.get('/admin/topics'),
  getTeachers: () => request.get('/admin/teachers'),
  getStudents: () => request.get('/admin/students'),
  getAllApplications: () => request.get('/admin/applications'),
  getStatistics: () => request.get('/admin/statistics'),
  getStudentSelections: () => request.get('/admin/student-selections')
}

// ===== 预选购物车 =====
export const shortlistApi = {
  getList: () => request.get('/shortlist'),
  add: (topicId: string) => request.post('/shortlist', { topicId }),
  remove: (id: string) => request.delete(`/shortlist/${id}`),
  batchRemove: (ids: string[]) => request.delete('/shortlist/batch', { data: { ids } })
}

// ===== 毕业全流程：任务书 =====
export const taskBookApi = {
  getList: () => request.get('/task-books'),
  getDetail: (id: string) => request.get(`/task-books/${id}`),
  create: (data: any) => request.post('/task-books', data),
  remove: (id: string) => request.delete(`/task-books/${id}`)
}

// ===== 毕业全流程：开题 =====
export const proposalApi = {
  getList: () => request.get('/proposals'),
  getDetail: (id: string) => request.get(`/proposals/${id}`),
  submit: (data: any) => request.post('/proposals', data),
  review: (id: string, data: { status: string; comment?: string }) =>
    request.put(`/proposals/${id}/review`, data)
}

// ===== 毕业全流程：中期检查 =====
export const midtermApi = {
  getList: () => request.get('/midterm'),
  getDetail: (id: string) => request.get(`/midterm/${id}`),
  submit: (data: any) => request.post('/midterm', data),
  review: (id: string, data: { status: string; comment?: string; score?: number }) =>
    request.put(`/midterm/${id}/review`, data)
}

// ===== 毕业全流程：毕业论文 =====
export const thesisApi = {
  getList: () => request.get('/thesis'),
  getDetail: (id: string) => request.get(`/thesis/${id}`),
  submit: (data: any) => request.post('/thesis', data),
  review: (id: string, data: { status: string; comment?: string }) =>
    request.put(`/thesis/${id}/review`, data)
}

// ===== 毕业全流程：设计作品 =====
export const designApi = {
  getList: () => request.get('/design'),
  getDetail: (id: string) => request.get(`/design/${id}`),
  submit: (data: any) => request.post('/design', data),
  review: (id: string, data: { status: string; comment?: string }) =>
    request.put(`/design/${id}/review`, data)
}

// ===== 毕业全流程：答辩 =====
export const defenseApi = {
  getGroups: () => request.get('/defense/groups'),
  createGroup: (data: any) => request.post('/defense/groups', data),
  updateGroup: (id: string, data: any) => request.put(`/defense/groups/${id}`, data),
  deleteGroup: (id: string) => request.delete(`/defense/groups/${id}`),
  getScores: (params?: { groupId?: string }) => request.get('/defense/scores', { params }),
  submitScore: (data: { groupId: string; studentId: string; score: number; comment?: string }) =>
    request.post('/defense/scores', data)
}

// ===== 毕业全流程：成绩 =====
export const gradeApi = {
  getList: () => request.get('/grades'),
  create: (data: any) => request.post('/grades', data),
  publish: (id: string) => request.put(`/grades/${id}/publish`)
}

// ===== 毕业全流程：指导记录 =====
export const guidanceApi = {
  getList: () => request.get('/guidance'),
  create: (data: any) => request.post('/guidance', data),
  remove: (id: string) => request.delete(`/guidance/${id}`)
}

// ===== 毕业全流程：公告 =====
export const announcementApi = {
  getList: (params?: { page?: number; pageSize?: number }) => request.get('/announcements', { params }),
  create: (data: any) => request.post('/announcements', data),
  update: (id: string, data: any) => request.put(`/announcements/${id}`, data),
  remove: (id: string) => request.delete(`/announcements/${id}`)
}

// ===== 毕业全流程：站内通知 =====
export const notificationApi = {
  getList: (params?: { page?: number; pageSize?: number }) => request.get('/notifications', { params }),
  getUnreadCount: () => request.get('/notifications/unread-count'),
  markRead: (id: string) => request.put(`/notifications/${id}/read`),
  markAllRead: () => request.put('/notifications/read-all')
}
