// 前端登录“空闲超时”：1 小时无任何操作（鼠标/键盘/滚动/触摸/请求）则视为离开，触发自动退出。
// 时间戳存内存，页面刷新即重置；本模块由全局根组件 App.vue 挂载一次。

export const IDLE_TIMEOUT_MS = 60 * 60 * 1000 // 1 小时
const CHECK_INTERVAL_MS = 30 * 1000 // 每 30s 检查一次

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart'] as const

let lastActivityAt = Date.now()

/** 记录一次“用户操作”（活动事件或任一 API 请求都会调用） */
export function touchActivity() {
  lastActivityAt = Date.now()
}

/** 距离最后活动是否已超过阈值 */
export function isIdle(now = Date.now()): boolean {
  return now - lastActivityAt > IDLE_TIMEOUT_MS
}

/**
 * 挂载空闲检测：监听活动事件 + 定时检查超时。
 * 超时回调应自行决定是否登出（登录页空闲时仅需重置，不应反复弹提示）。
 * @returns 清理函数（卸载时调用）
 */
export function startIdleTimeout(onTimeout: () => void): () => void {
  touchActivity()
  const touch = () => touchActivity()
  for (const ev of ACTIVITY_EVENTS) {
    window.addEventListener(ev, touch, { passive: true, capture: true })
  }
  const timer = window.setInterval(() => {
    if (isIdle()) onTimeout()
  }, CHECK_INTERVAL_MS)

  return () => {
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, touch, { capture: true } as EventListenerOptions)
    }
    window.clearInterval(timer)
  }
}
