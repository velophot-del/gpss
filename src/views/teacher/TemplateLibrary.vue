<template>
  <div class="template-library page-container">
    <div class="card-container">
      <div class="page-header">
        <h2 class="section-title">我的选题库</h2>
        <el-button type="primary" icon="Plus" @click="openCreate">新建题库模板</el-button>
      </div>

      <div class="topic-summary">
        <span>共 {{ templates.length }} 条模板</span>
        <el-divider direction="vertical" />
        <span>可用(可发布): {{ templates.filter(t => t.status === 'active').length }}</span>
        <el-divider direction="vertical" />
        <span>累计发布 {{ totalOffers }} 次 / 录取 {{ totalAccepted }} 人</span>
      </div>

      <div class="filter-bar">
        <el-input v-model="searchText" placeholder="搜索课题名称" prefix-icon="Search" clearable style="width: 240px;" @input="refresh" />
        <el-select v-model="statusFilter" placeholder="状态筛选" clearable style="width: 130px;" @change="refresh">
          <el-option label="可用" value="active" />
          <el-option label="停用" value="disabled" />
          <el-option label="已归档" value="archived" />
        </el-select>
        <el-select v-model="groupFilter" placeholder="全部分组" clearable style="width: 150px;" @change="refresh">
          <el-option v-for="g in groups" :key="g" :label="g" :value="g" />
        </el-select>
      </div>

      <el-table :data="displayRows" stripe v-loading="loading" style="margin-top: 16px;">
        <el-table-column prop="title" label="课题名称" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">
            <el-link type="primary" @click="openEdit(row)">{{ row.title }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="major" label="专业" width="150" show-overflow-tooltip />
        <el-table-column prop="category" label="研究方向" width="140" show-overflow-tooltip />
        <el-table-column label="分组" width="100">
          <template #default="{ row }">{{ row.groupName || '-' }}</template>
        </el-table-column>
        <el-table-column label="难度" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="difficultyType[row.difficulty]" size="small">{{ difficultyLabel[row.difficulty] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="statusType[row.status]" size="small">{{ statusLabel[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="发布/录取" width="120" align="center">
          <template #default="{ row }">
            <el-tooltip :content="row.lastCycleName ? `最近发布：${row.lastCycleName}` : '尚未发布过'" placement="top">
              <span>{{ row.offerCount }} 次 / {{ row.acceptedTotal }} 人</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="110">
          <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="330" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-tooltip
              :disabled="canOffer(row)"
              :content="!activeCycle ? '当前无进行中周期，无法发布' : '停用/归档模板不能发布'"
            >
              <span>
                <el-button link type="success" icon="Upload" :disabled="!canOffer(row)" @click="offer(row)">发布到本周期</el-button>
              </span>
            </el-tooltip>
            <el-popconfirm title="复制一条同样的题库模板？" @confirm="duplicate(row)">
              <template #reference>
                <el-button link type="info" icon="CopyDocument">复制</el-button>
              </template>
            </el-popconfirm>
            <el-popconfirm
              v-if="row.status !== 'archived'"
              :title="row.status === 'active' ? '停用后不可再发布，确定？' : '恢复可用后即可再次发布'"
              @confirm="toggleActive(row)"
            >
              <template #reference>
                <el-button link type="warning" icon="SwitchButton">{{ row.status === 'active' ? '停用' : '启用' }}</el-button>
              </template>
            </el-popconfirm>
            <el-popconfirm title="删除该题库模板？(已被历届引用时系统会拦截)" @confirm="remove(row)">
              <template #reference>
                <el-button link type="danger" icon="Delete">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <!-- 新建/编辑模板 -->
      <el-dialog v-model="dlgVisible" :title="isEdit ? '编辑题库模板' : '新建题库模板'" width="720px" @closed="resetForm">
        <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
          <el-form-item label="课题名称" prop="title">
            <el-input v-model="form.title" placeholder="请输入课题名称（建议30字以内）" maxlength="50" show-word-limit />
          </el-form-item>
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item label="专业设置" prop="major">
                <el-select v-model="form.major" placeholder="选择专业" style="width: 100%;" @change="onMajorChange">
                  <el-option v-for="m in majors" :key="m.code" :label="`${m.name} (${m.code})`" :value="m.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="研究方向" prop="category">
                <el-select v-model="form.category" :disabled="!form.major" placeholder="选择该专业的研究方向" style="width: 100%;">
                  <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item label="难度等级">
                <el-radio-group v-model="form.difficulty">
                  <el-radio value="easy">简单</el-radio>
                  <el-radio value="medium">中等</el-radio>
                  <el-radio value="hard">困难</el-radio>
                </el-radio-group>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="默认招收人数">
                <el-input-number v-model="form.maxStudents" :min="1" :max="10" controls-position="right" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item label="分组" prop="groupName">
                <el-input v-model="form.groupName" placeholder="如：人工智能方向 / 2026届" clearable />
              </el-form-item>
            </el-col>
            <el-col :span="12" v-if="isEdit">
              <el-form-item label="状态">
                <el-select v-model="form.status" style="width: 100%;">
                  <el-option label="可用" value="active" />
                  <el-option label="停用" value="disabled" />
                  <el-option label="归档" value="archived" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="课题简介" prop="description">
            <el-input v-model="form.description" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="简要描述课题内容、目标和预期成果" />
          </el-form-item>
          <el-form-item label="具体要求" prop="requirements">
            <el-input v-model="form.requirements" type="textarea" :rows="4" maxlength="1000" show-word-limit placeholder="对学生技能、背景等要求，每行一条" />
          </el-form-item>
          <el-form-item label="技术标签">
            <div class="tags-wrapper">
              <el-tag v-for="tag in form.tags" :key="tag" closable @close="removeTag(tag)" style="margin-right:8px; margin-bottom:8px;">{{ tag }}</el-tag>
              <el-input v-if="tagInputVisible" v-model="tagInputValue" size="small" style="width:120px;" @keyup.enter="addTag" @blur="addTag" />
              <el-button v-else size="small" @click="showTagInput">+ 新增标签</el-button>
            </div>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dlgVisible = false">取消</el-button>
          <template v-if="isEdit">
            <el-button type="primary" :loading="saving" @click="save(false)">保存</el-button>
          </template>
          <template v-else>
            <el-button :loading="saving" @click="save(false)">仅保存到题库</el-button>
            <el-tooltip :disabled="!!activeCycle" content="当前无进行中周期，无法立即提报">
              <span style="display:inline-block;">
                <el-button type="primary" :loading="saving" :disabled="!activeCycle" @click="save(true)">保存并提报本周期</el-button>
              </span>
            </el-tooltip>
          </template>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { templateApi, cycleConfigApi, cycleApi } from '@/api'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import dayjs from 'dayjs'
import { RESEARCH_CATEGORIES } from '../../types'
import type { MajorConfig } from '../../types'

const FALLBACK_MAJORS: MajorConfig[] = [
  { code: '130502', name: '视觉传达设计' },
  { code: '130508', name: '数字媒体艺术（交互方向）' },
  { code: '081702', name: '包装工程' },
  { code: '080906T', name: '智能交互（工科）' }
]

const loading = ref(false)
const saving = ref(false)
const templates = ref<any[]>([])
const searchText = ref('')
const statusFilter = ref('')
const groupFilter = ref('')
const activeCycle = ref<any>(null)
const cycleCfg = ref<{ majors: MajorConfig[]; researchCategories: Record<string, string[]> } | null>(null)

const majors = computed<MajorConfig[]>(() => cycleCfg.value?.majors?.length ? cycleCfg.value.majors : FALLBACK_MAJORS)
const researchCategories = computed<Record<string, string[]>>(() => {
  const rc = cycleCfg.value?.researchCategories
  return rc && Object.keys(rc).length ? rc : RESEARCH_CATEGORIES
})
const groups = computed(() => [...new Set(templates.value.map(t => t.groupName).filter(Boolean))] as string[])
const totalOffers = computed(() => templates.value.reduce((s, t) => s + Number(t.offerCount || 0), 0))
const totalAccepted = computed(() => templates.value.reduce((s, t) => s + Number(t.acceptedTotal || 0), 0))

const difficultyLabel: Record<string, string> = { easy: '简单', medium: '中等', hard: '困难' }
const difficultyType: Record<string, string> = { easy: 'success', medium: 'warning', hard: 'danger' }
const statusLabel: Record<string, string> = { active: '可用', disabled: '停用', archived: '归档' }
const statusType: Record<string, string> = { active: 'success', disabled: 'info', archived: 'warning' }

const displayRows = computed(() => {
  let list = templates.value
  if (searchText.value) {
    const kw = searchText.value.toLowerCase()
    list = list.filter(t => t.title?.toLowerCase().includes(kw))
  }
  if (statusFilter.value) list = list.filter(t => t.status === statusFilter.value)
  if (groupFilter.value) list = list.filter(t => t.groupName === groupFilter.value)
  return list
})

const load = async () => {
  loading.value = true
  try {
    const params: any = {}
    if (statusFilter.value) params.status = statusFilter.value
    if (groupFilter.value) params.group = groupFilter.value
    const res: any = await templateApi.list(params)
    templates.value = res.data || []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '加载选题库失败')
  } finally {
    loading.value = false
  }
}
const refresh = () => { load() }

async function loadMeta() {
  try {
    const cfg: any = await cycleConfigApi.get()
    cycleCfg.value = cfg?.data || null
  } catch { cycleCfg.value = null }
  try {
    const ac: any = await cycleApi.getActive()
    activeCycle.value = ac?.data || null
  } catch { activeCycle.value = null }
}

function canOffer(row: any): boolean {
  return !!activeCycle.value && row.status === 'active'
}

function formatDate(s: string) { return s ? dayjs(s).format('YYYY-MM-DD') : '-' }

// ===== 新建/编辑对话框 =====
const dlgVisible = ref(false)
const isEdit = ref(false)
const editingId = ref('')
const formRef = ref<FormInstance>()
const tagInputVisible = ref(false)
const tagInputValue = ref('')
const categories = computed<string[]>(() => researchCategories.value[form.major] || [])
const form = reactive<any>({
  title: '', category: '', major: '', difficulty: 'medium', maxStudents: 2,
  description: '', requirements: '', tags: [] as string[], groupName: '', status: 'active'
})
const rules: FormRules = {
  title: [{ required: true, message: '请输入课题名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择研究方向', trigger: 'change' }],
  major: [{ required: true, message: '请选择专业', trigger: 'change' }],
  description: [{ required: true, message: '请输入课题简介', trigger: 'blur' }]
}

function resetForm() {
  form.title = ''; form.category = ''; form.major = ''; form.difficulty = 'medium'
  form.maxStudents = 2; form.description = ''; form.requirements = ''
  form.tags = []; form.groupName = ''; form.status = 'active'
  editingId.value = ''; isEdit.value = false
}
function onMajorChange() { if (!categories.value.includes(form.category)) form.category = '' }

function openCreate() { resetForm(); dlgVisible.value = true }

function openEdit(row: any) {
  editingId.value = row.id
  isEdit.value = true
  Object.assign(form, {
    title: row.title || '', category: row.category || '', major: row.majorCode || row.major || '',
    difficulty: row.difficulty || 'medium', maxStudents: Number(row.maxStudentsDefault || row.maxStudents || 1),
    description: row.description || '', requirements: row.requirements || '',
    tags: Array.isArray(row.tags) ? [...row.tags] : [], groupName: row.groupName || '', status: row.status || 'active'
  })
  dlgVisible.value = true
}

function showTagInput() { tagInputVisible.value = true }
function addTag() {
  const v = tagInputValue.value.trim()
  if (v && !form.tags.includes(v)) form.tags.push(v)
  tagInputVisible.value = false; tagInputValue.value = ''
}
function removeTag(tag: string) { form.tags = form.tags.filter(t => t !== tag) }

async function save(saveAndOffer = false) {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  const m = majors.value.find(x => x.code === form.major)
  const payload: any = {
    title: form.title, category: form.category, major: m?.name || form.major, majorCode: form.major,
    difficulty: form.difficulty, maxStudents: form.maxStudents,
    description: form.description, requirements: form.requirements,
    tags: form.tags, groupName: form.groupName || null
  }
  saving.value = true
  try {
    if (isEdit.value) {
      payload.status = form.status
      await templateApi.update(editingId.value, payload)
      ElMessage.success('题库模板已更新')
    } else {
      const res: any = await templateApi.create(payload)
      const newId = res?.data?.id
      if (saveAndOffer && newId) {
        try {
          await templateApi.offer(newId, {})
          ElMessage.success('已保存到题库并提交至学院审核（本周期）')
        } catch (e2: any) {
          ElMessage.warning('模板已保存；提报本周期未成功：' + (e2?.response?.data?.message || e2?.message || '未知原因'))
        }
      } else {
        ElMessage.success('已保存到个人选题库')
      }
    }
    dlgVisible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// ===== 行操作 =====
async function offer(row: any) {
  try {
    const res: any = await templateApi.offer(row.id, {})
    ElMessage.success(res?.data?.message || '已提交至学院审核（本周期）')
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '发布失败')
  }
}

async function duplicate(row: any) {
  try {
    await templateApi.duplicate(row.id)
    ElMessage.success('已复制为新的题库模板')
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '复制失败')
  }
}

async function toggleActive(row: any) {
  try {
    await templateApi.update(row.id, { status: row.status === 'active' ? 'disabled' : 'active' })
    ElMessage.success(row.status === 'active' ? '已停用' : '已启用')
    load()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '操作失败')
  }
}

async function remove(row: any) {
  try {
    await templateApi.remove(row.id)
    ElMessage.success('模板已删除')
    load()
  } catch (e: any) {
    ElMessageBox.alert(e?.response?.data?.message || '删除失败', '无法删除', { type: 'warning' })
  }
}

onMounted(() => { loadMeta(); load() })
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.filter-bar { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
.topic-summary { font-size: 13px; color: #909399; }
.tags-wrapper { display: flex; flex-wrap: wrap; align-items: flex-start; width: 100%; }
</style>
