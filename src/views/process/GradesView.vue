<template>
  <div class="process-page">
    <!-- 学生：查看本人成绩 -->
    <template v-if="isStudent">
      <el-card shadow="never">
        <template #header>
          <div class="page-header"><span class="title">我的成绩</span></div>
        </template>
        <el-empty v-if="!list.length" description="成绩尚未发布" />
        <div v-for="g in list" :key="g.id" class="grade-card">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="选题">{{ g.topicTitle || '—' }}</el-descriptions-item>
            <el-descriptions-item label="导师">{{ g.teacherName || '—' }}</el-descriptions-item>
            <el-descriptions-item label="导师评分">{{ g.supervisorScore ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="评阅评分">{{ g.reviewScore ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="答辩评分">{{ g.defenseScore ?? g.defenseAvg ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="g.status === 'published' ? 'success' : 'info'" size="small">{{ g.status === 'published' ? '已发布' : '待发布' }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="总评成绩">
              <span v-if="g.totalScore != null" class="total-score">{{ g.totalScore }}</span>
              <span v-else>—</span>
            </el-descriptions-item>
            <el-descriptions-item label="等级">{{ g.gradeLevel || '—' }}</el-descriptions-item>
          </el-descriptions>
        </div>
      </el-card>
    </template>

    <!-- 教师 / 管理员：录入与发布 -->
    <template v-else>
      <el-card shadow="never">
        <template #header>
          <div class="page-header">
            <span class="title">成绩评定</span>
            <el-button type="primary" @click="openDialog()">录入 / 编辑成绩</el-button>
          </div>
        </template>

        <el-table :data="list" v-loading="loading" border>
          <el-table-column label="学生" min-width="130">
            <template #default="{ row }">{{ row.studentName }}（{{ row.studentCode }}）</template>
          </el-table-column>
          <el-table-column label="专业 / 班级" min-width="150">
            <template #default="{ row }">{{ row.major }} / {{ row.className }}</template>
          </el-table-column>
          <el-table-column prop="topicTitle" label="选题" min-width="180" show-overflow-tooltip />
          <el-table-column label="导师" width="90">
            <template #default="{ row }">{{ row.supervisorScore ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="评阅" width="90">
            <template #default="{ row }">{{ row.reviewScore ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="答辩" width="90">
            <template #default="{ row }">{{ row.defenseScore ?? row.defenseAvg ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="总分" width="90">
            <template #default="{ row }">
              <b v-if="row.totalScore != null">{{ row.totalScore }}</b><span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column label="等级" width="80" prop="gradeLevel" />
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'published' ? 'success' : 'info'" size="small">{{ row.status === 'published' ? '已发布' : '待发布' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDialog(row)">编辑</el-button>
              <el-button v-if="isAdmin" link type="success" @click="publish(row)">发布</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>

    <!-- 录入/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="form.studentId ? '编辑成绩' : '录入成绩'" width="560px">
      <el-form label-width="100px">
        <el-form-item label="学生" v-if="!form.studentId">
          <el-select v-model="form.studentId" filterable placeholder="选择学生" style="width: 100%">
            <el-option v-for="s in studentOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-else label="学生">
          <el-input :model-value="form.studentName" disabled />
        </el-form-item>
        <el-form-item label="导师评分">
          <el-input-number v-model="form.supervisorScore" :min="0" :max="100" :precision="1" />
        </el-form-item>
        <el-form-item label="评阅评分">
          <el-input-number v-model="form.reviewScore" :min="0" :max="100" :precision="1" />
        </el-form-item>
        <el-form-item label="答辩评分">
          <el-input-number v-model="form.defenseScore" :min="0" :max="100" :precision="1" />
        </el-form-item>
        <el-form-item label="发布">
          <el-switch v-model="form.publish" active-text="立即发布" />
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
import { ElMessage } from 'element-plus'
import { useUserStore } from '../../stores/user'
import { gradeApi, applicationApi, adminApi } from '../../api'

const userStore = useUserStore()
const isAdmin = computed(() => userStore.userRole === 'admin')
const isStudent = computed(() => userStore.userRole === 'student')

const loading = ref(false)
const saving = ref(false)
const list = ref<any[]>([])
const studentOptions = ref<{ value: string; label: string }[]>([])
const dialogVisible = ref(false)

const form = reactive<{
  studentId: string; studentName: string;
  supervisorScore: number | null; reviewScore: number | null; defenseScore: number | null; publish: boolean
}>({
  studentId: '', studentName: '', supervisorScore: null, reviewScore: null, defenseScore: null, publish: false
})

async function load() {
  loading.value = true
  try {
    const res: any = await gradeApi.getList()
    list.value = res.data || []
  } catch (e) {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}

async function loadStudents() {
  try {
    let opts: { value: string; label: string }[] = []
    if (isAdmin.value) {
      const res: any = await adminApi.getStudents()
      opts = (res.data || []).map((s: any) => ({ value: s.id, label: `${s.real_name}（${s.student_id}）` }))
    } else {
      const res: any = await applicationApi.getList()
      const apps = res.data || []
      const seen = new Set<string>()
      for (const a of apps) {
        if (a.status !== 'accepted' || seen.has(a.studentId)) continue
        seen.add(a.studentId)
        opts.push({ value: a.studentId, label: `${a.studentName}（${a.topicTitle}）` })
      }
    }
    studentOptions.value = opts
  } catch (e) {
    // 拦截器已提示
  }
}

function openDialog(row?: any) {
  if (row) {
    form.studentId = row.studentId
    form.studentName = row.studentName || ''
    form.supervisorScore = row.supervisorScore ?? null
    form.reviewScore = row.reviewScore ?? null
    form.defenseScore = row.defenseScore ?? null
    form.publish = row.status === 'published'
  } else {
    form.studentId = ''
    form.studentName = ''
    form.supervisorScore = null
    form.reviewScore = null
    form.defenseScore = null
    form.publish = false
    loadStudents()
  }
  dialogVisible.value = true
}

async function save() {
  if (!form.studentId) return ElMessage.warning('请选择学生')
  saving.value = true
  try {
    await gradeApi.create({
      studentId: form.studentId,
      supervisorScore: form.supervisorScore,
      reviewScore: form.reviewScore,
      defenseScore: form.defenseScore,
      publish: form.publish
    })
    ElMessage.success('成绩已保存')
    dialogVisible.value = false
    await load()
  } catch (e) {
    // 拦截器已提示
  } finally {
    saving.value = false
  }
}

async function publish(row: any) {
  try {
    await gradeApi.publish(row.id)
    ElMessage.success('成绩已发布')
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
.grade-card {
  max-width: 720px;
}
.total-score {
  font-size: 20px;
  font-weight: 700;
  color: #409eff;
}
</style>
