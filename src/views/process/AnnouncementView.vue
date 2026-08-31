<template>
  <div class="process-page">
    <el-card shadow="never">
      <template #header>
        <div class="page-header">
          <span class="title">公告通知</span>
          <el-button v-if="canPublish" type="primary" @click="openDialog()">发布公告</el-button>
        </div>
      </template>

      <el-empty v-if="!list.length" description="暂无公告" />
      <div v-for="a in list" :key="a.id" class="announcement-item">
        <div class="ann-head">
          <span class="ann-title">{{ a.title }}</span>
          <el-tag v-if="a.status === 'draft'" type="info" size="small">草稿</el-tag>
          <el-tag size="small" effect="plain">{{ scopeLabel(a.scope) }}</el-tag>
          <span class="ann-meta">{{ a.authorName }} · {{ formatDate(a.createdAt) }}</span>
          <span v-if="canPublish && a.createdBy === userStore.currentUser?.id" class="ann-actions">
            <el-button link type="primary" @click="openDialog(a)">编辑</el-button>
            <el-button link type="danger" @click="remove(a)">删除</el-button>
          </span>
        </div>
        <div class="ann-content pre">{{ a.content }}</div>
      </div>

      <div class="pager" v-if="total > pageSize">
        <el-pagination
          layout="prev, pager, next"
          :total="total"
          :page-size="pageSize"
          v-model:current-page="page"
          @current-change="load"
        />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="form.id ? '编辑公告' : '发布公告'" width="640px">
      <el-form label-width="80px">
        <el-form-item label="标题">
          <el-input v-model="form.title" maxlength="100" placeholder="公告标题" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="6" placeholder="公告正文" />
        </el-form-item>
        <el-form-item label="范围">
          <el-radio-group v-model="form.scope">
            <el-radio-button label="all">全体</el-radio-button>
            <el-radio-button label="student">学生</el-radio-button>
            <el-radio-button label="teacher">教师</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio-button label="published">发布</el-radio-button>
            <el-radio-button label="draft">存草稿</el-radio-button>
          </el-radio-group>
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
import { announcementApi } from '../../api'

const userStore = useUserStore()
const canPublish = computed(() => userStore.userRole === 'admin' || userStore.userRole === 'teacher')

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 10
const saving = ref(false)
const dialogVisible = ref(false)

const form = reactive<{ id: string; title: string; content: string; scope: string; status: string }>({
  id: '',
  title: '',
  content: '',
  scope: 'all',
  status: 'published'
})

function scopeLabel(s: string) {
  return ({ all: '全体', student: '学生', teacher: '教师' } as Record<string, string>)[s] || s
}
function formatDate(d: string) {
  if (!d) return ''
  return String(d).replace('T', ' ').slice(0, 16)
}

async function load() {
  try {
    const res: any = await announcementApi.getList({ page: page.value, pageSize })
    const data = res.data || {}
    list.value = data.list || []
    total.value = data.pagination?.total || 0
  } catch (e) {
    // 拦截器已提示
  }
}

function openDialog(row?: any) {
  if (row) {
    form.id = row.id
    form.title = row.title
    form.content = row.content
    form.scope = row.scope
    form.status = row.status
  } else {
    form.id = ''
    form.title = ''
    form.content = ''
    form.scope = 'all'
    form.status = 'published'
  }
  dialogVisible.value = true
}

async function save() {
  if (!form.title) return ElMessage.warning('请填写标题')
  if (!form.content) return ElMessage.warning('请填写内容')
  saving.value = true
  try {
    const body = { title: form.title, content: form.content, scope: form.scope, status: form.status }
    if (form.id) await announcementApi.update(form.id, body)
    else await announcementApi.create(body)
    ElMessage.success('已保存')
    dialogVisible.value = false
    await load()
  } catch (e) {
    // 拦截器已提示
  } finally {
    saving.value = false
  }
}

async function remove(a: any) {
  await ElMessageBox.confirm('确认删除该公告？', '提示', { type: 'warning' })
  try {
    await announcementApi.remove(a.id)
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
.announcement-item {
  padding: 16px 0;
  border-bottom: 1px solid #ebeef5;
}
.announcement-item:last-child {
  border-bottom: none;
}
.ann-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ann-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.ann-meta {
  color: #909399;
  font-size: 12px;
  margin-left: auto;
}
.ann-actions {
  display: inline-flex;
  gap: 4px;
}
.ann-content {
  color: #606266;
  font-size: 14px;
  line-height: 1.7;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
.pre {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
