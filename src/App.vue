<template>
  <router-view />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from './stores/user'
import { startIdleTimeout, touchActivity } from './utils/idleTimeout'

const router = useRouter()
const userStore = useUserStore()
let stopIdleWatch: (() => void) | null = null

onMounted(() => {
  stopIdleWatch = startIdleTimeout(() => {
    if (userStore.isLoggedIn) {
      userStore.logout()
      ElMessage.warning('长时间未操作，已自动退出登录')
      router.push('/login')
    }
    // 未登录（如停在登录页）不反复触发，重置计时即可
    touchActivity()
  })
})

onUnmounted(() => {
  stopIdleWatch?.()
})
</script>

<style>
#app {
  width: 100%;
  min-height: 100vh;
}
</style>
