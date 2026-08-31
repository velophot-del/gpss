import type { User, SelectionCycle, Topic, StudentProfile, Application, FinalResult } from '../types'

// ========== 模拟用户 ==========
export const mockUsers: User[] = [
  // 管理员
  {
    id: 'u001',
    username: 'admin',
    password: '123456',
    role: 'admin',
    realName: '系统管理员',
    email: 'admin@sdada.edu.cn',
    createdAt: '2024-01-01T00:00:00Z'
  },
  // 教师
  {
    id: 't001',
    username: 'teacher1',
    password: '123456',
    role: 'teacher',
    realName: '陈教授',
    teacherId: 'T2024001',
    department: '视觉传达设计系',
    title: '教授',
    email: 'chen@sdada.edu.cn',
    phone: '13800001001',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 't002',
    username: 'teacher2',
    password: '123456',
    role: 'teacher',
    realName: '林副教授',
    teacherId: 'T2024002',
    department: '数字媒体艺术系',
    title: '副教授',
    email: 'lin@sdada.edu.cn',
    phone: '13800001002',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 't003',
    username: 'teacher3',
    password: '123456',
    role: 'teacher',
    realName: '黄讲师',
    teacherId: 'T2024003',
    department: '视觉传达设计系',
    title: '讲师',
    email: 'huang@sdada.edu.cn',
    phone: '13800001003',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 't004',
    username: 'teacher4',
    password: '123456',
    role: 'teacher',
    realName: '周教授',
    teacherId: 'T2024004',
    department: '包装工程系',
    title: '教授',
    email: 'zhou@sdada.edu.cn',
    phone: '13800001004',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 't005',
    username: 'teacher5',
    password: '123456',
    role: 'teacher',
    realName: '吴副教授',
    teacherId: 'T2024005',
    department: '智能交互设计系',
    title: '副教授',
    email: 'wu@sdada.edu.cn',
    phone: '13800001005',
    createdAt: '2024-01-01T00:00:00Z'
  },
  // 学生
  {
    id: 's001',
    username: 'student1',
    password: '123456',
    role: 'student',
    realName: '张艺',
    studentId: 'S20240101',
    className: '视觉传达2001班',
    major: '视觉传达设计',
    majorCode: '130502',
    grade: '2020级',
    email: 'zhangyi@student.edu.cn',
    phone: '13900001001',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 's002',
    username: 'student2',
    password: '123456',
    role: 'student',
    realName: '林思远',
    studentId: 'S20240102',
    className: '数字媒体2001班',
    major: '数字媒体艺术（交互方向）',
    majorCode: '130508',
    grade: '2020级',
    email: 'linsiyuan@student.edu.cn',
    phone: '13900001002',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 's003',
    username: 'student3',
    password: '123456',
    role: 'student',
    realName: '王涵',
    studentId: 'S20240103',
    className: '视觉传达2002班',
    major: '视觉传达设计',
    majorCode: '130502',
    grade: '2020级',
    email: 'wanghan@student.edu.cn',
    phone: '13900001003',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 's004',
    username: 'student4',
    password: '123456',
    role: 'student',
    realName: '赵明哲',
    studentId: 'S20240104',
    className: '包装工程2001班',
    major: '包装工程',
    majorCode: '081702',
    grade: '2020级',
    email: 'zhaomingzhe@student.edu.cn',
    phone: '13900001004',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 's005',
    username: 'student5',
    password: '123456',
    role: 'student',
    realName: '孙晓萌',
    studentId: 'S20240105',
    className: '智能交互2001班',
    major: '智能交互（工科）',
    majorCode: '080906T',
    grade: '2020级',
    email: 'sunxiaomeng@student.edu.cn',
    phone: '13900001005',
    createdAt: '2024-01-01T00:00:00Z'
  },
  {
    id: 's006',
    username: 'student6',
    password: '123456',
    role: 'student',
    realName: '刘诗雨',
    studentId: 'S20240106',
    className: '数字媒体2002班',
    major: '数字媒体艺术（交互方向）',
    majorCode: '130508',
    grade: '2020级',
    email: 'liushiyu@student.edu.cn',
    phone: '13900001006',
    createdAt: '2024-01-01T00:00:00Z'
  }
]

// ========== 模拟选题周期 ==========
export const mockCycles: SelectionCycle[] = [
  {
    id: 'c001',
    name: '2025届山东工艺美术学院视觉传达设计学院本科毕业设计选题',
    description: '2025届山东工艺美术学院视觉传达设计学院本科毕业设计（论文）选题工作，涵盖视觉传达设计、数字媒体艺术（交互方向）、包装工程、智能交互等专业方向',
    year: '2025',
    topicPublishStart: '2024-12-01T00:00:00Z',
    topicPublishEnd: '2024-12-20T23:59:59Z',
    studentApplyStart: '2024-12-21T00:00:00Z',
    studentApplyEnd: '2025-01-10T23:59:59Z',
    teacherReviewStart: '2025-01-11T00:00:00Z',
    teacherReviewEnd: '2025-01-20T23:59:59Z',
    resultAnnounceTime: '2025-01-22T10:00:00Z',
    adjustmentStart: '2025-01-22T14:00:00Z',
    adjustmentEnd: '2025-01-25T23:59:59Z',
    status: 'active',
    createdAt: '2024-11-15T00:00:00Z'
  }
]

// ========== 模拟课题 ==========
export const mockTopics: Topic[] = [
  {
    id: 'tp001',
    teacherId: 't001',
    teacherName: '陈教授',
    cycleId: 'c001',
    title: '非遗文化传承的现代品牌视觉设计研究——以蜀锦纹样为例',
    category: '品牌形象设计',
    description: '本项目以四川蜀锦传统纹样为切入点，研究如何将非物质文化遗产元素转化为现代品牌视觉语言。学生需完成纹样提取、视觉符号转译、品牌VI系统设计和应用延展，最终形成一套完整的品牌形象设计方案。',
    requirements: '1. 熟练使用Adobe Illustrator和Photoshop\n2. 具备品牌设计基础知识\n3. 对中国传统文化有兴趣和一定了解\n4. 有较强的图案提取与再创作能力',
    difficulty: 'hard',
    maxStudents: 2,
    currentCount: 0,
    status: 'published',
    schedules: [
      { phase: '调研与资料收集', startDate: '2025-02-15', endDate: '2025-03-15', description: '蜀锦纹样实地调研、文献研究、素材整理' },
      { phase: '创意构思', startDate: '2025-03-16', endDate: '2025-04-10', description: '视觉符号提取、品牌定位、方案草图' },
      { phase: '设计深化', startDate: '2025-04-11', endDate: '2025-05-15', description: 'VI手册设计、应用延展设计' },
      { phase: '实物制作', startDate: '2025-05-16', endDate: '2025-05-30', description: '设计作品实物化、布展准备' },
      { phase: '论文撰写与答辩', startDate: '2025-06-01', endDate: '2025-06-10', description: '毕业论文撰写与答辩准备' }
    ],
    attachments: [
      { id: 'att001', name: '蜀锦纹样参考图库.zip', url: '#', size: 45000000, type: 'zip', uploadedAt: '2024-12-05T10:00:00Z' }
    ],
    tags: ['品牌设计', '非遗文化', 'VI设计', '图案设计', '传统文化'],
    viewCount: 189,
    applyCount: 10,
    createdAt: '2024-12-05T09:00:00Z',
    updatedAt: '2024-12-05T09:00:00Z'
  },
  {
    id: 'tp002',
    teacherId: 't001',
    teacherName: '陈教授',
    cycleId: 'c001',
    title: '新消费品牌包装设计创新研究——以茶饮品牌为例',
    category: '包装设计',
    description: '聚焦新消费时代下的茶饮品牌包装设计，研究消费者心理与包装视觉的关系。学生需完成市场调研、包装结构设计、视觉呈现和系列化延展，最终交付可落地的包装设计方案。',
    requirements: '1. 具备包装设计基础，了解包装结构与印刷工艺\n2. 熟练使用设计软件（AI/PS/ID）\n3. 对消费品牌和市场趋势有敏感度\n4. 能独立完成包装打样',
    difficulty: 'medium',
    maxStudents: 3,
    currentCount: 0,
    status: 'published',
    schedules: [
      { phase: '市场调研', startDate: '2025-02-15', endDate: '2025-03-10', description: '竞品分析、消费者调研、趋势研究' },
      { phase: '方案设计', startDate: '2025-03-11', endDate: '2025-04-30', description: '包装结构设计、视觉设计、系列化' },
      { phase: '打样测试', startDate: '2025-05-01', endDate: '2025-05-25', description: '实物打样、用户测试、优化调整' },
      { phase: '论文与展示', startDate: '2025-05-26', endDate: '2025-06-10', description: '论文撰写与毕业展览' }
    ],
    attachments: [],
    tags: ['包装设计', '品牌', '茶饮', '消费趋势', '印刷工艺'],
    viewCount: 234,
    applyCount: 14,
    createdAt: '2024-12-06T10:00:00Z',
    updatedAt: '2024-12-06T10:00:00Z'
  },
  {
    id: 'tp003',
    teacherId: 't002',
    teacherName: '林副教授',
    cycleId: 'c001',
    title: '面向老年群体的移动端交互界面适老化设计研究',
    category: '用户体验设计',
    description: '针对中国老龄化社会趋势，研究老年用户群体的数字产品使用习惯与痛点，设计一套符合适老化标准的移动端交互界面。包含用户研究、交互原型、视觉设计和可用性测试。',
    requirements: '1. 熟悉Figma或Sketch等UI设计工具\n2. 了解交互设计基本原则\n3. 有用户研究方法论基础\n4. 具备同理心和人文关怀意识',
    difficulty: 'medium',
    maxStudents: 2,
    currentCount: 0,
    status: 'published',
    schedules: [],
    attachments: [
      { id: 'att003', name: '适老化设计标准参考.pdf', url: '#', size: 2500000, type: 'pdf', uploadedAt: '2024-12-07T11:00:00Z' }
    ],
    tags: ['交互设计', '适老化', 'UI设计', '用户体验', 'Figma'],
    viewCount: 156,
    applyCount: 8,
    createdAt: '2024-12-07T10:00:00Z',
    updatedAt: '2024-12-07T10:00:00Z'
  },
  {
    id: 'tp004',
    teacherId: 't002',
    teacherName: '林副教授',
    cycleId: 'c001',
    title: '基于TouchDesigner的沉浸式动态视觉装置设计',
    category: '动态视觉与动画',
    description: '利用TouchDesigner实时视觉编程平台，设计一套沉浸式动态视觉装置。探索声音、光影与空间的交互关系，最终呈现一个可在展览中展示的互动媒体艺术作品。',
    requirements: '1. 有动态图形或视频制作经验\n2. 对TouchDesigner/Processing有兴趣和学习意愿\n3. 具备空间感知和审美能力\n4. 有跨媒介创作经验者优先',
    difficulty: 'hard',
    maxStudents: 2,
    currentCount: 0,
    status: 'published',
    schedules: [],
    attachments: [],
    tags: ['动态视觉', 'TouchDesigner', '装置艺术', '互动媒体', '新媒体艺术'],
    viewCount: 178,
    applyCount: 9,
    createdAt: '2024-12-08T10:00:00Z',
    updatedAt: '2024-12-08T10:00:00Z'
  },
  {
    id: 'tp005',
    teacherId: 't003',
    teacherName: '黄讲师',
    cycleId: 'c001',
    title: '城市文化IP的绘本创作与衍生品设计',
    category: '书籍与绘本设计',
    description: '以某城市的文化IP为主题，创作一本完整的儿童绘本，并进行衍生文创产品设计。涵盖故事构思、角色设计、分镜绘制、书籍装帧和周边产品开发。',
    requirements: '1. 有扎实的手绘或板绘功底\n2. 对绘本叙事结构有理解\n3. 具备角色造型设计能力\n4. 了解书籍装帧工艺',
    difficulty: 'medium',
    maxStudents: 2,
    currentCount: 0,
    status: 'published',
    schedules: [],
    attachments: [
      { id: 'att005', name: '城市文化IP素材包.zip', url: '#', size: 80000000, type: 'zip', uploadedAt: '2024-12-09T14:00:00Z' }
    ],
    tags: ['绘本设计', '插画', 'IP设计', '书籍装帧', '文创衍生'],
    viewCount: 210,
    applyCount: 12,
    createdAt: '2024-12-09T13:00:00Z',
    updatedAt: '2024-12-09T13:00:00Z'
  },
  {
    id: 'tp006',
    teacherId: 't003',
    teacherName: '黄讲师',
    cycleId: 'c001',
    title: '当代中文字体设计实验——可变字体的探索与应用',
    category: '字体与版式设计',
    description: '探索可变字体（Variable Font）技术在中文设计中的应用可能。研究中文可变字体的设计方法，开发一套实验性可变字体，并完成字体样张和排版应用设计。',
    requirements: '1. 对字体设计有浓厚兴趣\n2. 了解Glyphs或FontLab等字体设计软件\n3. 有版式设计基础\n4. 耐心细致，注重细节',
    difficulty: 'hard',
    maxStudents: 1,
    currentCount: 0,
    status: 'published',
    schedules: [],
    attachments: [],
    tags: ['字体设计', '可变字体', '版式设计', 'Glyphs', '实验设计'],
    viewCount: 145,
    applyCount: 6,
    createdAt: '2024-12-10T09:00:00Z',
    updatedAt: '2024-12-10T09:00:00Z'
  },
  {
    id: 'tp007',
    teacherId: 't004',
    teacherName: '周教授',
    cycleId: 'c001',
    title: '绿色可持续包装结构设计——可降解材料的创新应用',
    category: '包装结构与工艺',
    description: '在双碳背景下，研究可降解环保材料在包装结构中的创新应用。学生需完成材料测试、结构设计、力学分析和实物制作，提出兼顾环保与功能性的包装解决方案。',
    requirements: '1. 了解包装材料学基础知识\n2. 有Rhino或SolidWorks三维建模能力\n3. 具备包装结构设计思维\n4. 动手能力强，能完成实物制作',
    difficulty: 'medium',
    maxStudents: 2,
    currentCount: 0,
    status: 'published',
    schedules: [],
    attachments: [
      { id: 'att007', name: '可降解材料性能参数表.xlsx', url: '#', size: 35000, type: 'xlsx', uploadedAt: '2024-12-11T10:00:00Z' }
    ],
    tags: ['包装结构', '可持续设计', '环保材料', '3D建模', '绿色包装'],
    viewCount: 132,
    applyCount: 5,
    createdAt: '2024-12-11T10:00:00Z',
    updatedAt: '2024-12-11T10:00:00Z'
  },
  {
    id: 'tp008',
    teacherId: 't004',
    teacherName: '周教授',
    cycleId: 'c001',
    title: '智能温控包装系统的设计与实现',
    category: '智能包装系统',
    description: '设计一套集成温度传感器和物联网模块的智能温控包装系统，适用于生鲜冷链运输场景。包含硬件选型、结构设计、嵌入式开发和系统测试。',
    requirements: '1. 有Arduino或嵌入式开发经验\n2. 了解传感器技术基础\n3. 具备包装结构设计能力\n4. 有跨学科协作能力',
    difficulty: 'hard',
    maxStudents: 2,
    currentCount: 0,
    status: 'published',
    schedules: [],
    attachments: [],
    tags: ['智能包装', 'IoT', '传感器', '冷链', '嵌入式'],
    viewCount: 98,
    applyCount: 4,
    createdAt: '2024-12-12T09:00:00Z',
    updatedAt: '2024-12-12T09:00:00Z'
  },
  {
    id: 'tp009',
    teacherId: 't005',
    teacherName: '吴副教授',
    cycleId: 'c001',
    title: '基于AI生成技术的创意设计辅助工具开发',
    category: 'AI创意设计',
    description: '探索AI图像生成技术（如Stable Diffusion、Midjourney API）在设计流程中的应用。开发一个面向设计师的AI辅助创意工具原型，支持风格迁移、灵感生成和设计变体探索。',
    requirements: '1. 有Python编程基础\n2. 对AI生成技术有了解或浓厚兴趣\n3. 具备产品设计思维\n4. 了解设计师工作流程',
    difficulty: 'hard',
    maxStudents: 2,
    currentCount: 0,
    status: 'published',
    schedules: [],
    attachments: [],
    tags: ['AI设计', '生成式AI', 'StableDiffusion', '创意工具', 'Python'],
    viewCount: 267,
    applyCount: 16,
    createdAt: '2024-12-13T10:00:00Z',
    updatedAt: '2024-12-13T10:00:00Z'
  },
  {
    id: 'tp010',
    teacherId: 't005',
    teacherName: '吴副教授',
    cycleId: 'c001',
    title: '博物馆智能导览交互装置设计',
    category: '智能交互装置',
    description: '为博物馆展陈设计一套智能导览交互装置。结合计算机视觉、手势识别和增强现实技术，打造沉浸式观展体验。包含交互方案设计、硬件原型搭建和软件系统开发。',
    requirements: '1. 了解Arduino/树莓派等硬件平台\n2. 有Processing或TouchDesigner使用经验\n3. 对交互装置设计有热情\n4. 具备团队合作精神',
    difficulty: 'hard',
    maxStudents: 2,
    currentCount: 0,
    status: 'published',
    schedules: [],
    attachments: [],
    tags: ['交互装置', '博物馆', 'AR', '硬件原型', '用户体验'],
    viewCount: 156,
    applyCount: 7,
    createdAt: '2024-12-14T09:00:00Z',
    updatedAt: '2024-12-14T09:00:00Z'
  },
  {
    id: 'tp011',
    teacherId: 't001',
    teacherName: '陈教授',
    cycleId: 'c001',
    title: '亚文化圈层的视觉符号系统研究——以Z世代潮流品牌为例',
    category: '插画与视觉艺术',
    description: '研究Z世代亚文化圈层的视觉符号特征，提取核心视觉元素并进行创意转化。完成一套面向年轻消费群体的潮流品牌视觉系统，包括插画风格设定、符号系统设计和跨界应用方案。',
    requirements: '1. 有插画创作能力，风格鲜明\n2. 对潮流文化和亚文化有了解\n3. 具备视觉系统设计思维\n4. 熟练使用Procreate/PS等绘画工具',
    difficulty: 'medium',
    maxStudents: 2,
    currentCount: 0,
    status: 'published',
    schedules: [],
    attachments: [],
    tags: ['插画', '潮流文化', '视觉符号', 'Z世代', '品牌设计'],
    viewCount: 245,
    applyCount: 13,
    createdAt: '2024-12-15T10:00:00Z',
    updatedAt: '2024-12-15T10:00:00Z'
  },
  {
    id: 'tp012',
    teacherId: 't002',
    teacherName: '林副教授',
    cycleId: 'c001',
    title: '短视频平台的动态信息可视化设计',
    category: '数字媒体艺术',
    description: '针对短视频平台的信息传播特点，设计一套动态信息可视化方案。利用Motion Graphics技术，将复杂数据转化为易于传播的动态视觉内容，探索数据新闻与社交媒体的交叉领域。',
    requirements: '1. 熟练使用After Effects\n2. 有信息设计或数据可视化基础\n3. 了解短视频平台内容生态\n4. 具备叙事设计能力',
    difficulty: 'medium',
    maxStudents: 2,
    currentCount: 0,
    status: 'published',
    schedules: [],
    attachments: [],
    tags: ['动态图形', '数据可视化', 'AE', '短视频', '信息设计'],
    viewCount: 198,
    applyCount: 11,
    createdAt: '2024-12-16T09:00:00Z',
    updatedAt: '2024-12-16T09:00:00Z'
  }
]

// ========== 模拟学生档案 ==========
export const mockStudentProfiles: StudentProfile[] = [
  {
    userId: 's001',
    studentId: 'S20240101',
    className: '视觉传达2001班',
    major: '视觉传达设计',
    grade: '2020级',
    gpa: 3.85,
    ranking: 3,
    totalStudents: 45,
    skills: ['Illustrator', 'Photoshop', 'InDesign', 'Figma', '品牌策划', '手绘插画'],
    interests: ['品牌形象设计', '插画与视觉艺术', '包装设计'],
    personalStatement: '我对品牌视觉设计和传统文化创新有浓厚兴趣。大学期间参与了多个品牌设计项目和文创比赛，擅长将东方美学融入现代设计语言。希望在毕设中深入探索品牌视觉系统的构建方法。',
    portfolio: [
      { id: 'p001', title: '「山海经」文创品牌视觉设计', type: 'image', url: '#', description: '以山海经为主题的文创品牌VI设计作品', uploadedAt: '2024-06-15T10:00:00Z' },
      { id: 'p002', title: '课程作品集', type: 'pdf', url: '#', description: '大学期间精选设计作品合集', uploadedAt: '2024-12-20T10:00:00Z' }
    ],
    contactEmail: 'zhangyi@student.edu.cn',
    contactPhone: '13900001001',
    isComplete: true,
    completedAt: '2024-12-20T15:30:00Z',
    updatedAt: '2024-12-20T15:30:00Z'
  },
  {
    userId: 's002',
    studentId: 'S20240102',
    className: '数字媒体2001班',
    major: '数字媒体艺术（交互方向）',
    grade: '2020级',
    gpa: 3.72,
    ranking: 8,
    totalStudents: 40,
    skills: ['Figma', 'After Effects', 'Sketch', 'UI设计', 'UX研究', '动态图形'],
    interests: ['交互界面设计', '用户体验设计', '动态视觉与动画'],
    personalStatement: '专注于交互设计和用户体验方向，对适老化设计和包容性设计特别关注。希望用设计让数字产品更温暖、更易用。有多次用户研究和可用性测试项目经验。',
    portfolio: [
      { id: 'p003', title: '「乐龄助手」适老化APP设计', type: 'link', url: 'https://figma.com/example', description: '面向老年人的健康管理APP交互原型', uploadedAt: '2024-09-15T10:00:00Z' }
    ],
    contactEmail: 'linsiyuan@student.edu.cn',
    contactPhone: '13900001002',
    isComplete: true,
    completedAt: '2024-12-21T10:00:00Z',
    updatedAt: '2024-12-21T10:00:00Z'
  },
  {
    userId: 's003',
    studentId: 'S20240103',
    className: '视觉传达2002班',
    major: '视觉传达设计',
    grade: '2020级',
    gpa: 3.65,
    ranking: 12,
    totalStudents: 45,
    skills: ['Photoshop', 'Illustrator', 'Procreate', '手绘插画', '版式设计', '书籍装帧'],
    interests: ['书籍与绘本设计', '字体与版式设计', '插画与视觉艺术'],
    personalStatement: '热爱绘本创作和书籍设计，擅长手绘与数字绘画结合。曾参与校内绘本创作工作坊，独立完成过一本原创绘本的创作和装帧设计。希望毕设能在绘本和文创衍生方向深入探索。',
    portfolio: [],
    contactEmail: 'wanghan@student.edu.cn',
    contactPhone: '13900001003',
    isComplete: false,
    updatedAt: '2024-12-19T16:00:00Z'
  },
  {
    userId: 's004',
    studentId: 'S20240104',
    className: '包装工程2001班',
    major: '包装工程',
    grade: '2020级',
    gpa: 3.90,
    ranking: 1,
    totalStudents: 35,
    skills: ['SolidWorks', 'Rhino', 'AutoCAD', 'KeyShot', '包装结构', '3D建模'],
    interests: ['包装结构与工艺', '智能包装系统', '可持续设计'],
    personalStatement: '对包装结构设计和智能制造有深入研究。在校期间参与过多个包装创新项目，擅长参数化建模和结构优化分析。希望毕设能在智能包装或可持续包装方向做出创新成果。',
    portfolio: [
      { id: 'p004', title: '可折叠快递包装结构设计', type: 'model', url: '#', description: '基于拓扑优化的可折叠包装结构方案', uploadedAt: '2024-10-20T10:00:00Z' }
    ],
    contactEmail: 'zhaomingzhe@student.edu.cn',
    contactPhone: '13900001004',
    isComplete: true,
    completedAt: '2024-12-20T20:00:00Z',
    updatedAt: '2024-12-20T20:00:00Z'
  },
  {
    userId: 's005',
    studentId: 'S20240105',
    className: '智能交互2001班',
    major: '智能交互（工科）',
    grade: '2020级',
    gpa: 3.55,
    ranking: 10,
    totalStudents: 30,
    skills: ['Arduino', 'Processing', 'Python创意编程', 'TouchDesigner', '3D建模', 'Blender'],
    interests: ['智能交互装置', 'AI创意设计', '跨媒介设计'],
    personalStatement: '热衷于技术与艺术的交叉领域，擅长将编程与硬件交互融入设计创作。在校期间完成了多个互动装置作品，对AI生成设计方向充满好奇。希望毕设能打造一个真正有交互体验的作品。',
    portfolio: [
      { id: 'p005', title: '「呼吸」互动灯光装置', type: 'video', url: '#', description: '基于Arduino和传感器的互动灯光装置作品', uploadedAt: '2024-11-10T10:00:00Z' }
    ],
    contactEmail: 'sunxiaomeng@student.edu.cn',
    contactPhone: '13900001005',
    isComplete: true,
    completedAt: '2024-12-22T14:00:00Z',
    updatedAt: '2024-12-22T14:00:00Z'
  },
  {
    userId: 's006',
    studentId: 'S20240106',
    className: '数字媒体2002班',
    major: '数字媒体艺术（交互方向）',
    grade: '2020级',
    gpa: 3.78,
    ranking: 5,
    totalStudents: 40,
    skills: ['After Effects', 'Premiere', 'Cinema 4D', 'Blender', '动态图形', 'Figma'],
    interests: ['动态视觉与动画', '数字媒体艺术', '跨媒介设计'],
    personalStatement: '专注于动态视觉和新媒体艺术创作。擅长3D动画和Motion Graphics，有多次视频创作和展览经验。希望能结合动态视觉与数据叙事完成一个有社会意义的毕业设计。',
    portfolio: [
      { id: 'p006', title: '「城市脉动」数据可视化短片', type: 'video', url: '#', description: '基于城市数据的动态信息可视化短片', uploadedAt: '2024-12-01T10:00:00Z' }
    ],
    contactEmail: 'liushiyu@student.edu.cn',
    contactPhone: '13900001006',
    isComplete: true,
    completedAt: '2024-12-23T09:00:00Z',
    updatedAt: '2024-12-23T09:00:00Z'
  }
]

// ========== 模拟志愿申请 ==========
export const mockApplications: Application[] = [
  // 张艺（视觉传达）的志愿
  {
    id: 'a001', studentId: 's001', studentName: '张艺', topicId: 'tp001', topicTitle: '非遗文化传承的现代品牌视觉设计研究——以蜀锦纹样为例',
    priority: 1, status: 'submitted', motivation: '我的品牌设计经验和非遗文化兴趣与这个课题高度匹配。之前做过山海经文创品牌项目，对传统文化转译为现代设计语言有丰富经验。',
    submittedAt: '2024-12-25T10:00:00Z'
  },
  {
    id: 'a002', studentId: 's001', studentName: '张艺', topicId: 'tp011', topicTitle: '亚文化圈层的视觉符号系统研究——以Z世代潮流品牌为例',
    priority: 2, status: 'submitted', motivation: '对潮流文化也很有兴趣，可以作为第二选择。',
    submittedAt: '2024-12-25T10:05:00Z'
  },
  {
    id: 'a003', studentId: 's001', studentName: '张艺', topicId: 'tp002', topicTitle: '新消费品牌包装设计创新研究——以茶饮品牌为例',
    priority: 3, status: 'submitted', motivation: '包装设计也是我的兴趣方向，愿意尝试。',
    submittedAt: '2024-12-25T10:10:00Z'
  },
  // 林思远（数字媒体艺术）的志愿
  {
    id: 'a004', studentId: 's002', studentName: '林思远', topicId: 'tp003', topicTitle: '面向老年群体的移动端交互界面适老化设计研究',
    priority: 1, status: 'submitted', motivation: '这是我最有热情的方向！之前做的「乐龄助手」项目就是这个方向，积累了丰富的适老化设计经验。',
    submittedAt: '2024-12-26T14:00:00Z'
  },
  {
    id: 'a005', studentId: 's002', studentName: '林思远', topicId: 'tp012', topicTitle: '短视频平台的动态信息可视化设计',
    priority: 2, status: 'submitted', motivation: '动态信息设计也很有挑战性，可以拓展我的技能边界。',
    submittedAt: '2024-12-26T14:05:00Z'
  },
  {
    id: 'a006', studentId: 's002', studentName: '林思远', topicId: 'tp004', topicTitle: '基于TouchDesigner的沉浸式动态视觉装置设计',
    priority: 3, status: 'submitted', motivation: '对新媒体的交互装置设计感兴趣，想尝试跨媒介创作。',
    submittedAt: '2024-12-26T14:10:00Z'
  },
  // 王涵（视觉传达）的志愿
  {
    id: 'a007', studentId: 's003', studentName: '王涵', topicId: 'tp005', topicTitle: '城市文化IP的绘本创作与衍生品设计',
    priority: 1, status: 'submitted', motivation: '绘本创作是我最热爱的事情！我希望用画笔讲述城市故事，结合文创衍生品让作品更有延展性。',
    submittedAt: '2024-12-27T09:00:00Z'
  },
  {
    id: 'a008', studentId: 's003', studentName: '王涵', topicId: 'tp006', topicTitle: '当代中文字体设计实验——可变字体的探索与应用',
    priority: 2, status: 'submitted', motivation: '字体设计也是我一直想深入学习的领域，可变字体非常前沿。',
    submittedAt: '2024-12-27T09:05:00Z'
  },
  {
    id: 'a009', studentId: 's003', studentName: '王涵', topicId: 'tp011', topicTitle: '亚文化圈层的视觉符号系统研究——以Z世代潮流品牌为例',
    priority: 3, status: 'submitted', motivation: '插画方向的课题都可以考虑。',
    submittedAt: '2024-12-27T09:10:00Z'
  },
  // 赵明哲（包装工程）的志愿
  {
    id: 'a010', studentId: 's004', studentName: '赵明哲', topicId: 'tp007', topicTitle: '绿色可持续包装结构设计——可降解材料的创新应用',
    priority: 1, status: 'submitted', motivation: '我的包装结构设计能力与这个课题完美匹配。之前做过可折叠快递包装项目，对可持续设计方向有深入研究和热情。',
    submittedAt: '2024-12-28T11:00:00Z'
  },
  {
    id: 'a011', studentId: 's004', studentName: '赵明哲', topicId: 'tp008', topicTitle: '智能温控包装系统的设计与实现',
    priority: 2, status: 'submitted', motivation: '智能包装是未来趋势，我的嵌入式开发能力可以在这个课题中发挥作用。',
    submittedAt: '2024-12-28T11:05:00Z'
  },
  {
    id: 'a012', studentId: 's004', studentName: '赵明哲', topicId: 'tp002', topicTitle: '新消费品牌包装设计创新研究——以茶饮品牌为例',
    priority: 3, status: 'submitted', motivation: '也可以尝试偏视觉方向的包装课题。',
    submittedAt: '2024-12-28T11:10:00Z'
  },
  // 孙晓萌（智能交互）的志愿
  {
    id: 'a013', studentId: 's005', studentName: '孙晓萌', topicId: 'tp009', topicTitle: '基于AI生成技术的创意设计辅助工具开发',
    priority: 1, status: 'pending_review', motivation: 'AI+设计的交叉方向正是我的兴趣所在！我具备编程和设计的双重能力，希望能打造一款真正有用的AI设计工具。',
    submittedAt: '2024-12-29T16:00:00Z'
  },
  {
    id: 'a014', studentId: 's005', studentName: '孙晓萌', topicId: 'tp010', topicTitle: '博物馆智能导览交互装置设计',
    priority: 2, status: 'pending_review', motivation: '交互装置也是我的擅长方向，之前做过互动灯光装置。',
    submittedAt: '2024-12-29T16:05:00Z'
  },
  {
    id: 'a015', studentId: 's005', studentName: '孙晓萌', topicId: 'tp004', topicTitle: '基于TouchDesigner的沉浸式动态视觉装置设计',
    priority: 3, status: 'pending_review', motivation: 'TouchDesigner也是我熟悉的技术平台。',
    submittedAt: '2024-12-29T16:10:00Z'
  },
  // 刘诗雨（数字媒体艺术）的志愿
  {
    id: 'a016', studentId: 's006', studentName: '刘诗雨', topicId: 'tp012', topicTitle: '短视频平台的动态信息可视化设计',
    priority: 1, status: 'submitted', motivation: '这正是我擅长的方向！我的AE和C4D技能可以充分发挥，数据可视化短片也是我的作品集亮点。',
    submittedAt: '2024-12-30T10:00:00Z'
  },
  {
    id: 'a017', studentId: 's006', studentName: '刘诗雨', topicId: 'tp004', topicTitle: '基于TouchDesigner的沉浸式动态视觉装置设计',
    priority: 2, status: 'submitted', motivation: '沉浸式装置设计也很有吸引力，可以拓展我的创作边界。',
    submittedAt: '2024-12-30T10:05:00Z'
  },
  {
    id: 'a018', studentId: 's006', studentName: '刘诗雨', topicId: 'tp010', topicTitle: '博物馆智能导览交互装置设计',
    priority: 3, status: 'submitted', motivation: '对博物馆展陈设计也有兴趣。',
    submittedAt: '2024-12-30T10:10:00Z'
  }
]

// ========== 模拟最终结果 ==========
export const mockFinalResults: FinalResult[] = []
