<template>
  <div class="file-upload-list">
    <el-upload
      :auto-upload="false"
      :show-file-list="false"
      :accept="accept"
      multiple
      :on-change="handleSelect"
    >
      <el-button type="primary" plain :loading="uploading">
        <el-icon><UploadFilled /></el-icon>&nbsp;选择文件
      </el-button>
      <template #tip>
        <div class="upload-tip">{{ tip }}</div>
      </template>
    </el-upload>

    <div v-if="modelValue.length" class="file-list">
      <div v-for="(f, i) in modelValue" :key="i" class="file-item">
        <el-icon class="file-icon"><Document /></el-icon>
        <a :href="f.url" target="_blank" class="file-name">{{ f.name }}</a>
        <span v-if="f.size" class="file-size">{{ formatSize(f.size) }}</span>
        <el-icon class="remove" @click="remove(i)"><Close /></el-icon>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Document, Close } from '@element-plus/icons-vue'
import { uploadApi } from '../api'
import type { FileItem } from '../types'

const props = withDefaults(defineProps<{
  modelValue: FileItem[]
  category?: string
  tip?: string
  accept?: string
}>(), {
  category: 'general',
  tip: '支持多文件上传，单个文件大小按类型限制',
  accept: ''
})

const emit = defineEmits<{ (e: 'update:modelValue', v: FileItem[]): void }>()

const uploading = ref(false)

function formatSize(size: number): string {
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  return (size / 1024 / 1024).toFixed(1) + ' MB'
}

async function handleSelect(uploadFile: any) {
  const file = uploadFile.raw as File
  if (!file) return
  uploading.value = true
  try {
    const res: any = await uploadApi.file(file, props.category)
    const info = res.data
    const item: FileItem = {
      name: info.originalName || file.name,
      url: info.url,
      size: info.size,
      type: info.mimetype,
      uploadedAt: new Date().toISOString()
    }
    emit('update:modelValue', [...props.modelValue, item])
  } catch (e) {
    // 拦截器已提示错误
  } finally {
    uploading.value = false
  }
}

function remove(i: number) {
  const next = [...props.modelValue]
  next.splice(i, 1)
  emit('update:modelValue', next)
}
</script>

<style scoped>
.file-upload-list {
  width: 100%;
}
.upload-tip {
  color: #909399;
  font-size: 12px;
  margin-top: 6px;
}
.file-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 13px;
}
.file-icon {
  color: #409eff;
}
.file-name {
  color: #409eff;
  text-decoration: none;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-size {
  color: #909399;
  font-size: 12px;
}
.remove {
  color: #909399;
  cursor: pointer;
}
.remove:hover {
  color: #f56c6c;
}
</style>
