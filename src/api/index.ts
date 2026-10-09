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
  getList: (params?: { page?: number; pageSize?: number; keyword?: string; role?: string; status?: string; className?: string; major?: string }) =>
    request.get('/users', { params }),
  getFilterOptions: () => request.get('/users/filter-options'),
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
    request.get('/topics/teacher/mine', { params }),
  getTeacherQuota: (topicId?: string) => request.get('/topics/teacher/quota', { params: topicId ? { topicId } : undefined })
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
  // 教师提交/确认本课题名单（未被选中的自动落选进入下一志愿）
  finalizeTopic: (topicId: string) => request.post('/applications/finalize-topic', { topicId }),
  // 学生整批提交志愿（原子，全部成功或全部失败）
  submitVolunteers: (volunteers: { topicId: string; priority: number; motivation?: string }[]) =>
    request.post('/applications/volunteers/submit', { volunteers }),

  // 调整相关
  submitAdjustment: (data: { fromTopicId?: string; toTopicId?: string; reason: string }) =>
    request.post('/applications/adjustments', data),
  getAdjustments: () => request.get('/applications/adjustments'),
  reviewAdjustment: (id: string, data: { status: string; adminComment?: string }) =>
    request.put(`/applications/adjustments/${id}`, data)
}

export const selectionDraftApi = {
  get: (topicId: string) => request.get(`/applications/topics/${topicId}/selection-draft`),
  save: (topicId: string, data: { version: number; items: any[] }) =>
    request.put(`/applications/topics/${topicId}/selection-draft`, data),
  submit: (topicId: string, data: { version: number }) =>
    request.post(`/applications/topics/${topicId}/submit-selection`, data),
}

export const selectionAdminApi = {
  getProgress: (cycleId: string | number) => request.get(`/admin/selection-settlement/${cycleId}`),
  unlock: (topicId: string, reason: string) => request.post(`/admin/selection-topics/${topicId}/unlock`, { reason }),
  resetTopic: (topicId: string, reason: string) => request.post(`/admin/selection-topics/${topicId}/reset`, { confirmation: 'RESET', reason }),
  run: (cycleId: string | number) => request.post(`/admin/selection-settlement/${cycleId}/run`),
  getAcceptedResultOptions: (applicationId: string) => request.get(`/admin/accepted-results/${applicationId}/options`),
  adjustAcceptedResult: (applicationId: string, data: { targetApplicationId: string | null; reason: string }) =>
    request.post(`/admin/accepted-results/${applicationId}/adjust`, data),
}

export const adjustmentVolunteerApi = {
  getEligibleTopics: () => request.get('/adjustment-volunteers/eligible-topics'),
  getMine: () => request.get('/adjustment-volunteers/mine'),
  saveMine: (version: number, items: { topicId: string; motivation: string }[]) =>
    request.put('/adjustment-volunteers/mine', { version, items }),
  getTeacherTopics: () => request.get('/adjustment-volunteers/teacher/topics'),
  getTeacherDraft: (topicId: string) => request.get(`/adjustment-volunteers/topics/${topicId}/draft`),
  saveTeacherDraft: (topicId: string, version: number, items: any[]) =>
    request.put(`/adjustment-volunteers/topics/${topicId}/draft`, { version, items }),
  submitTeacherBatch: (topicId: string, version: number) =>
    request.post(`/adjustment-volunteers/topics/${topicId}/submit`, { version }),
}

export const adjustmentAdminApi = {
  getProgress: (cycleId: string | number) => request.get(`/admin/adjustment-settlement/${cycleId}`),
  unlock: (topicId: string, reason: string) => request.post(`/admin/adjustment-topics/${topicId}/unlock`, { reason }),
  run: (cycleId: string | number) => request.post(`/admin/adjustment-settlement/${cycleId}/run`),
}

// ===== 周期管理 =====
export const cycleApi = {
  getAll: () => request.get('/cycles'),
  getActive: () => request.get('/cycles/active'),
  create: (data: any) => request.post('/cycles', data),
  update: (id: string, data: any) => request.put(`/cycles/${id}`, data),
  delete: (id: string) => request.delete(`/cycles/${id}`)
}

// ===== 周期级「毕业专业 + 研究方向」配置 =====
export const cycleConfigApi = {
  // 当前进行中周期的专业/研究方向（教师建题、学生工作台下拉用；无进行中周期回退默认）
  get: () => request.get('/cycle-config'),
  // 按周期读取（管理员编辑回填）
  getByCycle: (cycleId: string | number) => request.get(`/cycle-config/${cycleId}`),
  save: (cycleId: string | number, data: { majors: any[]; researchCategories: Record<string, string[]> }) =>
    request.put(`/cycle-config/${cycleId}`, data)
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

export const profileOptionsApi = {
  get: () => request.get('/profile-options'),
  getAdmin: () => request.get('/profile-options/admin'),
  save: (options: any[]) => request.put('/profile-options', options),
  importExcel: (file: File) => { const form = new FormData(); form.append('file', file); return request.post('/profile-options/import', form, { headers: { 'Content-Type': 'multipart/form-data' } }) }
}

export const topicAccessApi = {
  get: (cycleId: string) => request.get(`/topic-access/${cycleId}`),
  save: (cycleId: string, data: any) => request.put(`/topic-access/${cycleId}`, data)
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

// ===== 周期级毕业资料模板 =====
export const documentTemplateApi = {
  getAll: (cycleId?: number) => request.get('/document-templates', { params: cycleId ? { cycleId } : undefined }),
  getMine: () => request.get('/document-templates/mine'),
  create: (data: FormData) => request.post('/document-templates', data, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  updateStatus: (id: string, status: 'draft' | 'published' | 'archived') =>
    request.put(`/document-templates/${id}`, { status }),
  download: (id: string) => request.get(`/document-templates/${id}/download`, { responseType: 'blob' }),
  remove: (id: string) => request.delete(`/document-templates/${id}`)
}

// ===== 管理员数据管理 =====
export const adminApi = {
  getSelectionOverview: () => request.get('/admin/selection-overview'),
  getAllTopics: () => request.get('/admin/topics'),
  getTeachers: () => request.get('/admin/teachers'),
  getStudents: () => request.get('/admin/students'),
  getAllApplications: () => request.get('/admin/applications'),
  returnStudentVolunteers: (studentId: string, reason: string) =>
    request.post(`/admin/students/${studentId}/volunteers/return`, { reason }),
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
  exportDocx: (id: string) => request.get(`/task-books/${id}/export`, { responseType: 'blob' }),
  submit: (data: any) => request.post('/task-books', data),
  review: (id: string, data: { status: 'confirmed' | 'need_revision'; comment?: string }) =>
    request.put(`/task-books/${id}/review`, data)
}

// ===== 毕业全流程：开题 =====
export const proposalApi = {
  getList: () => request.get('/proposals'),
  getDetail: (id: string) => request.get(`/proposals/${id}`),
  exportDocx: (id: string) => request.get(`/proposals/${id}/export`, { responseType: 'blob' }),
  submit: (data: any) => request.post('/proposals', data),
  review: (id: string, data: { status: string; comment?: string }) =>
    request.put(`/proposals/${id}/review`, data)
}

// ===== 毕业全流程：中期检查 =====
export const midtermApi = {
  getList: () => request.get('/midterm'),
  getDetail: (id: string) => request.get(`/midterm/${id}`),
  exportDocx: (id: string) => request.get(`/midterm/${id}/export`, { responseType: 'blob' }),
  submit: (data: any) => request.post('/midterm', data),
  review: (id: string, data: { status: string; comment?: string; score?: number }) =>
    request.put(`/midterm/${id}/review`, data)
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
