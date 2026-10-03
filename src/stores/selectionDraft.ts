import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { selectionDraftApi } from '../api'
import type { SelectionDraftApplication, SelectionDraftDecision, SelectionDraftView } from '../types'

export const useSelectionDraftStore = defineStore('selectionDraft', () => {
  const drafts = ref<Record<string, SelectionDraftView>>({})
  const loadingTopicIds = ref<string[]>([])
  const savingTopicIds = ref<string[]>([])
  const submittingTopicIds = ref<string[]>([])

  const pendingTopicCount = computed(() => Object.values(drafts.value).filter(view =>
    view.applications.some(item => item.status !== 'accepted') && view.batch.status === 'draft',
  ).length)

  async function load(topicId: string) {
    if (!loadingTopicIds.value.includes(topicId)) loadingTopicIds.value.push(topicId)
    try {
      const response: any = await selectionDraftApi.get(topicId)
      drafts.value[topicId] = response.data
      return response.data as SelectionDraftView
    } finally {
      loadingTopicIds.value = loadingTopicIds.value.filter(id => id !== topicId)
    }
  }

  function editableItems(topicId: string) {
    return (drafts.value[topicId]?.applications || []).filter(item => item.decision).map(item => ({
      applicationId: item.id,
      decision: item.decision,
      decisionRank: item.decision === 'reject' ? null : item.decisionRank,
      comment: item.comment || '',
    }))
  }

  function normalizeRanks(topicId: string, decision: 'proposed' | 'reserve') {
    const applications = drafts.value[topicId]?.applications || []
    const ranked = applications.filter(item => item.decision === decision)
      .sort((a, b) => (a.decisionRank || Number.MAX_SAFE_INTEGER) - (b.decisionRank || Number.MAX_SAFE_INTEGER))
    ranked.forEach((item, index) => { item.decisionRank = index + 1 })
  }

  function setDecision(topicId: string, applicationId: string, decision: SelectionDraftDecision | null) {
    const item = drafts.value[topicId]?.applications.find(application => application.id === applicationId)
    if (!item || item.status === 'accepted') return
    item.decision = decision
    item.decisionRank = decision === 'proposed' || decision === 'reserve'
      ? drafts.value[topicId].applications.filter(application => application.decision === decision).length
      : null
    normalizeRanks(topicId, 'proposed')
    normalizeRanks(topicId, 'reserve')
  }

  function reorder(topicId: string, decision: 'proposed' | 'reserve', orderedIds: string[]) {
    const applications = drafts.value[topicId]?.applications || []
    orderedIds.forEach((id, index) => {
      const item = applications.find(application => application.id === id && application.decision === decision)
      if (item) item.decisionRank = index + 1
    })
  }

  async function save(topicId: string) {
    const draft = drafts.value[topicId]
    if (!draft) throw new Error('草稿尚未加载')
    savingTopicIds.value.push(topicId)
    try {
      const response: any = await selectionDraftApi.save(topicId, { version: draft.batch.version, items: editableItems(topicId) })
      drafts.value[topicId] = response.data
      return response.data as SelectionDraftView
    } catch (error: any) {
      if (error?.response?.status === 409) await load(topicId)
      throw error
    } finally {
      savingTopicIds.value = savingTopicIds.value.filter(id => id !== topicId)
    }
  }

  async function submit(topicId: string) {
    await save(topicId)
    const draft = drafts.value[topicId]
    submittingTopicIds.value.push(topicId)
    try {
      const response: any = await selectionDraftApi.submit(topicId, { version: draft.batch.version })
      drafts.value[topicId] = response.data
      return response.data as SelectionDraftView
    } finally {
      submittingTopicIds.value = submittingTopicIds.value.filter(id => id !== topicId)
    }
  }

  function ordered(topicId: string, decision: 'proposed' | 'reserve'): SelectionDraftApplication[] {
    return (drafts.value[topicId]?.applications || []).filter(item => item.decision === decision)
      .sort((a, b) => (a.decisionRank || 0) - (b.decisionRank || 0))
  }

  return { drafts, loadingTopicIds, savingTopicIds, submittingTopicIds, pendingTopicCount, load, save, submit, setDecision, reorder, ordered }
})
