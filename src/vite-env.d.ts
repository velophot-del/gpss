/// <reference types="vite/client" />

declare module 'element-plus/dist/locale/zh-cn.mjs' {
  interface ZhCnLocale {
    name: string
    el: Record<string, any>
  }
  const zhCn: ZhCnLocale
  export default zhCn
}
