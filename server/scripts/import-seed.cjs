/**
 * 种子数据导入脚本
 *
 * 用法: node import-seed.cjs [--reset]
 *   --reset  先清空所有表再导入（慎用！）
 *
 * 从 seed-data/ 目录下的 JSON 文件读取预设数据，写入 MySQL 数据库。
 * 支持幂等操作（重复运行不会产生重复数据）。
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// ===== 配置 =====
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'gpss_db'
};

const SEED_DIR = path.resolve(__dirname, '..', 'seed-data');

// ===== 工具函数 =====

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`);
}

async function hashPassword(pwd) {
  return bcrypt.hashSync(pwd || '123456', 10);
}

function readJson(filename) {
  const filePath = path.join(SEED_DIR, filename);
  if (!fs.existsSync(filePath)) {
    log(`⚠️  文件不存在: ${filename}，跳过`);
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ===== 建表 SQL =====

async function createTables(conn) {
  log('创建数据表...');

  await conn.query(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    real_name VARCHAR(50) NOT NULL,
    email VARCHAR(100),
    role ENUM('admin','teacher','student') DEFAULT 'student',
    avatar VARCHAR(255),
    student_id VARCHAR(30),
    class_name VARCHAR(50),
    major VARCHAR(50),
    major_code VARCHAR(20),
    grade VARCHAR(10),
    title VARCHAR(20),
    department VARCHAR(50),
    phone VARCHAR(20),
    status ENUM('active','inactive','suspended') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS student_profiles (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL UNIQUE,
    gpa DECIMAL(3,2) DEFAULT 0.00,
    ranking INT,
    total_students INT,
    skills JSON,
    interests JSON,
    portfolio JSON,
    self_intro TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS cycles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    year VARCHAR(10),
    status ENUM('draft','upcoming','active','selection','review','adjustment','completed') DEFAULT 'draft',
    phase ENUM('topic_submission','topic_publish','student_apply','student_selection','teacher_review','result_announce','adjustment','result','task_book','proposal','midterm','thesis_design','defense','grading','archive','ended') DEFAULT 'topic_submission',
    topic_publish_start DATE,
    topic_publish_end DATE,
    student_apply_start DATE,
    student_apply_end DATE,
    teacher_review_start DATE,
    teacher_review_end DATE,
    result_announce_time DATE,
    adjustment_start DATE,
    adjustment_end DATE,
    start_date DATE,
    end_date DATE,
    phases_config JSON,
    created_by VARCHAR(36),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS topics (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    difficulty ENUM('easy','medium','hard') DEFAULT 'medium',
    max_students TINYINT UNSIGNED DEFAULT 1,
    status ENUM('draft','pending','published','full','closed') DEFAULT 'draft',
    teacher_id VARCHAR(36) NOT NULL,
    cycle_id INT,
    tags JSON,
    requirements TEXT,
    view_count INT UNSIGNED DEFAULT 0,
    apply_count INT UNSIGNED DEFAULT 0,
    selected_student_ids JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS applications (
    id VARCHAR(36) PRIMARY KEY,
    student_id VARCHAR(36) NOT NULL,
    topic_id VARCHAR(36) NOT NULL,
    priority TINYINT UNSIGNED DEFAULT 1,
    status ENUM('pending','accepted','rejected','cancelled','withdrawn') DEFAULT 'pending',
    motivation TEXT,
    teacher_comment TEXT,
    reviewed_by VARCHAR(36),
    reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS adjustments (
    id VARCHAR(36) PRIMARY KEY,
    student_id VARCHAR(36) NOT NULL,
    from_topic_id VARCHAR(36),
    to_topic_id VARCHAR(36),
    reason TEXT,
    status ENUM('pending','approved','rejected') DEFAULT 'pending',
    admin_comment TEXT,
    processed_by VARCHAR(36),
    processed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS system_configs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    \`key\` VARCHAR(50) NOT NULL UNIQUE,
    value TEXT,
    description VARCHAR(200),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await conn.query(`CREATE TABLE IF NOT EXISTS operation_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(36),
    action VARCHAR(50) NOT NULL,
    target_type VARCHAR(30),
    target_id VARCHAR(36),
    detail TEXT,
    ip VARCHAR(45),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  log('✅ 所有数据表就绪');
}

// ===== 数据导入函数 =====

async function importAdmin(conn) {
  const pw = await hashPassword('123456');
  await conn.query(
    `INSERT IGNORE INTO users (id, username, password, real_name, email, role, status)
     VALUES (?,?,?,?,?,?,?)`,
    ['admin-001', 'admin', pw, '系统管理员', 'admin@sdada.edu.cn', 'admin', 'active']
  );
  log('✅ 管理员账号: admin / 123456');
}

async function importTeachers(conn) {
  const teachers = readJson('teachers.json');
  if (!teachers.length) { log('⚠️  无教师数据'); return; }

  let count = 0;
  for (const t of teachers) {
    const pw = await hashPassword(t.password);
    await conn.query(
      `INSERT IGNORE INTO users (id, username, password, real_name, email, role, title, department, phone, status)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [t.id, t.username, pw, t.realName, t.email, t.role, t.title, t.department, t.phone || null, t.status || 'active']
    );
    count++;
  }
  log(`✅ 导入 ${count} 位教师`);
  // 打印教师列表供参考
  teachers.forEach(t => log(`   ${t.username}/${t.password} — ${t.realName}（${t.title}·${t.department}）`));
}

async function importStudents(conn) {
  const students = readJson('students.json');
  if (!students.length) { log('⚠️  无学生数据'); return; }

  let count = 0;
  for (const s of students) {
    const pw = await hashPassword(s.password);
    // 插入用户记录
    await conn.query(
      `INSERT IGNORE INTO users (id, username, password, real_name, email, role, student_id, class_name, major, major_code, grade, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        s.id, s.username, pw, s.realName, s.email, s.role,
        s.studentId || null, s.className || null, s.major || null,
        s.majorCode || null, s.grade || null, s.status || 'active'
      ]
    );

    // 插入学生档案
    if (s.profile) {
      const profileId = s.id + '-profile';
      await conn.query(
        `INSERT IGNORE INTO student_profiles (id, user_id, gpa, ranking, total_students, skills, interests, self_intro, portfolio)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          profileId, s.id,
          s.profile.gpa || 0, s.profile.ranking || null, s.profile.totalStudents || null,
          JSON.stringify(s.profile.skills || []),
          JSON.stringify(s.profile.interests || []),
          s.profile.selfIntro || null,
          JSON.stringify(s.profile.portfolio || [])
        ]
      );
    }
    count++;
  }
  log(`✅ 导入 ${count} 名学生（含档案）`);
}

async function importCycle(conn) {
  // 检查是否已有活跃周期
  const [existing] = await conn.query("SELECT id FROM cycles WHERE status = 'active' LIMIT 1");
  if (existing && existing.length > 0) {
    log('ℹ️  已存在活跃周期，跳过创建');
    return existing[0].id;
  }

  // 时间节点按「6 月第 N 周」规则生成，无调剂环节
  const y = String(new Date().getFullYear());
  const schedule = {
    topic_publish: { start: `${y}-06-01`, end: `${y}-06-14` },
    student_apply: { start: `${y}-06-15`, end: `${y}-06-28` },
    teacher_review: { start: `${y}-06-29`, end: `${y}-07-05` },
    result_announce: `${y}-07-06`,
  };

  const [result] = await conn.query(
    `INSERT INTO cycles (name, description, year, status, phase, start_date, end_date,
                         topic_publish_start, topic_publish_end,
                         student_apply_start, student_apply_end,
                         teacher_review_start, teacher_review_end,
                         result_announce_time)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      `${y}届山东工艺美术学院视觉传达设计学院本科毕业设计选题系统`,
      '涵盖视觉传达设计、数字媒体艺术、包装工程、智能交互等专业方向',
      y, 'active', 'student_apply',
      schedule.topic_publish.start, schedule.teacher_review.end,
      schedule.topic_publish.start, schedule.topic_publish.end,
      schedule.student_apply.start, schedule.student_apply.end,
      schedule.teacher_review.start, schedule.teacher_review.end,
      schedule.result_announce,
    ]
  );

  log(`✅ 创建选题周期 (ID: ${result.insertId})`);
  return result.insertId;
}

async function importTopics(conn, cycleId) {
  const topics = readJson('topics.json');
  if (!topics.length) { log('⚠️  无课题数据'); return; }

  let count = 0;
  for (const t of topics) {
    await conn.query(
      `INSERT IGNORE INTO topics (id, title, description, category, difficulty, max_students, status, teacher_id, cycle_id, tags, requirements)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        t.id, t.title, t.description || '', t.category, t.difficulty || 'medium',
        t.maxStudents || 1, t.status || 'published', t.teacherId, cycleId,
        JSON.stringify(t.tags || []), t.requirements || ''
      ]
    );
    count++;
  }
  log(`✅ 导入 ${count} 个课题`);
}

async function importSystemConfigs(conn) {
  const configs = [
    { key: 'max_applications_per_student', value: '6', description: '每位学生最多填报志愿数量（至少 3、至多 6）' },
    { key: 'allow_student_register', value: 'false', description: '是否允许学生自主注册' },
    { key: 'system_name', value: '视觉传达设计学院 · 毕业设计管理系统', description: '系统名称' },
    { key: 'academic_year', value: '2024-2025', description: '当前学年' }
  ];

  for (const cfg of configs) {
    await conn.query(
      `INSERT IGNORE INTO system_configs (\`key\`, value, description) VALUES (?,?,?)`,
      [cfg.key, cfg.value, cfg.description]
    );
  }
  log('✅ 系统配置已初始化');
}

// ===== 主流程 =====

async function main() {
  const shouldReset = process.argv.includes('--reset');
  const startTime = Date.now();

  log('🚀 开始导入种子数据...');
  log(`   配置: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
  if (shouldReset) log('   ⚠️  模式: 重置（清空全部数据）');

  let conn;

  try {
    // 创建数据库（如不存在）
    const tempConn = await mysql.createConnection({
      host: DB_CONFIG.host, port: DB_CONFIG.port,
      user: DB_CONFIG.user, password: DB_CONFIG.password
    });
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\` DEFAULT CHARACTER SET utf8mb4`);
    await tempConn.end();

    // 连接数据库
    conn = await mysql.createConnection(DB_CONFIG);

    // 先建表（确保所有表存在）
    await createTables(conn);

    // 可选：重置模式（建完表后再清空）
    if (shouldReset) {
      log('🗑️  重置：删除旧表并重建...');
      const tables = ['operation_logs', 'adjustments', 'applications', 'topics', 'student_profiles', 'system_configs', 'cycles', 'users'];
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const t of tables) {
        try { await conn.query(`DROP TABLE IF EXISTS \`${t}\``); } catch (_e) { /* ignore */ }
      }
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      // 重新建表
      await createTables(conn);
      log('✅ 表已重建');
    }

    // 按依赖顺序导入数据
    await importAdmin(conn);
    await importTeachers(conn);
    await importStudents(conn);
    const cycleId = await importCycle(conn);
    await importTopics(conn, cycleId);
    await importSystemConfigs(conn);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n🎉 全部完成！耗时 ${elapsed}s`);
    log('\n📋 预设账号:');
    log('   管理员: admin / 123456');
    log('   教师:   chen, lin, huang, zhou, wu, zhao, sun, liu  (密码均为 123456)');
    log('   学生:   zhangyi, wanghan, linsiyuan, liushiyu, zhaomingzhe, sunxiaomeng, chenyu, lixin, fanglei, zhoujing  (密码均为 123456)');

  } catch (err) {
    console.error('❌ 导入失败:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

main();
