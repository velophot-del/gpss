// ========== 用户相关类型 ==========
export type UserRole = 'admin' | 'teacher' | 'student'

export interface User {
  id: string
  username: string
  password?: string        // 可选：登录后不存储密码
  role: UserRole
  realName: string
  avatar?: string
  email?: string
  phone?: string
  // 学生特有字段
  studentId?: string
  className?: string
  major?: string
  majorCode?: string       // 专业代码：130502/130508/081702/080906T
  grade?: string
  // 教师特有字段
  teacherId?: string
  department?: string
  title?: string
  createdAt?: string       // 可选：登录响应可能不包含
}

// ========== 选题周期 ==========
export type CycleStatus = 'upcoming' | 'active' | 'selection' | 'review' | 'adjustment' | 'completed'

export interface SelectionCycle {
  id: string
  name: string
  description: string
  year: string
  // 阶段时间安排
  topicPublishStart: string   // 课题发布开始
  topicPublishEnd: string     // 课题发布截止
  studentApplyStart: string   // 学生填报开始
  studentApplyEnd: string     // 学生填报截止
  teacherReviewStart: string  // 教师遴选开始
  teacherReviewEnd: string    // 教师遴选截止
  resultAnnounceTime: string  // 结果公布时间
  adjustmentStart: string     // 调剂开始
  adjustmentEnd: string       // 调剂截止
  teacherStudentLimit?: number // 每位教师指导学生人数上限
  status: CycleStatus
  createdAt: string
}

// Cycle 类型别名（兼容不同命名）
export type Cycle = SelectionCycle

// ========== 课题相关 ==========
export type TopicStatus = 'draft' | 'pending' | 'published' | 'full' | 'closed'

// 专业方向配置（4个本科专业）
export const MAJOR_CATEGORIES = {
  '130502': { name: '视觉传达设计', degree: '艺术学', keywords: ['视觉语言', '品牌', '书籍插画', '书籍绘本', '包装', '字体设计', '版式设计', '信息可视化'] },
  '130508': { name: '数字媒体艺术（交互方向）', degree: '艺术学', keywords: ['交互设计', '用户体验', '动态视觉', '数字媒体', 'UI设计', 'UX研究', '服务设计'] },
  '081702': { name: '包装工程', degree: '工学', keywords: ['包装结构', '材料性能', '工艺制造', '智能包装', '绿色包装', '物流包装', '包装测试'] },
  '080906T': { name: '智能交互（工科）', degree: '工学', keywords: ['智能硬件交互', 'AI交互系统', '机器人交互', '物联网交互', '传感器', '嵌入式开发', '原型制作'] }
} as const

export const MAJOR_OPTIONS = [
  { value: '视觉传达设计', label: '视觉传达设计 (130502)', code: '130502' },
  { value: '数字媒体艺术', label: '数字媒体艺术 (130508)', code: '130508' },
  { value: '包装工程', label: '包装工程 (081702)', code: '081702' },
  { value: '智能交互（工科）', label: '智能交互（工科）(080906T)', code: '080906T' }
]

// 周期级“毕业专业”配置项（管理员在编辑周期时维护，专业代码为权威键）
export interface MajorConfig {
  code: string
  name: string
  degree?: string
  keywords?: string[]
}

// 周期级“研究方向”配置结构：按专业代码分组的字符串数组
export type MajorResearchCategories = Record<string, string[]>

// 专业常见名称 → 代码（覆盖带“方向”后缀等写法），用于课题只填名称、未写 majorCode 时的兜底归类
export const MAJOR_NAME_TO_CODE: Record<string, string> = {
  '视觉传达设计': '130502',
  '数字媒体艺术': '130508',
  '数字媒体艺术（交互方向）': '130508',
  '包装工程': '081702',
  '智能交互（工科）': '080906T',
  '智能交互': '080906T'
}

// 课题归属专业解析：优先 majorCode，缺失时按名称别名兜底
export function resolveTopicMajorCode(topic?: { major?: string; majorCode?: string } | null): string {
  if (!topic) return ''
  if (topic.majorCode) return topic.majorCode
  return topic.major ? (MAJOR_NAME_TO_CODE[topic.major] || '') : ''
}

// 各专业可选“研究大类”（与教师建题表单一致）
export const RESEARCH_CATEGORIES: Record<string, string[]> = {
  '130502': ['品牌形象与VI设计', '书籍纸媒与插画绘本', '包装视觉与结构设计', '企业实题与社会服务设计', '概念设计与实验性视觉', '视觉传达专业研究'],
  '130508': ['交互界面与系统设计', '用户体验与服务设计', '动态视觉与动效设计', '游戏与虚拟体验设计', '数字媒体叙事与创作', '数字媒体艺术研究'],
  '081702': ['包装结构设计与优化', '包装材料与性能研究', '包装工艺与智能制造', '智能包装与物联网应用', '绿色包装与循环经济', '包装系统集成与产品设计'],
  '080906T': ['智能硬件交互设计', '人工智能交互系统', '机器人交互设计', '物联网与空间交互', '感知与交互技术', '交互工程与原型开发'],
}

// 选题范围分类（基于4个专业24个选题大类）
// 视觉传达设计(130502)：品牌/书籍纸媒插画绘本/包装/企业实题/概念设计/专业研究
// 数字媒体艺术130508：交互设计/用户体验/动态视觉动效/游戏虚拟体验/数字媒体叙事/服务设计
// 包装工程081702：包装结构/包装材料性能/包装工艺智能制造/智能包装物联网/绿色包装循环经济/包装系统集成
// 智能交互080906T：智能硬件/AI交互系统/机器人交互/物联网空间交互/感知交互技术/交互工程原型
export const TOPIC_CATEGORIES = [
  // ===== 视觉传达设计专业 (130502) - 6个大类 =====
  '品牌形象与VI设计',
  '书籍纸媒与插画绘本',
  '包装视觉与结构设计',
  '企业实题与社会服务设计',
  '概念设计与实验性视觉',
  '视觉传达专业研究',
  // ===== 数字媒体艺术专业 (130508) - 6个大类 =====
  '交互界面与系统设计',
  '用户体验与服务设计',
  '动态视觉与动效设计',
  '游戏与虚拟体验设计',
  '数字媒体叙事与创作',
  '数字媒体艺术研究',
  // ===== 包装工程专业 (081702) - 6个大类 =====
  '包装结构设计与优化',
  '包装材料与性能研究',
  '包装工艺与智能制造',
  '智能包装与物联网应用',
  '绿色包装与循环经济',
  '包装系统集成与产品设计',
  // ===== 智能交互工科专业 (080906T) - 6个大类 =====
  '智能硬件交互设计',
  '人工智能交互系统',
  '机器人交互设计',
  '物联网与空间交互',
  '感知与交互技术',
  '交互工程与原型开发'
] as const

export type TopicCategory = typeof TOPIC_CATEGORIES[number]

export interface TopicAttachment {
  id: string
  name: string
  url: string
  size: number
  type: string
  uploadedAt: string
}

export interface TopicSchedule {
  phase: string
  startDate: string
  endDate: string
  description: string
}

export interface Topic {
  id: string
  teacherId: string
  teacherName: string
  teacherTitle?: string
  teacherDepartment?: string
  teacherEmail?: string
  teacherPhone?: string
  teacherAvatar?: string
  cycleId: string
  cycleName?: string
  title: string
  category: string           // 研究方向/分类
  description: string        // 简介
  requirements: string       // 具体要求
  difficulty: 'easy' | 'medium' | 'hard'
  maxStudents: number
  currentCount: number
  // 本课题已录取人数；applyCount 包含仍在处理的申请
  status: TopicStatus
  schedules: TopicSchedule[]
  attachments: TopicAttachment[]
  tags: string[]
  viewCount: number
  applyCount: number         // 申请人数
  firstChoiceCount?: number
  teacherApplicantCount?: number
  teacherFirstChoiceCount?: number
  teacherAcceptedCount?: number
  teacherStudentLimit?: number
  createdAt: string
  updatedAt: string
  major?: string             // 专业名称
  majorCode?: string         // 专业代码
}

// ========== 学生档案 ==========
export interface PortfolioItem {
  id: string
  title: string
  type: 'image' | 'pdf' | 'link' | 'model' | 'video'
  url: string
  description: string
  uploadedAt: string
}

// 技能标签（覆盖4个专业的技能需求）
export const DESIGN_SKILLS = [
  // ===== 视觉传达设计 (130502) =====
  'Photoshop', 'Illustrator', 'InDesign', 'After Effects', 'Premiere',
  '手绘插画', '品牌策划', 'VI设计', '字体设计', '版式设计',
  '信息可视化', 'Cinema 4D', 'Blender', '3D建模', '动态图形',
  // ===== 数字媒体艺术 (130508) =====
  'Figma', 'Sketch', 'Adobe XD', 'UI设计', 'UX研究',
  '交互原型', '动效设计', 'AR/VR', 'TouchDesigner',
  'Unity', 'Unreal Engine', '游戏设计', '3D美术',
  // ===== 包装工程 (081702) =====
  'Rhino', 'SolidWorks', 'AutoCAD', 'KeyShot',
  '包装结构', '材料测试', '工艺设计', '模切刀模',
  '印刷工艺', '绿色包装', '物流包装',
  // ===== 智能交互工科 (080906T) =====
  'Arduino', 'Raspberry Pi', 'Processing',
  'Python创意编程', 'JavaScript', 'TypeScript', 'React',
  '嵌入式开发', '传感器应用', '电路设计', 'PCB设计',
  '3D打印', '激光切割', '原型制作'
] as const

export interface StudentProfile {
  userId: string
  realName?: string            // 学生姓名（来自 users 表）
  studentId: string
  className: string
  major: string
  grade: string
  gpa: number
  ranking?: number
  totalStudents?: number
  skills: string[]            // 技能标签
  interests: string[]         // 兴趣方向
  personalStatement: string   // 个人陈述（前端字段名）
  selfIntro?: string          // 后端返回字段名（兼容）
  portfolio: PortfolioItem[]  // 作品集
  contactEmail: string
  contactPhone: string
  isComplete: boolean         // 档案是否完善（必填项都填了）
  completedAt?: string
  updatedAt: string
}

// ========== 志愿填报 ==========
export type ApplicationStatus = 'pending' | 'submitted' | 'withdrawn' | 'accepted' | 'rejected' | 'pending_review' | 'waitlisted'

export interface Application {
  id: string
  studentId: string
  studentName: string
  topicId: string
  topicTitle: string
  priority: number            // 1=第一志愿, 2=第二志愿, 3=第三志愿
  status: ApplicationStatus
  motivation: string          // 申请理由/个人陈述
  submittedAt: string
  reviewedAt?: string
  reviewedBy?: string
  reviewComment?: string
  confirmedAt?: string        // 确认录取时间
  teacherName?: string
  major?: string
  category?: string
}

// ========== 遴选记录 ==========
export type SelectionDecision = 'accepted' | 'rejected' | 'waitlisted'

export interface SelectionRecord {
  id: string
  topicId: string
  studentId: string
  decision: SelectionDecision
  priority: number
  teacherComment: string
  selectedAt: string
  selectedBy: string
}

// ========== 最终结果 ==========
export interface FinalResult {
  cycleId: string
  studentId: string
  studentName: string
  studentClass: string
  topicId: string
  topicTitle: string
  teacherName: string
  status: 'confirmed' | 'adjusting' | 'dropped'
  confirmedAt: string
}

// ========== 统计数据 ==========
export interface SystemStats {
  totalTopics: number
  totalStudents: number
  totalApplications: number
  totalTeachers: number
  selectionRate: number       // 选课完成率
  popularTopics: Topic[]      // 热门课题
  recentActivity: ActivityLog[]
}

export interface ActivityLog {
  id: string
  type: 'topic_created' | 'application_submitted' | 'selection_made' | 'result_confirmed'
  userId: string
  userName: string
  targetId: string
  targetName: string
  timestamp: string
}

// ========== 毕业全流程（在选题基础上扩展） ==========

// 通用附件
export interface FileItem {
  name: string
  url: string
  size?: number
  type?: string
  uploadedAt?: string
}

// 环节提交状态（不同环节各自使用子集）
export type SubmissionStatus =
  | 'not_started' | 'draft' | 'submitted'
  | 'need_revision' | 'approved' | 'rejected'
  | 'passed' | 'failed' | 'final'

export const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  not_started: '未开始',
  draft: '草稿',
  submitted: '待审核',
  need_revision: '待修改',
  approved: '已通过',
  rejected: '已拒绝',
  passed: '通过',
  failed: '未通过',
  final: '已定稿'
}

export const SUBMISSION_STATUS_TAG: Record<string, string> = {
  not_started: 'info',
  draft: 'info',
  submitted: 'warning',
  need_revision: 'danger',
  approved: 'success',
  rejected: 'danger',
  passed: 'success',
  failed: 'danger',
  final: 'success'
}

// 任务书
export interface TaskBook {
  id: string
  studentId: string
  studentName?: string
  studentCode?: string
  className?: string
  major?: string
  topicId: string
  topicTitle?: string
  teacherName?: string
  title: string
  content?: string
  mainContent?: string
  requirements?: string
  specificRequirements?: string
  schedule?: string
  status: 'draft' | 'issued' | 'submitted' | 'need_revision' | 'confirmed'
  teacherComment?: string
  reviewedAt?: string
  updatedAt?: string
}

export type DocumentTemplateType = 'task_book' | 'proposal' | 'midterm' | 'thesis' | 'other'

export interface DocumentTemplate {
  id: string
  cycleId: number
  cycleName?: string
  documentType: DocumentTemplateType
  title: string
  version: string
  description?: string
  originalName: string
  mimeType?: string
  size: number
  status: 'draft' | 'published' | 'archived'
  publishedAt?: string
  createdAt?: string
  updatedAt?: string
}

// 开题报告
export interface Proposal {
  id: string
  studentId: string
  topicId: string
  topicTitle?: string
  teacherName?: string
  title: string
  background?: string
  objectives?: string
  content?: string
  methods?: string
  plan?: string
  status: SubmissionStatus
  teacherComment?: string
  reviewedAt?: string
  updatedAt?: string
}

// 中期检查
export interface MidtermReport {
  id: string
  studentId: string
  studentName?: string
  studentCode?: string
  className?: string
  major?: string
  topicId: string
  topicTitle?: string
  teacherName?: string
  progressSummary?: string
  completedWork?: string
  problems?: string
  nextPlan?: string
  status: SubmissionStatus
  score?: number | null
  teacherComment?: string
  reviewedAt?: string
  updatedAt?: string
}

// 答辩分组
export interface DefenseGroup {
  id: string
  cycleId?: number
  name: string
  defenseDate?: string
  location?: string
  judges: { id: string; real_name: string; title?: string }[]
  students: { id: string; real_name: string; student_id?: string; class_name?: string; major?: string }[]
  status: 'pending' | 'finished'
  createdBy?: string
}

// 答辩评分
export interface DefenseScore {
  id: string
  groupId: string
  studentId: string
  judgeId: string
  score: number
  comment?: string
  judgeName?: string
  studentName?: string
  studentCode?: string
  groupName?: string
}

// 成绩
export interface Grade {
  id: string
  studentId: string
  studentName?: string
  studentCode?: string
  className?: string
  major?: string
  topicId: string
  topicTitle?: string
  teacherName?: string
  supervisorScore?: number | null
  reviewScore?: number | null
  defenseScore?: number | null
  defenseAvg?: number | null
  totalScore?: number | null
  gradeLevel?: string | null
  status: 'pending' | 'published'
}

// 指导记录
export interface GuidanceRecord {
  id: string
  studentId: string
  studentName?: string
  studentCode?: string
  className?: string
  major?: string
  teacherId: string
  teacherName?: string
  topicId: string
  topicTitle?: string
  recordDate?: string
  content: string
  nextAction?: string
  updatedAt?: string
}

// 公告
export interface Announcement {
  id: string
  title: string
  content: string
  scope: 'all' | 'student' | 'teacher'
  status: 'draft' | 'published'
  authorName?: string
  createdBy?: string
  createdAt?: string
}

// 站内通知
export interface AppNotification {
  id: string
  type?: string
  title: string
  content?: string
  relatedType?: string
  relatedId?: string
  isRead: number | boolean
  createdAt?: string
}

// 全流程阶段顺序（选题 + 后续环节）
export const PROCESS_PHASES: { value: string; label: string }[] = [
  { value: 'topic_submission', label: '课题发布' },
  { value: 'student_selection', label: '学生选课' },
  { value: 'adjustment', label: '调剂' },
  { value: 'result', label: '选题结果' },
  { value: 'task_book', label: '任务书下达' },
  { value: 'proposal', label: '开题' },
  { value: 'midterm', label: '中期检查' },
  { value: 'thesis_design', label: '论文/作品提交' },
  { value: 'defense', label: '答辩' },
  { value: 'grading', label: '成绩评定' },
  { value: 'archive', label: '归档' },
  { value: 'ended', label: '结束' }
]

export const PROCESS_PHASE_LABELS: Record<string, string> = Object.fromEntries(
  PROCESS_PHASES.map(p => [p.value, p.label])
)
