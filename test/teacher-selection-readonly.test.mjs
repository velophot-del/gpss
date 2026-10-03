import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../src/views/teacher/SelectionReview.vue', import.meta.url), 'utf8')
const draftService = await readFile(new URL('../server/src/services/selectionDraftService.ts', import.meta.url), 'utf8')
const readMethod = draftService.slice(draftService.indexOf('export async function getSelectionDraft'), draftService.indexOf('export async function saveSelectionDraft'))

assert.doesNotMatch(page, /canViewApplications/)
assert.match(page, /<el-alert v-if="!isTeacherReview"/)
assert.match(page, /<el-tabs v-if="myTopics\.length" :model-value="activeTopicId"/)
assert.match(page, /const readOnly = computed\(\(\) => !isTeacherReview\.value/)
assert.doesNotMatch(page, /if \(!isTeacherReview\.value\) return/)
assert.match(page, /学生申请状态/)
assert.doesNotMatch(page, /当前阶段暂不可查看学生申报信息/)
assert.doesNotMatch(readMethod, /当前周期未配置教师遴选截止时间/)
assert.match(readMethod, /LEFT JOIN cycles c ON c\.id = t\.cycle_id/)
assert.doesNotMatch(readMethod, /WHERE a\.topic_id = \? AND a\.status IN/)
