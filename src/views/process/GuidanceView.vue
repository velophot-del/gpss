<template>
  <div class="process-page">
    <el-card shadow="never">
      <template #header>
        <div class="page-header">
          <span class="title">指导记录</span>
          <el-button v-if="isTeacher" type="primary" @click="openDialog()">新增指导记录</el-button>
        </div>
      </template>

      <el-table :data="list" v-loading="loading" border>
        <el-table-column label="日期" width="130">
          <template #default="{ row }">{{ formatDate(row.recordDate) }}</template>
        </el-table-column>
        <el-table-column v-if="isTeacher" label="学生" min-width="130">
          <template #default="{ row }">{{ row.studentName }}（{{ row.studentCode }}）</template>
        </el-table-column>
        <el-table-column v-if="!isTeacher" label="导师" width="110" prop="teacherName" />
        <el-table-column prop="topicTitle" label="选题" min-width="180" show-overflow-tooltip />
        <el-table-column prop="content" label="指导内容" min-width="220" show-overflow-tooltip />
        <el-table-column prop="nextAction" label="下一步计划" min-width="180" show-overflow-tooltip />
        <el-table-column label="附件" width="90">
          <template #default="{ row }">
            <span v-if="row.fileUrls?.length">{{ row.fileUrls.length }} 个</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column v-if="isTeacher" label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="新增指导记录" width="620px">
      <el-form label-width="90px">
        <el-form-item label="学生" v-if="isTeacher">
          <el-select v-model="form.studentId" filterable placeholder="选择学生">
            <el-option v-for="s in studentOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="指导日期">
          <el-date-picker v-model="form.recordDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="指导内容">
          <el-input v-model="form.content" type="textarea" :rows="4" placeholder="本次指导的主要内容、学生进展与问题" />
        </el-form-item>
        <el-form-item label="下一步计划">
          <el-input v-model="form.nextAction" type="textarea" :rows="2" placeholder="布置下一步任务 / 计划" />
        </el-form-item>
        <el-form-item label="附件">
          <FileUploadList v-model="form.fileUrls" category="general" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" tip="支持 PDF / Word / 图片" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '../../stores/user'
import { guidanceApi, applicationApi } from '../../api'
import FileUploadList from '../../components/FileUploadList.vue'
import type { FileItem } from '../../types'

const userStore = useUserStore()
const isTeacher = computed(() => userStore.userRole === 'teacher' || userStore.userRole === 'admin')

const loading = ref(false)
const saving = ref(false)
const list = ref<any[]>([])
const studentOptions = ref<{ value: string; label: string }[]>([])
const dialogVisible = ref(false)

const form = reactive<{ studentId: string; recordDate: string; content: string; nextAction: string; fileUrls: FileItem[] }>({
  studentId: '',
  recordDate: '',
  content: '',
  nextAction: '',
  fileUrls: []
})

function formatDate(d: string) {
  if (!d) return '—'
  return String(d).slice(0, 10)
}

async function load() {
  loading.value = true
  try {
    const res: any = await guidanceApi.getList()
    list.value = res.data || []
  } catch (e) {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}

async function loadStudents() {
  try {
    const res: any = await applicationApi.getList()
    const apps = res.data || []
    const seen = new Set<string>()
    const opts: { value: string; label: string }[] = []
    for (const a of apps) {
      if (a.status !== 'accepted' || seen.has(a.studentId)) continue
      seen.add(a.studentId)
      opts.push({ value: a.studentId, label: `${a.studentName}（${a.topicTitle}）` })
    }
    studentOptions.value = opts
  } catch (e) {
    // 拦截器已提示
  }
}

function openDialog() {
  form.studentId = ''
  form.recordDate = ''
  form.content = ''
  form.nextAction = ''
  form.fileUrls = []
  if (isTeacher.value) loadStudents()
  dialogVisible.value = true
}

async function save() {
  if (isTeacher.value && !form.studentId) return ElMessage.warning('请选择学生')
  if (!form.content) return ElMessage.warning('请填写指导内容')
  saving.value = true
  try {
    const body: any = {
      recordDate: form.recordDate || undefined,
      content: form.content,
      nextAction: form.nextAction,
      fileUrls: form.fileUrls
    }
    if (isTeacher.value) body.studentId = form.studentId
    await guidanceApi.create(body)
    ElMessage.success('指导记录已保存')
    dialogVisible.value = false
    await load()
  } catch (e) {
    // 拦截器已提示
  } finally {
    saving.value = false
  }
}

async function remove(row: any) {
  await ElMessageBox.confirm('确认删除该指导记录？', '提示', { type: 'warning' })
  try {
    await guidanceApi.remove(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    // 拦截器已提示
  }
}

onMounted(load)
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page-header .title {
  font-size: 16px;
  font-weight: 600;
}
</style>
