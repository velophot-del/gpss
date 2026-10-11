<template>
  <div class="cycle-management page-container">
    <div class="card-container">
      <h2 class="section-title">选题周期管理</h2>
      <el-alert v-if="configurationError" :title="configurationError" type="error" show-icon class="config-alert">
        <template #default><el-button link type="danger" @click="router.push('/admin/selection-settlement')">前往录取结算查看配置</el-button></template>
      </el-alert>

      <el-alert title="进行中周期手动切换时，同时忽略该周期的课题名额合计冲突；实际录取仍受教师指导人数上限约束。" type="info" :closable="false" show-icon class="config-alert" />

      <el-button type="primary" icon="Plus" style="margin-bottom: 20px;" @click="showCreateDialog">
        创建新周期
      </el-button>

      <el-table :data="cycleStore.cycles" stripe v-loading="loading">
        <el-table-column prop="name" label="周期名称" min-width="200" />
        <el-table-column prop="year" label="年份" width="100" />
        <el-table-column prop="status" label="状态" width="120" align="center">
          <template #default="{ row }">
            <el-tag :type="cycleStatusType[row.status]" size="small">{{ cycleStatusLabel[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="课题发布期" min-width="220">
          <template #default="{ row }">
            {{ formatDate(row.topicPublishStart) }} ~ {{ formatDate(row.topicPublishEnd) }}
          </template>
        </el-table-column>
        <el-table-column label="填报开始" width="190">
          <template #default="{ row }">
            {{ formatDate(row.studentApplyStart) }}
          </template>
        </el-table-column>
        <el-table-column label="调剂截止" width="190">
          <template #default="{ row }">{{ formatDate(row.adjustmentEnd) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="340" fixed="right">
          <template #default="{ row }">
            <div class="action-btns">
            <el-button link type="primary" icon="Edit" size="small" @click="showEditDialog(row)">编辑</el-button>
            <el-dropdown trigger="click">
              <el-button link type="warning" icon="Switch" size="small">
                手动切换状态
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item @click="changeStatus(row.id, 'active')">设为当前</el-dropdown-item>
                  <el-dropdown-item @click="changeStatus(row.id, 'selection')">进入选课</el-dropdown-item>
                  <el-dropdown-item @click="changeStatus(row.id, 'review')">进入审核</el-dropdown-item>
                  <el-dropdown-item @click="changeStatus(row.id, 'review', 'result_announce')">进入结果公示</el-dropdown-item>
                  <el-dropdown-item @click="changeStatus(row.id, 'adjustment')">进入调剂</el-dropdown-item>
                  <el-dropdown-item @click="changeStatus(row.id, 'completed')">结束</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <el-popconfirm
              title="确定删除此选题周期？删除后不可恢复"
              confirm-button-text="确定"
              cancel-button-text="取消"
              @confirm="handleDelete(row.id)"
            >
              <template #reference>
                <el-tooltip
                  v-if="['active','selection','review','adjustment'].includes(row.status)"
                  content="进行中的周期不可删除，请先将状态切换为「已结束」"
                  placement="top"
                >
                  <el-button link type="danger" icon="Delete" size="small" disabled>删除</el-button>
                </el-tooltip>
                <el-button v-else link type="danger" icon="Delete" size="small">删除</el-button>
              </template>
            </el-popconfirm>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <!-- 创建弹窗 -->
      <el-dialog v-model="dialogVisible" title="创建选题周期" width="680px">
        <el-form ref="formRef" :model="form" label-width="110px" size="large">
          <el-form-item label="周期名称" required>
            <el-input v-model="form.name" placeholder="例如：2025届本科毕业设计选题" />
          </el-form-item>
          <el-form-item label="年度" required>
            <el-input v-model="form.year" placeholder="例如：2025" />
          </el-form-item>
          <el-form-item label="初始状态">
            <el-radio-group v-model="form.status">
              <el-radio value="upcoming">未开始</el-radio>
              <el-radio value="active">立即启用（进行中）</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="阶段切换方式">
            <el-radio-group v-model="form.phaseSwitchMode">
              <el-radio value="auto">按时间自动切换</el-radio>
              <el-radio value="manual">管理员手动切换</el-radio>
            </el-radio-group>
            <div class="cycle-cfg-hint">手动模式保持所选阶段；截止自动提交与结算仍按截止时间执行。</div>
          </el-form-item>
          <el-form-item label="课题名额合计冲突">
            <el-switch v-model="form.ignoreCapacityConflicts" active-text="本周期忽略" inactive-text="校验" />
            <div class="cycle-cfg-hint">仅跳过课题设置名额合计冲突，最终录取仍遵守教师指导人数和单课题名额上限。</div>
          </el-form-item>
          <el-form-item label="教师指导人数上限">
            <el-input-number v-model="form.teacherStudentLimit" :min="0" :max="200" :step="1" style="width: 100%" />
          </el-form-item>
          <el-form-item label="单课题人数上限">
            <el-input-number v-model="form.topicStudentLimit" :min="1" :max="10" :step="1" style="width: 100%" />
            <div class="cycle-cfg-hint">限制每个课题可设置的招收人数；调整此项不会修改已存在课题。</div>
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="form.description" type="textarea" :rows="2" />
          </el-form-item>
          <el-divider content-position="left">阶段时间安排</el-divider>
          <el-alert title="时间按当前设备时区设置，精确到秒。00:00:00 表示当天开始；若开放至某日全天，请将截止时间设为次日 00:00:00。" type="info" :closable="false" show-icon class="config-alert" />
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="发布开始">
                <el-date-picker v-model="form.topicPublishStart" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="发布截止">
                <el-date-picker v-model="form.topicPublishEnd" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="填报开始">
                <el-date-picker v-model="form.studentApplyStart" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="填报截止">
                <el-date-picker v-model="form.studentApplyEnd" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="遴选开始">
                <el-date-picker v-model="form.teacherReviewStart" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="遴选截止">
                <el-date-picker v-model="form.teacherReviewEnd" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="结果公布">
                <el-date-picker v-model="form.resultAnnounceTime" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="调剂开始">
                <el-date-picker v-model="form.adjustmentStart" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="调剂结束">
                <el-date-picker v-model="form.adjustmentEnd" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="handleCreate">创建</el-button>
        </template>
      </el-dialog>

      <!-- 编辑弹窗 -->
      <el-dialog v-model="editDialogVisible" title="编辑选题周期" width="760px">
        <el-form ref="editFormRef" :model="form" label-width="110px" size="large">
          <el-form-item label="周期名称" required>
            <el-input v-model="form.name" />
          </el-form-item>
          <el-form-item label="年度" required>
            <el-input v-model="form.year" />
          </el-form-item>
          <el-form-item label="状态">
            <el-radio-group v-model="form.status">
              <el-radio value="upcoming">未开始</el-radio>
              <el-radio value="active">进行中</el-radio>
              <el-radio value="selection">选课中</el-radio>
              <el-radio value="review">审核中</el-radio>
              <el-radio value="adjustment">调剂中</el-radio>
              <el-radio value="completed">已结束</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="阶段切换方式">
            <el-radio-group v-model="form.phaseSwitchMode">
              <el-radio value="auto">按时间自动切换</el-radio>
              <el-radio value="manual">管理员手动切换</el-radio>
            </el-radio-group>
            <div class="cycle-cfg-hint">手动模式保持所选阶段；截止自动提交与结算仍按截止时间执行。</div>
          </el-form-item>
          <el-form-item label="课题名额合计冲突">
            <el-switch v-model="form.ignoreCapacityConflicts" active-text="本周期忽略" inactive-text="校验" />
            <div class="cycle-cfg-hint">仅跳过课题设置名额合计冲突，最终录取仍遵守教师指导人数和单课题名额上限。</div>
          </el-form-item>
          <el-form-item label="教师指导人数上限">
            <el-input-number v-model="form.teacherStudentLimit" :min="0" :max="200" :step="1" style="width: 100%" />
          </el-form-item>
          <el-form-item label="单课题人数上限">
            <el-input-number v-model="form.topicStudentLimit" :min="1" :max="10" :step="1" style="width: 100%" />
            <div class="cycle-cfg-hint">限制每个课题可设置的招收人数；调整此项不会修改已存在课题。</div>
          </el-form-item>
          <el-form-item label="描述">
            <el-input v-model="form.description" type="textarea" :rows="2" />
          </el-form-item>

          <el-divider content-position="left">毕业专业与研究方向（本周期）</el-divider>
          <div class="cycle-cfg-hint">
            配置本周期允许发布的毕业专业与研究方向，作为教师建题、学生选志愿的专业/方向来源。未配置时按系统默认 4 个专业执行。
          </div>
          <div v-for="(m, idx) in cfgMajorsDraft" :key="`m-${m.code || idx}`" class="cfg-major-row">
            <el-input v-model="m.name" placeholder="专业名称" />
            <el-input v-model="m.code" placeholder="专业代码" style="width: 170px;" />
            <el-button text type="danger" @click="removeMajorRow(idx)">删除</el-button>
          </div>
          <el-button size="small" type="primary" plain icon="Plus" @click="addMajorRow">添加专业</el-button>
          <div v-for="m in cfgMajorsDraft" :key="`c-${m.code}`" class="cfg-cats-block">
            <template v-if="m.code">
              <div class="cfg-cats-head">{{ m.name || '未命名' }}（{{ m.code }}）研究方向</div>
              <div class="cfg-cats-tags">
                <el-tag v-for="(c, i) in cfgResearchDraft[m.code] || []" :key="c" closable @close="removeCat(m.code, i)">{{ c }}</el-tag>
                <span v-if="!(cfgResearchDraft[m.code] || []).length" class="cfg-cats-empty">暂无方向</span>
              </div>
              <div class="cfg-cats-add">
                <el-input v-model="cfgCatDrafts[m.code]" size="small" placeholder="输入研究方向，回车或点添加" style="width: 280px;" @keyup.enter="addCat(m.code)" />
                <el-button size="small" @click="addCat(m.code)">添加方向</el-button>
              </div>
            </template>
          </div>

          <el-divider content-position="left">阶段时间安排</el-divider>
          <el-alert title="时间按当前设备时区设置，精确到秒。00:00:00 表示当天开始；若开放至某日全天，请将截止时间设为次日 00:00:00。" type="info" :closable="false" show-icon class="config-alert" />
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="发布开始">
                <el-date-picker v-model="form.topicPublishStart" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="发布截止">
                <el-date-picker v-model="form.topicPublishEnd" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="填报开始">
                <el-date-picker v-model="form.studentApplyStart" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="填报截止">
                <el-date-picker v-model="form.studentApplyEnd" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="遴选开始">
                <el-date-picker v-model="form.teacherReviewStart" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="遴选截止">
                <el-date-picker v-model="form.teacherReviewEnd" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="结果公布">
                <el-date-picker v-model="form.resultAnnounceTime" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="调剂开始">
                <el-date-picker v-model="form.adjustmentStart" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="调剂结束">
                <el-date-picker v-model="form.adjustmentEnd" type="datetime" format="YYYY-MM-DD HH:mm:ss" placeholder="选择日期和时间" style="width: 100%" value-format="YYYY-MM-DDTHH:mm:ssZ" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
        <template #footer>
          <el-button @click="closeEditDialog">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="handleEdit">保存修改</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCycleStore } from '../../stores/cycle'
import { cycleApi, cycleConfigApi } from '../../api'
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'

const cycleStore = useCycleStore()
const router = useRouter()
const configurationError = ref('')
const loading = ref(false)
const submitting = ref(false)

const dialogVisible = ref(false)
const editDialogVisible = ref(false)
const editingId = ref<string | null>(null)

const form = reactive({
  name: '',
  year: '',
  status: 'upcoming' as string,
  description: '',
  phaseSwitchMode: 'auto',
  ignoreCapacityConflicts: false,
  teacherStudentLimit: 0,
  topicStudentLimit: 10,
  topicPublishStart: '',
  topicPublishEnd: '',
  studentApplyStart: '',
  studentApplyEnd: '',
  teacherReviewStart: '',
  teacherReviewEnd: '',
  resultAnnounceTime: '',
  adjustmentStart: '',
  adjustmentEnd: ''
})

const cycleStatusType: Record<string, string> = {
  upcoming: 'info', active: 'success', selection: 'primary',
  review: 'warning', adjustment: 'danger', completed: 'success', draft: 'info'
}
const cycleStatusLabel: Record<string, string> = {
  upcoming: '未开始', active: '进行中', selection: '选课中',
  review: '审核中', adjustment: '调剂中', completed: '已结束', draft: '草稿'
}

// ===== 周期级「毕业专业 + 研究方向」配置编辑 =====
const cfgMajorsDraft = ref<{ code: string; name: string }[]>([])
const cfgResearchDraft = reactive<Record<string, string[]>>({})
const cfgCatDrafts = reactive<Record<string, string>>({})

function resetCfg() {
  cfgMajorsDraft.value = []
  for (const k of Object.keys(cfgResearchDraft)) delete cfgResearchDraft[k]
  for (const k of Object.keys(cfgCatDrafts)) delete cfgCatDrafts[k]
}
function addMajorRow() { cfgMajorsDraft.value.push({ code: '', name: '' }) }
function removeMajorRow(idx: number) {
  const rm = cfgMajorsDraft.value.splice(idx, 1)[0]
  if (rm?.code) { delete cfgResearchDraft[rm.code]; delete cfgCatDrafts[rm.code] }
}
function addCat(code: string) {
  const v = (cfgCatDrafts[code] || '').trim()
  if (!v) return
  if (!cfgResearchDraft[code]) cfgResearchDraft[code] = []
  if (!cfgResearchDraft[code].includes(v)) cfgResearchDraft[code].push(v)
  cfgCatDrafts[code] = ''
}
function removeCat(code: string, index: number) { cfgResearchDraft[code]?.splice(index, 1) }
// 校验并把草稿规整成可保存结构；非法返回 null
function buildCfgPayload(): { majors: { code: string; name: string }[]; researchCategories: Record<string, string[]> } | null {
  const seen = new Set<string>()
  const majors = cfgMajorsDraft.value
    .map(m => ({ code: m.code.trim(), name: m.name.trim() }))
    .filter(m => m.code && m.name)
  for (const m of majors) {
    if (seen.has(m.code)) { ElMessage.warning(`专业代码重复：${m.code}`); return null }
    seen.add(m.code)
  }
  if (!majors.length) { ElMessage.warning('请至少配置一个毕业专业'); return null }
  const researchCategories: Record<string, string[]> = {}
  for (const m of majors) {
    if (Array.isArray(cfgResearchDraft[m.code])) researchCategories[m.code] = [...new Set(cfgResearchDraft[m.code].map(String).filter(Boolean))]
  }
  return { majors, researchCategories }
}

// 加载周期列表
async function fetchCycles() {
  loading.value = true
  try {
    await cycleStore.fetchAllCycles()
    // 同时刷新 store 中的当前周期
    await cycleStore.fetchCurrentCycle()
  } catch (e) {
    console.error('获取周期列表失败:', e)
  } finally {
    loading.value = false
  }
}

function showCreateDialog() {
  editingId.value = null
  Object.assign(form, {
    name: '', year: '', status: 'upcoming', description: '',
    phaseSwitchMode: 'auto', ignoreCapacityConflicts: false,
    teacherStudentLimit: 0, topicStudentLimit: 10,
    topicPublishStart: '', topicPublishEnd: '',
    studentApplyStart: '', studentApplyEnd: '',
    teacherReviewStart: '', teacherReviewEnd: '',
    resultAnnounceTime: '', adjustmentStart: '', adjustmentEnd: ''
  })
  dialogVisible.value = true
}

async function showEditDialog(row: any) {
  editingId.value = row.id
  resetCfg()
  let configuredTopicStudentLimit: number | null = null
  // 从周期配置读取“毕业专业 + 研究方向”（未配置时后端回退默认 4 专业）
  try {
    const r: any = await cycleConfigApi.getByCycle(row.id)
    const majors = r?.data?.majors || []
    const cats = r?.data?.researchCategories || {}
    const configuredLimit = Number(r?.data?.topicStudentLimit)
    configuredTopicStudentLimit = Number.isInteger(configuredLimit) && configuredLimit >= 1 ? configuredLimit : null
    cfgMajorsDraft.value = majors.map((m: any) => ({ code: String(m.code || ''), name: String(m.name || '') }))
    for (const [code, list] of Object.entries(cats)) cfgResearchDraft[code] = Array.isArray(list) ? [...list.map(String)] : []
  } catch (e) {
    console.error('读取周期专业配置失败:', e)
    ElMessage.warning('读取该周期专业配置失败，可手动添加')
  }
  // 从 phases_config 解析阶段时间（如果存在）
  const phases = typeof row.phases_config === 'string' ? JSON.parse(row.phases_config || '{}') : (row.phases_config || {})
  Object.assign(form, {
    name: row.name,
    year: row.year,
    status: row.status || 'upcoming',
    description: row.description || '',
    phaseSwitchMode: phases.phase_switch_mode || row.phaseSwitchMode || 'auto',
    ignoreCapacityConflicts: phases.ignore_capacity_conflicts === true || row.ignoreCapacityConflicts === true,
    teacherStudentLimit: Number(phases.teacher_student_limit ?? row.teacherStudentLimit ?? 0) || 0,
    topicStudentLimit: Number(phases.topic_student_limit ?? configuredTopicStudentLimit ?? row.topicStudentLimit ?? 10) || 10,
    topicPublishStart: phases.topic_publish?.start || row.topicPublishStart || '',
    topicPublishEnd: phases.topic_publish?.end || row.topicPublishEnd || '',
    studentApplyStart: phases.student_apply?.start || row.studentApplyStart || '',
    studentApplyEnd: phases.student_apply?.end || row.studentApplyEnd || '',
    teacherReviewStart: phases.teacher_review?.start || row.teacherReviewStart || '',
    teacherReviewEnd: phases.teacher_review?.end || row.teacherReviewEnd || '',
    resultAnnounceTime: phases.result_announce || row.resultAnnounceTime || '',
    adjustmentStart: phases.adjustment?.start || row.adjustmentStart || '',
    adjustmentEnd: phases.adjustment?.end || row.adjustmentEnd || ''
  })
  editDialogVisible.value = true
}

function closeEditDialog() {
  editDialogVisible.value = false
  resetCfg()
}

async function handleCreate() {
  if (!form.name || !form.year) {
    return ElMessage.warning('请填写周期名称和年度')
  }

  submitting.value = true
  try {
    await cycleApi.create({
      name: form.name,
      year: form.year,
      status: form.status,
      description: form.description || null,
      startDate: form.topicPublishStart || null,
      endDate: form.adjustmentEnd || null,
      phasesConfig: {
        phase_switch_mode: form.phaseSwitchMode,
        ignore_capacity_conflicts: form.ignoreCapacityConflicts,
        topic_publish: { start: form.topicPublishStart, end: form.topicPublishEnd },
        student_apply: { start: form.studentApplyStart, end: form.studentApplyEnd },
        teacher_review: { start: form.teacherReviewStart, end: form.teacherReviewEnd },
        result_announce: form.resultAnnounceTime,
        adjustment: { start: form.adjustmentStart, end: form.adjustmentEnd },
        teacher_student_limit: Number(form.teacherStudentLimit) || 0,
        topic_student_limit: Number(form.topicStudentLimit) || 10
      }
    })
    ElMessage.success(`选题周期创建成功（状态：${form.status === 'active' ? '已启用' : '未开始'}）`)
    dialogVisible.value = false
    await fetchCycles()
  } catch (e: any) {
    console.error('创建周期失败:', e)
    ElMessage.error(e.response?.data?.message || '创建失败')
  } finally {
    submitting.value = false
  }
}

async function changeStatus(id: string, status: any, selectedPhase?: string) {
  try {
    const target = cycleStore.cycles.find((c: any) => c.id === id)
    if (target) {
      // 状态到阶段的正确映射（必须匹配数据库 phase ENUM 允许的值）
      const statusToPhaseMap: Record<string, string> = {
        active: 'topic_publish',
        selection: 'student_apply',
        review: 'teacher_review',
        adjustment: 'adjustment',
        completed: 'ended'
      }
      await cycleApi.update(id, {
        status,
        phase: selectedPhase || statusToPhaseMap[status] || 'topic_publish',
        phasesConfig: {
          phase_switch_mode: 'manual',
          ignore_capacity_conflicts: target.ignoreCapacityConflicts === true || ['active', 'selection', 'review', 'adjustment'].includes(target.status)
        }
      })
      configurationError.value = ''
      ElMessage.success(`已切换为手动模式，状态更新为「${cycleStatusLabel[status] || status}」`)
      await fetchCycles()
    }
  } catch (e: any) {
    console.error('更新状态失败:', e)
    configurationError.value = e.response?.data?.message || '更新失败'
    ElMessage.error(configurationError.value)
  }
}

async function handleEdit() {
  if (!form.name || !form.year) {
    return ElMessage.warning('请填写周期名称和年度')
  }
  if (!editingId.value) return

  const cfgPayload = buildCfgPayload()
  if (!cfgPayload) return

  submitting.value = true
  try {
    // 状态到阶段的映射
    const statusToPhaseMap: Record<string, string> = {
      active: 'topic_publish',
      selection: 'student_apply',
      review: 'teacher_review',
      adjustment: 'adjustment',
      completed: 'ended'
    }
    // 阶段时间与专业/研究方向分两次保存（后端对 phases_config 深合并，互不覆盖）
    await cycleApi.update(editingId.value, {
      name: form.name,
      year: form.year,
      status: form.status,
      phase: form.status === cycleStore.cycles.find((c: any) => c.id === editingId.value)?.status
        ? cycleStore.cycles.find((c: any) => c.id === editingId.value)?.phase
        : statusToPhaseMap[form.status] || 'topic_publish',
      description: form.description || null,
      startDate: form.topicPublishStart || null,
      endDate: form.adjustmentEnd || null,
      phasesConfig: {
        phase_switch_mode: form.phaseSwitchMode,
        ignore_capacity_conflicts: form.ignoreCapacityConflicts,
        topic_publish: { start: form.topicPublishStart, end: form.topicPublishEnd },
        student_apply: { start: form.studentApplyStart, end: form.studentApplyEnd },
        teacher_review: { start: form.teacherReviewStart, end: form.teacherReviewEnd },
        result_announce: form.resultAnnounceTime,
        adjustment: { start: form.adjustmentStart, end: form.adjustmentEnd },
        teacher_student_limit: Number(form.teacherStudentLimit) || 0,
        topic_student_limit: Number(form.topicStudentLimit) || 10
      }
    })
    await cycleConfigApi.save(editingId.value, cfgPayload)
    configurationError.value = ''
    ElMessage.success('选题周期与专业/研究方向已更新')
    closeEditDialog()
    editingId.value = null
    await fetchCycles()
  } catch (e: any) {
    console.error('更新周期失败:', e)
    configurationError.value = e.response?.data?.message || '更新失败'
    ElMessage.error(configurationError.value)
  } finally {
    submitting.value = false
  }
}

async function handleDelete(id: string) {
  try {
    await cycleApi.delete(id)
    ElMessage.success('选题周期已删除')
    await fetchCycles()
  } catch (e: any) {
    console.error('删除周期失败:', e)
    ElMessage.error(e.response?.data?.message || '删除失败')
  }
}

function formatDate(dateStr: any): string {
  if (!dateStr) return '-'
  const d = dayjs(dateStr)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : '-'
}

onMounted(() => {
  fetchCycles()
})
</script>

<style scoped>
.action-btns {
  display: flex;
  align-items: center;
  gap: 0;
}

.cycle-cfg-hint { font-size: 12px; color: #909399; margin: -6px 0 12px; line-height: 1.5; }
.cfg-major-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
.cfg-cats-block { margin: 10px 0 14px; padding: 10px; background: #fafafa; border-radius: 8px; }
.cfg-cats-head { font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--primary-color); }
.cfg-cats-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.cfg-cats-empty { color: #c0c4cc; font-size: 12px; }
.cfg-cats-add { display: flex; gap: 8px; }

@media (max-width: 768px) {
  :deep(.el-table) { font-size: 12px; }
  :deep(.el-table th) { font-size: 11px; padding: 8px 6px; }
  :deep(.el-table td) { font-size: 11px; padding: 8px 6px; }
  :deep(.el-button) { padding: 4px 8px; font-size: 11px; }
}

@media (max-width: 480px) {
  :deep(.el-table) { font-size: 11px; }
  :deep(.el-table th) { font-size: 10px; padding: 6px 4px; }
  :deep(.el-table td) { font-size: 10px; padding: 6px 4px; }
  :deep(.el-button) { padding: 2px 6px; font-size: 10px; }
}
</style>
