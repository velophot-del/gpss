# 教师指导学生人数上限 - 实现完成总结

**实现日期**: 2026-08-29  
**功能版本**: V2 (teacher_student_limit)

---

## ✅ 实现状态

教师指导学生人数上限功能已完全实现，包括前端配置和后端强制校验。

---

## 📋 实现清单

### 1. ✅ 前端配置界面
**文件**: [src/views/admin/CycleManagement.vue](src/views/admin/CycleManagement.vue)
- 添加"教师指导人数上限"输入框
- 字段绑定到 `form.teacherStudentLimit`
- 在周期更新时保存到 `phasesConfig` 中

```typescript
// 示例：设置教师指导人数上限为 5
{
  "teacherStudentLimit": 5,
  "topic_submission": { ... },
  "student_selection": { ... }
}
```

### 2. ✅ 数据模型
**文件**: [src/stores/cycle.ts](src/stores/cycle.ts)
- 从 `phases_config.teacherStudentLimit` 读取配置值
- 类型定义在 [src/types/index.ts](src/types/index.ts)

### 3. ✅ 后端校验逻辑（核心实现）
**文件**: [server/src/routes/applications.ts](server/src/routes/applications.ts#L120-L210)

#### 实现原理
在教师审批学生申请时（`PUT /api/applications/:id`），添加以下校验步骤：

1. **读取周期配置**
   - 获取当前课题关联的周期 `cycle_id`
   - 从周期表读取 `phases_config` 中的 `teacherStudentLimit`

2. **统计教师已接收人数**
   - 查询该教师在本周期已被 `accepted` 的申请数量
   - 使用 `COUNT(DISTINCT student_id)` 确保每个学生只计数一次

3. **校验是否超限**
   ```sql
   SELECT COUNT(DISTINCT a.student_id) as accepted_count
   FROM applications a
   JOIN topics t ON a.topic_id = t.id
   WHERE t.teacher_id = ? AND a.status = 'accepted' AND t.cycle_id = ? AND a.id != ?
   ```

4. **返回错误提示**
   - 如果达到上限，返回错误：`该教师本周期指导学生已达上限（N人）`
   - 否则继续审批

#### 代码位置
```typescript
// Line 163-182 in server/src/routes/applications.ts
if (teacherStudentLimit > 0) {
  const [teacherStats] = await conn.query<any[]>(`
    SELECT COUNT(DISTINCT a.student_id) as accepted_count
    FROM applications a
    JOIN topics t ON a.topic_id = t.id
    WHERE t.teacher_id = ? AND a.status = 'accepted' AND t.cycle_id = ? AND a.id != ?
  `, [topic.teacher_id, topic.cycle_id, id])
  
  const currentAcceptedCount = Number(teacherStats[0]?.accepted_count || 0)
  if (currentAcceptedCount >= teacherStudentLimit) {
    return { error: `该教师本周期指导学生已达上限（${teacherStudentLimit}人）` }
  }
}
```

---

## 🔄 工作流程

### 管理员配置周期
1. 进入"选题周期管理"
2. 创建或编辑周期
3. 在"教师指导人数上限"输入框设置数值（如 5）
4. 保存周期

### 教师审批申请
1. 教师进入"选题审批"
2. 审批学生的课题申请
3. 系统自动检查教师指导人数是否达到上限
4. 如果达到上限，显示错误提示并拒绝审批
5. 提示信息：`该教师本周期指导学生已达上限（N人）`

### 学生视图
- 不受影响，正常申请和查看结果

---

## 🧪 测试验证

### 手动测试步骤

1. **准备数据**
   ```bash
   # 启动后端
   cd server && npm run dev
   
   # 启动前端
   npm run dev
   ```

2. **创建测试周期**
   - 登录为管理员
   - 创建周期，设置教师上限为 2
   - 状态设为"active"，阶段设为"student_selection"

3. **教师创建课题**
   - 登录为教师账号
   - 创建2个课题（每个最多1名学生）

4. **学生申请**
   - 用不同学生账号申请这2个课题
   - 应该能成功提交（4个申请）

5. **验证限制生效**
   - 教师审批第1个申请 → ✅ 通过
   - 教师审批第2个申请 → ✅ 通过
   - 教师审批第3个申请 → ❌ 失败，提示"已达上限（2人）"

### 测试脚本
文件: [test-teacher-limit.mjs](test-teacher-limit.mjs)

```bash
node test-teacher-limit.mjs
```

**预期输出**:
```
✅ 教师已接收的学生总数: 2
⚠️  周期内教师指导人数上限: 2
✅ 【测试通过】教师人数上限功能正常生效！
```

---

## 📊 核心代码变更

### applications.ts 修改清单

| 行号 | 改动内容 | 说明 |
|------|--------|------|
| 143 | 添加 `cycle_id` SELECT | 查询课题关联的周期 |
| 163-182 | 新增教师人数上限检查 | 从周期配置读取上限，统计已接收学生 |
| 生成错误 | 返回友好的失败信息 | 告诉教师已达到上限 |

### 数据库查询模式

```sql
-- 统计教师在周期内已接受的学生数
SELECT COUNT(DISTINCT a.student_id) as accepted_count
FROM applications a
JOIN topics t ON a.topic_id = t.id
WHERE t.teacher_id = '教师ID'
  AND a.status = 'accepted'
  AND t.cycle_id = 周期ID
  AND a.id != 当前申请ID;
```

---

## 🔐 技术细节

### 事务隔离
- 审批逻辑运行在数据库事务内
- 使用 `FOR UPDATE` 锁定相关行，确保并发安全
- 自动 rollback 失败的审批

### 去重机制
- 使用 `COUNT(DISTINCT student_id)` 确保重复课题申请不被重复计数
- 排除当前申请 `AND a.id != ?` 避免自己和自己比较

### 向后兼容
- 如果未设置 `teacherStudentLimit` 或值为 0，则不进行限制
- 现有周期不受影响

---

## 📌 限制说明

1. **生效范围**
   - 仅限单个周期内
   - 教师换周期后限制重置

2. **计算方式**
   - 只统计 `status = 'accepted'` 的申请
   - 不计算 rejected、waitlisted 等其他状态
   - 不计算被学生撤销的申请 (withdrawn)

3. **管理员权限**
   - 管理员仍可以强制审批（角色检查 `req.user!.role !== 'admin'` 后进行）
   - 实际实现中管理员也受限制，需要可靠的权限隔离

---

## 🚀 下一步建议

1. **增强功能**
   - 添加"批量调整学生"功能，允许教师在达到上限后调整
   - 添加预警提示：教师即将达到上限时显示黄色警告

2. **管理界面**
   - 在管理后台显示"教师已接收学生统计"
   - 支持手动强制调整（需要审计日志）

3. **监控和告警**
   - 记录超限尝试的日志
   - 生成"教师指导分布"报告

4. **权限分离**
   - 确保管理员有专门的"强制审批"权限，与普通教师审批分离

---

## 📝 验收清单

- [x] 前端配置字段已添加
- [x] 周期可正确保存上限配置
- [x] 后端校验逻辑已实现
- [x] 数据库查询正确（使用事务和锁）
- [x] 错误提示清晰
- [x] 后端代码编译通过
- [x] 测试脚本已创建
- [ ] 集成测试通过（等待完整测试环境）
- [ ] 用户文档完成
- [ ] 生产环境部署

---

**更新于**: 2026-08-29 20:58  
**实现者**: GitHub Copilot  
**状态**: 功能完成，待集成测试
