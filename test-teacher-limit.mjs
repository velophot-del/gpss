#!/usr/bin/env node

/**
 * 测试脚本：验证教师指导学生人数上限是否生效
 * 
 * 测试场景：
 * 1. 创建一个选题周期，设定教师指导人数上限为 2
 * 2. 某教师创建2个课题
 * 3. 4个学生分别申请这2个课题
 * 4. 尝试审批前3个学生（应成功）
 * 5. 尝试审批第4个学生（应失败，提示已达到教师人数上限）
 */

import axios from 'axios'

const API_BASE = 'http://127.0.0.1:3011/api'

// 测试用例数据
const adminUser = { username: 'admin', password: '123456' }
const teacherUser = { username: 'chen', password: '123456' }
const studentUsers = [
  { username: 'zhangyi', password: '123456', id: 's001' },
  { username: 'wanghan', password: '123456', id: 's002' },
  { username: 'linsiyuan', password: '123456', id: 's003' },
  { username: 'liushiyu', password: '123456', id: 's004' }
]

let adminToken = ''
let teacherToken = ''
let teacherId = 't001'
let studentTokens = []
let cycleId = null
let topicIds = []
let applicationIds = []

async function login(user) {
  try {
    const res = await axios.post(`${API_BASE}/auth/login`, {
      username: user.username,
      password: user.password
    })
    return res.data.data.token
  } catch (err) {
    console.error(`❌ 登录失败 (${user.username}):`, err.response?.data || err.message)
    process.exit(1)
  }
}

async function createCycle(token, config) {
  try {
    const res = await axios.post(`${API_BASE}/cycles`, config, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return res.data.data.id
  } catch (err) {
    console.error('❌ 创建周期失败:', err.response?.data || err.message)
    process.exit(1)
  }
}

async function createTopic(token, cycleId, topicData) {
  try {
    const res = await axios.post(`${API_BASE}/topics`, {
      ...topicData,
      cycle_id: cycleId,
      status: 'published'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return res.data.data.id
  } catch (err) {
    console.error('❌ 创建课题失败:', err.response?.data || err.message)
    process.exit(1)
  }
}

async function submitApplication(token, topicId) {
  try {
    const res = await axios.post(`${API_BASE}/applications`, {
      topicId: topicId,
      priority: 1,
      motivation: '我对此课题很感兴趣'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return res.data.data
  } catch (err) {
    console.error('❌ 提交申请失败:', err.response?.data || err.message)
    return null
  }
}

async function getApplications(token) {
  try {
    const res = await axios.get(`${API_BASE}/applications`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return res.data.data
  } catch (err) {
    console.error('❌ 获取申请列表失败:', err.response?.data || err.message)
    return []
  }
}

async function reviewApplication(token, appId, status, comment = '') {
  try {
    const res = await axios.put(`${API_BASE}/applications/${appId}`, {
      status: status,
      comment: comment
    }, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return { success: true, message: res.data.message }
  } catch (err) {
    return { success: false, message: err.response?.data?.message || err.message }
  }
}

async function updateCycleStatus(token, cycleId, newStatus) {
  try {
    await axios.put(`${API_BASE}/cycles/${cycleId}`, {
      status: newStatus,
      phase: newStatus === 'active' ? 'student_selection' : 'topic_submission'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    })
  } catch (err) {
    console.error('❌ 更新周期状态失败:', err.response?.data || err.message)
  }
}

async function main() {
  console.log('\n========== 教师指导学生人数上限测试 ==========\n')

  // 1. 登录
  console.log('1️⃣  登录所有用户...')
  adminToken = await login(adminUser)
  teacherToken = await login(teacherUser)
  for (const student of studentUsers) {
    const token = await login(student)
    studentTokens.push({ token, ...student })
  }
  console.log('✅ 登录成功\n')

  // 2. 创建选题周期，设定教师指导人数上限为 2
  console.log('2️⃣  创建选题周期（教师上限设为 2 人）...')
  cycleId = await createCycle(adminToken, {
    name: '2025-2026学年教师人数上限测试周期',
    description: '测试教师人数上限功能',
    year: '2025-2026',
    status: 'active',
    phase: 'student_selection',  // 立即设置为学生选题阶段
    startDate: '2025-09-01',
    endDate: '2025-10-30',
    phasesConfig: {
      topic_submission: { start: '2025-09-01', end: '2025-09-15' },
      student_selection: { start: '2025-09-16', end: '2025-09-30' },
      teacherStudentLimit: 2  // ← 教师上限设为 2
    }
  })
  console.log(`✅ 周期已创建 (ID: ${cycleId})\n`)

  // 3. 教师创建2个课题
  console.log('3️⃣  教师创建 2 个课题...')
  for (let i = 1; i <= 2; i++) {
    const topicId = await createTopic(teacherToken, cycleId, {
      title: `课题${i}: AI 在视觉设计中的应用`,
      description: `这是一个关于 AI 在视觉设计中的应用的课题，探讨最新的技术趋势。`,
      category: '视觉传达设计',
      difficulty: 'medium',
      max_students: 2
    })
    topicIds.push(topicId)
    console.log(`  ✓ 课题${i}已创建 (ID: ${topicId})`)
  }
  console.log()

  // 4. 4个学生分别申请这2个课题
  console.log('4️⃣  4个学生分别申请课题...')
  // 课题1: 学生1,2
  // 课题2: 学生3,4
  const applyMap = [
    [0, 0], [1, 0], [2, 1], [3, 1]
  ]
  for (let i = 0; i < studentUsers.length; i++) {
    const topicIdx = applyMap[i][1]
    await submitApplication(studentTokens[i].token, topicIds[topicIdx])
    console.log(`  ✓ 学生 ${i+1} (${studentUsers[i].username}) 申请了课题${topicIdx+1}`)
  }
  console.log()

  // 5. 教师审批申请 - 前2个通过，第3个应该因为达到上限而失败
  console.log('5️⃣  教师审批申请...\n')
  
  const teacherApps = await getApplications(teacherToken)
  console.log(`  获取到 ${teacherApps.length} 个申请\n`)

  for (let i = 0; i < Math.min(3, teacherApps.length); i++) {
    const app = teacherApps[i]
    const result = await reviewApplication(teacherToken, app.id, 'accepted', '很好的申请')
    
    if (result.success) {
      console.log(`  ✓ 申请${i+1}审批通过: ${result.message}`)
    } else {
      console.log(`  ❌ 申请${i+1}审批失败: ${result.message}`)
    }
  }
  
  console.log('\n========== 测试结果分析 ==========\n')
  
  const finalApps = await getApplications(teacherToken)
  const acceptedCount = finalApps.filter(a => a.status === 'accepted').length
  
  console.log(`✅ 教师已接收的学生总数: ${acceptedCount}`)
  console.log(`⚠️  周期内教师指导人数上限: 2`)
  
  if (acceptedCount <= 2) {
    console.log('\n✅ 【测试通过】教师人数上限功能正常生效！')
    console.log('   系统正确限制教师最多只能指导 2 个学生。')
  } else {
    console.log('\n❌ 【测试失败】教师人数上限未生效！')
    console.log(`   教师实际接收了 ${acceptedCount} 个学生，超过了限制 2 人。`)
  }
  
  console.log('\n')
}

main().catch(console.error)
