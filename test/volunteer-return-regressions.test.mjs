import test from 'node:test'
import assert from 'node:assert/strict'

const rules = await import('../server/dist/utils/adminVolunteerRules.js')

test('administrator can return a 3-6 choice pending group with stale review metadata', () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({
    status: 'pending',
    reviewed_by: index === 0 ? 'legacy-reviewer' : null,
    reviewed_at: index === 0 ? '2026-09-26T16:00:00.000Z' : null,
  }))
  assert.equal(rules.canReturnVolunteerRows(rows), true)
})

test('administrator cannot return a group with a final teacher decision or outside the 3-6 range', () => {
  assert.equal(rules.canReturnVolunteerRows([{ status: 'pending' }, { status: 'pending' }]), false)
  assert.equal(rules.canReturnVolunteerRows([
    { status: 'pending' }, { status: 'pending' }, { status: 'accepted' },
  ]), false)
})
