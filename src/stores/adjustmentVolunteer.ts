import { defineStore } from 'pinia'
import { ref } from 'vue'
import { adjustmentVolunteerApi } from '@/api'

export const useAdjustmentVolunteerStore = defineStore('adjustmentVolunteer', () => {
  const eligibleTopics = ref<any[]>([])
  const mine = ref<any>({ cycleId: null, version: 0, items: [], settlement: null, canEdit: false })
  const loading = ref(false)

  async function loadMine() {
    const response: any = await adjustmentVolunteerApi.getMine()
    mine.value = response.data || mine.value
    return mine.value
  }

  async function loadEligibleTopics() {
    loading.value = true
    try {
      const response: any = await adjustmentVolunteerApi.getEligibleTopics()
      eligibleTopics.value = response.data?.topics || []
      return response.data
    } finally { loading.value = false }
  }

  async function save(items: { topicId: string; motivation: string }[]) {
    const response: any = await adjustmentVolunteerApi.saveMine(Number(mine.value.version || 0), items, mine.value.roundId || null)
    mine.value = response.data || mine.value
    return mine.value
  }

  return { eligibleTopics, mine, loading, loadMine, loadEligibleTopics, save }
})
