/**
 * 毕业全流程相关表的建表 SQL（与 initDb 共享，供迁移脚本复用）
 *
 * 全流程阶段（在选题基础上扩展）：
 *   topic_submission → student_selection → adjustment → result
 *   → task_book → proposal → midterm → thesis_design → defense → grading → archive → ended
 */

// cycles.phase 枚举的完整取值（选题阶段 + 毕业全流程阶段 + 兼容历史取值）
export const PROCESS_PHASE_VALUES = [
  'topic_submission', 'topic_publish', 'student_apply', 'student_selection',
  'teacher_review', 'result_announce', 'adjustment', 'result',
  'task_book', 'proposal', 'midterm', 'thesis_design',
  'defense', 'grading', 'archive', 'ended'
]

export function processPhaseEnum(): string {
  return `ENUM(${PROCESS_PHASE_VALUES.map(v => `'${v}'`).join(', ')})`
}

export async function createProcessTables(conn: any) {
  // ===== 周期级毕业资料模板 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS document_templates (
      id VARCHAR(36) PRIMARY KEY,
      cycle_id INT NOT NULL,
      document_type ENUM('task_book', 'proposal', 'midterm', 'thesis', 'other') NOT NULL,
      title VARCHAR(200) NOT NULL,
      version VARCHAR(50) NOT NULL,
      description TEXT,
      original_name VARCHAR(255) NOT NULL,
      storage_key VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100),
      size BIGINT UNSIGNED NOT NULL DEFAULT 0,
      status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
      published_at DATETIME,
      created_by VARCHAR(36),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id),
      UNIQUE KEY uk_cycle_type_version (cycle_id, document_type, version),
      INDEX idx_cycle_status (cycle_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：任务书 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS task_books (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      cycle_id INT,
      title VARCHAR(200) NOT NULL,
      content TEXT,
      main_content TEXT,
      requirements TEXT,
      specific_requirements TEXT,
      schedule TEXT,
      file_urls JSON,
      status ENUM('draft', 'issued', 'submitted', 'need_revision', 'confirmed') NOT NULL DEFAULT 'draft',
      issued_by VARCHAR(36),
      issued_at DATETIME,
      teacher_comment TEXT,
      reviewed_by VARCHAR(36),
      reviewed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL,
      UNIQUE KEY uk_student_topic (student_id, topic_id),
      INDEX idx_issued_by (issued_by),
      INDEX idx_student (student_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：开题报告 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS proposals (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      cycle_id INT,
      title VARCHAR(200) NOT NULL,
      background TEXT,
      objectives TEXT,
      content TEXT,
      methods TEXT,
      plan TEXT,
      file_urls JSON,
      status ENUM('not_started', 'draft', 'submitted', 'need_revision', 'approved', 'rejected') NOT NULL DEFAULT 'not_started',
      teacher_comment TEXT,
      reviewed_by VARCHAR(36),
      reviewed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL,
      UNIQUE KEY uk_student_topic (student_id, topic_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：中期检查 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS midterm_reports (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      cycle_id INT,
      progress_summary TEXT,
      completed_work TEXT,
      problems TEXT,
      next_plan TEXT,
      file_urls JSON,
      status ENUM('not_started', 'draft', 'submitted', 'need_revision', 'passed', 'failed') NOT NULL DEFAULT 'not_started',
      teacher_comment TEXT,
      score DECIMAL(5,2),
      reviewed_by VARCHAR(36),
      reviewed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL,
      UNIQUE KEY uk_student_topic (student_id, topic_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：毕业论文提交 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS thesis_submissions (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      cycle_id INT,
      title VARCHAR(200) NOT NULL,
      abstract TEXT,
      keywords VARCHAR(255),
      file_urls JSON,
      version INT NOT NULL DEFAULT 1,
      status ENUM('draft', 'submitted', 'need_revision', 'approved', 'final') NOT NULL DEFAULT 'draft',
      teacher_comment TEXT,
      reviewed_by VARCHAR(36),
      reviewed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL,
      UNIQUE KEY uk_student_topic (student_id, topic_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：设计作品提交 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS design_submissions (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      cycle_id INT,
      title VARCHAR(200) NOT NULL,
      description TEXT,
      file_urls JSON,
      version INT NOT NULL DEFAULT 1,
      status ENUM('draft', 'submitted', 'need_revision', 'approved', 'final') NOT NULL DEFAULT 'draft',
      teacher_comment TEXT,
      reviewed_by VARCHAR(36),
      reviewed_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL,
      UNIQUE KEY uk_student_topic (student_id, topic_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：答辩分组 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS defense_groups (
      id VARCHAR(36) PRIMARY KEY,
      cycle_id INT,
      name VARCHAR(100) NOT NULL,
      defense_date DATETIME,
      location VARCHAR(100),
      judges JSON,
      students JSON,
      status ENUM('pending', 'finished') NOT NULL DEFAULT 'pending',
      created_by VARCHAR(36),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL,
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：答辩评分 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS defense_scores (
      id VARCHAR(36) PRIMARY KEY,
      group_id VARCHAR(36) NOT NULL,
      student_id VARCHAR(36) NOT NULL,
      judge_id VARCHAR(36) NOT NULL,
      score DECIMAL(5,2),
      comment TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES defense_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (judge_id) REFERENCES users(id),
      UNIQUE KEY uk_group_student_judge (group_id, student_id, judge_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：成绩评定 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS grades (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      cycle_id INT,
      supervisor_score DECIMAL(5,2),
      review_score DECIMAL(5,2),
      defense_score DECIMAL(5,2),
      total_score DECIMAL(5,2),
      grade_level VARCHAR(10),
      status ENUM('pending', 'published') NOT NULL DEFAULT 'pending',
      published_by VARCHAR(36),
      published_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL,
      UNIQUE KEY uk_student_topic (student_id, topic_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：指导记录 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS guidance_records (
      id VARCHAR(36) PRIMARY KEY,
      student_id VARCHAR(36) NOT NULL,
      teacher_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      cycle_id INT,
      record_date DATETIME,
      content TEXT,
      next_action TEXT,
      file_urls JSON,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (teacher_id) REFERENCES users(id),
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE SET NULL,
      INDEX idx_student (student_id),
      INDEX idx_teacher (teacher_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：公告 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id VARCHAR(36) PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      content TEXT,
      scope ENUM('all', 'student', 'teacher') NOT NULL DEFAULT 'all',
      status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
      created_by VARCHAR(36),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  // ===== 毕业全流程：站内通知 =====
  await conn.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      type VARCHAR(30),
      title VARCHAR(200) NOT NULL,
      content TEXT,
      related_type VARCHAR(30),
      related_id VARCHAR(36),
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user (user_id),
      INDEX idx_read (is_read)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}
