const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const index = read('server/src/index.ts')
assert.match(index, /const HOST = process\.env\.HOST \|\| '127\.0\.0\.1'/)
assert.match(index, /app\.listen\(PORT, HOST,/)

const start = read('start.sh')
assert.doesNotMatch(start, /npm install/)
assert.doesNotMatch(start, /db:seed|seed\.ts/)
assert.doesNotMatch(start, /tsx watch|npm run dev/)
assert.match(start, /NODE_ENV=production/)
assert.match(start, /curl -fsS/)

const deployCheck = read('deploy-check.sh')
assert.match(deployCheck, /通过：\$\{passed\}；失败：\$\{failed\}/)
assert.match(deployCheck, /\.\/node_modules\/\.bin\/vue-tsc;/)
assert.doesNotMatch(deployCheck, /\.\/node_modules\/\.bin\/vue-tsc --noEmit/)
execFileSync('bash', ['-n', path.join(root, 'deploy-check.sh')], { stdio: 'pipe' })

const seed = read('server/src/scripts/seed.ts')
assert.match(seed, /const topicIds: string\[\] = \[\]/)
assert.match(seed, /topicIds\.push\(tid\)/)
assert.match(seed, /topicIds\[10\]/)
assert.doesNotMatch(seed, /SELECT id FROM topics LIMIT 6/)

const applicationsRoute = read('server/src/routes/applications.ts')
assert.match(applicationsRoute, /!isStudentSelectionPhase\(activeCycle\.phase\)/)
assert.doesNotMatch(applicationsRoute, /activeCycle\.phase !== 'student_apply'/)

const cycleStore = read('src/stores/cycle.ts')
assert.match(cycleStore, /student_selection: 'student_apply'/)
assert.match(cycleStore, /phases\.student_apply\?\.start \|\| phases\.student_selection\?\.start/)
assert.match(cycleStore, /topicStudentLimit: Number\(phases\.topic_student_limit/)

const teacherTopicsRoute = read('server/src/routes/topics.ts')
assert.match(teacherTopicsRoute, /AS apply_count/)
assert.match(teacherTopicsRoute, /AS accepted_count/)
assert.match(teacherTopicsRoute, /currentCount: Number\(item\.accepted_count\)/)
assert.match(teacherTopicsRoute, /LEFT JOIN users u ON t\.teacher_id = u\.id/)
assert.match(teacherTopicsRoute, /teacherName: item\.teacher_name/)

const statisticsView = read('src/views/admin/Statistics.vue')
assert.match(statisticsView, /adminApi\.getAllTopics\(\)/)
assert.match(statisticsView, /const statisticsTopics = ref<any\[\]>\(\[\]\)/)
const chartContainerStyles = statisticsView.match(/\.chart-container\s*\{([^}]*)\}/s)?.[1] || ''
assert.doesNotMatch(chartContainerStyles, /max-height|overflow-y/)

const dashboard = read('src/views/Dashboard.vue')
assert.match(dashboard, /if \(!dateStr\) return '-'/)
