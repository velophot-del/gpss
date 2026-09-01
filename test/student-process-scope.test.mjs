import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('student process excludes thesis/design and attachment uploads', () => {
  for (const file of ['src/router/index.ts', 'src/layouts/MainLayout.vue', 'src/views/process/processConfig.ts', 'src/api/index.ts', 'server/src/index.ts']) {
    const source = read(file)
    assert.doesNotMatch(source, /process\/(thesis|design)|['"]\/(thesis|design)['"]|\b(thesisApi|designApi)\b/)
  }
  for (const file of ['src/views/process/StudentSubmission.vue', 'src/views/process/TaskBookView.vue', 'src/views/process/GuidanceView.vue']) {
    assert.doesNotMatch(read(file), /FileUploadList|fileUrls|ProcessPrintForm|打印|导出 PDF|printForm/)
  }
  const taskBook = read('src/views/process/TaskBookView.vue')
  assert.match(taskBook, /下载正式 Word/)
  assert.match(taskBook, /:disabled="!record"/)
  assert.match(taskBook, /下载 Word（预览版）/)
  assert.match(taskBook, /下载正式 Word/)
  for (const file of ['server/src/utils/submissionFlow.ts', 'server/src/routes/taskBooks.ts', 'server/src/routes/guidance.ts']) {
    assert.doesNotMatch(read(file), /req\.body\.fileUrls|\bfileUrls\b/)
  }
})
