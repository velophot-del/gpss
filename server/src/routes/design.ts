import { createSubmissionRouter } from '../utils/submissionFlow.js'

// 设计作品：学生提交（多附件、多版本）→ 导师批阅（通过/退回修改/拒绝/定稿）
export default createSubmissionRouter({
  table: 'design_submissions',
  stagePhase: 'thesis_design',
  label: '设计作品',
  titleField: 'title',
  textFields: [
    { column: 'description', key: 'description', required: true, label: '设计说明' }
  ],
  hasVersion: true,
  allowFinal: true,
  initialStatus: 'draft',
  submitStatus: 'submitted',
  reviewStates: { pass: 'approved', reject: 'rejected', revision: 'need_revision' }
})
