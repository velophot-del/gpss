import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import { resolveDatabaseConfig } from './runtime.js'

dotenv.config()

export const dbConfig = {
  ...resolveDatabaseConfig(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
}

// 获取数据库连接
const pool = mysql.createPool(dbConfig)

export async function getConnection() {
  return pool.getConnection()
}

// 执行查询（使用连接池，复用连接）
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const [rows] = await pool.query(sql, params)
  return rows as T[]
}

// 执行事务
export async function transaction<T>(callback: (conn: mysql.Connection) => Promise<T>): Promise<T> {
  const conn = await getConnection()
  try {
    await conn.beginTransaction()
    const result = await callback(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}
