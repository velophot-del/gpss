<template>
  <div class="profile-edit page-container">
    <div class="card-container" style="max-width: 900px;">
      <h2 class="section-title">个人档案</h2>
      <el-alert
        v-if="!isComplete"
        title="您的个人档案尚未完善，请填写完整后才能正常参与选课流程"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 20px;"
      />

      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" size="large">
        <!-- 基本信息 -->
        <el-divider content-position="left">基本信息</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="学号">
              <el-input :model-value="form.studentId" disabled />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="班级">
              <el-input :model-value="form.className" disabled />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="专业">
              <el-input :model-value="form.major" disabled />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="年级">
              <el-input :model-value="form.grade" disabled />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="GPA">
              <el-input :model-value="form.gpa ? form.gpa.toFixed(2) : '0.00'" disabled>
                <template #append>由教务系统导入，不可修改</template>
              </el-input>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 联系方式 -->
        <el-divider content-position="left">联系方式</el-divider>

        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="邮箱" prop="contactEmail">
              <el-input v-model="form.contactEmail" placeholder="常用邮箱地址" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="手机号" prop="contactPhone">
              <el-input v-model="form.contactPhone" placeholder="联系电话" maxlength="11" />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 技能与兴趣 -->
        <el-divider content-position="left">技能与兴趣</el-divider>

        <el-form-item label="设计技能" prop="skills">
          <div class="skill-selector">
            <span
              v-for="skill in studentStore.allSkills"
              :key="skill"
              class="skill-tag"
              :class="{ 'skill-checked': form.skills.includes(skill), 'skill-disabled': !form.skills.includes(skill) && form.skills.length >= 6 }"
              @click="toggleSkill(skill)"
            >
              {{ skill }}
            </span>
          </div>
          <p class="form-tip">已选择 {{ form.skills.length }}/6 项技能</p>
        </el-form-item>

        <el-form-item label="兴趣方向">
          <div class="skill-selector">
            <span
              v-for="interest in studentStore.interestOptions"
              :key="interest"
              class="skill-tag"
              :class="{ 'skill-checked': form.interests.includes(interest), 'skill-disabled': !form.interests.includes(interest) && form.interests.length >= 6 }"
              @click="toggleInterest(interest)"
            >
              {{ interest }}
            </span>
          </div>
          <p class="form-tip">已选择 {{ form.interests.length }}/6 项兴趣方向</p>
        </el-form-item>

        <!-- 个人陈述 -->
        <el-divider content-position="left">个人陈述</el-divider>

        <el-form-item label="个人陈述" prop="personalStatement">
          <el-input
            v-model="form.personalStatement"
            type="textarea"
            :rows="5"
            placeholder="请简要介绍自己的学习情况、项目经验、对毕业设计的期望和规划等（200-500字）"
            maxlength="1000"
            show-word-limit
          />
        </el-form-item>

        <!-- 操作按钮 -->
        <div class="action-bar">
          <el-button type="primary" size="large" icon="Check" @click="handleSave" :loading="saving">
            保存档案
          </el-button>
          <el-button size="large" @click="$router.push('/student/browse')">稍后再说</el-button>
        </div>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useUserStore } from '../../stores/user'
import { useStudentStore } from '../../stores/student'
import type { FormInstance, FormRules } from 'element-plus'
import type { PortfolioItem } from '../../types'
import { ElMessage } from 'element-plus'

const userStore = useUserStore()
const studentStore = useStudentStore()

const formRef = ref<FormInstance>()
const saving = ref(false)
const isComplete = ref(false)

// 保留已存在作品集数据(仅去除上传/编辑入口,保存时原样回传避免清空)
let existingPortfolio: PortfolioItem[] = []

const form = reactive({
  studentId: '',
  className: '',
  major: '',
  grade: '',
  gpa: 0,
  skills: [] as string[],
  interests: [] as string[],
  personalStatement: '',
  contactEmail: '',
  contactPhone: ''
})

const rules: FormRules = {
  skills: [{ required: true, type: 'array', min: 1, message: '请至少选择一项技能', trigger: 'change' }],
  personalStatement: [{ required: true, message: '请填写个人陈述', trigger: 'blur' }],
  contactEmail: [{ required: true, message: '请填写邮箱', trigger: 'blur' }, { type: 'email', message: '邮箱格式不正确', trigger: 'blur' }]
}

function toggleSkill(skill: string) {
  const idx = form.skills.indexOf(skill)
  if (idx > -1) {
    form.skills.splice(idx, 1)
  } else if (form.skills.length < 6) {
    form.skills.push(skill)
  } else {
    ElMessage.warning('最多只能选择 6 项技能')
  }
}

function toggleInterest(interest: string) {
  const idx = form.interests.indexOf(interest)
  if (idx > -1) {
    form.interests.splice(idx, 1)
  } else if (form.interests.length < 6) {
    form.interests.push(interest)
  } else {
    ElMessage.warning('最多只能选择 6 项兴趣方向')
  }
}

async function handleSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid || !userStore.currentUser) return

  saving.value = true
  try {
    // 原样回传已存在作品集,避免后端把 portfolio 清空
    await studentStore.updateProfile(userStore.currentUser.id, { ...form, portfolio: existingPortfolio })
    ElMessage.success('档案保存成功！')
    isComplete.value = true
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  if (!userStore.currentUser) return
  
  await studentStore.fetchProfile()
  
  const profile = studentStore.profile
  if (profile) {
    Object.assign(form, {
      studentId: profile.studentId || userStore.currentUser.studentId || '',
      className: profile.className || userStore.currentUser.className || '',
      major: profile.major || userStore.currentUser.major || '',
      grade: profile.grade || '',
      gpa: profile.gpa || 0,
      personalStatement: profile.personalStatement || profile.selfIntro || '',
      contactEmail: profile.contactEmail || '',
      contactPhone: profile.contactPhone || ''
    })
    // 使用 splice 原地更新数组，保证响应式追踪
    const newSkills = Array.isArray(profile.skills) ? [...profile.skills] : []
    form.skills.splice(0, form.skills.length, ...newSkills)
    const newInterests = Array.isArray(profile.interests) ? [...profile.interests] : []
    form.interests.splice(0, form.interests.length, ...newInterests)
    existingPortfolio = Array.isArray(profile.portfolio) ? [...profile.portfolio] : []
    isComplete.value = profile.isComplete || !!(profile.gpa && (profile.personalStatement || profile.selfIntro))
  } else {
    form.studentId = userStore.currentUser.studentId || ''
    form.className = userStore.currentUser.className || ''
    form.major = userStore.currentUser.major || ''
    form.grade = userStore.currentUser.grade || ''
  }
})
</script>

<style scoped>
.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}

.skill-selector {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  max-height: 200px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  gap: 6px;
}

.skill-tag {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid #dcdfe6;
  background: #f4f4f5;
  color: #606266;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s;
  white-space: nowrap;
}

.skill-tag:hover {
  border-color: #409eff;
  color: #409eff;
}

.skill-tag.skill-checked {
  background: #ecf5ff;
  border-color: #409eff;
  color: #409eff;
  font-weight: 500;
}

.skill-tag.skill-disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

.action-bar {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #ebeef5;
  text-align: center;
}
.action-bar .el-button {
  width: 140px;
}
</style>
