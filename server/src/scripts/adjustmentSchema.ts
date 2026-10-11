import type { Connection } from 'mysql2/promise'

export async function createAdjustmentTables(conn: Connection) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS adjustment_volunteers (
      id VARCHAR(36) PRIMARY KEY,
      cycle_id INT NOT NULL,
      student_id VARCHAR(36) NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      priority TINYINT UNSIGNED NOT NULL,
      motivation TEXT,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      status ENUM('submitted','accepted','rejected','withdrawn') NOT NULL DEFAULT 'submitted',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
      UNIQUE KEY uk_adjustment_volunteer_cycle_student_topic (cycle_id, student_id, topic_id),
      INDEX idx_adjustment_volunteer_student (cycle_id, student_id),
      INDEX idx_adjustment_volunteer_topic_status (topic_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await conn.query(`
    CREATE TABLE IF NOT EXISTS adjustment_batches (
      id VARCHAR(36) PRIMARY KEY,
      cycle_id INT NOT NULL,
      topic_id VARCHAR(36) NOT NULL,
      status ENUM('draft','submitted','auto_submitted','settled') NOT NULL DEFAULT 'draft',
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
      decision ENUM('proposed','reserve','reject') NOT NULL,
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
      status ENUM('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
      trigger_type ENUM('all_submitted','deadline','admin_retry') NOT NULL,
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

  await conn.query(`
    CREATE TABLE IF NOT EXISTS adjustment_round_archives (
      sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE,
      id VARCHAR(36) PRIMARY KEY,
      cycle_id INT NOT NULL,
      settlement_id VARCHAR(36) NOT NULL,
      snapshot_json JSON NOT NULL,
      reopened_by VARCHAR(36) NOT NULL,
      reason VARCHAR(500) NOT NULL,
      next_deadline DATETIME NOT NULL,
      reopened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_adjustment_archive_settlement (settlement_id),
      INDEX idx_adjustment_archive_cycle (cycle_id, reopened_at),
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  const [versionColumns] = await conn.query<any[]>(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'adjustment_volunteers' AND COLUMN_NAME = 'version'
  `)
  if (!versionColumns.length) {
    try {
      await conn.query('ALTER TABLE adjustment_volunteers ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER motivation')
    } catch (cause: any) {
      // Container startup and the deployment migration may initialize the schema concurrently.
      if (cause?.code !== 'ER_DUP_FIELDNAME') throw cause
    }
  }
}
