import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  // 内嵌到「半山学堂」的 /gpss/ 子路径下；如需独立部署，改回 '/'
  base: '/gpss/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: true,
    proxy: {
      // 开发/演示模式使用 /gpss/ 子路径时，axios 会请求 /gpss/api；
      // Vite 默认只代理 /api，因此这里显式剥除前缀转发到后端。
      '/gpss/api': {
        target: 'http://127.0.0.1:3011',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gpss/, '')
      },
      '/api': {
        target: 'http://127.0.0.1:3011',
        changeOrigin: true
      }
    }
  }
})
