import { Router } from 'express'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'
import { getActiveCycle } from '../utils/processFlow.js'
import { getStudentMajorCode, getTopicAccessPolicy } from '../utils/topicAccess.js'
import { getAllowedMajorNames, getAllowedMajorOptions, getCycleMajors } from '../utils/majors.js'

const router = Router()
router.use(authMiddleware)

// GET /api/statistics/overview - 概览统计
router.get('/overview', async (req: AuthRequest, res) => {
  try {
    // 基础数据统计
    const [studentCount] = await query<any>("SELECT COUNT(*) as cnt FROM users WHERE role = 'student' AND status = 'active'")
    const [teacherCount] = await query<any>("SELECT COUNT(*) as cnt FROM users WHERE role = 'teacher' AND status = 'active'")
    const [topicCount] = await query<any>("SELECT COUNT(*) as cnt FROM topics")
    const [publishedTopicCount] = await query<any>("SELECT COUNT(*) as cnt FROM topics WHERE status = 'published'")
    const [applicationCount] = await query<any>("SELECT COUNT(*) as cnt FROM applications")
    const [acceptedCount] = await query<any>("SELECT COUNT(*) as cnt FROM applications WHERE status = 'accepted'")

    // 各专业学生分布
    const majorDistribution = await query<any>(`
      SELECT major_code, major, COUNT(*) as count
      FROM users WHERE role = 'student' AND status = 'active'
      GROUP BY major_code, major ORDER BY count DESC
    `)

    // 课题分类分布
    const categoryDistribution = await query<any>(`
      SELECT category, COUNT(*) as count
      FROM topics GROUP BY category ORDER BY count DESC
    `)

    // 申请状态分布
    const applicationStatusDist = await query<any>(`
      SELECT status, COUNT(*) as count
      FROM applications GROUP BY status
    `)

    // 近7天注册趋势（模拟）
    const recentTrend = await query<any>(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at) ORDER BY date
    `)

    success(res, {
      summary: {
        totalStudents: studentCount.cnt,
        totalTeachers: teacherCount.cnt,
        totalTopics: topicCount.cnt,
        publishedTopics: publishedTopicCount.cnt,
        totalApplications: applicationCount.cnt,
        acceptedApplications: acceptedCount.cnt,
        selectionRate: studentCount.cnt > 0 ? ((acceptedCount.cnt / studentCount.cnt) * 100).toFixed(1) + '%' : '0%'
      },
      majorDistribution,
      categoryDistribution,
      applicationStatusDist,
      recentTrend
    })
  } catch (err: any) {
    console.error('获取统计数据失败:', err)
    error(res, '服务器内部错误', 500)
  }
})

// GET /api/statistics/topics - 课题详细统计
router.get('/topics', async (req: AuthRequest, res) => {
  try {
    // 教师课题数排行
    const teacherRanking = await query<any>(`
      SELECT u.real_name, u.department, COUNT(t.id) as topic_count,
             SUM(CASE WHEN t.status = 'published' THEN 1 ELSE 0 END) as published_count,
             SUM(t.view_count) as total_views,
             SUM(t.apply_count) as total_applications
      FROM users u
      LEFT JOIN topics t ON u.id = t.teacher_id
      WHERE u.role = 'teacher'
      GROUP BY u.id, u.real_name, u.department
      ORDER BY topic_count DESC
    `)

    const activeCycle = await getActiveCycle()
    if (!activeCycle) {
      return success(res, { teacherRanking, hotTopics: [], recommendedTopics: [] })
    }

    let visibilitySql = ''
    const visibilityParams: any[] = []
    if (req.user!.role === 'student') {
      const [studentMajorCode, policy, cycleMajors] = await Promise.all([
        getStudentMajorCode(req.user!.id),
        getTopicAccessPolicy(activeCycle.id),
        getCycleMajors(activeCycle.id),
      ])
      if (policy.mode !== 'all') {
        const allowedMajors = getAllowedMajorOptions(policy, cycleMajors, studentMajorCode)
        const allowedCodes = allowedMajors.map(major => major.code)
        if (!allowedCodes.length) {
          return success(res, { teacherRanking, hotTopics: [], recommendedTopics: [] })
        }
        const allowedNames = getAllowedMajorNames(allowedCodes, cycleMajors)
        const conditions = [`t.major_code IN (${allowedCodes.map(() => '?').join(',')})`]
        visibilityParams.push(...allowedCodes)
        if (allowedNames.length) {
          conditions.push(`t.major IN (${allowedNames.map(() => '?').join(',')})`)
          visibilityParams.push(...allowedNames)
        }
        visibilitySql = ` AND (${conditions.join(' OR ')})`
      }
    }

    // 工作台只统计当前周期的已发布课题；申请人数从 applications 实时计算，排除已撤回志愿。
    const topicRows = await query<any>(`
      SELECT t.id, t.title, t.difficulty, t.max_students, t.major, t.major_code,
             t.view_count, t.teacher_id, u.real_name AS teacher_name,
             COALESCE(ac.apply_count, 0) AS apply_count,
             COALESCE(ac.accepted_count, 0) AS accepted_count
      FROM topics t
      JOIN users u ON t.teacher_id = u.id
      LEFT JOIN (
        SELECT topic_id,
               COUNT(*) AS apply_count,
               SUM(status = 'accepted') AS accepted_count
        FROM applications
        WHERE status IN ('pending', 'submitted', 'pending_review', 'waitlisted', 'accepted')
        GROUP BY topic_id
      ) ac ON ac.topic_id = t.id
      WHERE t.status = 'published' AND t.cycle_id = ?${visibilitySql}
    `, [activeCycle.id, ...visibilityParams])

    const numericRows = topicRows.map((topic: any) => ({
      ...topic,
      view_count: Number(topic.view_count) || 0,
      apply_count: Number(topic.apply_count) || 0,
      accepted_count: Number(topic.accepted_count) || 0,
      max_students: Number(topic.max_students) || 0,
    }))

    // 管理员/教师查看综合热度：申请意向权重 60%，浏览关注权重 40%。
    const maxApplyLog = Math.max(...numericRows.map((topic: any) => Math.log1p(topic.apply_count)), 1)
    const maxViewLog = Math.max(...numericRows.map((topic: any) => Math.log1p(topic.view_count)), 1)
    const hotTopics = numericRows
      .map((topic: any) => ({
        ...topic,
        heat_score: Number((
          Math.log1p(topic.apply_count) / maxApplyLog * 0.6
          + Math.log1p(topic.view_count) / maxViewLog * 0.4
        ).toFixed(4)),
      }))
      .sort((a: any, b: any) => b.heat_score - a.heat_score || b.apply_count - a.apply_count || b.view_count - a.view_count || String(a.id).localeCompare(String(b.id)))
      .slice(0, 10)

    // 学生推荐优先低申请、低浏览课题，并按教师轮换，避免同一教师连续占据推荐位。
    const recommendationGroups = new Map<string, any[]>()
    const fairRows = [...numericRows].sort((a: any, b: any) => {
      const aScore = Math.log1p(a.apply_count) * 0.6 + Math.log1p(a.view_count) * 0.4
      const bScore = Math.log1p(b.apply_count) * 0.6 + Math.log1p(b.view_count) * 0.4
      return aScore - bScore || a.apply_count - b.apply_count || a.view_count - b.view_count || String(a.id).localeCompare(String(b.id))
    })
    for (const topic of fairRows) {
      const teacherId = String(topic.teacher_id)
      if (!recommendationGroups.has(teacherId)) recommendationGroups.set(teacherId, [])
      recommendationGroups.get(teacherId)!.push(topic)
    }
    const recommendedTopics: any[] = []
    while (recommendationGroups.size) {
      for (const [teacherId, topics] of recommendationGroups) {
        const topic = topics.shift()
        if (topic) recommendedTopics.push(topic)
        if (!topics.length) recommendationGroups.delete(teacherId)
      }
    }

    success(res, { teacherRanking, hotTopics, recommendedTopics })
  } catch (err: any) {
    error(res, '服务器内部错误', 500)
  }
})

export default router
