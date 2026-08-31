import { createSubmissionRouter } from '../utils/submissionFlow.js'

// 毕业论文：学生提交（多版本）→ 导师批阅（通过/退回修改/拒绝/定稿）
export default createSubmissionRouter({
  table: 'thesis_submissions',
  stagePhase: 'thesis_design',
  label: '毕业论文',
  titleField: 'title',
  textFields: [
    { column: 'abstract', key: 'abstract', required: true, label: '摘要' },
    { column: 'keywords', key: 'keywords', label: '关键词' }
  ],
  hasVersion: true,
  allowFinal: true,
  initialStatus: 'draft',
  submitStatus: 'submitted',
  reviewStates: { pass: 'approved', reject: 'rejected', revision: 'need_revision' }
})
