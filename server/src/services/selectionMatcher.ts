import { createHash } from 'node:crypto'

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

export function buildSettlementPlan(input: SettlementInput): SettlementPlan {
  const topicById = new Map(input.topics.map(topic => [topic.topicId, topic]))
  const applicationIds = new Set<string>()
  for (const candidate of input.candidates) {
    if (applicationIds.has(candidate.applicationId)) throw new Error(`重复申请：${candidate.applicationId}`)
    const candidateTopic = topicById.get(candidate.topicId)
    if (!candidateTopic) throw new Error(`申请所属课题不存在：${candidate.topicId}`)
    if (candidateTopic.teacherId !== candidate.teacherId) throw new Error(`申请教师与课题不一致：${candidate.applicationId}`)
    if (!Number.isInteger(candidate.priority) || candidate.priority < 1 || candidate.priority > 6) throw new Error(`志愿序号无效：${candidate.applicationId}`)
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

  const heldByStudent = new Map<string, HeldAssignment>()
  const heldByTopic = new Map<string, Set<string>>(input.topics.map(topic => [topic.topicId, new Set<string>()]))
  const candidates = input.candidates
    .filter(candidate => candidate.decision === 'proposed' || candidate.decision === 'reserve')
    .sort((a, b) => a.priority - b.priority || candidateOrder(a, b))

  // Complete each preference round before considering a lower preference.
  for (const candidate of candidates) {
    if (lockedStudents.has(candidate.studentId) || heldByStudent.has(candidate.studentId)) continue
    const held = heldByTopic.get(candidate.topicId)!
    if (held.size >= remainingSeats.get(candidate.topicId)!) continue
    const teacherCount = teacherCounts.get(candidate.teacherId) || 0
    if (input.teacherLimit > 0 && teacherCount >= input.teacherLimit) continue
    held.add(candidate.applicationId)
    heldByStudent.set(candidate.studentId, candidate)
    teacherCounts.set(candidate.teacherId, teacherCount + 1)
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

export interface AdjustmentVolunteerCandidate {
  applicationId: string
  studentId: string
  topicId: string
  teacherId: string
  priority: number
}

export interface AdjustmentMatchingTopic {
  topicId: string
  teacherId: string
  capacity: number
}

export interface AdjustmentLockedAssignment {
  applicationId: string
  studentId: string
  topicId: string
  teacherId: string
}

export interface AdjustmentMatchingInput {
  cycleId: number | string
  volunteers: AdjustmentVolunteerCandidate[]
  topics: AdjustmentMatchingTopic[]
  lockedAssignments: AdjustmentLockedAssignment[]
  teacherLimit: number
}

export interface AdjustmentMatchingPlan {
  acceptedApplicationIds: string[]
  withdrawnApplicationIds: string[]
  rejectedApplicationIds: string[]
  unmatchedStudentIds: string[]
  topicAcceptedCounts: Record<string, number>
  lotteryVersion: string
}

export const ADJUSTMENT_LOTTERY_VERSION = 'sha256-teacher-priority-v1'

function adjustmentLotteryRank(cycleId: number | string, teacherId: string, studentId: string) {
  return createHash('sha256').update(`${cycleId}:${teacherId}:${studentId}`).digest('hex')
}

/**
 * Match students to their highest available adjustment preference. Candidates
 * rejected by a topic or shared teacher quota continue with their next choice.
 */
export function buildAdjustmentMatchingPlan(input: AdjustmentMatchingInput): AdjustmentMatchingPlan {
  const topicById = new Map(input.topics.map(topic => [topic.topicId, topic]))
  if (topicById.size !== input.topics.length) throw new Error('调剂课题重复')

  const applicationIds = new Set<string>()
  const studentTopicPairs = new Set<string>()
  const studentPriorities = new Set<string>()
  for (const candidate of input.volunteers) {
    if (applicationIds.has(candidate.applicationId)) throw new Error(`重复调剂志愿：${candidate.applicationId}`)
    applicationIds.add(candidate.applicationId)
    const topic = topicById.get(candidate.topicId)
    if (!topic || topic.teacherId !== candidate.teacherId) throw new Error(`调剂志愿课题无效：${candidate.applicationId}`)
    if (!Number.isInteger(candidate.priority) || candidate.priority < 1 || candidate.priority > 6) {
      throw new Error(`调剂志愿序号无效：${candidate.applicationId}`)
    }
    const pairKey = `${candidate.studentId}\u0000${candidate.topicId}`
    const priorityKey = `${candidate.studentId}\u0000${candidate.priority}`
    if (studentTopicPairs.has(pairKey) || studentPriorities.has(priorityKey)) throw new Error(`学生调剂志愿重复：${candidate.studentId}`)
    studentTopicPairs.add(pairKey)
    studentPriorities.add(priorityKey)
  }

  const lockedStudents = new Set<string>()
  const lockedByTopic = new Map<string, number>()
  const lockedByTeacher = new Map<string, number>()
  for (const assignment of input.lockedAssignments) {
    if (lockedStudents.has(assignment.studentId)) throw new Error(`学生存在多个锁定录取：${assignment.studentId}`)
    const topic = topicById.get(assignment.topicId)
    if (!topic || topic.teacherId !== assignment.teacherId) throw new Error(`锁定录取课题无效：${assignment.applicationId}`)
    lockedStudents.add(assignment.studentId)
    lockedByTopic.set(assignment.topicId, (lockedByTopic.get(assignment.topicId) || 0) + 1)
    lockedByTeacher.set(assignment.teacherId, (lockedByTeacher.get(assignment.teacherId) || 0) + 1)
  }

  const remainingByTopic = new Map<string, number>()
  for (const topic of input.topics) {
    if (!Number.isInteger(topic.capacity) || topic.capacity < 0) throw new Error(`课题容量无效：${topic.topicId}`)
    const remaining = topic.capacity - (lockedByTopic.get(topic.topicId) || 0)
    if (remaining < 0) throw new Error(`课题已有录取超过容量：${topic.topicId}`)
    remainingByTopic.set(topic.topicId, remaining)
  }
  for (const [teacherId, count] of lockedByTeacher) {
    if (input.teacherLimit > 0 && count > input.teacherLimit) throw new Error(`教师已有录取超过指导上限：${teacherId}`)
  }

  const preferences = new Map<string, AdjustmentVolunteerCandidate[]>()
  for (const candidate of input.volunteers) {
    if (lockedStudents.has(candidate.studentId)) continue
    const list = preferences.get(candidate.studentId) || []
    list.push(candidate)
    preferences.set(candidate.studentId, list)
  }
  for (const list of preferences.values()) list.sort((a, b) => a.priority - b.priority || a.topicId.localeCompare(b.topicId))

  const nextChoice = new Map([...preferences.keys()].map(studentId => [studentId, 0]))
  const heldByStudent = new Map<string, AdjustmentVolunteerCandidate>()
  while (true) {
    const proposals: AdjustmentVolunteerCandidate[] = []
    for (const studentId of [...preferences.keys()].sort()) {
      if (heldByStudent.has(studentId)) continue
      const list = preferences.get(studentId)!
      const index = nextChoice.get(studentId) || 0
      if (index >= list.length) continue
      proposals.push(list[index])
      nextChoice.set(studentId, index + 1)
    }
    if (!proposals.length) break

    const applicantsByTeacher = new Map<string, Map<string, AdjustmentVolunteerCandidate>>()
    for (const candidate of [...heldByStudent.values(), ...proposals]) {
      const applicants = applicantsByTeacher.get(candidate.teacherId) || new Map<string, AdjustmentVolunteerCandidate>()
      applicants.set(candidate.studentId, candidate)
      applicantsByTeacher.set(candidate.teacherId, applicants)
    }

    const nextHeld = new Map<string, AdjustmentVolunteerCandidate>()
    for (const [teacherId, applicants] of applicantsByTeacher) {
      let teacherSeats = input.teacherLimit > 0
        ? input.teacherLimit - (lockedByTeacher.get(teacherId) || 0)
        : Number.POSITIVE_INFINITY
      const ordered = [...applicants.values()].sort((a, b) =>
        adjustmentLotteryRank(input.cycleId, teacherId, a.studentId).localeCompare(adjustmentLotteryRank(input.cycleId, teacherId, b.studentId)) ||
        a.studentId.localeCompare(b.studentId) || a.applicationId.localeCompare(b.applicationId))
      const topicCounts = new Map<string, number>()
      for (const candidate of ordered) {
        const heldCount = topicCounts.get(candidate.topicId) || 0
        if (teacherSeats <= 0 || heldCount >= (remainingByTopic.get(candidate.topicId) || 0)) continue
        topicCounts.set(candidate.topicId, heldCount + 1)
        teacherSeats -= 1
        nextHeld.set(candidate.studentId, candidate)
      }
    }
    heldByStudent.clear()
    for (const [studentId, candidate] of nextHeld) heldByStudent.set(studentId, candidate)
  }

  const acceptedIds = new Set([...heldByStudent.values()].map(candidate => candidate.applicationId))
  const placedStudents = new Set([...lockedStudents, ...heldByStudent.keys()])
  const withdrawn: string[] = []
  const rejected: string[] = []
  for (const candidate of input.volunteers) {
    if (acceptedIds.has(candidate.applicationId)) continue
    if (placedStudents.has(candidate.studentId)) withdrawn.push(candidate.applicationId)
    else rejected.push(candidate.applicationId)
  }

  const topicAcceptedCounts: Record<string, number> = {}
  for (const topic of input.topics) {
    const count = (lockedByTopic.get(topic.topicId) || 0) +
      [...heldByStudent.values()].filter(candidate => candidate.topicId === topic.topicId).length
    if (count > topic.capacity) throw new Error(`调剂结算超过课题容量：${topic.topicId}`)
    topicAcceptedCounts[topic.topicId] = count
  }
  const acceptedByTeacher = new Map<string, number>(lockedByTeacher)
  for (const candidate of heldByStudent.values()) {
    acceptedByTeacher.set(candidate.teacherId, (acceptedByTeacher.get(candidate.teacherId) || 0) + 1)
  }
  for (const [teacherId, count] of acceptedByTeacher) {
    if (input.teacherLimit > 0 && count > input.teacherLimit) throw new Error(`调剂结算超过教师指导上限：${teacherId}`)
  }

  return {
    acceptedApplicationIds: [...acceptedIds].sort(),
    withdrawnApplicationIds: withdrawn.sort(),
    rejectedApplicationIds: rejected.sort(),
    unmatchedStudentIds: [...new Set(input.volunteers.map(candidate => candidate.studentId))]
      .filter(studentId => !placedStudents.has(studentId)).sort(),
    topicAcceptedCounts,
    lotteryVersion: ADJUSTMENT_LOTTERY_VERSION,
  }
}
