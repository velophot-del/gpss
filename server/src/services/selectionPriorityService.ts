import type { SelectionDecision } from './selectionMatcher.js'

export interface PriorityDecisionCandidate {
  applicationId: string
  studentId: string
  topicId?: string
  priority: number
  decision: SelectionDecision | null
  topicTitle: string
  teacherId?: string
}

export interface PriorityBlock {
  blockingPriority: number
  blockingDecision: 'proposed' | 'reserve'
  blockingTopicTitle: string
}

/** A proposed or reserve decision pauses lower choices but keeps their draft. */
export function buildPriorityBlocks(candidates: PriorityDecisionCandidate[]): Map<string, PriorityBlock> {
  const result = new Map<string, PriorityBlock>()
  const byStudent = new Map<string, PriorityDecisionCandidate[]>()
  for (const candidate of candidates) {
    const list = byStudent.get(candidate.studentId) || []
    list.push(candidate)
    byStudent.set(candidate.studentId, list)
  }
  for (const list of byStudent.values()) {
    list.sort((a, b) => a.priority - b.priority || a.applicationId.localeCompare(b.applicationId))
    let blocker: PriorityDecisionCandidate | null = null
    for (const candidate of list) {
      if (blocker && candidate.priority > blocker.priority) {
        result.set(candidate.applicationId, {
          blockingPriority: blocker.priority,
          blockingDecision: blocker.decision as 'proposed' | 'reserve',
          blockingTopicTitle: blocker.topicTitle,
        })
      }
      if (!blocker && (candidate.decision === 'proposed' || candidate.decision === 'reserve')) blocker = candidate
    }
  }
  return result
}
