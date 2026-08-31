/**
 * 数据导出脚本
 *
 * 用法: node export-sql.cjs [--output-dir ./backups]
 *
 * 从 MySQL 数据库导出数据为 SQL 文件，可用于备份或迁移。
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// ===== 配置 =====
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'gpss_db'
};

// 从参数获取输出目录，默认为 backups/
const outputDirIndex = process.argv.indexOf('--output-dir');
const OUTPUT_DIR = outputDirIndex !== -1 && process.argv[outputDirIndex + 1]
  ? process.argv[outputDirIndex + 1]
  : path.join(__dirname, '..', 'backups');

// ===== 工具函数 =====

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`);
}

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  if (typeof str === 'number') return String(str);
  return `'${String(str).replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
}

async function exportTable(conn, tableName, columns, options = {}) {
  const { orderBy = 'id', where = '', limit = '' } = options;

  let sql = `SELECT ${columns} FROM \`${tableName}\``;
  if (where) sql += ` WHERE ${where}`;
  if (orderBy) sql += ` ORDER BY ${orderBy}`;
  if (limit) sql += ` LIMIT ${limit}`;

  const [rows] = await conn.query(sql);
  return rows;
}

function rowsToInsertSql(tableName, rows) {
  if (!rows || rows.length === 0) return `-- \`${tableName}\`: 空表\n\n`;

  const keys = Object.keys(rows[0]);
  const columnList = keys.map(k => `\`${k}\``).join(', ');
  const valueRows = rows.map(row => {
    const values = keys.map(k => {
      const val = row[k];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'object') return escapeSql(JSON.stringify(val));
      return escapeSql(val);
    });
    return `    (${values.join(', ')})`;
  });

  return [
    `-- ================================`,
    `-- 表: ${tableName}`,
    `-- 记录数: ${rows.length}`,
    `-- 导出时间: ${new Date().toISOString()}`,
    `-- ================================`,
    ``,
    `INSERT INTO \`${tableName}\` (${columnList}) VALUES`,
    valueValues.join(',\n'),
    ';',
    ''
  ].join('\n');
}

// ===== 主流程 =====

async function main() {
  log('📦 开始导出数据库...');
  log(`   数据源: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
  log(`   输出目录: ${path.resolve(OUTPUT_DIR)}`);

  // 确保输出目录存在
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputFile = path.join(OUTPUT_DIR, `gpss_backup_${timestamp}.sql`);
    const lines = [];

    lines.push('-- ==========================================================');
    lines.push(`-- GPSS 毕业设计管理系统 - 数据库备份`);
    lines.push(`-- 时间: ${new Date().toLocaleString('zh-CN')}`);
    lines.push(`-- 数据库: ${DB_CONFIG.database}`);
    lines.push('-- ==========================================================');
    lines.push('');
    lines.push('SET NAMES utf8mb4;');
    lines.push('SET FOREIGN_KEY_CHECKS = 0;');
    lines.push('');

    // 按依赖关系顺序导出各表
    const tables = [
      { name: 'users', cols: 'id, username, password, real_name, email, role, avatar, student_id, class_name, major, major_code, grade, title, department, phone, status, created_at, updated_at' },
      { name: 'student_profiles', cols: 'id, user_id, gpa, ranking, total_students, skills, interests, portfolio, self_intro, created_at' },
      { name: 'cycles', cols: '*' },
      { name: 'topics', cols: '*' },
      { name: 'applications', cols: '*' },
      { name: 'adjustments', cols: '*' },
      { name: 'system_configs', cols: '*' },
      { name: 'operation_logs', cols: '*', limit: '1000' }
    ];

    for (const t of tables) {
      log(`   导出 ${t.name}...`);
      const rows = await exportTable(conn, t.name, t.cols, { limit: t.limit });
      lines.push(rowsToInsertSql(t.name, rows));
    }

    lines.push('SET FOREIGN_KEY_CHECKS = 1;');
    lines.push('');
    lines.push(`-- 备份完成。总计导出 ${tables.length} 张表`);

    // 写入文件
    fs.writeFileSync(outputFile, lines.join('\n'), 'utf-8');

    const sizeKB = (fs.statSync(outputFile).size / 1024).toFixed(1);
    log(`\n✅ 导出完成！`);
    log(`   文件: ${outputFile}`);
    log(`   大小: ${sizeKB} KB`);

  } catch (err) {
    console.error('❌ 导出失败:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

main();
