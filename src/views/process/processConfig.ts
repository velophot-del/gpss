import { proposalApi, midtermApi } from '../../api'

export interface StageField {
  key: string
  label: string
  required?: boolean
  type?: 'input' | 'textarea'
  rows?: number
}

export interface StageConfig {
  stage: string
  pageTitle: string
  api: any
  hasTitle: boolean
  titleLabel: string
  fields: StageField[]
  hasScore?: boolean
  submitStatus: string
  reviewPass: string
  reviewReject: string
  reviewLabel: string
}

// 开题/中期两个在线表单的统一配置
export const STAGE_CONFIGS: Record<string, StageConfig> = {
  proposal: {
    stage: 'proposal',
    pageTitle: '我的开题报告',
    api: proposalApi,
    hasTitle: true,
    titleLabel: '开题题目',
    fields: [
      { key: 'background', label: '设计的目的和意义（市场价值等）', required: true, type: 'textarea', rows: 4 },
      { key: 'objectives', label: '设计内容和预期成果', required: true, type: 'textarea', rows: 4 },
      { key: 'methods', label: '拟采取的设计方法和手段（技术）', required: true, type: 'textarea', rows: 4 },
      { key: 'plan', label: '毕业设计方案（步骤）或毕业设计报告提纲', required: true, type: 'textarea', rows: 4 }
    ],
    submitStatus: 'submitted',
    reviewPass: 'approved',
    reviewReject: 'rejected',
    reviewLabel: '开题报告'
  },
  midterm: {
    stage: 'midterm',
    pageTitle: '我的中期检查',
    api: midtermApi,
    hasTitle: false,
    titleLabel: '',
    fields: [
      { key: 'completedWork', label: '目前已完成工作', required: true, type: 'textarea', rows: 5 },
      { key: 'problems', label: '目前存在的主要问题', required: true, type: 'textarea', rows: 4 },
      { key: 'nextPlan', label: '下一步的主要任务、具体时间安排', required: true, type: 'textarea', rows: 4 }
    ],
    hasScore: true,
    submitStatus: 'submitted',
    reviewPass: 'passed',
    reviewReject: 'failed',
    reviewLabel: '中期检查'
  }
}
