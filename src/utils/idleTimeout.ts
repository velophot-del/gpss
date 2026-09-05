// 前端登录“空闲超时”：30 分钟无任何操作（鼠标/键盘/滚动/触摸/请求）则视为离开，触发自动退出。
// 最后活动时间持久化到 localStorage，页面刷新/重开后可判断“关闭期间是否已超时”。
// 本模块由全局根组件 App.vue 挂载一次。

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 分钟
const CHECK_INTERVAL_MS = 30 * 1000 // 每 30s 检查一次
const LAST_ACTIVITY_KEY = 'gpss_last_activity'
const PERSIST_THROTTLE_MS = 30 * 1000 // 节流写入间隔，避免 mousemove 高频写 localStorage

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart'] as const

let lastActivityAt = Date.now()
let lastPersistedAt = 0

function readPersistedLastActivity(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY)
    if (!raw) return null
    const ts = Number(raw)
    return Number.isFinite(ts) && ts > 0 ? ts : null
  } catch {
    return null
  }
}

function persistLastActivity(ts: number) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(ts))
  } catch {
    // 隐私模式 / 存储被禁用时静默降级：仍以内存计时为准
  }
}

/** 记录一次“用户操作”（活动事件或任一 API 请求都会调用） */
export function touchActivity() {
  lastActivityAt = Date.now()
  // 节流写盘：距上次持久化 ≥ 30s 才写
  if (lastActivityAt - lastPersistedAt >= PERSIST_THROTTLE_MS) {
    lastPersistedAt = lastActivityAt
    persistLastActivity(lastActivityAt)
  }
}

/** 距离最后活动是否已超过阈值（基于内存值，供定时器用） */
export function isIdle(now = Date.now()): boolean {
  return now - lastActivityAt > IDLE_TIMEOUT_MS
}

/** 页面重开/刷新时判断：关闭前记录的最后活动距现在是否已超时。
 *  无持久化记录（老用户从未登录过此版本）视为未超时，兼容旧登录态。 */
export function hasExpiredSinceLastActivity(now = Date.now()): boolean {
  const persisted = readPersistedLastActivity()
  if (persisted == null) return false
  return now - persisted > IDLE_TIMEOUT_MS
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
