import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveDatabaseConfig } from '../config/runtime.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: path.resolve(__dirname, '../../.env') })
dotenv.config()

// 把学生用户名从「姓名全拼」改为「学号」。
//
// 只更新 users.username 一列的值，id 主键不变，因此学生已编辑的个人信息
// （users.email/avatar/phone、student_profiles 的档案内容）完全不受影响。
// 绝不能用删行重建的方式迁移：student_profiles 有 ON DELETE CASCADE，删用户会级联丢档案。
//
// 预检不通过时直接中止，不做任何修改。

async function migrate() {
  console.log('正在连接数据库...')
  const conn = await mysql.createConnection(resolveDatabaseConfig(process.env))

  try {
    // ---- 预检 1：同一学号被多名学生占用 ----
    const [dupRows] = await conn.query<any[]>(`
      SELECT student_id, COUNT(*) AS cnt, GROUP_CONCAT(real_name SEPARATOR '、') AS names
      FROM users
      WHERE role = 'student' AND student_id IS NOT NULL AND student_id != ''
      GROUP BY student_id
      HAVING cnt > 1
    `)

    // ---- 预检 2：学号与他人当前用户名冲突（会撞 username 唯一约束）----
    const [collisionRows] = await conn.query<any[]>(`
      SELECT s.real_name AS student_name, s.student_id,
             o.real_name AS owner_name, o.role AS owner_role
      FROM users s
      JOIN users o ON o.username = s.student_id AND o.id != s.id
      WHERE s.role = 'student' AND s.student_id IS NOT NULL AND s.student_id != ''
    `)

    if (dupRows.length > 0 || collisionRows.length > 0) {
      console.error('\n❌ 预检未通过，已中止，未做任何修改。\n')

      if (dupRows.length > 0) {
        console.error(`学号在学生之间重复（${dupRows.length} 组）：`)
        dupRows.forEach((r: any) => {
          console.error(`  学号 ${r.student_id} 被 ${r.cnt} 名学生共用：${r.names}`)
        })
        console.error('')
      }

      if (collisionRows.length > 0) {
        console.error(`学号与他人当前用户名冲突（${collisionRows.length} 条）：`)
        collisionRows.forEach((r: any) => {
          console.error(`  学生「${r.student_name}」的学号 ${r.student_id} 已被${r.owner_role}「${r.owner_name}」占用`)
        })
        console.error('')
      }

      console.error('请先修正以上数据，再重新执行本脚本。')
      process.exit(1)
    }

    // ---- 无学号的学生：不中止，迁移后单独列出 ----
    const [blankRows] = await conn.query<any[]>(`
      SELECT username, real_name FROM users
      WHERE role = 'student' AND (student_id IS NULL OR student_id = '')
      ORDER BY real_name
    `)

    // ---- 执行迁移（幂等：用户名已等于学号的行不会被重复计入）----
    const [result] = await conn.query<any>(`
      UPDATE users SET username = student_id
      WHERE role = 'student' AND student_id IS NOT NULL AND student_id != ''
    `)

    console.log(`\n✅ 已迁移 ${result.changedRows ?? 0} 名学生的用户名为学号`)

    if (blankRows.length > 0) {
      console.log(`\n⚠️  跳过 ${blankRows.length} 名学生（无学号，用户名保持不变）：`)
      blankRows.forEach((r: any) => console.log(`    ${r.username}    ${r.real_name}`))
      console.log('\n补齐这些学生的学号后，可重新执行本脚本。')
    }

    console.log('\n迁移完成！')
  } catch (err: any) {
    console.error('迁移失败:', err.message)
    process.exit(1)
  } finally {
    await conn.end()
  }
}

migrate()
