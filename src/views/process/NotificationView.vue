<template>
  <div class="process-page">
    <el-card shadow="never">
      <template #header>
        <div class="page-header">
          <span class="title">站内通知</span>
          <el-button v-if="list.length" text type="primary" @click="markAll">全部已读</el-button>
        </div>
      </template>

      <el-empty v-if="!list.length" description="暂无通知" />
      <div v-for="n in list" :key="n.id" class="notif-item" :class="{ unread: !n.isRead }" @click="read(n)">
        <span class="notif-dot" v-if="!n.isRead"></span>
        <div class="notif-body">
          <div class="notif-title"><el-tag v-if="notificationLabel(n.type)" :type="notificationType(n.type)" size="small">{{ notificationLabel(n.type) }}</el-tag>{{ n.title }}</div>
          <div class="notif-content">{{ n.content }}</div>
          <div class="notif-time">{{ formatDate(n.createdAt) }}</div>
        </div>
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { notificationApi } from '../../api'

const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20

function formatDate(d: string) {
  if (!d) return ''
  return String(d).replace('T', ' ').slice(0, 16)
}

function notificationLabel(type: string) {
  return ({ selection_accepted: '已录取', selection_unmatched: '未录取', selection_settled: '结算完成' } as Record<string, string>)[type] || ''
}
function notificationType(type: string): 'success' | 'warning' | 'info' {
  if (type === 'selection_accepted' || type === 'selection_settled') return 'success'
  if (type === 'selection_unmatched') return 'warning'
  return 'info'
}

async function load() {
  try {
    const res: any = await notificationApi.getList({ page: page.value, pageSize })
    list.value = res.data?.list || []
    total.value = res.data?.total || 0
  } catch (e) {
    // 拦截器已提示
  }
}

async function read(n: any) {
  if (n.isRead) return
  try {
    await notificationApi.markRead(n.id)
    n.isRead = true
  } catch (e) {
    // 拦截器已提示
  }
}

async function markAll() {
  try {
    await notificationApi.markAllRead()
    list.value.forEach(n => (n.isRead = true))
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
.notif-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 8px;
  border-bottom: 1px solid #ebeef5;
  cursor: pointer;
}
.notif-item:last-child {
  border-bottom: none;
}
.notif-item.unread {
  background: #f0f7ff;
}
.notif-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f56c6c;
  margin-top: 6px;
  flex-shrink: 0;
}
.notif-body {
  flex: 1;
}
.notif-title {
  font-weight: 600;
  color: #303133;
  font-size: 14px;
}
.notif-title .el-tag { margin-right: 8px; }
.notif-content {
  color: #606266;
  font-size: 13px;
  margin-top: 4px;
}
.notif-time {
  color: #909399;
  font-size: 12px;
  margin-top: 6px;
}
.pager {
  margin-top: 16px;
  display: flex;
  justify-content: center;
}
</style>
