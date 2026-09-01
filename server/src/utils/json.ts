/**
 * 安全解析 JSON 字符串：已是对象/数组则原样返回，解析失败返回 fallback。
 * 统一各路由/工具中重复的「先判类型再 try JSON.parse」逻辑。
 */
export function safeParseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
