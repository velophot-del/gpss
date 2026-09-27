<template>
  <div class="student-status page-container">
    <div class="card-container">
      <el-card shadow="never" class="mb-4" v-loading="overviewLoading">
        <template #header><div class="flex justify-between items-center"><strong>当前周期选题监控 {{ overview?.cycle?.name || '' }}</strong><div><el-button size="small" :disabled="!overview?.cycle" @click="exportPressure">导出集中度</el-button><el-button size="small" @click="loadOverview">刷新</el-button></div></div></template>
        <el-alert v-if="overviewError" :title="overviewError" type="error" :closable="false" class="mb-4" />
        <el-empty v-else-if="!overview?.cycle" description="暂无进行中的选题周期" />
        <template v-else>
          <p>未填报 {{ unsubmittedStudents.length }} 人 · 已填报未录取 {{ unmatchedStudents.length }} 人 · 有空位课题 {{ availableTopics.length }} 个</p>
          <p class="mb-4">学生范围为系统内全部启用账号；系统尚未配置“本届学生名单”，请先核对未填报名单再通知学生。课题和申请均按当前周期统计。</p>
          <el-tabs>
            <el-tab-pane label="志愿集中度">
              <p class="mb-4">按当前周期第一志愿统计。达到名额仅提示竞争，不代表已录取或不能申报；“全部志愿”包含后续志愿。</p>
              <h3 class="mb-4">课题第一志愿</h3>
              <el-table :data="topicPressure" stripe max-height="360" empty-text="暂无课题">
                <el-table-column prop="title" label="课题" min-width="220" /><el-table-column prop="teacher_name" label="导师" width="110" />
                <el-table-column prop="first_choice_count" label="第一志愿" width="90" /><el-table-column prop="application_count" label="全部志愿" width="90" />
                <el-table-column prop="max_students" label="课题名额" width="90" />
                <el-table-column label="竞争提示" width="110"><template #default="{ row }"><el-tag :type="pressureType(row.first_choice_count, row.max_students)">{{ pressureLabel(row.first_choice_count, row.max_students) }}</el-tag></template></el-table-column>
              </el-table>
              <h3 class="mb-4" style="margin-top: 20px;">导师第一志愿</h3>
              <el-table :data="teacherPressure" stripe max-height="300" empty-text="暂无导师课题">
                <el-table-column prop="name" label="导师" min-width="140" /><el-table-column prop="firstChoices" label="第一志愿学生" width="120" />
                <el-table-column prop="topicCapacity" label="课题名额合计" width="120" /><el-table-column label="指导上限" width="110"><template #default>{{ overview.teacherLimit || '未设置' }}</template></el-table-column>
                <el-table-column label="竞争提示" width="110"><template #default="{ row }"><el-tag :type="pressureType(row.firstChoices, row.effectiveCapacity)">{{ pressureLabel(row.firstChoices, row.effectiveCapacity) }}</el-tag></template></el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane :label="`未填报学生（${unsubmittedStudents.length}）`">
              <el-table :data="unsubmittedStudents" stripe max-height="360" empty-text="当前没有未填报学生">
                <el-table-column prop="student_id" label="学号" width="130" /><el-table-column prop="real_name" label="姓名" width="110" />
                <el-table-column prop="class_name" label="班级" width="150" /><el-table-column prop="major" label="专业" min-width="140" />
              </el-table>
            </el-tab-pane>
            <el-tab-pane :label="`未录取学生（${unmatchedStudents.length}）`">
              <el-table :data="unmatchedStudents" stripe max-height="360" empty-text="当前没有已填报但未录取的学生">
                <el-table-column prop="student_id" label="学号" width="130" /><el-table-column prop="real_name" label="姓名" width="110" />
                <el-table-column prop="class_name" label="班级" width="150" /><el-table-column prop="major" label="专业" min-width="140" />
                <el-table-column prop="application_count" label="志愿数" width="90" /><el-table-column prop="pending_count" label="待处理" width="90" />
                <el-table-column label="可联系课题（同专业、相近方向）" min-width="260"><template #default="{ row }">{{ suggestedTopics(row) }}</template></el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane :label="`空余课题（${availableTopics.length}）`">
              <el-table :data="availableTopics" stripe max-height="360" empty-text="当前没有可调剂的空余课题">
                <el-table-column prop="title" label="课题" min-width="220" /><el-table-column prop="teacher_name" label="教师" width="110" />
                <el-table-column prop="category" label="方向" min-width="130" /><el-table-column prop="application_count" label="申请人数" width="90" />
                <el-table-column label="剩余名额" width="90"><template #default="{ row }">{{ remainingSeats(row) }}</template></el-table-column>
                <el-table-column label="教师余量" width="100"><template #default="{ row }">{{ teacherRemaining(row) }}</template></el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane :label="`调剂待办（${pendingAdjustments.length}）`">
              <p class="mb-4">仅显示学生主动提交的申请；名额和导师余量是当前预览，审批时由后端再次校验。请先与目标教师确认。</p>
              <el-table :data="pendingAdjustments" stripe max-height="420" empty-text="暂无待审批调剂申请">
                <el-table-column prop="student_id" label="学号" width="130" /><el-table-column prop="student_name" label="姓名" width="100" />
                <el-table-column prop="to_topic_title" label="申请课题" min-width="230" /><el-table-column prop="reason" label="调剂理由" min-width="170" show-overflow-tooltip />
                <el-table-column label="匹配预览" width="150"><template #default="{ row }"><el-tag :type="adjustmentHint(row).ok ? 'success' : 'warning'">{{ adjustmentHint(row).label }}</el-tag></template></el-table-column>
                <el-table-column label="操作" width="100"><template #default="{ row }"><el-button link type="primary" :disabled="!adjustmentHint(row).ok" @click="approveAdjustment(row)">确认录取</el-button></template></el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </template>
      </el-card>
      <div class="flex justify-between items-center mb-4">
        <h2 class="section-title">学生选课历史明细</h2>
        <div class="flex gap-2">
          <el-button @click="exportData" type="primary" size="small">
            <el-icon><Download /></el-icon> 导出数据
          </el-button>
        </div>
      </div>

      <el-card shadow="never" class="mb-4">
        <el-row :gutter="20">
          <el-col :span="6" :xs="12">
            <div class="stat-box">
              <span class="stat-value">{{ stats.total }}</span>
              <span class="stat-label">学生总数</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box done">
              <span class="stat-value">{{ stats.applied }}</span>
              <span class="stat-label">曾提交申请</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box warning">
              <span class="stat-value">{{ stats.notApplied }}</span>
              <span class="stat-label">从未提交申请</span>
            </div>
          </el-col>
          <el-col :span="6" :xs="12">
            <div class="stat-box shortlist">
              <span class="stat-value">{{ stats.withShortlist }}</span>
              <span class="stat-label">有预选课题</span>
            </div>
          </el-col>
        </el-row>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="flex justify-between items-center">
            <strong>学生列表
              <el-tag type="danger" size="small" v-if="stats.notApplied > 0">
                {{ stats.notApplied }} 人未完成选课
              </el-tag>
            </strong>
            <el-select v-model="filterStatus" placeholder="筛选状态" size="small" class="w-40">
              <el-option label="全部" value="" />
              <el-option label="已选课" value="applied" />
              <el-option label="未选课" value="not_applied" />
            </el-select>
          </div>
        </template>
        <el-table :data="filteredStudents" stripe size="small">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div v-if="getStudentSelections(row.id).length > 0" class="expand-content">
                <h4 class="mb-2">选课详情</h4>
                <el-table :data="getStudentSelections(row.id)" size="mini" border>
                  <el-table-column prop="priority" label="志愿" width="60" align="center">
                    <template #default="{ row }">
                      <el-tag :type="getPriorityType(row.priority)" size="small">
                        {{ formatPriority(row.priority) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="topic_title" label="课题题目" min-width="300" />
                  <el-table-column prop="topic_category" label="类别" width="100" />
                  <el-table-column prop="teacher_name" label="指导教师" width="100" />
                  <el-table-column prop="application_status" label="状态" width="100" align="center">
                    <template #default="{ row }">
                      <el-tag :type="getStatusType(row.application_status)" size="small">
                        {{ getStatusText(row.application_status) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
              <div v-else class="expand-content text-gray-400">
                暂无选课记录
              </div>
            </template>
          </el-table-column>
          <el-table-column type="index" label="#" width="50" />
          <el-table-column prop="student_id" label="学号" width="120" />
          <el-table-column prop="real_name" label="学生姓名" width="120">
            <template #default="{ row }">
              <span :class="{ 'highlight-warning': !row.application_count }">
                {{ row.real_name }}
                <el-tag v-if="!row.application_count" type="danger" size="small" class="ml-2">未选课</el-tag>
              </span>
            </template>
          </el-table-column>
          <el-table-column prop="class_name" label="班级" width="120" />
          <el-table-column prop="major" label="专业" width="100" />
          <el-table-column prop="application_count" label="申请数" width="80" align="center" />
          <el-table-column prop="accepted_count" label="已录取" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.accepted_count > 0 ? 'success' : 'info'" size="small">
                {{ row.accepted_count }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="shortlist_count" label="预选数" width="80" align="center" />
          <el-table-column prop="status" label="账户状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
                {{ row.status === 'active' ? '正常' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="注册时间" width="150" />
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download } from '@element-plus/icons-vue'
import { adminApi, applicationApi } from '@/api'
import { formatPriority, priorityTagType } from '@/utils/volunteerRules'

const overview = ref<any>(null)
const overviewLoading = ref(false)
const overviewError = ref('')
const adjustments = ref<any[]>([])
const unsubmittedStudents = computed(() => overview.value?.students?.filter((s: any) => Number(s.application_count) === 0) || [])
const unmatchedStudents = computed(() => overview.value?.students?.filter((s: any) => Number(s.application_count) > 0 && Number(s.accepted_count) === 0) || [])
const availableTopics = computed(() => overview.value?.topics?.filter((t: any) => t.status === 'published' && remainingSeats(t) > 0 && teacherRemainingNumber(t) > 0) || [])
const pendingAdjustments = computed(() => adjustments.value.filter(a => a.status === 'pending' && overview.value?.topics?.some((t: any) => t.id === a.to_topic_id)))
const topicPressure = computed(() => [...(overview.value?.topics || [])].sort((a: any, b: any) =>
  Number(b.first_choice_count || 0) / Math.max(1, Number(b.max_students)) - Number(a.first_choice_count || 0) / Math.max(1, Number(a.max_students))))
const teacherPressure = computed(() => {
  const teachers = new Map<string, any>()
  for (const topic of overview.value?.topics || []) {
    const teacher = teachers.get(topic.teacher_id) || { id: topic.teacher_id, name: topic.teacher_name, firstChoices: Number(topic.teacher_first_choice_count || 0), topicCapacity: 0 }
    teacher.topicCapacity += Number(topic.max_students || 0)
    teachers.set(topic.teacher_id, teacher)
  }
  const limit = Number(overview.value?.teacherLimit || 0)
  return [...teachers.values()].map(teacher => ({
    ...teacher,
    effectiveCapacity: limit > 0 ? Math.min(limit, teacher.topicCapacity) : teacher.topicCapacity
  })).sort((a, b) => b.firstChoices / Math.max(1, b.effectiveCapacity) - a.firstChoices / Math.max(1, a.effectiveCapacity))
})
function pressureType(firstChoices: number, capacity: number) {
  if (Number(firstChoices) >= 2 * Number(capacity)) return 'danger'
  if (Number(firstChoices) >= Number(capacity)) return 'warning'
  return 'success'
}
function pressureLabel(firstChoices: number, capacity: number) {
  if (Number(capacity) <= 0) return '无名额'
  if (Number(firstChoices) >= 2 * Number(capacity)) return '高度集中'
  if (Number(firstChoices) >= Number(capacity)) return '接近或超额'
  return '未达名额'
}
function exportPressure() {
  if (!overview.value?.cycle) return
  const rows = [
    ['周期', '统计时间', '类型', '课题或导师', '导师', '第一志愿人数', '全部志愿数', '有效名额', '预警'],
    ...topicPressure.value.map((topic: any) => [overview.value.cycle.name, new Date().toLocaleString('zh-CN'), '课题', topic.title, topic.teacher_name, topic.first_choice_count, topic.application_count, topic.max_students, pressureLabel(topic.first_choice_count, topic.max_students)]),
    ...teacherPressure.value.map((teacher: any) => [overview.value.cycle.name, new Date().toLocaleString('zh-CN'), '导师', teacher.name, teacher.name, teacher.firstChoices, '', teacher.effectiveCapacity, pressureLabel(teacher.firstChoices, teacher.effectiveCapacity)])
  ]
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `志愿集中度_${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
function suggestedTopics(student: any) {
  const categories = String(student.preferred_categories || '').split('、').filter(Boolean)
  const appliedIds = String(student.applied_topic_ids || '').split(',')
  const matches = availableTopics.value.filter((topic: any) => topic.major === student.major && !appliedIds.includes(topic.id))
  const ranked = [...matches].sort((a: any, b: any) => Number(categories.includes(b.category)) - Number(categories.includes(a.category)))
  return ranked.slice(0, 3).map((topic: any) => topic.title).join('；') || '暂无同专业空余课题'
}

function remainingSeats(topic: any) { return Math.max(0, Number(topic.max_students) - Number(topic.accepted_count || 0)) }
function teacherRemainingNumber(topic: any) {
  const limit = Number(overview.value?.teacherLimit || 0)
  return limit > 0 ? Math.max(0, limit - Number(topic.teacher_accepted_count || 0)) : Number.POSITIVE_INFINITY
}
function teacherRemaining(topic: any) {
  const count = teacherRemainingNumber(topic)
  return Number.isFinite(count) ? count : '未设置上限'
}
function adjustmentHint(adjustment: any) {
  if (overview.value?.cycle?.phase !== 'adjustment') return { ok: false, label: '未进入调剂阶段' }
  if (adjustment.from_topic_id) return { ok: false, label: '转题需人工处理' }
  const topic = overview.value?.topics?.find((t: any) => t.id === adjustment.to_topic_id)
  if (!topic || topic.status !== 'published') return { ok: false, label: '课题不可补录' }
  const seats = remainingSeats(topic)
  if (seats <= 0 || teacherRemainingNumber(topic) <= 0) return { ok: false, label: '名额已满' }
  const higherWaiting = pendingAdjustments.value.filter(a => a.to_topic_id === topic.id && a.id !== adjustment.id && Number(a.gpa || 0) > Number(adjustment.gpa || 0)).length
  if (higherWaiting >= seats) return { ok: false, label: '高绩点申请待处理' }
  return { ok: true, label: '可提交审批' }
}
async function loadOverview() {
  overviewLoading.value = true
  overviewError.value = ''
  try {
    const [overviewRes, adjustmentsRes]: any[] = await Promise.all([adminApi.getSelectionOverview(), applicationApi.getAdjustments()])
    overview.value = overviewRes.data
    adjustments.value = adjustmentsRes.data || []
  } catch (err: any) {
    overviewError.value = err?.response?.data?.message || '当前周期数据加载失败，请重试'
  } finally {
    overviewLoading.value = false
  }
}
async function approveAdjustment(adjustment: any) {
  if (!adjustmentHint(adjustment).ok) return
  try {
    await ElMessageBox.confirm(`确认 ${adjustment.student_name} 调剂到「${adjustment.to_topic_title}」？请先核对学生意愿及教师意见。`, '确认调剂录取', { type: 'warning' })
    await applicationApi.reviewAdjustment(adjustment.id, { status: 'approved' })
    ElMessage.success('调剂录取成功')
    await loadOverview()
  } catch (err: any) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err?.response?.data?.message || '审批失败，请刷新后重试')
    await loadOverview()
  }
}

const students = ref<any[]>([])
const studentSelections = ref<any[]>([])
const filterStatus = ref('')

const stats = computed(() => ({
  total: students.value.length,
  applied: students.value.filter(s => s.application_count > 0).length,
  notApplied: students.value.filter(s => s.application_count === 0).length,
  withShortlist: students.value.filter(s => s.shortlist_count > 0).length
}))

const filteredStudents = computed(() => {
  if (!filterStatus.value) return students.value
  if (filterStatus.value === 'applied') return students.value.filter(s => s.application_count > 0)
  if (filterStatus.value === 'not_applied') return students.value.filter(s => s.application_count === 0)
  return students.value
})

const getStudentSelections = (studentId: string) => {
  return studentSelections.value.filter(s => s.student_id === studentId)
}

const getPriorityType = (priority: number) => {
  return priorityTagType(priority)
}

const getStatusType = (status: string) => {
  if (status === 'accepted') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'rejected') return 'danger'
  return 'info'
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    accepted: '已录取',
    pending: '待审核',
    rejected: '已拒绝'
  }
  return map[status] || status
}

const loadStudents = async () => {
  const [studentsRes, selectionsRes] = await Promise.all([
    adminApi.getStudents(),
    adminApi.getStudentSelections()
  ])
  students.value = studentsRes.data
  studentSelections.value = selectionsRes.data
}

const exportData = () => {
  const headers = ['学号', '姓名', '班级', '专业', '志愿优先级', '课题题目', '课题类别', '指导教师', '录取状态']
  const rows: string[][] = []
  
  studentSelections.value.forEach(s => {
    if (s.topic_title) {
      rows.push([
        s.student_code || '',
        s.student_name || '',
        s.class_name || '',
        s.major || '',
        s.priority ? `第${s.priority}志愿` : '',
        s.topic_title || '',
        s.topic_category || '',
        s.teacher_name || '',
        getStatusText(s.application_status)
      ])
    } else {
      rows.push([
        s.student_code || '',
        s.student_name || '',
        s.class_name || '',
        s.major || '',
        '',
        '未选课',
        '',
        '',
        ''
      ])
    }
  })

  const csv = [headers.join(','), ...rows.map(r => r.map(cell => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
      return `"${cell.replace(/"/g, '""')}"`
    }
    return cell
  }).join(','))].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `学生选题明细_${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(() => { loadStudents(); loadOverview() })
</script>

<style scoped>
.stat-box {
  text-align: center;
  padding: 16px;
  background: #f8fafc;
  border-radius: 8px;
}
.stat-box.done { background: #ecfdf5; }
.stat-box.warning { background: #fef2f2; }
.stat-box.shortlist { background: #eff6ff; }

.stat-value {
  display: block;
  font-size: 28px;
  font-weight: bold;
  color: #1e293b;
}
.stat-box.done .stat-value { color: #059669; }
.stat-box.warning .stat-value { color: #dc2626; }
.stat-box.shortlist .stat-value { color: #3b82f6; }

.stat-label {
  font-size: 14px;
  color: #64748b;
}

.highlight-warning {
  color: #dc2626;
  font-weight: bold;
}

.expand-content {
  padding: 16px 0;
}

.text-gray-400 {
  color: #9ca3af;
}
</style>
