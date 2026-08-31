<template>
  <div class="process-page">
    <!-- 管理员：分组管理 + 评分总览 -->
    <template v-if="isAdmin">
      <el-card shadow="never">
        <el-tabs v-model="tab">
          <el-tab-pane label="答辩分组" name="groups">
            <div class="tab-toolbar">
              <el-button type="primary" @click="openGroupDialog()">新建分组</el-button>
            </div>
            <el-table :data="groups" v-loading="loading" border>
              <el-table-column prop="name" label="分组名称" min-width="150" />
              <el-table-column label="答辩时间" width="170">
                <template #default="{ row }">{{ formatDate(row.defenseDate) }}</template>
              </el-table-column>
              <el-table-column prop="location" label="地点" min-width="120" show-overflow-tooltip />
              <el-table-column label="评委" min-width="150">
                <template #default="{ row }">{{ (row.judges || []).map((j: any) => j.real_name).join('、') }}</template>
              </el-table-column>
              <el-table-column label="学生数" width="80">
                <template #default="{ row }">{{ (row.students || []).length }}</template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'finished' ? 'success' : 'warning'" size="small">{{ row.status === 'finished' ? '已完成' : '待答辩' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="160" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openGroupDialog(row)">编辑</el-button>
                  <el-button link type="danger" @click="removeGroup(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="评分总览" name="scores">
            <el-table :data="allScores" v-loading="loading" border>
              <el-table-column prop="studentName" label="学生" min-width="120" />
              <el-table-column prop="studentCode" label="学号" width="110" />
              <el-table-column prop="groupName" label="分组" min-width="130" />
              <el-table-column prop="judgeName" label="评委" width="100" />
              <el-table-column prop="score" label="分数" width="80" />
              <el-table-column prop="comment" label="评语" min-width="180" show-overflow-tooltip />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </template>

    <!-- 教师（评委）：给分组学生打分 -->
    <template v-else-if="isTeacher">
      <el-card shadow="never">
        <template #header>
          <div class="page-header"><span class="title">答辩评分</span></div>
        </template>

        <el-empty v-if="!groups.length" description="您尚未被分配为任何答辩分组的评委" />
        <template v-else>
          <div class="group-tabs">
            <el-radio-group v-model="selectedGroupId" @change="loadScores">
              <el-radio-button v-for="g in groups" :key="g.id" :label="g.id">{{ g.name }}</el-radio-button>
            </el-radio-group>
          </div>

          <el-table :data="currentGroupStudents" border class="mt12">
            <el-table-column label="学生" min-width="130">
              <template #default="{ row }">{{ row.real_name }}（{{ row.student_id }}）</template>
            </el-table-column>
            <el-table-column label="专业 / 班级" min-width="150">
              <template #default="{ row }">{{ row.major }} / {{ row.class_name }}</template>
            </el-table-column>
            <el-table-column label="评分" width="160">
              <template #default="{ row }">
                <el-input-number v-model="scoreMap[row.id].score" :min="0" :max="100" size="small" />
              </template>
            </el-table-column>
            <el-table-column label="评语" min-width="180">
              <template #default="{ row }">
                <el-input v-model="scoreMap[row.id].comment" size="small" placeholder="评语" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" :loading="savingId === row.id" @click="submit(row)">保存</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </el-card>
    </template>

    <!-- 学生：查看自己的分组与成绩 -->
    <template v-else>
      <el-card shadow="never">
        <template #header>
          <div class="page-header"><span class="title">我的答辩</span></div>
        </template>
        <el-empty v-if="!groups.length" description="您尚未被安排答辩" />
        <el-descriptions v-for="g in groups" :key="g.id" :column="1" border class="mb12">
          <el-descriptions-item label="分组">{{ g.name }}</el-descriptions-item>
          <el-descriptions-item label="时间">{{ formatDate(g.defenseDate) }}</el-descriptions-item>
          <el-descriptions-item label="地点">{{ g.location || '—' }}</el-descriptions-item>
          <el-descriptions-item label="评委">{{ (g.judges || []).map((j: any) => j.real_name).join('、') }}</el-descriptions-item>
        </el-descriptions>

        <el-table v-if="myScores.length" :data="myScores" border>
          <el-table-column prop="judgeName" label="评委" width="120" />
          <el-table-column prop="score" label="分数" width="100" />
          <el-table-column prop="comment" label="评语" min-width="200" show-overflow-tooltip />
        </el-table>
      </el-card>
    </template>

    <!-- 分组编辑对话框（管理员） -->
    <el-dialog v-model="groupDialogVisible" :title="groupForm.id ? '编辑分组' : '新建分组'" width="640px">
      <el-form label-width="90px">
        <el-form-item label="分组名称">
          <el-input v-model="groupForm.name" maxlength="100" placeholder="如：第一答辩组" />
        </el-form-item>
        <el-form-item label="答辩时间">
          <el-date-picker v-model="groupForm.defenseDate" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="选择时间" style="width: 100%" />
        </el-form-item>
        <el-form-item label="地点">
          <el-input v-model="groupForm.location" maxlength="100" placeholder="答辩地点" />
        </el-form-item>
        <el-form-item label="评委">
          <el-select v-model="groupForm.judges" multiple filterable placeholder="选择评委（教师）" style="width: 100%">
            <el-option v-for="t in teachers" :key="t.id" :label="t.real_name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="学生">
          <el-select v-model="groupForm.students" multiple filterable placeholder="选择学生" style="width: 100%">
            <el-option v-for="s in students" :key="s.id" :label="`${s.real_name}（${s.student_id}）`" :value="s.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="groupDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingGroup" @click="saveGroup">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '../../stores/user'
import { defenseApi, adminApi } from '../../api'

const userStore = useUserStore()
const isAdmin = computed(() => userStore.userRole === 'admin')
const isTeacher = computed(() => userStore.userRole === 'teacher')

const loading = ref(false)
const tab = ref('groups')
const groups = ref<any[]>([])
const allScores = ref<any[]>([])
const myScores = ref<any[]>([])
const teachers = ref<any[]>([])
const students = ref<any[]>([])

// 教师打分相关
const selectedGroupId = ref('')
const scoreMap = reactive<Record<string, { score: number | null; comment: string }>>({})
const savingId = ref('')

// 分组编辑
const groupDialogVisible = ref(false)
const savingGroup = ref(false)
const groupForm = reactive<{ id: string; name: string; defenseDate: string; location: string; judges: string[]; students: string[] }>({
  id: '', name: '', defenseDate: '', location: '', judges: [], students: []
})

const currentGroup = computed(() => groups.value.find(g => g.id === selectedGroupId.value) || groups.value[0])
const currentGroupStudents = computed(() => currentGroup.value?.students || [])

function formatDate(d: string) {
  if (!d) return '—'
  return String(d).replace('T', ' ').slice(0, 16)
}

async function loadGroups() {
  loading.value = true
  try {
    const res: any = await defenseApi.getGroups()
    groups.value = res.data || []
    if (groups.value.length && !selectedGroupId.value) selectedGroupId.value = groups.value[0].id
    // 初始化打分 map
    for (const g of groups.value) {
      for (const s of (g.students || [])) {
        if (!scoreMap[s.id]) scoreMap[s.id] = { score: null, comment: '' }
      }
    }
    await loadScores()
  } catch (e) {
    // 拦截器已提示
  } finally {
    loading.value = false
  }
}

async function loadScores() {
  const gid = currentGroup.value?.id
  if (isTeacher.value) {
    if (!gid) return
    try {
      const res: any = await defenseApi.getScores({ groupId: gid })
      const rows = res.data || []
      for (const s of currentGroupStudents.value) {
        const mine = rows.find((r: any) => r.student_id === s.id && r.judge_id === userStore.currentUser?.id)
        scoreMap[s.id] = { score: mine?.score ?? null, comment: mine?.comment ?? '' }
      }
    } catch (e) {
      // 拦截器已提示
    }
  } else if (isAdmin.value) {
    try {
      const res: any = await defenseApi.getScores()
      allScores.value = res.data || []
    } catch (e) {
      // 拦截器已提示
    }
  } else {
    // 学生
    try {
      const res: any = await defenseApi.getScores()
      myScores.value = res.data || []
    } catch (e) {
      // 拦截器已提示
    }
  }
}

async function loadRefs() {
  try {
    const [t, s] = await Promise.all([adminApi.getTeachers(), adminApi.getStudents()])
    teachers.value = t.data || []
    students.value = s.data || []
  } catch (e) {
    // 拦截器已提示
  }
}

function openGroupDialog(row?: any) {
  if (row) {
    groupForm.id = row.id
    groupForm.name = row.name
    groupForm.defenseDate = row.defenseDate || ''
    groupForm.location = row.location || ''
    groupForm.judges = (row.judges || []).map((j: any) => j.id)
    groupForm.students = (row.students || []).map((s: any) => s.id)
  } else {
    groupForm.id = ''
    groupForm.name = ''
    groupForm.defenseDate = ''
    groupForm.location = ''
    groupForm.judges = []
    groupForm.students = []
  }
  groupDialogVisible.value = true
}

async function saveGroup() {
  if (!groupForm.name) return ElMessage.warning('请填写分组名称')
  if (!groupForm.judges.length) return ElMessage.warning('请选择评委')
  savingGroup.value = true
  try {
    const body = {
      name: groupForm.name,
      defenseDate: groupForm.defenseDate,
      location: groupForm.location,
      judges: groupForm.judges,
      students: groupForm.students
    }
    if (groupForm.id) await defenseApi.updateGroup(groupForm.id, body)
    else await defenseApi.createGroup(body)
    ElMessage.success('已保存')
    groupDialogVisible.value = false
    await loadGroups()
  } catch (e) {
    // 拦截器已提示
  } finally {
    savingGroup.value = false
  }
}

async function removeGroup(row: any) {
  await ElMessageBox.confirm('确认删除该分组？', '提示', { type: 'warning' })
  try {
    await defenseApi.deleteGroup(row.id)
    ElMessage.success('已删除')
    await loadGroups()
  } catch (e) {
    // 拦截器已提示
  }
}

async function submit(row: any) {
  const s = scoreMap[row.id]
  if (s.score == null) return ElMessage.warning('请填写分数')
  savingId.value = row.id
  try {
    await defenseApi.submitScore({
      groupId: currentGroup.value.id,
      studentId: row.id,
      score: s.score,
      comment: s.comment
    })
    ElMessage.success('评分已保存')
  } catch (e) {
    // 拦截器已提示
  } finally {
    savingId.value = ''
  }
}

onMounted(async () => {
  await loadGroups()
  if (isAdmin.value) loadRefs()
})
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
.tab-toolbar {
  margin-bottom: 12px;
}
.group-tabs {
  margin-bottom: 8px;
}
.mt12 {
  margin-top: 12px;
}
.mb12 {
  margin-bottom: 12px;
}
</style>
