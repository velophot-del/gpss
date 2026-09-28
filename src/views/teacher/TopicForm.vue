<template>
  <div class="topic-form page-container">
    <div class="card-container">
      <h2 class="section-title">{{ isEdit ? '编辑课题' : '发布新课题' }}</h2>

      <el-alert v-if="locked" type="warning" :closable="false" show-icon style="margin-bottom: 14px;">
        该选题已正式发布并被锁定，不能编辑/提交；如需修改请先由管理员在“选题库管理”中撤回发布。
      </el-alert>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="110px"
        size="large"
        style="max-width: 800px; margin-top: 24px;"
      >
        <el-form-item label="课题名称" prop="title">
          <el-input v-model="form.title" placeholder="请输入课题名称（建议30字以内）" maxlength="50" show-word-limit />
        </el-form-item>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="研究方向" prop="category">
              <el-select
                v-model="form.category"
                :disabled="!form.major"
                :placeholder="!form.major ? '请先选择专业' : (selectedMajorCategories.length ? '选择该专业的研究方向' : '该专业暂无研究方向配置')"
                style="width: 100%;"
              >
                <el-option v-for="c in selectedMajorCategories" :key="c" :label="c" :value="c" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="专业设置" prop="major">
              <el-select v-model="form.major" placeholder="选择专业" style="width: 100%;">
                <el-option v-for="m in majors" :key="m.code" :label="`${m.name} (${m.code})`" :value="m.code" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="难度等级" prop="difficulty">
              <el-radio-group v-model="form.difficulty">
                <el-radio value="easy">简单</el-radio>
                <el-radio value="medium">中等</el-radio>
                <el-radio value="hard">困难</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="课题简介" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="简要描述课题内容、目标和预期成果"
            maxlength="500"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="具体要求" prop="requirements">
          <el-input
            v-model="form.requirements"
            type="textarea"
            :rows="5"
            placeholder="详细说明对学生技能、背景等方面的要求，每行一条"
            maxlength="1000"
            show-word-limit
          />
        </el-form-item>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="招收人数" prop="maxStudents">
              <el-input-number v-model="form.maxStudents" :min="1" :max="maxStudentsForCurrentTopic" :disabled="quotaExhausted" controls-position="right" />
              <div class="form-tip quota-tip" v-if="teacherQuota">
                <span>本周期教师总名额：{{ teacherQuota.teacherLimit || '不限额' }}</span>
                <span>当前已分配：{{ teacherQuota.allocatedCapacity }} 人</span>
                <span v-if="teacherQuota.teacherLimit > 0" :class="{ 'quota-over': remainingCapacityAfterSetting < 0 }">
                  设置后剩余：{{ remainingCapacityAfterSetting }} 人
                </span>
                <span v-else>设置后剩余：不限额</span>
              </div>
              <span class="form-tip">本周期单个课题上限为 {{ topicStudentLimit }} 人；已存在课题不会因调整上限自动变化</span>
              <span v-if="quotaExhausted" class="form-tip quota-over">本周期教师可分配名额已用完，不能新增课题。</span>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 时间安排 -->
        <el-divider content-position="left">时间安排（可选）</el-divider>

        <div v-for="(schedule, index) in form.schedules" :key="index" class="schedule-item">
          <el-row :gutter="12" align="middle">
            <el-col :span="6">
              <el-input v-model="schedule.phase" placeholder="阶段名称" size="default">
                <template #prepend>阶段</template>
              </el-input>
            </el-col>
            <el-col :span="8">
              <el-date-picker
                v-model="schedule.dateRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                size="default"
                style="width: 100%;"
              />
            </el-col>
            <el-col :span="8">
              <el-input v-model="schedule.description" placeholder="阶段说明" size="default" />
            </el-col>
            <el-col :span="2">
              <el-button link type="danger" icon="Delete" @click="removeSchedule(index)" :disabled="form.schedules.length <= 1" />
            </el-col>
          </el-row>
        </div>
        <el-button type="primary" link plain icon="Plus" @click="addSchedule" style="margin-top: 8px;">
          添加阶段
        </el-button>

        <!-- 标签 -->
        <el-divider content-position="left">标签</el-divider>
        <el-form-item label="技术标签">
          <div class="tags-wrapper">
            <el-tag
              v-for="tag in form.tags"
              :key="tag"
              closable
              @close="removeTag(tag)"
              style="margin-right: 8px; margin-bottom: 8px;"
            >
              {{ tag }}
            </el-tag>
            <el-input
              v-if="tagInputVisible"
              ref="tagInputRef"
              v-model="tagInputValue"
              size="small"
              style="width: 120px;"
              @keyup.enter="addTag"
              @blur="addTag"
            />
            <el-button v-else size="small" @click="showTagInput">+ 新增标签</el-button>
          </div>
          <p class="form-tip">添加技术栈或关键词标签，方便学生搜索</p>
        </el-form-item>

        <!-- 附件上传 -->
        <el-divider content-position="left">附件</el-divider>
        <el-upload
          action="#"
          :auto-upload="false"
          :on-change="handleFileChange"
          :file-list="fileList"
          :show-file-list="false"
          multiple
        >
          <template #trigger>
            <el-button type="primary" plain icon="Upload" :loading="uploadingFiles">选择文件</el-button>
          </template>
          <template #tip>
            <div class="upload-tip">支持上传任务书模板、参考资料等，单个文件不超过10MB</div>
          </template>
        </el-upload>
        
        <!-- 已上传的附件列表 -->
        <div v-if="attachments.length > 0" class="attachments-list" style="margin-top: 12px;">
          <div v-for="(att, index) in attachments" :key="att.id" class="attachment-item">
            <el-icon style="margin-right: 8px;"><Document /></el-icon>
            <span class="attachment-name">{{ att.name }}</span>
            <span class="attachment-size">{{ (att.size / 1024).toFixed(1) }}KB</span>
            <el-button link type="danger" size="small" @click="removeAttachment(index)">
              <el-icon><Delete /></el-icon>
            </el-button>
          </div>
        </div>

        <!-- 操作按钮 -->
        <el-form-item style="margin-top: 32px;">
          <el-button type="primary" icon="Upload" @click="handleSubmit('submit')" :loading="submitting" :disabled="locked">
            提交至学院审核
          </el-button>
          <el-button icon="Document" @click="handleSubmit('draft')" :loading="submitting" :disabled="locked">
            存为草稿
          </el-button>
          <el-button @click="$router.back()">取消</el-button>
        </el-form-item>
        <p class="form-tip" style="margin-top: 8px; margin-left: 110px; color: #909399;">
          提交后进入学院选题库，由管理员审核通过后正式发布，学生方可查看。
        </p>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../../stores/user'
import { useTopicStore } from '../../stores/topic'
import { useCycleStore } from '../../stores/cycle'
import { topicApi, uploadApi, cycleConfigApi } from '../../api'
import type { FormInstance, FormRules, UploadFile } from 'element-plus'
import { ElMessage } from 'element-plus'
import { Document, Delete } from '@element-plus/icons-vue'
import type { MajorConfig } from '../../types'
import { RESEARCH_CATEGORIES, resolveTopicMajorCode } from '../../types'

// 未配置周期/接口不可用时的兜底选项（与后端默认 4 专业一致）
const FALLBACK_MAJORS: MajorConfig[] = [
  { code: '130502', name: '视觉传达设计' },
  { code: '130508', name: '数字媒体艺术（交互方向）' },
  { code: '081702', name: '包装工程' },
  { code: '080218T', name: '智能交互设计' }
]

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const topicStore = useTopicStore()
const cycleStore = useCycleStore()

const formRef = ref<FormInstance>()
const submitting = ref(false)
const isEdit = !!route.params.id
const loading = ref(false)
// 已正式发布的选题锁定：只能查看，不能编辑/提交
const locked = ref(false)

// 当期“毕业专业 + 研究方向”选项（来自周期配置；缺失回退默认）
const cycleCfg = ref<{ majors: MajorConfig[]; researchCategories: Record<string, string[]>; topicStudentLimit?: number } | null>(null)
const topicStudentLimit = computed(() => cycleCfg.value?.topicStudentLimit ?? 10)
type TeacherQuota = {
  cycleId: number | null
  teacherLimit: number
  allocatedCapacity: number
  currentTopicCapacity: number
  otherAllocatedCapacity: number
}
const teacherQuota = ref<TeacherQuota | null>(null)
const remainingCapacityAfterSetting = computed(() => {
  if (!teacherQuota.value || teacherQuota.value.teacherLimit <= 0) return 0
  return teacherQuota.value.teacherLimit - teacherQuota.value.otherAllocatedCapacity - Number(form.maxStudents || 0)
})
const maxStudentsForCurrentTopic = computed(() => {
  if (!teacherQuota.value || teacherQuota.value.teacherLimit <= 0) return topicStudentLimit.value
  const quotaMaximum = teacherQuota.value.teacherLimit - teacherQuota.value.otherAllocatedCapacity
  return Math.min(topicStudentLimit.value, Math.max(teacherQuota.value.currentTopicCapacity, quotaMaximum, 0))
})
const quotaExhausted = computed(() => Boolean(
  teacherQuota.value
  && teacherQuota.value.teacherLimit > 0
  && maxStudentsForCurrentTopic.value < 1,
))
const majors = computed<MajorConfig[]>(() =>
  cycleCfg.value?.majors?.length ? cycleCfg.value.majors : FALLBACK_MAJORS
)
const researchCategories = computed<Record<string, string[]>>(() => {
  const rc = cycleCfg.value?.researchCategories
  return rc && Object.keys(rc).length ? rc : RESEARCH_CATEGORIES
})

const form = reactive({
  title: '',
  category: '',
  major: '',
  difficulty: 'medium',
  description: '',
  requirements: '',
  maxStudents: 2,
  schedules: [
    { phase: '文献调研', dateRange: [] as string[], description: '' },
    { phase: '系统设计', dateRange: [] as string[], description: '' },
    { phase: '编码实现', dateRange: [] as string[], description: '' },
    { phase: '测试优化', dateRange: [] as string[], description: '' },
    { phase: '论文撰写', dateRange: [] as string[], description: '' }
  ],
  tags: [] as string[]
})

// 当前所选专业的研究方向（随专业联动，确保“方向与专业对应”）
const selectedMajorCategories = computed<string[]>(() => researchCategories.value[form.major] || [])
// 编辑回填期间暂停“切专业清空方向”，避免把历史值冲掉
const suppressCategoryReset = ref(false)
watch(() => form.major, (val) => {
  if (suppressCategoryReset.value) return
  const list = researchCategories.value[val] || []
  if (form.category && !list.includes(form.category)) form.category = ''
})

watch(maxStudentsForCurrentTopic, (limit) => {
  if (!isEdit || limit < 1 || form.maxStudents <= limit) return
  form.maxStudents = limit
})

const rules: FormRules = {
  title: [{ required: true, message: '请输入课题名称', trigger: 'blur' }],
  category: [{ required: true, message: '请选择研究方向', trigger: 'change' }],
  major: [{ required: true, message: '请选择专业', trigger: 'change' }],
  difficulty: [{ required: true, message: '请选择难度等级', trigger: 'change' }],
  description: [{ required: true, message: '请输入课题简介', trigger: 'blur' }],
  requirements: [{ required: true, message: '请填写具体要求', trigger: 'blur' }],
  maxStudents: [{ required: true, message: '请设置招收人数', trigger: 'change' }]
}

// 标签管理
const tagInputVisible = ref(false)
const tagInputValue = ref('')
const tagInputRef = ref<HTMLInputElement>()

function showTagInput() {
  tagInputVisible.value = true
  nextTick(() => tagInputRef.value?.focus())
}

function addTag() {
  const val = tagInputValue.value.trim()
  if (val && !form.tags.includes(val)) {
    form.tags.push(val)
  }
  tagInputVisible.value = false
  tagInputValue.value = ''
}

function removeTag(tag: string) {
  form.tags = form.tags.filter(t => t !== tag)
}

// 时间安排
function addSchedule() {
  form.schedules.push({ phase: '', dateRange: [], description: '' })
}

function removeSchedule(index: number) {
  form.schedules.splice(index, 1)
}

// 文件上传
const fileList = ref<UploadFile[]>([])
const attachments = ref<any[]>([])
const uploadingFiles = ref(false)

async function handleFileChange(file: UploadFile) {
  if (!file.raw) return
  
  // 检查文件大小（10MB）
  if (file.raw.size > 10 * 1024 * 1024) {
    ElMessage.warning(`${file.name} 文件过大，请选择小于10MB的文件`)
    return
  }
  
  uploadingFiles.value = true
  try {
    const res: any = await uploadApi.file(file.raw)
    if (res.data) {
      attachments.value.push({
        id: Date.now().toString(),
        name: res.data.originalName || file.name,
        url: res.data.url,
        size: res.data.size,
        type: res.data.mimetype,
        uploadedAt: new Date().toISOString()
      })
      ElMessage.success(`${file.name} 上传成功`)
    }
  } catch (e: any) {
    console.error('文件上传失败:', e)
    ElMessage.error(`${file.name} 上传失败`)
  } finally {
    uploadingFiles.value = false
  }
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1)
}

// 提交到后端
async function handleSubmit(action: 'submit' | 'draft') {
  if (locked.value) {
    return ElMessage.warning('已正式发布的选题已锁定，不能编辑或提交；如需修改请管理员先撤回')
  }
  if (action === 'submit') {
    const valid = await formRef.value?.validate().catch(() => false)
    if (!valid) return
  } else {
    // 草稿只验证必填字段
    const valid = await formRef.value?.validateField(['title', 'category']).then(() => true).catch(() => false)
    if (!valid) return
  }

  if (action === 'submit' && !cycleStore.currentCycle) {
    return ElMessage.warning('当前没有活跃的选题周期，请联系管理员创建周期后再提交课题')
  }
  if (quotaExhausted.value || remainingCapacityAfterSetting.value < 0) {
    return ElMessage.warning('本周期教师剩余名额不足，不能继续增加招生人数')
  }

  submitting.value = true

  try {
    // 构造时间安排 JSON
    const scheduleJson = form.schedules
      .filter(s => s.phase && s.dateRange?.length === 2)
      .map(s => ({
        phase: s.phase,
        startDate: s.dateRange[0],
        endDate: s.dateRange[1],
        description: s.description
      }))

    const m = majors.value.find(x => x.code === form.major)
    const payload: any = {
      title: form.title,
      category: form.category,
      major: m?.name || form.major,
      majorCode: m?.code || form.major,
      description: form.description,
      requirements: form.requirements,
      difficulty: form.difficulty,
      maxStudents: form.maxStudents,
      status: action === 'submit' ? 'pending' : 'draft',
      schedules: scheduleJson.length > 0 ? scheduleJson : undefined,
      attachments: attachments.value.length > 0 ? attachments.value : undefined,
      tags: form.tags.length > 0 ? form.tags : undefined,
      cycleId: cycleStore.currentCycle?.id
    }

    if (isEdit) {
      await topicApi.update(route.params.id as string, payload)
      ElMessage.success('课题更新成功')
    } else {
      await topicApi.create(payload)
      ElMessage.success(action === 'submit' ? '选题已提交至学院审核，等待管理员审核发布' : '已保存为草稿')
    }

    router.push('/teacher/topics')
  } catch (e: any) {
    console.error('提交课题失败:', e)
    ElMessage.error(e.message || e.response?.data?.message || '提交失败，请检查表单内容')
  } finally {
    submitting.value = false
  }
}

async function loadTeacherQuota() {
  try {
    const res: any = await topicApi.getTeacherQuota(isEdit ? route.params.id as string : undefined)
    teacherQuota.value = res?.data || null
    if (!isEdit && teacherQuota.value?.teacherLimit && maxStudentsForCurrentTopic.value >= 1) {
      form.maxStudents = Math.min(form.maxStudents, maxStudentsForCurrentTopic.value)
    }
  } catch (e) {
    teacherQuota.value = null
  }
}

// 编辑模式加载数据
onMounted(async () => {
  try {
    const cfgRes: any = await cycleConfigApi.get()
    cycleCfg.value = cfgRes?.data || null
  } catch {
    cycleCfg.value = null
  }
  if (isEdit && route.params.id) {
    loading.value = true
    try {
      const res: any = await topicApi.getDetail(route.params.id as string)
      const t = res.data
      if (t) {
        cycleCfg.value = {
          ...(cycleCfg.value || { majors: [], researchCategories: {} }),
          topicStudentLimit: Number(t.topicStudentLimit) || 10
        }
        suppressCategoryReset.value = true
        Object.assign(form, {
          title: t.title || '',
          category: t.category || '',
          major: t.majorCode || resolveTopicMajorCode(t) || '',
          difficulty: t.difficulty || 'medium',
          description: t.description || '',
          requirements: t.requirements || '',
          maxStudents: t.maxStudents || t.max_students || 2,
          tags: Array.isArray(t.tags) ? [...t.tags] : []
        })
        await nextTick()
        suppressCategoryReset.value = false
        locked.value = t.status === 'published'

        if (Array.isArray(t.schedules) && t.schedules.length > 0) {
          form.schedules = t.schedules.map((s: any) => ({
            phase: s.phase || '',
            dateRange: s.startDate && s.endDate ? [s.startDate, s.endDate] : [],
            description: s.description || ''
          }))
        }
        
        if (Array.isArray(t.attachments) && t.attachments.length > 0) {
          attachments.value = t.attachments.map((a: any) => ({
            id: a.id || Date.now().toString(),
            name: a.name || '',
            url: a.url || '',
            size: a.size || 0,
            type: a.type || '',
            uploadedAt: a.uploadedAt || new Date().toISOString()
          }))
        }
      }
    } catch (e) {
      console.error('加载课题详情失败:', e)
      ElMessage.error('加载课题数据失败')
    } finally {
      loading.value = false
    }
  }
  await loadTeacherQuota()
})
</script>

<style scoped>
.form-tip {
  font-size: 12px;
  color: #909399;
  margin-left: 8px;
  line-height: 1.4;
}

.quota-tip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: 6px 0 0;
}

.quota-over {
  color: #f56c6c;
}

.schedule-item {
  margin-bottom: 12px;
  padding: 12px;
  background: #fafafa;
  border-radius: 6px;
}

.tags-wrapper {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
}

.upload-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 8px;
}

.attachments-list {
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 8px 12px;
}

.attachment-item {
  display: flex;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
}

.attachment-item:last-child {
  border-bottom: none;
}

.attachment-name {
  flex: 1;
  color: #409eff;
}

.attachment-size {
  color: #909399;
  font-size: 12px;
  margin-right: 8px;
}
</style>
