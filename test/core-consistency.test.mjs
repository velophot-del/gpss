import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import mysql from '../server/node_modules/mysql2/promise.js'

const env = Object.fromEntries(
  fs.readFileSync('server/.env', 'utf8')
    .split(/\r?\n/)
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)]
    })
)
const baseUrl = `http://${env.HOST}:${env.PORT}`
const db = await mysql.createConnection({
  host: env.DB_HOST,
  port: Number(env.DB_PORT),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME
})

async function login(username) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: '123456' })
  })
  const body = await response.json()
  assert.equal(response.status, 200)
  return body.data.token
}

const topicId = randomUUID()
const applicationId = randomUUID()

try {
  const [[teacher]] = await db.query("SELECT id FROM users WHERE username = 'chen'")
  const [[student]] = await db.query("SELECT id FROM users WHERE username = 'sunxiaomeng'")

  await db.execute(
    `INSERT INTO topics (id, title, category, difficulty, max_students, status, teacher_id)
     VALUES (?, ?, '测试分类', 'medium', 1, 'published', ?)`,
    [topicId, `计数回归-${topicId}`, teacher.id]
  )
  await db.execute(
    `INSERT INTO applications (id, student_id, topic_id, priority, status)
     VALUES (?, ?, ?, 1, 'pending')`,
    [applicationId, student.id, topicId]
  )

  const token = await login('sunxiaomeng')
  const addResponse = await fetch(`${baseUrl}/api/shortlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ topicId })
  })
  assert.equal(addResponse.status, 200)

  const shortlistResponse = await fetch(`${baseUrl}/api/shortlist`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const shortlistBody = await shortlistResponse.json()
  assert.equal(shortlistResponse.status, 200)
  const item = shortlistBody.data.find(entry => entry.topic_id === topicId)
  assert.ok(item, 'temporary topic should be present in the shortlist')
  assert.equal(Number(item.apply_count), 1, 'shortlist must return the live non-withdrawn application count')

  const adminToken = await login('admin')
  const adminTopicsResponse = await fetch(`${baseUrl}/api/admin/topics`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  })
  const adminTopicsBody = await adminTopicsResponse.json()
  assert.equal(adminTopicsResponse.status, 200)
  const adminTopic = adminTopicsBody.data.find(entry => entry.id === topicId)
  assert.ok(adminTopic, 'temporary topic should be visible to the administrator')
  assert.equal(Number(adminTopic.apply_count), 1, 'administrator statistics must use the live application count')
} finally {
  await db.execute('DELETE FROM topic_shortlist WHERE topic_id = ?', [topicId])
  await db.execute('DELETE FROM applications WHERE id = ?', [applicationId])
  await db.execute('DELETE FROM topics WHERE id = ?', [topicId])
}

const reviewTopicId = randomUUID()
const reviewApplicationId = randomUUID()

try {
  const [[teacher]] = await db.query("SELECT id FROM users WHERE username = 'chen'")
  const [[student]] = await db.query("SELECT id FROM users WHERE username = 'sunxiaomeng'")
  await db.execute(
    `INSERT INTO topics (id, title, category, difficulty, max_students, status, teacher_id)
     VALUES (?, ?, '测试分类', 'medium', 1, 'published', ?)`,
    [reviewTopicId, `审批回归-${reviewTopicId}`, teacher.id]
  )
  await db.execute(
    `INSERT INTO applications (id, student_id, topic_id, priority, status)
     VALUES (?, ?, ?, 1, 'pending')`,
    [reviewApplicationId, student.id, reviewTopicId]
  )

  const teacherToken = await login('chen')
  const acceptResponse = await fetch(`${baseUrl}/api/applications/${reviewApplicationId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${teacherToken}` },
    body: JSON.stringify({ status: 'accepted' })
  })
  assert.equal(acceptResponse.status, 200)

  const rejectResponse = await fetch(`${baseUrl}/api/applications/${reviewApplicationId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${teacherToken}` },
    body: JSON.stringify({ status: 'rejected' })
  })
  assert.equal(rejectResponse.status, 200)

  const [[topicAfterReject]] = await db.query('SELECT status FROM topics WHERE id = ?', [reviewTopicId])
  assert.equal(topicAfterReject.status, 'published', 'rejecting the sole accepted application must reopen the topic')
} finally {
  await db.execute('DELETE FROM applications WHERE id = ?', [reviewApplicationId])
  await db.execute('DELETE FROM topics WHERE id = ?', [reviewTopicId])
  await db.end()
}
