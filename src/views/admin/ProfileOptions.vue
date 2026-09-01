<template>
  <div class="page-container">
    <el-card>
      <template #header><div class="card-header"><span>学生技能与兴趣标签</span><el-button type="primary" @click="save">保存当前配置</el-button></div></template>
      <el-alert title="Excel列名支持：类型、标签、专业代码、排序、状态；类型填写“技能”或“兴趣”。导入后请确认再保存。" type="info" show-icon :closable="false" />
      <div class="toolbar"><input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" @change="onFile" /><el-button @click="load">重新读取</el-button></div>
      <el-table :data="options" border stripe>
        <el-table-column label="类型" width="100"><template #default="{ row }"><el-tag>{{ row.type === 'skill' ? '技能' : '兴趣' }}</el-tag></template></el-table-column>
        <el-table-column prop="label" label="标签" />
        <el-table-column prop="majorCodes" label="适用专业"><template #default="{ row }">{{ row.majorCodes?.join('、') || '全部专业' }}</template></el-table-column>
        <el-table-column label="状态" width="100"><template #default="{ row }"><el-switch v-model="row.enabled" /></template></el-table-column>
        <el-table-column label="操作" width="90"><template #default="{ $index }"><el-button link type="danger" @click="options.splice($index, 1)">删除</el-button></template></el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { profileOptionsApi } from '../../api'
const options = ref<any[]>([])
const fileInput = ref<HTMLInputElement>()
async function load() { const res: any = await profileOptionsApi.getAdmin(); options.value = Array.isArray(res.data) ? res.data : [] }
async function onFile(e: Event) { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; const res: any = await profileOptionsApi.importExcel(file); if (Array.isArray(res.data)) { options.value = res.data; ElMessage.success('Excel解析成功，请确认后保存') } }
async function save() { await profileOptionsApi.save(options.value); ElMessage.success('标签配置已保存') }
onMounted(load)
</script>
<style scoped>.card-header,.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.toolbar{margin:16px 0}</style>
