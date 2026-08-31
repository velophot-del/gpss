import mysql from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveDatabaseConfig } from '../config/runtime.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config()

const dbConfig = resolveDatabaseConfig()

async function getAcceptedTopic(conn: mysql.Connection, studentId: string) {
  const [rows] = await conn.query<any[]>(
    `SELECT a.student_id, a.topic_id, t.title, t.teacher_id, t.cycle_id
     FROM applications a JOIN topics t ON a.topic_id = t.id
     WHERE a.student_id = ? AND a.status = 'accepted' LIMIT 1`,
    [studentId]
  )
  return rows[0] || null
}

async function exists(conn: mysql.Connection, table: string, studentId: string) {
  const [rows] = await conn.query<any[]>(
    `SELECT id FROM ${table} WHERE student_id = ? LIMIT 1`,
    [studentId]
  )
  return rows.length > 0
}

async function seed() {
  const conn = await mysql.createConnection(dbConfig)
  console.log('开始导入毕业全流程演示数据...')

  const s1 = await getAcceptedTopic(conn, 's001') // 张艺
  const s3 = await getAcceptedTopic(conn, 's003') // 林思远
  if (!s1 || !s3) {
    console.error('未找到 s001 / s003 的录取选题，请先确认选课数据')
    await conn.end()
    process.exit(1)
  }
  const cycleId = s1.cycle_id

  // 1. 任务书（张艺）
  if (!(await exists(conn, 'task_books', 's001'))) {
    await conn.query(`
      INSERT INTO task_books (id, student_id, topic_id, cycle_id, title, content, requirements, schedule, file_urls, status, issued_by, issued_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'issued', ?, NOW())
    `, [uuidv4(), 's001', s1.topic_id, cycleId,
      `《${s1.title}》任务书`,
      '完成新式茶饮品牌的全案包装体系与门店空间视觉设计，形成系统化、可落地的品牌视觉方案。',
      '1. 品牌定位与视觉策略；2. 包装结构设计与系列延展；3. 门店空间视觉规范；4. 实物打样与论文撰写。',
      '第1-4周调研与定位，第5-8周包装设计，第9-12周空间视觉与打样。',
      't001'])
    console.log('✅ 任务书已创建（张艺）')
  } else {
    console.log('· 任务书已存在，跳过')
  }

  // 2. 开题报告（张艺 - 已通过；林思远 - 待审核）
  if (!(await exists(conn, 'proposals', 's001'))) {
    await conn.query(`
      INSERT INTO proposals (id, student_id, topic_id, cycle_id, title, background, objectives, content, methods, plan, file_urls, status, teacher_comment, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'approved', ?, ?, NOW())
    `, [uuidv4(), 's001', s1.topic_id, cycleId,
      `《${s1.title}》开题报告`,
      '新式茶饮消费持续升温，但品牌视觉同质化严重，亟需差异化、系统化的包装与空间视觉方案。',
      '构建一套兼具传统茶文化意蕴与现代审美的茶饮品牌全案视觉体系。',
      '品牌调研、视觉策略、包装结构设计、系列延展、门店空间视觉规范。',
      '市场调研 + 竞品分析 + 设计实践。',
      '第1-4周调研，第5-10周设计，第11-12周总结。',
      '选题方向明确，思路清晰，同意开题。', 't001'])
    console.log('✅ 开题报告已创建（张艺·已通过）')
  } else {
    console.log('· 开题报告（张艺）已存在，跳过')
  }
  if (!(await exists(conn, 'proposals', 's003'))) {
    await conn.query(`
      INSERT INTO proposals (id, student_id, topic_id, cycle_id, title, background, objectives, content, methods, plan, file_urls, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'submitted')
    `, [uuidv4(), 's003', s3.topic_id, cycleId,
      `《${s3.title}》开题报告`,
      '我国老龄化进程加快，适老化数字产品需求迫切。',
      '设计一套面向老年用户的智能家居APP交互方案并进行可用性测试。',
      '用户研究、信息架构、交互原型、可用性测试。',
      '用户访谈 + 原型设计 + 可用性测试。',
      '第1-5周研究，第6-10周设计，第11-12周测试。'])
    console.log('✅ 开题报告已创建（林思远·待审核）')
  } else {
    console.log('· 开题报告（林思远）已存在，跳过')
  }

  // 3. 中期检查（张艺 - 已通过）
  if (!(await exists(conn, 'midterm_reports', 's001'))) {
    await conn.query(`
      INSERT INTO midterm_reports (id, student_id, topic_id, cycle_id, progress_summary, completed_work, problems, next_plan, file_urls, status, score, teacher_comment, reviewed_by, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'passed', 85.0, ?, ?, NOW())
    `, [uuidv4(), 's001', s1.topic_id, cycleId,
      '已完成品牌定位与包装主视觉，系列包装延展完成约60%。',
      '品牌视觉策略、主视觉与辅助图形、包装结构初稿。',
      '门店空间视觉规范的落地还需进一步细化。',
      '完成系列包装延展、空间视觉规范与实物打样。',
      '进度正常，建议加强包装系列的系列感。', 't001'])
    console.log('✅ 中期检查已创建（张艺·已通过）')
  } else {
    console.log('· 中期检查已存在，跳过')
  }

  // 4. 毕业论文（张艺 - 待批阅）
  if (!(await exists(conn, 'thesis_submissions', 's001'))) {
    await conn.query(`
      INSERT INTO thesis_submissions (id, student_id, topic_id, cycle_id, title, abstract, keywords, file_urls, version, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 1, 'submitted')
    `, [uuidv4(), 's001', s1.topic_id, cycleId,
      s1.title,
      '本文以新式茶饮品牌为研究对象，探讨其全案包装与空间视觉的设计方法与路径，并完成一套可落地的品牌视觉实践。',
      '新式茶饮,包装设计,空间视觉,品牌'])
    console.log('✅ 毕业论文已创建（张艺·待批阅）')
  } else {
    console.log('· 毕业论文已存在，跳过')
  }

  // 5. 设计作品（张艺 - 草稿）
  if (!(await exists(conn, 'design_submissions', 's001'))) {
    await conn.query(`
      INSERT INTO design_submissions (id, student_id, topic_id, cycle_id, title, description, file_urls, version, status)
      VALUES (?, ?, ?, ?, ?, ?, '[]', 1, 'draft')
    `, [uuidv4(), 's001', s1.topic_id, cycleId,
      '「茶境」茶饮品牌全案视觉形象系统',
      '以东方茶文化为核心元素，构建「茶境」品牌的包装体系与门店空间视觉系统。'])
    console.log('✅ 设计作品已创建（张艺·草稿）')
  } else {
    console.log('· 设计作品已存在，跳过')
  }

  await conn.end()
  console.log('\n🎉 毕业全流程演示数据导入完成！')
}

seed().catch(err => {
  console.error('导入失败:', err.message)
  process.exit(1)
})
