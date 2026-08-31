import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

const source = await readFile(new URL('../src/utils/shortlist-submission.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 }
}).outputText
const { submitShortlistApplications } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const topics = [
  { topic_id: 'one', title: '第一志愿' },
  { topic_id: 'two', title: '第二志愿' },
  { topic_id: 'three', title: '第三志愿' }
]
const calls = []
const result = await submitShortlistApplications(topics, async (topicId, priority) => {
  calls.push([topicId, priority])
  if (topicId === 'two') throw new Error('名额已满')
})

assert.deepEqual(calls, [['one', 1], ['two', 2], ['three', 3]])
assert.deepEqual(result.submittedTopicIds, ['one', 'three'])
assert.deepEqual(result.failed, [{ topic: topics[1], error: '名额已满' }])
