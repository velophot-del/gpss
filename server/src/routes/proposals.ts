import { createSubmissionRouter } from '../utils/submissionFlow.js'

// 开题报告：学生提交 → 导师审核（通过/退回修改/拒绝）
export default createSubmissionRouter({
  table: 'proposals',
  stagePhase: 'proposal',
  label: '开题报告',
  titleField: 'title',
  textFields: [
    { column: 'background', key: 'background', required: true, label: '选题背景' },
    { column: 'objectives', key: 'objectives', required: true, label: '研究/设计目标' },
    { column: 'content', key: 'content', required: true, label: '主要内容' },
    { column: 'methods', key: 'methods', required: true, label: '方法与技术路线' },
    { column: 'plan', key: 'plan', label: '进度计划' }
  ],
  initialStatus: 'not_started',
  submitStatus: 'submitted',
  reviewStates: { pass: 'approved', reject: 'rejected', revision: 'need_revision' }
})
