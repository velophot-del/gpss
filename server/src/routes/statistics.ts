import { Router } from 'express'
import { query } from '../config/database.js'
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js'
import { success, error } from '../utils/response.js'

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

    // 热门课题 Top 10
    const hotTopics = await query<any>(`
      SELECT t.*, u.real_name as teacher_name
      FROM topics t
      JOIN users u ON t.teacher_id = u.id
      ORDER BY t.view_count DESC, t.apply_count DESC
      LIMIT 10
    `)

    success(res, { teacherRanking, hotTopics })
  } catch (err: any) {
    error(res, '服务器内部错误', 500)
  }
})

export default router
