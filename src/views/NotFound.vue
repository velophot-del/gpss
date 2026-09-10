<template>
  <main class="not-found">
    <div class="not-found__content">
      <p class="not-found__code">404</p>
      <h1>页面不存在</h1>
      <p>您访问的地址无效、已移动，或没有访问权限。</p>
      <el-button type="primary" @click="$router.push('/')">返回首页</el-button>
    </div>
    <footer class="app-footer">
      <span>毕业设计管理系统 V2 @视觉传达设计学院</span>
      <a class="icp-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">鲁ICP备2026052694号-1</a>
    </footer>
  </main>
</template>

<style scoped>
.not-found {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  background: #f5f7fa;
  position: relative;
}

.app-footer {
  position: absolute;
  bottom: 24px;
  left: 0;
  right: 0;
  text-align: center;
  color: #909399;
  font-size: 12px;
}

.icp-link {
  margin-left: 12px;
  color: #909399;
  transition: color 0.2s ease;
}

.icp-link:hover {
  color: #409eff;
}

.not-found__content {
  max-width: 420px;
}

.not-found__code {
  margin: 0;
  color: #409eff;
  font-size: 88px;
  font-weight: 700;
  line-height: 1;
}

h1 {
  margin: 20px 0 12px;
  color: #303133;
  font-size: 24px;
}

p:not(.not-found__code) {
  margin: 0 0 24px;
  color: #909399;
}
</style>
