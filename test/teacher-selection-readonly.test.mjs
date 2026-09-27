import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../src/views/teacher/SelectionReview.vue', import.meta.url), 'utf8')

assert.match(page, /const canViewApplications = computed\(\(\) => \['student_apply', 'teacher_review'\]\.includes\(cycleStore\.currentPhase\)\)/)
assert.match(page, /const readOnly = computed\(\(\) => !isTeacherReview\.value/)
assert.match(page, /if \(!canViewApplications\.value\) return/)
assert.match(page, /学生申请状态/)
assert.match(page, /if \(!canViewApplications\.value\) return ElMessage\.info/)
