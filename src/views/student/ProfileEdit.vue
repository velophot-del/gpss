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

        <!-- 作品集 -->
        <el-divider content-position="left">
          作品集
          <el-tag size="small" style="margin-left: 8px;" type="info">{{ form.portfolio.length }} 项</el-tag>
        </el-divider>

        <div class="portfolio-section">
          <!-- 添加作品表单 -->
          <el-card shadow="never" v-if="showAddPortfolio" class="add-portfolio-card">
            <el-form :model="newPortfolio" label-width="80px" size="default">
              <el-row :gutter="16">
                <el-col :span="10">
                  <el-form-item label="作品名称">
                    <el-input v-model="newPortfolio.title" placeholder="作品名称" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="类型">
                    <el-select v-model="newPortfolio.type" placeholder="选择类型" @change="onPortfolioTypeChange">
                      <el-option label="图片" value="image" />
                      <el-option label="PDF文档" value="pdf" />
                      <el-option label="链接" value="link" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="16">
                  <el-form-item :label="newPortfolio.type === 'link' ? '链接/URL' : '上传文件'">
                    <!-- 链接类型：输入URL -->
                    <template v-if="newPortfolio.type === 'link'">
                      <el-input v-model="newPortfolio.url" placeholder="输入作品链接地址" />
                    </template>
                    <!-- 图片/PDF 类型：文件上传 -->
                    <template v-else>
                      <el-upload
                        ref="portfolioUploadRef"
                        :auto-upload="false"
                        :limit="1"
                        :accept="newPortfolio.type === 'image' ? 'image/*' : '.pdf'"
                        :on-change="onPortfolioFileChange"
                        :on-remove="onPortfolioFileRemove"
                        :file-list="portfolioFileList"
                      >
                        <el-button type="primary" size="small">选择{{ newPortfolio.type === 'image' ? '图片' : 'PDF' }}文件</el-button>
                        <template #tip>
                          <div class="upload-tip">{{ newPortfolio.type === 'image' ? '支持 jpg/png/gif，不超过 5MB' : '支持 PDF 格式，不超过 10MB' }}</div>
                        </template>
                      </el-upload>
                    </template>
                  </el-form-item>
                </el-col>
              </el-row>
              <el-form-item label="说明">
                <el-input v-model="newPortfolio.description" placeholder="简要描述该作品" />
              </el-form-item>
              <el-button type="primary" size="small" @click="addPortfolioItem">添加</el-button>
              <el-button size="small" @click="showAddPortfolio = false">取消</el-button>
            </el-form>
          </el-card>

          <!-- 已有作品列表 -->
          <div v-if="!showAddPortfolio" class="portfolio-actions">
            <el-button type="primary" icon="Plus" @click="showAddPortfolio = true">添加作品</el-button>
          </div>

          <el-table v-if="form.portfolio.length > 0" :data="form.portfolio" stripe size="small" style="margin-top: 16px;">
            <el-table-column prop="title" label="作品名称" min-width="150" />
            <el-table-column prop="type" label="类型" width="100">
              <template #default="{ row }">
                <el-tag size="small">{{ portfolioTypeLabel[row.type] }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="url" label="链接/地址" show-overflow-tooltip min-width="180">
              <template #default="{ row }">
                <el-link v-if="row.url !== '#'" :href="row.url" target="_blank" type="primary" size="small">查看</el-link>
                <span v-else>本地文件</span>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="说明" show-overflow-tooltip min-width="160" />
            <el-table-column width="80" align="center">
              <template #default="{ $index }">
                <el-button link type="danger" icon="Delete" size="small" @click="removePortfolio($index)" />
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="暂未添加任何作品" :image-size="60" style="margin-top: 20px;" />
        </div>

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
import type { UploadFile } from 'element-plus'
import { ElMessage } from 'element-plus'
import { uploadApi } from '../../api'
import genId from '../../utils/id'

const userStore = useUserStore()
const studentStore = useStudentStore()

const formRef = ref<FormInstance>()
const saving = ref(false)
const isComplete = ref(false)
const portfolioUploadRef = ref()
const portfolioFileList = ref<UploadFile[]>([])
const portfolioUploadingFile = ref<File | null>(null)

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
  contactPhone: '',
  portfolio: [] as PortfolioItem[]
})

const rules: FormRules = {
  skills: [{ required: true, type: 'array', min: 1, message: '请至少选择一项技能', trigger: 'change' }],
  personalStatement: [{ required: true, message: '请填写个人陈述', trigger: 'blur' }],
  contactEmail: [{ required: true, message: '请填写邮箱', trigger: 'blur' }, { type: 'email', message: '邮箱格式不正确', trigger: 'blur' }]
}

// 作品集操作
const showAddPortfolio = ref(false)
const newPortfolio = reactive<{ title: string; type: 'image' | 'pdf' | 'link'; url: string; description: string }>({ title: '', type: 'link', url: '', description: '' })

const portfolioTypeLabel: Record<string, string> = {
  image: '图片', pdf: 'PDF', link: '链接'
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

// 作品集文件上传
function onPortfolioTypeChange() {
  portfolioFileList.value = []
  portfolioUploadingFile.value = null
  newPortfolio.url = ''
}

function onPortfolioFileChange(file: UploadFile) {
  const rawFile = file.raw
  if (!rawFile) return
  const maxSize = newPortfolio.type === 'image' ? 5 * 1024 * 1024 : 10 * 1024 * 1024
  if (rawFile.size > maxSize) {
    ElMessage.error(newPortfolio.type === 'image' ? '图片大小不能超过 5MB' : 'PDF 大小不能超过 10MB')
    portfolioFileList.value = []
    return
  }
  portfolioUploadingFile.value = rawFile
  portfolioFileList.value = [file]
}

function onPortfolioFileRemove() {
  portfolioUploadingFile.value = null
  newPortfolio.url = ''
}

async function addPortfolioItem() {
  if (!newPortfolio.title) {
    ElMessage.warning('请填写作品名称')
    return
  }
  // 图片/PDF 类型需要上传文件
  if (newPortfolio.type !== 'link' && !newPortfolio.url && portfolioUploadingFile.value) {
    try {
      const res: any = await uploadApi.file(portfolioUploadingFile.value, 'portfolio')
      newPortfolio.url = res.data.url || res.data.path || `${import.meta.env.BASE_URL}uploads/${res.data.filename}`
    } catch (e) {
      console.error('上传失败:', e)
      ElMessage.error('文件上传失败，请重试')
      return
    }
  }
  if (newPortfolio.type !== 'link' && !newPortfolio.url) {
    ElMessage.warning(newPortfolio.type === 'image' ? '请选择要上传的图片' : '请选择要上传的 PDF 文件')
    return
  }
  form.portfolio.push({ id: genId(), ...newPortfolio, uploadedAt: new Date().toISOString() })
  // 重置表单
  newPortfolio.title = ''
  newPortfolio.url = ''
  newPortfolio.description = ''
  newPortfolio.type = 'link'
  portfolioFileList.value = []
  portfolioUploadingFile.value = null
  showAddPortfolio.value = false
}

function removePortfolio(index: number) {
  form.portfolio.splice(index, 1)
}

async function handleSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid || !userStore.currentUser) return

  // 检查作品集
  if (form.portfolio.length === 0) {
    ElMessage.warning('请至少添加一个作品集项')
    return
  }

  saving.value = true
  try {
    await studentStore.updateProfile(userStore.currentUser.id, { ...form })
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
    const newPortfolio = Array.isArray(profile.portfolio) ? [...profile.portfolio] : []
    form.portfolio.splice(0, form.portfolio.length, ...newPortfolio)
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

.add-portfolio-card {
  margin-bottom: 16px;
}

.portfolio-actions {
  margin-bottom: 8px;
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

.upload-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
</style>
