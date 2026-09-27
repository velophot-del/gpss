export type SelectionDecision = 'proposed' | 'reserve' | 'reject'

export interface SettlementCandidate {
  applicationId: string
  studentId: string
  topicId: string
  teacherId: string
  priority: number
  decision: SelectionDecision | null
  decisionRank: number | null
  appliedAt: string
}

export interface SettlementTopic {
  topicId: string
  teacherId: string
  capacity: number
}

export interface LockedAssignment {
  applicationId: string
  studentId: string
  topicId: string
  teacherId: string
}

export interface SettlementInput {
  candidates: SettlementCandidate[]
  topics: SettlementTopic[]
  lockedAssignments: LockedAssignment[]
  teacherLimit: number
}

export interface SettlementPlan {
  acceptedApplicationIds: string[]
  withdrawnApplicationIds: string[]
  rejectedApplicationIds: string[]
  unmatchedStudentIds: string[]
  topicAcceptedCounts: Record<string, number>
}

type HeldAssignment = SettlementCandidate

function candidateOrder(a: SettlementCandidate, b: SettlementCandidate): number {
  const decisionOrder = (value: SelectionDecision | null) => value === 'proposed' ? 0 : value === 'reserve' ? 1 : 2
  return decisionOrder(a.decision) - decisionOrder(b.decision) ||
    (a.decisionRank ?? Number.MAX_SAFE_INTEGER) - (b.decisionRank ?? Number.MAX_SAFE_INTEGER) ||
    a.appliedAt.localeCompare(b.appliedAt) ||
    a.applicationId.localeCompare(b.applicationId)
}

function prefers(candidate: SettlementCandidate, current: HeldAssignment): boolean {
  return candidate.priority < current.priority ||
    (candidate.priority === current.priority && candidate.topicId.localeCompare(current.topicId) < 0)
}

export function buildSettlementPlan(input: SettlementInput): SettlementPlan {
  const topicById = new Map(input.topics.map(topic => [topic.topicId, topic]))
  const applicationIds = new Set<string>()
  for (const candidate of input.candidates) {
    if (applicationIds.has(candidate.applicationId)) throw new Error(`重复申请：${candidate.applicationId}`)
    const candidateTopic = topicById.get(candidate.topicId)
    if (!candidateTopic) throw new Error(`申请所属课题不存在：${candidate.topicId}`)
    if (candidateTopic.teacherId !== candidate.teacherId) throw new Error(`申请教师与课题不一致：${candidate.applicationId}`)
    if (!Number.isInteger(candidate.priority) || candidate.priority < 1) throw new Error(`志愿序号无效：${candidate.applicationId}`)
    applicationIds.add(candidate.applicationId)
  }

  const lockedStudents = new Set<string>()
  const lockedByTopic = new Map<string, number>()
  const teacherCounts = new Map<string, number>()
  for (const assignment of input.lockedAssignments) {
    if (lockedStudents.has(assignment.studentId)) throw new Error(`学生存在多个锁定录取：${assignment.studentId}`)
    const lockedTopic = topicById.get(assignment.topicId)
    if (!lockedTopic || lockedTopic.teacherId !== assignment.teacherId) throw new Error(`锁定录取课题无效：${assignment.applicationId}`)
    lockedStudents.add(assignment.studentId)
    lockedByTopic.set(assignment.topicId, (lockedByTopic.get(assignment.topicId) || 0) + 1)
    teacherCounts.set(assignment.teacherId, (teacherCounts.get(assignment.teacherId) || 0) + 1)
  }

  const remainingSeats = new Map<string, number>()
  for (const topic of input.topics) {
    if (!Number.isInteger(topic.capacity) || topic.capacity < 0) throw new Error(`课题容量无效：${topic.topicId}`)
    const remaining = topic.capacity - (lockedByTopic.get(topic.topicId) || 0)
    if (remaining < 0) throw new Error(`课题已有录取超过容量：${topic.topicId}`)
    remainingSeats.set(topic.topicId, remaining)
  }

  const sequences = new Map<string, SettlementCandidate[]>()
  for (const topic of input.topics) {
    sequences.set(topic.topicId, input.candidates
      .filter(candidate => candidate.topicId === topic.topicId && (candidate.decision === 'proposed' || candidate.decision === 'reserve'))
      .sort(candidateOrder))
  }

  const nextIndex = new Map(input.topics.map(topic => [topic.topicId, 0]))
  const heldByStudent = new Map<string, HeldAssignment>()
  const heldByTopic = new Map<string, Set<string>>(input.topics.map(topic => [topic.topicId, new Set<string>()]))
  const queue = input.topics.map(topic => topic.topicId).sort()
  const queued = new Set(queue)

  const enqueue = (topicId: string) => {
    const held = heldByTopic.get(topicId)?.size || 0
    const sequence = sequences.get(topicId) || []
    if (held < (remainingSeats.get(topicId) || 0) && (nextIndex.get(topicId) || 0) < sequence.length && !queued.has(topicId)) {
      queue.push(topicId)
      queue.sort()
      queued.add(topicId)
    }
  }

  while (queue.length) {
    const topicId = queue.shift()!
    queued.delete(topicId)
    const topic = topicById.get(topicId)!
    const sequence = sequences.get(topicId) || []
    const held = heldByTopic.get(topicId)!

    while (held.size < (remainingSeats.get(topicId) || 0)) {
      const index = nextIndex.get(topicId) || 0
      const candidate = sequence[index]
      if (!candidate) break
      nextIndex.set(topicId, index + 1)
      if (lockedStudents.has(candidate.studentId)) continue

      const current = heldByStudent.get(candidate.studentId)
      if (current && !prefers(candidate, current)) continue

      const currentTeacherCount = teacherCounts.get(topic.teacherId) || 0
      const freesSameTeacherSeat = current?.teacherId === topic.teacherId ? 1 : 0
      if (input.teacherLimit > 0 && currentTeacherCount - freesSameTeacherSeat >= input.teacherLimit) continue

      if (current) {
        heldByTopic.get(current.topicId)?.delete(current.applicationId)
        teacherCounts.set(current.teacherId, (teacherCounts.get(current.teacherId) || 1) - 1)
        enqueue(current.topicId)
      }
      held.add(candidate.applicationId)
      heldByStudent.set(candidate.studentId, candidate)
      teacherCounts.set(topic.teacherId, (teacherCounts.get(topic.teacherId) || 0) + 1)
    }
  }

  const accepted = new Set([...heldByStudent.values()].map(item => item.applicationId))
  const studentsWithPlacement = new Set([...lockedStudents, ...heldByStudent.keys()])
  const withdrawn = new Set<string>()
  const rejected = new Set<string>()
  for (const candidate of input.candidates) {
    if (accepted.has(candidate.applicationId)) continue
    if (studentsWithPlacement.has(candidate.studentId)) withdrawn.add(candidate.applicationId)
    else rejected.add(candidate.applicationId)
  }

  const allStudents = new Set(input.candidates.map(candidate => candidate.studentId))
  const unmatchedStudentIds = [...allStudents].filter(studentId => !studentsWithPlacement.has(studentId)).sort()
  const topicAcceptedCounts: Record<string, number> = {}
  for (const topic of input.topics) {
    const count = (lockedByTopic.get(topic.topicId) || 0) + (heldByTopic.get(topic.topicId)?.size || 0)
    if (count > topic.capacity) throw new Error(`课题结算超过容量：${topic.topicId}`)
    topicAcceptedCounts[topic.topicId] = count
  }
  for (const [teacherId, count] of teacherCounts) {
    if (input.teacherLimit > 0 && count > input.teacherLimit) throw new Error(`教师结算超过指导上限：${teacherId}`)
  }
  if (accepted.size + withdrawn.size + rejected.size !== input.candidates.length) {
    throw new Error('结算结果未完整覆盖所有申请')
  }

  return {
    acceptedApplicationIds: [...accepted].sort(),
    withdrawnApplicationIds: [...withdrawn].sort(),
    rejectedApplicationIds: [...rejected].sort(),
    unmatchedStudentIds,
    topicAcceptedCounts,
  }
}
