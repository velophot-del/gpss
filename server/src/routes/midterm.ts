import { createSubmissionRouter } from '../utils/submissionFlow.js'

// 中期检查：学生提交 → 导师评分 + 评价（通过/不通过/退回修改）
export default createSubmissionRouter({
  table: 'midterm_reports',
  stagePhase: 'midterm',
  label: '中期检查',
  textFields: [
    { column: 'completed_work', key: 'completedWork', required: true, label: '目前已完成工作' },
    { column: 'problems', key: 'problems', required: true, label: '目前存在的主要问题' },
    { column: 'next_plan', key: 'nextPlan', required: true, label: '下一步的主要任务、具体时间安排' }
  ],
  hasScore: true,
  initialStatus: 'not_started',
  submitStatus: 'submitted',
  reviewStates: { pass: 'passed', reject: 'failed', revision: 'need_revision' }
})
