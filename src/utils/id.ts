/**
 * 生成简单唯一 ID（时间戳 + 随机数）
 */
export default function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
