<template>
  <div class="page-container">
    <el-card shadow="never">
      <el-result icon="info" title="调剂改为系统自动匹配" sub-title="学生按个人意愿填报 1–6 个补录志愿。调剂截止后，系统会依据志愿顺序、课题名额和教师指导上限完成匹配，无需教师提交遴选名单。">
        <template #extra><el-button type="primary" @click="$router.push('/teacher/topics')">返回课题管理</el-button></template>
      </el-result>
    </el-card>
  </div>
</template>
