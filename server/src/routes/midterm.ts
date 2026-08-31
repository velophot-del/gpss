import { createSubmissionRouter } from '../utils/submissionFlow.js'

// 中期检查：学生提交 → 导师评分 + 评价（通过/不通过/退回修改）
export default createSubmissionRouter({
  table: 'midterm_reports',
  stagePhase: 'midterm',
  label: '中期检查',
  textFields: [
    { column: 'progress_summary', key: 'progressSummary', required: true, label: '进度总结' },
    { column: 'completed_work', key: 'completedWork', required: true, label: '已完成内容' },
    { column: 'problems', key: 'problems', label: '存在问题' },
    { column: 'next_plan', key: 'nextPlan', label: '后续计划' }
  ],
  hasScore: true,
  initialStatus: 'not_started',
  submitStatus: 'submitted',
  reviewStates: { pass: 'passed', reject: 'failed', revision: 'need_revision' }
})
