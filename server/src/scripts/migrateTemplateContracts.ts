import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import { resolveDatabaseConfig } from '../config/runtime.js'
import { createTemplateContractTables } from './templateSchema.js'

dotenv.config()
const conn = await mysql.createConnection(resolveDatabaseConfig())
try {
  await createTemplateContractTables(conn)
  const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS total FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN ('document_template_contracts', 'document_material_templates')`)
  if (Number(rows[0]?.total) !== 2) throw new Error('模板配置表验证失败')
  console.log('模板配置与材料版本绑定表已就绪；未修改现有材料或上传文件')
} finally { await conn.end() }
