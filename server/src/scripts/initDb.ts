import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveDatabaseConfig } from '../config/runtime.js'
import { createProcessTables, processPhaseEnum } from './processSchema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config()

async function initDatabase() {
  console.log('正在连接数据库...')
  const createIfMissing = process.env.DB_CREATE_IF_MISSING === 'true'
  const dbConfig = resolveDatabaseConfig(process.env, !createIfMissing)
  const conn = await mysql.createConnection(dbConfig)

  const dbName = process.env.DB_NAME || 'gpss_db'
  if (createIfMissing) {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await conn.query(`USE \`${dbName}\``)
  }
  console.log(`数据库 ${dbName} 就绪`)

  // 创建用户表
  await conn.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      real_name VARCHAR(50) NOT NULL,
      email VARCHAR(100),
      role ENUM('admin', 'teacher', 'student') NOT NULL DEFAULT 'student',
      avatar VARCHAR(255),
      -- 学生字段
      student_id VARCHAR(30),
      class_name VARCHAR(50),
      major VARCHAR(50),
      major_code VARCHAR(20),
      grade VARCHAR(10),
      -- 教师字段
      title VARCHAR(20),
      department VARCHAR(50),
      phone VARCHAR(20),
      -- 状态
      status ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_role (role),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 创建学生档案表
  await conn.query(`
    CREATE TABLE IF NOT EXISTS student_profiles (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      gpa DECIMAL(3,2) DEFAULT 0.00,
      ranking INT DEFAULT 0,
      total_students INT DEFAULT 0,
      skills JSON,
      interests JSON,
      portfolio JSON,
      self_intro TEXT,
      contact_email VARCHAR(255),
      contact_phone VARCHAR(20),
      grade VARCHAR(50),
      is_complete TINYINT(1) DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE KEY uk_user_id (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 创建选题周期表
  await conn.query(`
    CREATE TABLE IF NOT EXISTS cycles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      year VARCHAR(10) NOT NULL,
      status ENUM('draft', 'active', 'closed') NOT NULL DEFAULT 'draft',
      phase ${processPhaseEnum()} NOT NULL DEFAULT 'topic_submission',
      start_date DATE,
      end_date DATE,
      phases_config JSON,
      created_by VARCHAR(36),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 创建课题表
  await conn.query(`
    CREATE TABLE IF NOT EXISTS topics (
      id VARCHAR(36) PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      description TEXT,
      category VARCHAR(50) NOT NULL,
      difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium',
      max_students TINYINT UNSIGNED NOT NULL DEFAULT 1,
      status ENUM('draft', 'pending', 'published', 'full', 'closed') NOT NULL DEFAULT 'draft',
      teacher_id VARCHAR(36) NOT NULL,
      cycle_id INT,
      tags JSON,
      requirements TEXT,
      view_count INT UNSIGNED NOT NULL DEFAULT 0,
      apply_count INT UNSIGNED NOT NULL DEFAULT 0,
      schedules JSON,
      attachments JSON,
      major VARCHAR(100),
      major_code VARCHAR(20),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (teacher_id) REFERENCES users(id),
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL,
      INDEX idx_status (status),
      INDEX idx_category (category),
      INDEX idx_teacher (teacher_id),
      INDEX idx_cycle (cycle_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 创建选题申请表
  await conn.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      priority TINYINT UNSIGNED NOT NULL DEFAULT 1,
      status ENUM('pending','submitted','pending_review','accepted','rejected','waitlisted','withdrawn','cancelled') NOT NULL DEFAULT 'pending',
      motivation TEXT,
      teacher_comment TEXT,
      reviewed_by VARCHAR(36),
      reviewed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id),
      UNIQUE KEY uk_student_topic (student_id, topic_id),
      INDEX idx_student (student_id),
      INDEX idx_topic (topic_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 教师遴选批次：草稿与正式 applications 状态分离
  await conn.query(`
    CREATE TABLE IF NOT EXISTS selection_batches (
      id VARCHAR(36) PRIMARY KEY,
      cycle_id INT NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      status ENUM('draft', 'submitted', 'auto_submitted', 'settled') NOT NULL DEFAULT 'draft',
      version INT UNSIGNED NOT NULL DEFAULT 0,
      submitted_by VARCHAR(36),
      submitted_at DATETIME,
      auto_submitted_at DATETIME,
      settled_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY uk_selection_batch_cycle_topic (cycle_id, topic_id),
      INDEX idx_selection_batch_cycle_status (cycle_id, status),
      INDEX idx_selection_batch_topic (topic_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await conn.query(`
    CREATE TABLE IF NOT EXISTS selection_draft_items (
      id VARCHAR(36) PRIMARY KEY,
      batch_id VARCHAR(36) NOT NULL,
      application_id VARCHAR(36) NOT NULL,
      decision ENUM('proposed', 'reserve', 'reject') NOT NULL,
      decision_rank INT UNSIGNED,
      comment TEXT,
      updated_by VARCHAR(36),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (batch_id) REFERENCES selection_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY uk_selection_draft_batch_application (batch_id, application_id),
      INDEX idx_selection_draft_batch_decision (batch_id, decision, decision_rank),
      INDEX idx_selection_draft_application (application_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await conn.query(`
    CREATE TABLE IF NOT EXISTS selection_settlements (
      id VARCHAR(36) PRIMARY KEY,
      cycle_id INT NOT NULL,
      status ENUM('pending', 'running', 'completed', 'failed') NOT NULL DEFAULT 'pending',
      trigger_type ENUM('all_submitted', 'deadline', 'admin_retry') NOT NULL,
      result_json JSON,
      error_message TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE,
      UNIQUE KEY uk_selection_settlement_cycle (cycle_id),
      INDEX idx_selection_settlement_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 调剂志愿：与首次志愿和首次遴选批次完全分离，保留旧 adjustments 作为历史记录
  await conn.query(`
    CREATE TABLE IF NOT EXISTS adjustment_volunteers (
      id VARCHAR(36) PRIMARY KEY,
      cycle_id INT NOT NULL,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      priority INT UNSIGNED NOT NULL,
      motivation TEXT NOT NULL,
      status ENUM('submitted', 'accepted', 'rejected', 'withdrawn') NOT NULL DEFAULT 'submitted',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      UNIQUE KEY uk_adjustment_volunteer_cycle_student_topic (cycle_id, student_id, topic_id),
      INDEX idx_adjustment_volunteer_cycle_student (cycle_id, student_id),
      INDEX idx_adjustment_volunteer_topic_status (topic_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await conn.query(`
    CREATE TABLE IF NOT EXISTS adjustment_batches (
      id VARCHAR(36) PRIMARY KEY,
      cycle_id INT NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      status ENUM('draft', 'submitted', 'auto_submitted', 'settled') NOT NULL DEFAULT 'draft',
      version INT UNSIGNED NOT NULL DEFAULT 0,
      submitted_by VARCHAR(36),
      submitted_at DATETIME,
      auto_submitted_at DATETIME,
      settled_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY uk_adjustment_batch_cycle_topic (cycle_id, topic_id),
      INDEX idx_adjustment_batch_cycle_status (cycle_id, status),
      INDEX idx_adjustment_batch_topic (topic_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await conn.query(`
    CREATE TABLE IF NOT EXISTS adjustment_draft_items (
      id VARCHAR(36) PRIMARY KEY,
      batch_id VARCHAR(36) NOT NULL,
      volunteer_id VARCHAR(36) NOT NULL,
      decision ENUM('proposed', 'reserve', 'reject') NOT NULL,
      decision_rank INT UNSIGNED,
      comment TEXT,
      updated_by VARCHAR(36),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (batch_id) REFERENCES adjustment_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (volunteer_id) REFERENCES adjustment_volunteers(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY uk_adjustment_draft_batch_volunteer (batch_id, volunteer_id),
      INDEX idx_adjustment_draft_batch_decision (batch_id, decision, decision_rank),
      INDEX idx_adjustment_draft_volunteer (volunteer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await conn.query(`
    CREATE TABLE IF NOT EXISTS adjustment_settlements (
      id VARCHAR(36) PRIMARY KEY,
      cycle_id INT NOT NULL,
      status ENUM('pending', 'running', 'completed', 'failed') NOT NULL DEFAULT 'pending',
      trigger_type ENUM('all_submitted', 'deadline', 'admin_retry') NOT NULL,
      result_json JSON,
      error_message TEXT,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE,
      UNIQUE KEY uk_adjustment_settlement_cycle (cycle_id),
      INDEX idx_adjustment_settlement_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 创建课题预选表（购物车）
  await conn.query(`
    CREATE TABLE IF NOT EXISTS topic_shortlist (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_student_topic (student_id, topic_id),
      INDEX idx_student (student_id),
      INDEX idx_topic (topic_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 创建调整记录表
  await conn.query(`
    CREATE TABLE IF NOT EXISTS adjustments (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      from_topic_id VARCHAR(36),
      to_topic_id VARCHAR(36),
      reason TEXT,
      status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
      admin_comment TEXT,
      processed_by VARCHAR(36),
      processed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (from_topic_id) REFERENCES topics(id) ON DELETE SET NULL,
      FOREIGN KEY (to_topic_id) REFERENCES topics(id) ON DELETE SET NULL,
      FOREIGN KEY (processed_by) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 操作日志表
  await conn.query(`
    CREATE TABLE IF NOT EXISTS operation_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(36),
      action VARCHAR(50) NOT NULL,
      target_type VARCHAR(30),
      target_id VARCHAR(36),
      detail JSON,
      ip_address VARCHAR(45),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_action (action),
      INDEX idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 系统配置表
  await conn.query(`
    CREATE TABLE IF NOT EXISTS system_configs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      \`key\` VARCHAR(50) NOT NULL UNIQUE,
      value TEXT,
      description VARCHAR(200),
      updated_by VARCHAR(36),
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // 毕业全流程相关表（任务书/开题/中期/论文/作品/答辩/成绩/指导/公告/通知）
  await createProcessTables(conn)

  console.log('✅ 所有数据表创建完成！')
  
  // 插入默认系统配置
  await conn.query(`
    INSERT IGNORE INTO system_configs (\`key\`, value, description) VALUES
    ('site_name', '视觉传达设计学院 · 毕业设计管理系统', '系统名称'),
    ('max_applications_per_student', '6', '每名学生最多填报志愿数（至少 3、至多 6，不重复）'),
    ('allow_cross_major', 'true', '是否允许跨专业选课'),
    ('auto_close_full_topics', 'true', '满员后自动关闭课题')
  `)
  console.log('✅ 默认配置已插入')

  await conn.end()
  console.log('\n数据库初始化完成！')
}

initDatabase().catch(err => {
  console.error('初始化失败:', err.message)
  process.exit(1)
})
