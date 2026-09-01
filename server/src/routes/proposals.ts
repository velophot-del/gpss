import { createSubmissionRouter } from '../utils/submissionFlow.js'

// 开题报告：学生提交 → 导师审核（通过/退回修改/拒绝）
export default createSubmissionRouter({
  table: 'proposals',
  stagePhase: 'proposal',
  label: '开题报告',
  titleField: 'title',
  textFields: [
    { column: 'background', key: 'background', required: true, label: '设计的目的和意义（市场价值等）' },
    { column: 'objectives', key: 'objectives', required: true, label: '设计内容和预期成果' },
    { column: 'methods', key: 'methods', required: true, label: '拟采取的设计方法和手段（技术）' },
    { column: 'plan', key: 'plan', required: true, label: '毕业设计方案（步骤）或毕业设计报告提纲' }
  ],
  initialStatus: 'not_started',
  submitStatus: 'submitted',
  reviewStates: { pass: 'approved', reject: 'rejected', revision: 'need_revision' }
})
