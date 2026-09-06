import mysql from 'mysql2/promise'
import { v4 as uuidv4 } from 'uuid'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveDatabaseConfig } from '../config/runtime.js'

// 选题库两段式 M1 迁移：新建 topic_templates（个人模板库）+ topics 加 template_id 回链
// 幂等、可重复执行；只做加列/建表/回填，不改动任何 topic 行内容与状态。
// 说明：topics.template_id 此阶段保持可空（服务端建题代码尚不写该列），收紧 NOT NULL 放到 M2 之后。

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config()

const dbName = process.env.DB_NAME || 'gpss_db'

async function migrate() {
  console.log('连接数据库...')
  const conn = await mysql.createConnection(resolveDatabaseConfig())
  try {
    // 1) 建表（与 initDb.ts 内 DDL 保持一致；全新环境 initDb 亦会建）
    await conn.query(`
      CREATE TABLE IF NOT EXISTS topic_templates (
        id                  VARCHAR(36) PRIMARY KEY,
        teacher_id          VARCHAR(36) NOT NULL,
        title               VARCHAR(200) NOT NULL,
        description         TEXT,
        category            VARCHAR(50) NOT NULL,
        major               VARCHAR(100),
        major_code          VARCHAR(20),
        difficulty          ENUM('easy','medium','hard') NOT NULL DEFAULT 'medium',
        max_students_default TINYINT UNSIGNED NOT NULL DEFAULT 1,
        tags                JSON,
        requirements        TEXT,
        schedules           JSON,
        attachments         JSON,
        group_name          VARCHAR(50),
        status              ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (teacher_id) REFERENCES users(id),
        INDEX idx_tpl_teacher (teacher_id),
        INDEX idx_tpl_status (status),
        INDEX idx_tpl_major (major_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)
    console.log('topic_templates 表就绪')

    // 2) topics 加 template_id（可空）+ 索引 + 外键
    const colRows = await conn.query<any[]>(`SELECT 1 FROM information_schema.COLUMNS
      WHERE table_schema=? AND table_name='topics' AND column_name='template_id'`, [dbName])
    if (!colRows[0].length) {
      await conn.query('ALTER TABLE topics ADD COLUMN template_id VARCHAR(36) NULL')
      console.log('已添加 topics.template_id')
    }
    const idxRows = await conn.query<any[]>(`SELECT 1 FROM information_schema.STATISTICS
      WHERE table_schema=? AND table_name='topics' AND index_name='idx_topic_template'`, [dbName])
    if (!idxRows[0].length) {
      await conn.query('ALTER TABLE topics ADD INDEX idx_topic_template (template_id)')
      console.log('已添加索引 idx_topic_template')
    }
    const fkRows = await conn.query<any[]>(`SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE constraint_schema=? AND table_name='topics' AND constraint_name='fk_topic_template'`, [dbName])
    if (!fkRows[0].length) {
      await conn.query(`ALTER TABLE topics ADD CONSTRAINT fk_topic_template
        FOREIGN KEY (template_id) REFERENCES topic_templates(id) ON DELETE SET NULL`)
      console.log('已添加外键 fk_topic_template')
    }

    // 3) 孤儿检查：若全部 topic 均已回链到有效模板则直接结束（幂等出口）
    const [orphan0] = await conn.query<any[]>(`SELECT COUNT(*) AS cnt FROM topics t
      LEFT JOIN topic_templates tp ON tp.id = t.template_id
      WHERE t.template_id IS NULL OR tp.id IS NULL`)
    if (Number(orphan0[0].cnt) === 0) {
      console.log('无待回填数据，已是最新，退出')
      return
    }

    // 4) 按 (teacher_id, TRIM(title)) 归并建库：每组取 updated_at 最新的一行做内容种子
    const rows = await conn.query<any[]>(`SELECT id, teacher_id, title, description, category,
      major, major_code, difficulty, max_students, tags, requirements, schedules, attachments,
      updated_at, created_at FROM topics`)
    const best = new Map<string, any>()
    for (const r of rows[0]) {
      const key = `${r.teacher_id}\u0000${String(r.title).trim()}`
      const cur = best.get(key)
      if (!cur || r.updated_at > cur.updated_at || (r.updated_at?.getTime?.() === cur.updated_at?.getTime?.() && r.created_at > cur.created_at)) {
        best.set(key, { ...r, key })
      }
    }

    const toJson = (v: any) => (typeof v === 'string' ? v : JSON.stringify(v ?? []))
    const link = new Map<string, string>() // topicId -> templateId
    for (const [, s] of best) {
      const tid = uuidv4()
      await conn.query(`INSERT INTO topic_templates
        (id, teacher_id, title, description, category, major, major_code, difficulty,
         max_students_default, tags, requirements, schedules, attachments, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active')`,
        [tid, s.teacher_id, String(s.title).trim(), s.description ?? null, s.category,
         s.major ?? null, s.major_code ?? null, s.difficulty, s.max_students || 1,
         toJson(s.tags), s.requirements ?? '', toJson(s.schedules), toJson(s.attachments)])
      const ts = await conn.query<any[]>(`SELECT id FROM topics
        WHERE teacher_id=? AND TRIM(title)=? AND template_id IS NULL`,
        [s.teacher_id, String(s.title).trim()])
      for (const t of ts[0]) link.set(t.id, tid)
    }

    // 5) 逐条回链
    for (const [topicId, templateId] of link) {
      await conn.query('UPDATE topics SET template_id=? WHERE id=?', [templateId, topicId])
    }

    // 6) 复核：孤儿应为 0
    const [orphan1] = await conn.query<any[]>(`SELECT COUNT(*) AS cnt FROM topics t
      LEFT JOIN topic_templates tp ON tp.id = t.template_id
      WHERE t.template_id IS NULL OR tp.id IS NULL`)
    if (Number(orphan1[0].cnt) !== 0) throw new Error(`回填后仍有 ${orphan1[0].cnt} 条孤儿 topic`)
    console.log(`迁移完成：建模板 ${best.size} 条，回链 ${link.size} 条`)
  } catch (e: any) {
    console.error('迁移失败:', e.message)
    process.exit(1)
  } finally {
    await conn.end()
  }
}

migrate()
