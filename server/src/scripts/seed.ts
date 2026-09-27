import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveDatabaseConfig } from '../config/runtime.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config()

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  throw new Error('生产环境禁止执行演示种子数据；如需导入经审核的数据，请使用独立导入流程并显式设置 ALLOW_DEMO_SEED=true')
}

const dbConfig = resolveDatabaseConfig()

// 默认密码：123456
const DEFAULT_PASSWORD = bcrypt.hashSync('123456', 10)

async function seed() {
  const conn = await mysql.createConnection(dbConfig)

  console.log('开始导入种子数据...')

  // 防重复导入：目标库已有数据时中止（除非显式传 --force），避免产生第二个进行中周期与重复录取
  if (!process.argv.includes('--force')) {
    const result: any = await conn.query(
      'SELECT (SELECT COUNT(*) FROM cycles) + (SELECT COUNT(*) FROM topics) AS total'
    )
    const total = Number(result?.[0]?.[0]?.total || 0)
    if (total > 0) {
      console.error('检测到数据库已有数据（cycles/topics 非空）。为防止重复导入产生第二个进行中周期与重复录取，已中止。')
      console.error('如需重建：请先清空目标库；或显式传 --force 跳过本检查。')
      process.exit(1)
    }
  }

  // ===== 管理员 =====
  await conn.query(`
    INSERT INTO users (id, username, password, real_name, email, role, phone) VALUES
    ('admin-001', 'admin', ?, '系统管理员', 'admin@sdada.edu.cn', 'admin', '0531-88880001')
  `, [DEFAULT_PASSWORD])
  console.log('✅ 管理员已创建 (admin / 123456)')

  // ===== 教师 =====
  const teachers = [
    { id: 't001', name: '陈教授', username: 'chen', title: '教授', dept: '视觉传达设计系', email: 'chen@sdada.edu.cn' },
    { id: 't002', name: '林副教授', username: 'lin', title: '副教授', dept: '数字媒体艺术系', email: 'lin@sdada.edu.cn' },
    { id: 't003', name: '黄讲师', username: 'huang', title: '讲师', dept: '视觉传达设计系', email: 'huang@sdada.edu.cn' },
    { id: 't004', name: '周教授', username: 'zhou', title: '教授', dept: '包装工程系', email: 'zhou@sdada.edu.cn' },
    { id: 't005', name: '吴副教授', username: 'wu', title: '副教授', dept: '智能交互设计系', email: 'wu@sdada.edu.cn' },
  ]

  for (const t of teachers) {
    await conn.query(`
      INSERT INTO users (id, username, password, real_name, email, role, title, department, phone)
      VALUES (?, ?, ?, ?, ?, 'teacher', ?, ?, ?)
    `, [t.id, t.username, DEFAULT_PASSWORD, t.name, t.email, t.title, t.dept, `138${Math.floor(Math.random()*100000000).toString().padStart(8,'0')}`])
  }
  console.log(`✅ ${teachers.length} 名教师已创建`)

  // ===== 学生 =====
  const students = [
    { id: 's001', name: '张艺', username: 'zhangyi', studentId: '2021305001', className: '视传2101班', major: '视觉传达设计', majorCode: '130502', grade: '2025届' },
    { id: 's002', name: '王涵', username: 'wanghan', studentId: '2021305020', className: '视传2102班', major: '视觉传达设计', majorCode: '130502', grade: '2025届' },
    { id: 's003', name: '林思远', username: 'linsiyuan', studentId: '2021508017', className: '数媒2101班', major: '数字媒体艺术（交互方向）', majorCode: '130508', grade: '2025届' },
    { id: 's004', name: '刘诗雨', username: 'liushiyu', studentId: '2021508024', className: '数媒2102班', major: '数字媒体艺术（交互方向）', majorCode: '130508', grade: '2025届' },
    { id: 's005', name: '赵明哲', username: 'zhaomingzhe', studentId: '2018170211', className: '包装2101班', major: '包装工程', majorCode: '081702', grade: '2025届' },
    { id: 's006', name: '孙晓萌', username: 'sunxiaomeng', studentId: '2009060105', className: '智交2101班', major: '智能交互设计', majorCode: '080218T', grade: '2025届' },
  ]

  for (const s of students) {
    await conn.query(`
      INSERT INTO users (id, username, password, real_name, email, role, student_id, class_name, major, major_code, grade)
      VALUES (?, ?, ?, ?, CONCAT(?, '@stu.sdada.edu.cn'), 'student', ?, ?, ?, ?, ?)
    `, [s.id, s.username, DEFAULT_PASSWORD, s.name, s.username, s.studentId, s.className, s.major, s.majorCode, s.grade])

    // 学生档案
    const skills = {
      [s.id]: ['Photoshop', 'Illustrator', 'Figma'],
      ['s002']: ['手绘插画', '品牌策划', 'InDesign'],
      ['s003']: ['Figma', 'After Effects', 'Cinema 4D'],
      ['s004']: ['UI设计', 'UX研究', 'Sketch'],
      ['s005']: ['Rhino', 'SolidWorks', 'KeyShot'],
      ['s006']: ['Arduino', 'Processing', 'Python创意编程'],
    }

    await conn.query(`
      INSERT INTO student_profiles (id, user_id, gpa, ranking, total_students, skills, interests, self_intro)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuidv4(), s.id,
      (3.2 + Math.random() * 1.5).toFixed(2),
      Math.floor(Math.random() * 60 + 1),
      120,
      JSON.stringify(skills[s.id] || skills['s001']),
      JSON.stringify(['品牌形象与VI设计', '包装视觉与结构设计', '交互界面与系统设计']),
      `我是${s.major}专业的学生，对毕业设计充满期待。`,
    ])
  }
  console.log(`✅ ${students.length} 名学生及档案已创建`)

  // ===== 选题周期 =====
  const cycleResult = await conn.query(`
    INSERT INTO cycles (name, description, year, status, phase, start_date, end_date, phases_config)
    VALUES (
      '2025届山东工艺美术学院视觉传达设计学院本科毕业设计选题',
      '涵盖视觉传达设计、数字媒体艺术、包装工程、智能交互等专业方向',
      '2025',
      'active',
      'student_selection',
      '2025-01-10',
      '2025-06-30',
      ?
    )
  `, [JSON.stringify({
    topic_submission: { start: '2025-01-10', end: '2025-02-28', label: '课题申报阶段' },
    student_selection: { start: '2025-03-01', end: '2025-03-31', label: '学生选课阶段' },
    adjustment: { start: '2025-04-01', end: '2025-04-15', label: '调整阶段' },
    result: { start: '2025-04-16', end: '2025-04-30', label: '结果公示' },
    ended: { start: '2025-05-01', end: '2025-06-30', label: '结束' }
  })])
  const cycleId = (cycleResult[0] as any).insertId
  console.log('✅ 选题周期已创建')

  // ===== 课题 =====
  const topics = [
    { title: '非遗蜀锦纹样在现代品牌VI中的创新应用研究', category: '品牌形象与VI设计', difficulty: 'hard', teacherId: 't001', maxStudents: 1, majorCode: '130502', major: '视觉传达设计', tags: ['非遗', '蜀锦', '品牌VI', '传统文化'], desc: '以四川成都蜀锦传统纹样为研究对象，探索其在现代品牌视觉识别系统中的创新转化路径。要求学生具备较强的图形设计能力和文化研究能力。' },
    { title: '新式茶饮品牌"茶境"全案包装与空间视觉设计', category: '包装系统集成与产品设计', difficulty: 'medium', teacherId: 't001', maxStudents: 2, majorCode: '081702', major: '包装工程', tags: ['茶饮品牌', '包装设计', '空间设计'], desc: '为虚构新式茶饮品牌"茶境"进行完整的品牌包装体系及门店空间视觉设计。' },
    { title: '适老化智能家居APP交互界面设计与可用性研究', category: '交互界面与系统设计', difficulty: 'hard', teacherId: 't002', maxStudents: 1, majorCode: '080218T', major: '智能交互设计', tags: ['适老化', '智能家居', '交互设计', '可用性'], desc: '针对65+老年用户群体，设计一套智能家居控制应用的交互方案，并进行可用性测试验证。需掌握Figma和用户研究方法。' },
    { title: '城市记忆——济南泉水文化沉浸式动态视觉装置设计', category: '数字媒体叙事与创作', difficulty: 'hard', teacherId: 't002', maxStudents: 1, majorCode: '130508', major: '数字媒体艺术（交互方向）', tags: ['城市IP', '动态视觉', '装置艺术', 'TouchDesigner'], desc: '以济南泉水文化为主题，运用投影映射和交互技术创作一件大型公共空间沉浸式视觉装置作品。' },
    { title: '《山海经》异兽主题原创儿童绘本创作', category: '书籍纸媒与插画绘本', difficulty: 'medium', teacherId: 't003', maxStudents: 2, majorCode: '130502', major: '视觉传达设计', tags: ['绘本', '山海经', '儿童插画', '故事创作'], desc: '选取《山海经》中3-5个经典异兽形象进行现代化改编，创作一套面向6-12岁儿童的原创绘本。' },
    { title: '基于情感计算的可变字体实验设计', category: '概念设计与实验性视觉', difficulty: 'medium', teacherId: 't003', maxStudents: 1, majorCode: '130502', major: '视觉传达设计', tags: ['可变字体', '字体设计', '实验设计'], desc: '探索可变字体技术（Variable Fonts）在情感表达层面的可能性，完成一套具有情感响应能力的可变字体设计方案。' },
    { title: '基于生物降解材料的绿色食品包装结构设计', category: '包装结构设计与优化', difficulty: 'hard', teacherId: 't004', maxStudents: 1, majorCode: '081702', major: '包装工程', tags: ['绿色包装', '生物降解', '结构设计', '可持续'], desc: '选用PLA或PHA等生物降解材料，设计一款新型绿色食品包装，需完成结构设计、打样测试和性能对比报告。' },
    { title: '生鲜冷链智能温控包装系统设计研究', category: '智能包装与物联网应用', difficulty: 'hard', teacherId: 't004', maxStudents: 1, majorCode: '081702', major: '包装工程', tags: ['冷链物流', '温控', '智能包装', 'IoT'], desc: '设计一款集成温度传感和数据记录功能的智能温控包装系统原型，适用于高端生鲜产品运输。' },
    { title: 'AI驱动的中国风插画生成工具设计与实现', category: '数字媒体叙事与创作', difficulty: 'hard', teacherId: 't005', maxStudents: 1, majorCode: '130508', major: '数字媒体艺术（交互方向）', tags: ['AI', 'Stable Diffusion', '中国风插画', 'LoRA训练'], desc: '基于开源大模型开发一款面向设计师的中国风插画AI辅助生成工具，包含模型微调、风格控制和交互界面设计。' },
    { title: '博物馆文物AR导览交互体验设计', category: '数字媒体叙事与创作', difficulty: 'medium', teacherId: 't005', maxStudents: 2, majorCode: '080218T', major: '智能交互设计', tags: ['博物馆', 'AR增强现实', '导览', 'Unity'], desc: '选择山东某博物馆的3-5件核心藏品，设计并实现一套AR移动端导览交互体验原型。' },
    { title: 'Z世代国潮美妆品牌视觉形象升级设计', category: '品牌形象与VI设计', difficulty: 'easy', teacherId: 't001', maxStudents: 2, majorCode: '130502', major: '视觉传达设计', tags: ['Z世代', '国潮', '美妆品牌', '品牌升级'], desc: '针对虚拟国潮美妆品牌进行全面的视觉形象升级设计，包括Logo、色彩系统、包装系列和社交媒体视觉规范。' },
    { title: '气候变化数据可视化动态短片创作', category: '动态视觉与动效设计', difficulty: 'medium', teacherId: 't002', maxStudents: 1, majorCode: '130508', major: '数字媒体艺术（交互方向）', tags: ['数据可视化', '动态图形', 'After Effects', '环保'], desc: '选取近100年全球气候数据，创作一支3分钟的数据可视化动态信息短片，用于科普传播。' },
    { title: '汉字之美——书法字体的活态再设计与文创应用', category: '概念设计与实验性视觉', difficulty: 'medium', teacherId: 't003', maxStudents: 1, majorCode: '130502', major: '视觉传达设计', tags: ['书法', '字体设计', '文创'], desc: '以传统书法为母本，探索其数字化转译与文创产品应用。' },
    { title: '城市公共空间品牌形象与环境导视系统设计', category: '品牌形象与VI设计', difficulty: 'easy', teacherId: 't001', maxStudents: 2, majorCode: '130502', major: '视觉传达设计', tags: ['导视', '环境视觉'], desc: '面向城市公共空间完成一套品牌形象与环境导视系统设计。' },
    { title: '情绪化动态海报的生成式设计研究', category: '动态视觉与动效设计', difficulty: 'medium', teacherId: 't002', maxStudents: 1, majorCode: '130508', major: '数字媒体艺术（交互方向）', tags: ['动态海报', '生成式'], desc: '结合生成式工具探索面向年轻用户的情绪化动态海报设计方法。' },
    { title: '红色文化数字展馆的沉浸式交互体验设计', category: '数字媒体叙事与创作', difficulty: 'hard', teacherId: 't005', maxStudents: 2, majorCode: '130508', major: '数字媒体艺术（交互方向）', tags: ['数字展馆', '沉浸式'], desc: '为红色主题数字展馆设计沉浸式交互体验。' },
    { title: 'XR赋能非遗戏曲的多人协同体验原型', category: '数字媒体叙事与创作', difficulty: 'hard', teacherId: 't005', maxStudents: 1, majorCode: '130508', major: '数字媒体艺术（交互方向）', tags: ['XR', '非遗'], desc: '设计并实现面向非遗戏曲的XR多人协同体验原型。' },
    { title: '预制菜即食包装微波/水浴双适配结构设计', category: '包装结构设计与优化', difficulty: 'medium', teacherId: 't004', maxStudents: 1, majorCode: '081702', major: '包装工程', tags: ['预制菜包装', '结构设计'], desc: '设计可同时耐受微波与水浴加热的预制菜包装结构。' },
    { title: '高阻隔轻量啤酒包装开发与货架期测试', category: '包装结构设计与优化', difficulty: 'hard', teacherId: 't004', maxStudents: 1, majorCode: '081702', major: '包装工程', tags: ['高阻隔', '货架期'], desc: '开发高阻隔轻量化啤酒包装并完成货架期性能测试。' },
    { title: '循环快递包装箱可复用锁合结构设计', category: '智能包装与物联网应用', difficulty: 'medium', teacherId: 't004', maxStudents: 1, majorCode: '081702', major: '包装工程', tags: ['循环包装', '物流'], desc: '面向绿色物流设计可多次复用与回收的快递箱锁合结构。' },
    { title: '肌电手势识别的无障碍交互系统原型', category: '交互界面与系统设计', difficulty: 'hard', teacherId: 't005', maxStudents: 1, majorCode: '080218T', major: '智能交互设计', tags: ['肌电', '无障碍'], desc: '基于肌电手势识别设计面向肢障用户的无障碍交互原型。' },
    { title: '智能导盲随行避障装置交互设计', category: '交互界面与系统设计', difficulty: 'hard', teacherId: 't005', maxStudents: 1, majorCode: '080218T', major: '智能交互设计', tags: ['导盲', '避障'], desc: '设计可辅助视障人群出行的智能避障随行装置交互方案。' },
    { title: '养老院无感跌倒监测与呼叫交互原型', category: '交互界面与系统设计', difficulty: 'medium', teacherId: 't002', maxStudents: 1, majorCode: '080218T', major: '智能交互设计', tags: ['养老', '跌倒监测'], desc: '设计养老场景下无感跌倒监测与一键呼叫的交互系统原型。' },
    { title: '车载多模态语音驾驶助手交互原型', category: '交互界面与系统设计', difficulty: 'medium', teacherId: 't002', maxStudents: 1, majorCode: '080218T', major: '智能交互设计', tags: ['车载', '语音助手'], desc: '面向车载场景设计多模态语音助手的交互与可用性原型。' },
  ]

  const topicIds: string[] = []
  for (const t of topics) {
    const tid = uuidv4()
    topicIds.push(tid)
    await conn.query(`
      INSERT INTO topics (id, title, description, category, difficulty, max_students, status, teacher_id, cycle_id, major, major_code, tags, requirements)
      VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, ?)
    `, [tid, t.title, t.desc, t.category, t.difficulty, t.maxStudents, t.teacherId, cycleId, t.major, t.majorCode, JSON.stringify(t.tags), '详见课题详情页'])
  }
  console.log(`✅ ${topics.length} 个课题已创建`)

  // ===== 模拟部分选课申请 =====
  await conn.query(`
    INSERT INTO applications (id, student_id, topic_id, priority, status, motivation, created_at)
    VALUES 
      (uuid(), 's001', ?, 1, 'accepted', '我对非遗文化非常感兴趣，希望能将传统与现代设计相结合。', NOW()),
      (uuid(), 's003', ?, 1, 'accepted', '我的毕设方向是交互设计，这个课题非常契合我的专业背景。', NOW()),
      (uuid(), 's004', ?, 2, 'pending', '作为备选方向。', NOW()),
      (uuid(), 's002', ?, 1, 'pending', '我热爱绘本创作，希望能在毕业设计中完成自己的第一本绘本。', NOW())
  `, [topicIds[0], topicIds[2], topicIds[10], topicIds[4]])
  console.log('✅ 模拟申请数据已创建')

  // ===== 毕业全流程演示数据 =====

  // 任务书（张艺 - 陈教授）
  await conn.query(`
    INSERT INTO task_books (id, student_id, topic_id, cycle_id, title, content, requirements, schedule, file_urls, status, issued_by, issued_at)
    VALUES (uuid(), 's001', ?, ?, '《非遗蜀锦纹样在现代品牌VI中的创新应用研究》任务书',
      '以蜀锦传统纹样为研究对象，完成一套现代品牌VI系统的创新设计。',
      '1. 完成纹样调研与提炼；2. 品牌VI基础系统；3. 应用延展与实物打样。',
      '第1-4周调研，第5-8周设计，第9-12周打样与论文撰写。',
      '[]', 'issued', 't001', NOW())
  `, [topicIds[0], cycleId])

  // 开题报告（张艺 - 已通过；林思远 - 待审核）
  await conn.query(`
    INSERT INTO proposals (id, student_id, topic_id, cycle_id, title, background, objectives, content, methods, plan, file_urls, status, teacher_comment, reviewed_by, reviewed_at)
    VALUES
      (uuid(), 's001', ?, ?, '非遗蜀锦纹样在现代品牌VI中的创新应用研究——开题报告',
        '蜀锦作为国家级非物质文化遗产，其纹样具有独特的美学价值，但在现代品牌语境中的转化研究仍较薄弱。',
        '探索蜀锦纹样在现代品牌VI中的创新转化路径，完成一套可落地的品牌视觉系统。',
        '纹样收集整理、设计语言提炼、VI基础系统设计、应用延展。',
        '文献研究 + 案例分析 + 设计实践。',
        '第1-4周调研，第5-10周设计，第11-12周总结。',
        '[]', 'approved', '选题方向明确，技术路线可行，同意开题。', 't001', NOW()),
      (uuid(), 's003', ?, ?, '适老化智能家居APP交互界面设计与可用性研究——开题报告',
        '我国老龄化进程加快，适老化数字产品需求迫切。',
        '设计一套面向老年用户的智能家居APP交互方案并进行可用性测试。',
        '用户研究、信息架构、交互原型、可用性测试。',
        '用户访谈 + 原型设计 + 可用性测试。',
        '第1-5周研究，第6-10周设计，第11-12周测试。',
        '[]', 'submitted', NULL, NULL, NULL)
  `, [topicIds[0], cycleId, topicIds[2], cycleId])

  // 中期检查（张艺 - 已通过）
  await conn.query(`
    INSERT INTO midterm_reports (id, student_id, topic_id, cycle_id, progress_summary, completed_work, problems, next_plan, file_urls, status, score, teacher_comment, reviewed_by, reviewed_at)
    VALUES (uuid(), 's001', ?, ?,
      '已完成纹样调研与设计语言提炼，VI基础系统完成约60%。',
      '蜀锦纹样数字化整理、主视觉与辅助图形、Logo方案初稿。',
      '应用延展的材质适配还需进一步测试。',
      '完成VI应用延展、品牌画册与实物打样。',
      '[]', 'passed', 85.0, '进度正常，建议加强应用延展的系统性。', 't001', NOW())
  `, [topicIds[0], cycleId])

  // 毕业论文（张艺 - 已提交待批阅）
  await conn.query(`
    INSERT INTO thesis_submissions (id, student_id, topic_id, cycle_id, title, abstract, keywords, file_urls, version, status)
    VALUES (uuid(), 's001', ?, ?, '非遗蜀锦纹样在现代品牌VI中的创新应用研究',
      '本文以蜀锦纹样为切入点，探讨其现代化转化的设计方法与路径，并完成一套品牌VI实践。',
      '蜀锦纹样,品牌VI,非遗,创新转化',
      '[]', 1, 'submitted')
  `, [topicIds[0], cycleId])

  // 设计作品（张艺 - 草稿）
  await conn.query(`
    INSERT INTO design_submissions (id, student_id, topic_id, cycle_id, title, description, file_urls, version, status)
    VALUES (uuid(), 's001', ?, ?, '「蜀韵」品牌视觉形象系统',
      '以蜀锦纹样为核心元素，构建「蜀韵」茶饮品牌的完整视觉形象系统。',
      '[]', 1, 'draft')
  `, [topicIds[0], cycleId])

  console.log('✅ 毕业全流程演示数据已创建（任务书/开题/中期/论文/作品）')

  await conn.end()
  console.log('\n🎉 种子数据导入完成！')
  console.log('\n默认账号：')
  console.log('  管理员: admin / 123456')
  console.log('  教师:   chen / 123456')
  console.log('  学生:   zhangyi / 123456')
}

seed().catch(err => {
  console.error('种子数据导入失败:', err.message)
  process.exit(1)
})
