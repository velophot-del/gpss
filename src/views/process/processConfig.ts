import { proposalApi, midtermApi, thesisApi, designApi } from '../../api'

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
  category: string
  accept: string
  uploadTip: string
  hasScore?: boolean
  reviewPass: string
  reviewReject: string
  reviewLabel: string
}

// 论文/作品/开题/中期 四个环节的统一配置
export const STAGE_CONFIGS: Record<string, StageConfig> = {
  proposal: {
    stage: 'proposal',
    pageTitle: '我的开题报告',
    api: proposalApi,
    hasTitle: true,
    titleLabel: '开题题目',
    fields: [
      { key: 'background', label: '选题背景', required: true, type: 'textarea', rows: 3 },
      { key: 'objectives', label: '研究/设计目标', required: true, type: 'textarea', rows: 3 },
      { key: 'content', label: '主要内容', required: true, type: 'textarea', rows: 4 },
      { key: 'methods', label: '方法与技术路线', required: true, type: 'textarea', rows: 3 },
      { key: 'plan', label: '进度计划', type: 'textarea', rows: 3 }
    ],
    category: 'proposal',
    accept: '.pdf,.doc,.docx,.zip',
    uploadTip: '支持 PDF / Word / 压缩包，单个不超过 50MB',
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
      { key: 'progressSummary', label: '进度总结', required: true, type: 'textarea', rows: 3 },
      { key: 'completedWork', label: '已完成内容', required: true, type: 'textarea', rows: 3 },
      { key: 'problems', label: '存在问题', type: 'textarea', rows: 3 },
      { key: 'nextPlan', label: '后续计划', type: 'textarea', rows: 3 }
    ],
    category: 'midterm',
    accept: '.pdf,.doc,.docx,.zip,.jpg,.jpeg,.png',
    uploadTip: '支持 PDF / Word / 图片 / 压缩包，单个不超过 50MB',
    hasScore: true,
    reviewPass: 'passed',
    reviewReject: 'failed',
    reviewLabel: '中期检查'
  },
  thesis: {
    stage: 'thesis',
    pageTitle: '毕业论文提交',
    api: thesisApi,
    hasTitle: true,
    titleLabel: '论文标题',
    fields: [
      { key: 'abstract', label: '摘要', required: true, type: 'textarea', rows: 5 },
      { key: 'keywords', label: '关键词', type: 'input' }
    ],
    category: 'thesis',
    accept: '.pdf,.doc,.docx,.zip',
    uploadTip: '支持 PDF / Word / 压缩包，单个不超过 50MB，可多版本重传',
    reviewPass: 'approved',
    reviewReject: 'rejected',
    reviewLabel: '毕业论文'
  },
  design: {
    stage: 'design',
    pageTitle: '设计作品提交',
    api: designApi,
    hasTitle: true,
    titleLabel: '作品名称',
    fields: [
      { key: 'description', label: '设计说明', required: true, type: 'textarea', rows: 5 }
    ],
    category: 'design',
    accept: '.jpg,.jpeg,.png,.gif,.svg,.webp,.mp4,.mov,.zip,.rar,.stl,.obj,.pdf',
    uploadTip: '支持图片 / 视频 / 模型 / 压缩包，单个不超过 500MB，可多附件',
    reviewPass: 'approved',
    reviewReject: 'rejected',
    reviewLabel: '设计作品'
  }
}
