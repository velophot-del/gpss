<template>
  <div class="process-page">
    <el-card shadow="never">
      <template #header>
        <div class="page-header">
          <span class="title">任务书</span>
          <el-button v-if="isTeacher" type="primary" @click="openDialog()">下达 / 编辑任务书</el-button>
        </div>
      </template>

      <!-- 学生视图：自己的任务书卡片 -->
      <template v-if="!isTeacher">
        <el-empty v-if="!list.length" description="导师尚未下达任务书" />
        <el-card v-for="tb in list" :key="tb.id" shadow="never" class="tb-card">
          <div class="tb-title">{{ tb.title }}</div>
          <el-tag :type="tb.status === 'issued' ? 'success' : 'info'" size="small">{{ tb.status === 'issued' ? '已下达' : '草稿' }}</el-tag>
          <el-descriptions :column="1" border size="small" class="mt12">
            <el-descriptions-item label="选题">{{ tb.topicTitle }}</el-descriptions-item>
            <el-descriptions-item label="导师">{{ tb.teacherName }}</el-descriptions-item>
            <el-descriptions-item label="任务内容"><div class="pre">{{ tb.content || '—' }}</div></el-descriptions-item>
            <el-descriptions-item label="成果要求"><div class="pre">{{ tb.requirements || '—' }}</div></el-descriptions-item>
            <el-descriptions-item label="进度安排"><div class="pre">{{ tb.schedule || '—' }}</div></el-descriptions-item>
            <el-descriptions-item label="附件">
              <div v-if="tb.fileUrls?.length">
                <a v-for="(f, i) in tb.fileUrls" :key="i" :href="f.url" target="_blank" class="mr8">{{ f.name }}</a>
              </div>
              <span v-else>无</span>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </template>

      <!-- 教师视图：已下达列表 -->
      <el-table v-else :data="list" v-loading="loading" border>
        <el-table-column label="学生" min-width="130">
          <template #default="{ row }">{{ row.studentName }}（{{ row.studentCode }}）</template>
        </el-table-column>
        <el-table-column prop="topicTitle" label="选题" min-width="200" show-overflow-tooltip />
        <el-table-column prop="title" label="任务书标题" min-width="200" show-overflow-tooltip />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'issued' ? 'success' : 'info'" size="small">{{ row.status === 'issued' ? '已下达' : '草稿' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDialog(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 下达/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑任务书' : '下达任务书'" width="640px">
      <el-form label-width="90px">
        <el-form-item label="学生" v-if="!form.id">
          <el-select v-model="form.studentId" filterable placeholder="选择学生">
            <el-option v-for="s in studentOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="任务书标题" maxlength="200" />
        </el-form-item>
        <el-form-item label="任务内容">
          <el-input v-model="form.content" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="成果要求">
          <el-input v-model="form.requirements" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="进度安排">
          <el-input v-model="form.schedule" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="附件">
          <FileUploadList v-model="form.fileUrls" category="task_book" accept=".pdf,.doc,.docx" tip="支持 PDF / Word，单个不超过 20MB" />
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
import { taskBookApi, applicationApi } from '../../api'
import FileUploadList from '../../components/FileUploadList.vue'
import type { FileItem } from '../../types'

const userStore = useUserStore()
const isTeacher = computed(() => userStore.userRole === 'teacher' || userStore.userRole === 'admin')

const loading = ref(false)
const saving = ref(false)
const list = ref<any[]>([])
const studentOptions = ref<{ value: string; label: string }[]>([])
const dialogVisible = ref(false)

const form = reactive<{ id: string; studentId: string; title: string; content: string; requirements: string; schedule: string; fileUrls: FileItem[] }>({
  id: '',
  studentId: '',
  title: '',
  content: '',
  requirements: '',
  schedule: '',
  fileUrls: []
})

async function load() {
  loading.value = true
  try {
    const res: any = await taskBookApi.getList()
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

function openDialog(row?: any) {
  if (row) {
    form.id = row.id
    form.studentId = row.studentId
    form.title = row.title
    form.content = row.content || ''
    form.requirements = row.requirements || ''
    form.schedule = row.schedule || ''
    form.fileUrls = row.fileUrls || []
  } else {
    form.id = ''
    form.studentId = ''
    form.title = ''
    form.content = ''
    form.requirements = ''
    form.schedule = ''
    form.fileUrls = []
  }
  if (isTeacher.value) loadStudents()
  dialogVisible.value = true
}

async function save() {
  if (!form.id && !form.studentId) return ElMessage.warning('请选择学生')
  if (!form.title) return ElMessage.warning('请填写任务书标题')
  saving.value = true
  try {
    await taskBookApi.create({
      studentId: form.studentId,
      title: form.title,
      content: form.content,
      requirements: form.requirements,
      schedule: form.schedule,
      fileUrls: form.fileUrls,
      status: 'issued'
    })
    ElMessage.success('任务书已保存')
    dialogVisible.value = false
    await load()
  } catch (e) {
    // 拦截器已提示
  } finally {
    saving.value = false
  }
}

async function remove(row: any) {
  await ElMessageBox.confirm('确认删除该任务书？', '提示', { type: 'warning' })
  try {
    await taskBookApi.remove(row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    // 拦截器已提示
  }
}

onMounted(() => { load(); if (isTeacher.value) loadStudents() })
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
.tb-card {
  margin-bottom: 12px;
}
.tb-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 8px;
}
.mt12 {
  margin-top: 12px;
}
.mr8 {
  margin-right: 8px;
}
.pre {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
