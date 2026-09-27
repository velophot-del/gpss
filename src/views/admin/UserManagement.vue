<template>
  <div class="user-management page-container">
    <div class="card-container">
      <div class="header-row">
        <h2 class="section-title" style="border: none; padding: 0;">用户管理</h2>
        <div class="header-actions">
          <el-button
            v-if="isSuperAdmin && selectedRows.length > 0"
            type="danger"
            icon="Delete"
            @click="handleBatchDelete"
            :loading="batchDeleting"
          >
            批量删除（{{ selectedRows.length }}）
          </el-button>
          <el-button type="success" icon="Upload" @click="showImportDialog = true" v-if="isSuperAdmin">批量导入</el-button>
          <el-button type="warning" icon="Download" @click="exportUsers">导出数据</el-button>
          <el-button type="primary" icon="Plus" @click="openCreateDialog" v-if="isSuperAdmin">新增用户</el-button>
        </div>
      </div>

      <!-- 筛选栏 -->
      <div class="filter-bar">
        <el-input v-model="searchText" placeholder="搜索用户名/姓名/学号/邮箱" prefix-icon="Search" clearable style="width: 280px;" @input="handleSearch" />
        <el-select v-model="roleFilter" placeholder="角色筛选" clearable style="width: 130px;" @change="handleFilterChange">
          <el-option label="管理员" value="admin" />
          <el-option label="教师" value="teacher" />
          <el-option label="学生" value="student" />
        </el-select>
        <el-select v-model="classFilter" placeholder="班级筛选" clearable filterable style="width: 180px;" @change="handleFilterChange">
          <el-option v-for="className in classOptions" :key="className" :label="className" :value="className" />
        </el-select>
        <el-select v-model="majorFilter" placeholder="专业筛选" clearable filterable style="width: 180px;" @change="handleFilterChange">
          <el-option v-for="major in majorOptions" :key="major" :label="major" :value="major" />
        </el-select>
      </div>

      <!-- 用户表格 -->
      <el-table
        :data="users"
        stripe
        v-loading="loading"
        @sort-change="handleSortChange"
        @selection-change="handleSelectionChange"
        :selectable="checkSelectable"
        class="user-table"
      >
        <el-table-column v-if="isSuperAdmin" type="selection" width="45" />
        <el-table-column prop="username" label="用户名" width="110" sortable />
        <el-table-column prop="realName" label="真实姓名" width="100" sortable />
        <el-table-column prop="role" label="角色" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="roleTypeMap[row.role]" size="small">{{ roleLabel[row.role] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="studentId" label="学号" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.studentId || '-' }}</template>
        </el-table-column>
        <el-table-column label="专业" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.major || '-' }}
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
        <el-table-column prop="status" label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">{{ statusLabel[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="注册时间" width="110" sortable>
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" v-if="isSuperAdmin" width="260" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" icon="Edit" size="small" @click="openEditDialog(row)">编辑</el-button>
            <el-button link type="warning" icon="Key" size="small" @click="openResetPwDialog(row)">重置密码</el-button>
            <el-button
              v-if="row.id !== userStore.currentUser?.id"
              link :type="row.status === 'active' ? 'warning' : 'success'"
              size="small"
              @click="toggleStatus(row)"
            >{{ row.status === 'active' ? '禁用' : '启用' }}</el-button>
            <el-popconfirm
              v-if="row.id !== userStore.currentUser?.id"
              title="确定删除该用户？关联数据也将被清除！"
              confirm-button-text="确定删除"
              cancel-button-text="取消"
              confirm-button-type="danger"
              @confirm="handleDelete(row)"
            >
              <template #reference>
                <el-button link type="danger" icon="Delete" size="small">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @size-change="fetchUsers"
          @current-change="fetchUsers"
        />
      </div>

      <!-- 统计信息 -->
      <div class="stats-bar">
        共 {{ total }} 个用户
        <el-divider direction="vertical" />
        管理员: {{ roleCount.admin }}
        <el-divider direction="vertical" />
        教师: {{ roleCount.teacher }}
        <el-divider direction="vertical" />
        学生: {{ roleCount.student }}
      </div>
    </div>

    <!-- 新增/编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? '编辑用户' : '新增用户'"
      width="560px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form ref="formRef" :model="formData" :rules="formRules" label-width="90px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="formData.username" placeholder="用于登录的用户名" :disabled="isEditing" />
        </el-form-item>

        <el-form-item label="密码" prop="password" v-if="!isEditing">
          <el-input v-model="formData.password" type="password" show-password placeholder="至少6位" />
        </el-form-item>

        <el-form-item label="真实姓名" prop="realName">
          <el-input v-model="formData.realName" placeholder="请输入真实姓名" />
        </el-form-item>

        <el-form-item label="角色" prop="role">
          <el-radio-group v-model="formData.role" :disabled="isEditing && editingUsername === 'admin'" @change="onRoleChange">
            <el-radio value="admin">管理员</el-radio>
            <el-radio value="teacher">教师</el-radio>
            <el-radio value="student">学生</el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="邮箱" prop="email">
          <el-input v-model="formData.email" placeholder="选填" />
        </el-form-item>

        <!-- 教师字段 -->
        <template v-if="formData.role === 'teacher'">
          <el-form-item label="职称">
            <el-select v-model="formData.title" placeholder="选择职称" clearable>
              <el-option label="教授" value="教授" />
              <el-option label="副教授" value="副教授" />
              <el-option label="讲师" value="讲师" />
            </el-select>
          </el-form-item>
          <el-form-item label="所属院系">
            <el-select v-model="formData.department" placeholder="选择院系" clearable>
              <el-option label="视觉传达设计系" value="视觉传达设计系" />
              <el-option label="数字媒体艺术系" value="数字媒体艺术系" />
              <el-option label="包装工程系" value="包装工程系" />
              <el-option label="智能交互设计系" value="智能交互设计系" />
            </el-select>
          </el-form-item>
        </template>

        <!-- 学生字段 -->
        <template v-if="formData.role === 'student'">
          <el-form-item label="学号">
            <el-input v-model="formData.studentId" placeholder="学号" />
          </el-form-item>
          <el-form-item label="班级">
            <el-input v-model="formData.className" placeholder="班级" />
          </el-form-item>
          <el-form-item label="专业">
            <el-select v-model="formData.major" placeholder="选择或输入专业" style="width: 100%;" filterable allow-create>
              <el-option v-for="opt in majorChoices" :key="`n-${opt.code}`" :label="opt.name" :value="opt.name" />
            </el-select>
          </el-form-item>
          <el-form-item label="专业代码">
            <el-select v-model="formData.majorCode" placeholder="选择或输入专业代码" style="width: 100%;" filterable allow-create>
              <el-option v-for="opt in majorChoices" :key="`c-${opt.code}`" :label="`${opt.code} - ${opt.name}`" :value="opt.code" />
            </el-select>
          </el-form-item>
          <el-form-item label="届别">
            <el-input v-model="formData.grade" placeholder="如 2025届" />
          </el-form-item>
          <el-form-item label="学分绩点">
            <el-input-number v-model="formData.gpa" :min="0" :max="5" :step="0.01" :precision="2" controls-position="right" placeholder="如 3.65" style="width: 100%;" />
          </el-form-item>
        </template>

        <el-form-item label="手机号">
          <el-input v-model="formData.phone" placeholder="选填" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ isEditing ? '保存' : '创建' }}</el-button>
      </template>
    </el-dialog>

    <!-- 批量导入对话框 -->
    <el-dialog v-model="showImportDialog" title="批量导入用户" width="560px" :close-on-click-modal="false">
      <div class="import-section">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px;">
          <template #title>支持 .csv / .xlsx / .xls 格式，文件大小不超过 5MB</template>
        </el-alert>

        <div class="import-steps">
          <div class="step">
            <span class="step-num">1</span>
            <div class="step-body">
              <p>下载导入模板，按格式填写用户信息</p>
              <p style="color: #909399; font-size: 12px; margin: -8px 0 8px;">学生的「用户名」可留空，将自动使用「学号」作为用户名</p>
              <el-button size="small" type="primary" plain icon="Download" @click="downloadTemplate">下载模板</el-button>
            </div>
          </div>
          <div class="step">
            <span class="step-num">2</span>
            <div class="step-body">
              <p>选择填写好的文件上传</p>
              <el-upload
                ref="uploadRef"
                :auto-upload="false"
                :limit="1"
                accept=".csv,.xlsx,.xls"
                :on-change="onFileChange"
                :on-remove="() => { importFile = null }"
              >
                <el-button size="small" type="primary" plain icon="Upload">选择文件</el-button>
              </el-upload>
              <span v-if="importFile" class="file-name">{{ importFile.name }}</span>
            </div>
          </div>
        </div>

        <!-- 导入结果 -->
        <div v-if="importResult" class="import-result">
          <el-alert :type="importResult.failed > 0 ? 'warning' : 'success'" :closable="false">
            导入完成：成功 <b>{{ importResult.success }}</b> 条，失败 <b>{{ importResult.failed }}</b> 条
          </el-alert>
          <ul v-if="importResult.errors?.length" class="error-list">
            <li v-for="(err, idx) in importResult.errors" :key="idx">{{ err }}</li>
          </ul>
        </div>
      </div>

      <template #footer>
        <el-button @click="showImportDialog = false; importResult = null">关闭</el-button>
        <el-button type="primary" :loading="importing" :disabled="!importFile" @click="handleBatchImport">开始导入</el-button>
      </template>
    </el-dialog>

    <!-- 重置密码对话框 -->
    <el-dialog v-model="showResetPwDialog" title="重置用户密码" width="420px" :close-on-click-modal="false">
      <el-form label-width="100px">
        <el-form-item label="目标用户">
          <el-input :value="resetTarget?.realName || resetTarget?.username" disabled />
        </el-form-item>
        <el-form-item label="新密码" required>
          <el-input v-model="newPassword" type="password" show-password placeholder="请输入新密码（至少6位）" />
        </el-form-item>
        <el-form-item label="确认密码" required>
          <el-input v-model="confirmPassword" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showResetPwDialog = false">取消</el-button>
        <el-button type="primary" :loading="resetting" @click="handleResetPassword">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'
import { useUserStore } from '../../stores/user'
import { userApi, cycleConfigApi } from '../../api'
import { MAJOR_CATEGORIES } from '../../types'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'

const userStore = useUserStore()

// 系统管理员（内置 admin 账号）拥有最高权限
const isSuperAdmin = computed(() => userStore.currentUser?.username === 'admin')

// ===== 数据 =====
const loading = ref(false)
const submitting = ref(false)
const users = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const searchText = ref('')
const roleFilter = ref('')
const classFilter = ref('')
const majorFilter = ref('')
const classOptions = ref<string[]>([])
const majorOptions = ref<string[]>([])
const selectedRows = ref<any[]>([])
const batchDeleting = ref(false)

// 对话框
const dialogVisible = ref(false)
const isEditing = ref(false)
const editingId = ref('')
const editingUsername = ref('')
const editingTargetRole = ref('')
const formRef = ref()

// 表单数据
const formData = reactive({
  username: '',
  password: '',
  realName: '',
  email: '',
  role: 'student',
  title: '',
  department: '',
  studentId: '',
  className: '',
  major: '',
  majorCode: '',
  grade: '',
  gpa: 0 as number | undefined,
  phone: ''
})

// 重置表单
function resetForm() {
  Object.assign(formData, {
    username: '', password: '', realName: '', email: '',
    role: 'student', title: '', department: '',
    studentId: '', className: '', major: '', majorCode: '', grade: '', gpa: undefined, phone: ''
  })
}

// 表单校验规则
const formRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }, { min: 2, max: 30, message: '2-30个字符', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '至少6位', trigger: 'blur' }
  ],
  realName: [{ required: true, message: '请输入真实姓名', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }]
}

// ===== 角色统计 =====
const roleCount = computed(() => ({
  admin: users.value.filter(u => u.role === 'admin').length,
  teacher: users.value.filter(u => u.role === 'teacher').length,
  student: users.value.filter(u => u.role === 'student').length
}))

const roleTypeMap: Record<string, string> = { admin: 'danger', teacher: '', student: 'success' }
const roleLabel: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' }
const statusLabel: Record<string, string> = { active: '正常', inactive: '已禁用', suspended: '已停用' }

// ===== API 操作 =====

async function fetchUsers() {
  loading.value = true
  try {
    const res: any = await userApi.getList({
      page: page.value,
      pageSize: pageSize.value,
      keyword: searchText.value || undefined,
      role: roleFilter.value || undefined,
      className: classFilter.value || undefined,
      major: majorFilter.value || undefined
    })
    if (res.data) {
      users.value = res.data.list || []
      total.value = res.data.pagination?.total || 0
    }
  } catch (e) {
    console.error('获取用户列表失败:', e)
  } finally {
    loading.value = false
  }
}

let searchTimer: any = null
function handleSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; fetchUsers() }, 400)
}

function handleFilterChange() {
  page.value = 1
  fetchUsers()
}

async function loadUserFilterOptions() {
  try {
    const res: any = await userApi.getFilterOptions()
    classOptions.value = res.data?.classes || []
    majorOptions.value = res.data?.majors || []
  } catch (e) {
    console.error('获取用户筛选项失败:', e)
  }
}

function handleSortChange(_col: any) {
  // 后续可实现服务端排序
  fetchUsers()
}

// 新增
function openCreateDialog() {
  resetForm()
  isEditing.value = false
  editingId.value = ''
  editingUsername.value = ''
  editingTargetRole.value = ''
  dialogVisible.value = true
}

// 编辑
function openEditDialog(row: any) {
  resetForm()
  isEditing.value = true
  editingId.value = row.id
  editingUsername.value = row.username || ''
  editingTargetRole.value = row.role || ''

  // 填充现有数据
  Object.assign(formData, {
    username: row.username,
    password: '',
    realName: row.realName || '',
    email: row.email || '',
    role: row.role,
    title: row.title || '',
    department: row.department || '',
    studentId: row.studentId || '',
    className: row.className || '',
    major: row.major || '',
    majorCode: row.majorCode || '',
    grade: row.grade || '',
    gpa: row.gpa ?? undefined,
    phone: row.phone || ''
  })

  dialogVisible.value = true
}

// 提交表单（创建或编辑）
async function handleSubmit() {
  if (!formRef.value) return

  try {
    await formRef.value.validate()
  } catch (_e) { return }

  submitting.value = true
  try {
    if (isEditing.value) {
      await userApi.update(editingId.value, formData)
      ElMessage.success('用户信息更新成功')
    } else {
      await userApi.create({ ...formData })
      ElMessage.success('用户创建成功，默认密码为所设密码')
    }

    dialogVisible.value = false
    await fetchUsers()
  } catch (e: any) {
    console.error('操作失败:', e)
    ElMessage.error(e?.response?.data?.message || e?.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

// 切换状态：启用/禁用
async function toggleStatus(row: any) {
  const newStatus = row.status === 'active' ? 'suspended' : 'active'
  const action = newStatus === 'active' ? '启用' : '禁用'

  try {
    await userApi.updateStatus(row.id, newStatus)
    ElMessage.success(`已${action}用户「${row.realName}」`)
    await fetchUsers()
  } catch (e: any) {
    console.error(`${action}失败:`, e)
    ElMessage.error(e?.response?.data?.message || e?.message || `${action}失败`)
  }
}

// 多选变化
function handleSelectionChange(rows: any[]) {
  selectedRows.value = rows
}

// 控制哪些行可被选中（普通管理员不能选择管理员行进行批量删除）
function checkSelectable(row: any) {
  if (row.role === 'admin' && !isSuperAdmin.value) return false
  return true
}

// 批量删除
async function handleBatchDelete() {
  const names = selectedRows.value.map(r => r.realName || r.username).join('、')
  try {
    await ElMessageBox.confirm(
      `确定批量删除以下 ${selectedRows.value.length} 个用户？此操作不可恢复！<br><br><b>${names}</b>`,
      '批量删除确认',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        dangerouslyUseHTMLString: true,
        type: 'warning'
      }
    )
  } catch {
    return // 用户取消
  }

  batchDeleting.value = true
  try {
    const ids = selectedRows.value.map(r => r.id)
    const res: any = await userApi.batchDelete(ids)
    ElMessage.success(res.data?.message || `成功删除 ${res.data?.deletedCount || 0} 个用户`)
    if (res.data?.errors?.length > 0) {
      // 有部分失败的，展示详情
      setTimeout(() => {
        res.data.errors.forEach((err: string) => ElMessage.warning(err))
      }, 500)
    }
    selectedRows.value = []
    await fetchUsers()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || e?.message || '批量删除失败')
  } finally {
    batchDeleting.value = false
  }
}

// 导出数据（拉取全部数据，不受分页限制）
async function exportUsers() {
  const roleMap: Record<string, string> = { admin: '管理员', teacher: '教师', student: '学生' }
  const statusMap: Record<string, string> = { active: '正常', inactive: '已禁用', suspended: '已停用' }

  // 请求全量数据
  let allUsers: any[] = []
  try {
    const res: any = await userApi.getList({ all: 'true' } as any)
    allUsers = res.data?.list || res.data || []
  } catch {
    allUsers = users.value  // 降级使用当前页面数据
  }

  const rows = allUsers.map((u: any) => ({
    '用户名': u.username || '',
    '真实姓名': u.realName || '',
    '角色': roleMap[u.role] || u.role,
    '邮箱': u.email || '',
    '学号': u.studentId || '',
    '班级': u.className || '',
    '专业': u.major || '',
    '届别': u.grade || '',
    '学分绩点': u.gpa ?? '',
    '职称': u.title || '',
    '所属院系': u.department || '',
    '手机号': u.phone || '',
    '状态': statusMap[u.status] || u.status,
    '注册时间': u.createdAt ? dayjs(u.createdAt).format('YYYY-MM-DD HH:mm') : ''
  }))

  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 14 },
    { wch: 16 }, { wch: 18 }, { wch: 8 }, { wch: 8 },
    { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 18 }
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '用户数据')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  saveAs(blob, `用户数据_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`)
  ElMessage.success(`已导出 ${rows.length} 条用户数据`)
}

// 删除
async function handleDelete(row: any) {
  try {
    await userApi.delete(row.id)
    ElMessage.success(`已删除用户「${row.realName}」`)
    await fetchUsers()
  } catch (e: any) {
    console.error('删除失败:', e)
    ElMessage.error(e?.response?.data?.message || e?.message || '删除失败')
  }
}

function onRoleChange() {
  // 切换角色时清空不相关字段
  if (formData.role !== 'teacher') {
    formData.title = ''
    formData.department = ''
  }
  if (formData.role !== 'student') {
    formData.studentId = ''
    formData.className = ''
    formData.major = ''
    formData.majorCode = ''
    formData.grade = ''
    formData.gpa = undefined
  }
}

function formatDate(dateStr: string): string {
  return dateStr ? dayjs(dateStr).format('YYYY-MM-DD') : '-'
}

// ===== 周期级专业选项（支持管理员自定义专业，学生专业下拉可自由录入） =====
const cycleMajors = ref<{ code: string; name: string }[]>([])
async function loadCycleMajors() {
  try {
    const r: any = await cycleConfigApi.get()
    cycleMajors.value = (r?.data?.majors || []).map((m: any) => ({ code: String(m.code || ''), name: String(m.name || '') }))
  } catch {
    cycleMajors.value = []
  }
}
const majorChoices = computed(() => {
  const map = new Map<string, string>()
  cycleMajors.value.forEach(m => { if (m.code) map.set(m.code, m.name) })
  Object.entries(MAJOR_CATEGORIES).forEach(([code, info]: [string, any]) => { if (!map.has(code)) map.set(code, info.name) })
  return [...map.entries()].map(([code, name]) => ({ code, name }))
})

// 初始化加载
onMounted(() => {
  fetchUsers()
  loadUserFilterOptions()
  loadCycleMajors()
})

// ===== 批量导入 =====
const showImportDialog = ref(false)
const importing = ref(false)
const importFile = ref<File | null>(null)
const importResult = ref<any>(null)
const uploadRef = ref()

function onFileChange(file: any) {
  importFile.value = file.raw
}

async function handleBatchImport() {
  if (!importFile.value) return
  importing.value = true
  importResult.value = null

  try {
    const res: any = await userApi.batchImport(importFile.value)
    importResult.value = res.data
    ElMessage.success(`导入完成：成功 ${res.data.success} 条`)
    await fetchUsers()
  } catch (e: any) {
    console.error('批量导入失败:', e)
    const errData = e?.response?.data
    if (errData) {
      importResult.value = { success: 0, failed: 1, errors: [errData.message || '导入失败'] }
    }
  } finally {
    importing.value = false
  }
}

function downloadTemplate() {
  // 生成 CSV 模板并下载
  const headers = ['用户名', '密码', '姓名', '角色', '邮箱', '学号', '班级', '专业', '专业代码', '届别', '学分绩点', '职称', '院系', '手机号']
  const sampleRow = ['zhangsan', '123456', '张三', '学生', 'zhangsan@example.com', '2025001', '视觉2301班', '视觉传达设计', '130502', '2025届', '3.65', '', '', '13800138000']
  const csvContent = '\uFEFF' + headers.join(',') + '\n' + sampleRow.join(',')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '用户导入模板.csv'
  link.click()
  URL.revokeObjectURL(url)
}

// ===== 重置密码 =====
const showResetPwDialog = ref(false)
const resetting = ref(false)
const resetTarget = ref<any>(null)
const newPassword = ref('')
const confirmPassword = ref('')

function openResetPwDialog(row: any) {
  resetTarget.value = row
  newPassword.value = ''
  confirmPassword.value = ''
  showResetPwDialog.value = true
}

async function handleResetPassword() {
  if (newPassword.value.length < 6) {
    return ElMessage.warning('密码长度不能少于6位')
  }
  if (newPassword.value !== confirmPassword.value) {
    return ElMessage.warning('两次输入的密码不一致')
  }

  resetting.value = true
  try {
    await userApi.resetPassword(resetTarget.value.id, newPassword.value)
    ElMessage.success(`已重置「${resetTarget.value.realName || resetTarget.value.username}」的密码`)
    showResetPwDialog.value = false
  } catch (e: any) {
    console.error('重置密码失败:', e)
  } finally {
    resetting.value = false
  }
}
</script>

<style scoped>
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.filter-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  align-items: center;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}

.stats-bar {
  margin-top: 12px;
  font-size: 13px;
  color: #909399;
}

/* 批量导入样式 */
.import-section {
  padding: 0 10px;
}

.import-steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.step-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 1px;
}

.step-body p {
  margin: 0;
  font-size: 14px;
  color: #606266;
}

.file-name {
  font-size: 13px;
  color: var(--el-color-primary);
  word-break: break-all;
}

.import-result {
  margin-top: 16px;
}

.error-list {
  margin: 8px 0 0;
  padding-left: 20px;
  max-height: 200px;
  overflow-y: auto;
}

.error-list li {
  font-size: 12px;
  color: #f56c6c;
  line-height: 1.8;
}

/* 响应式适配 */
@media (max-width: 768px) {
  .header-row {
    flex-direction: column;
    gap: 12px;
    align-items: stretch;
  }

  .header-actions {
    justify-content: flex-end;
  }

  .filter-bar :deep(.el-input) {
    width: 100% !important;
  }

  .filter-bar :deep(.el-select) {
    width: 100% !important;
  }

  /* 表格字体缩小 */
  .user-table :deep(.el-table) { font-size: 12px; }
  .user-table :deep(.el-table th) { font-size: 11px; padding: 8px 6px; }
  .user-table :deep(.el-table td) { font-size: 11px; padding: 8px 6px; }

  /* 操作列按钮紧凑 */
  .user-table :deep(.el-button) {
    padding: 4px 8px;
    font-size: 11px;
  }

  .pagination-wrap {
    justify-content: center;
  }

  .stats-bar {
    text-align: center;
    font-size: 12px;
  }
}

@media (max-width: 480px) {
  .user-table :deep(.el-table) { font-size: 11px; }
  .user-table :deep(.el-table th) { font-size: 10px; padding: 6px 4px; }
  .user-table :deep(.el-table td) { font-size: 10px; padding: 6px 4px; }

  .user-table :deep(.el-button) {
    padding: 2px 6px;
    font-size: 10px;
  }

  /* 对话框宽度适配 */
  :deep(.el-dialog) {
    margin: 0 12px !important;
    width: calc(100% - 24px) !important;
  }

  :deep(.el-dialog__body) {
    padding: 16px;
  }

  :deep(.el-form-item) {
    margin-bottom: 12px;
  }

  :deep(.el-form-item__label) {
    font-size: 12px;
    padding: 0 0 4px;
  }
}
</style>
