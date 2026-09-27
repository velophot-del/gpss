# 遴选草稿与统一录取发布清单

## 发布边界

- 本次只升级 GPSS 的 `gpss-app`，不替换半山学堂服务。
- 不在聊天、文档或仓库中记录服务器密码、SSH 私钥、数据库密码和 GitHub Token。
- 推送 `main` 前必须再次确认；现有 GitHub Actions 会在推送后自动备份并重建线上容器。
- 自动化测试和隔离数据库验收仅在用户明确要求验证后执行。

## 上线前数据盘点

在只读连接中保存以下查询结果，作为升级前基线：

```sql
SELECT id, name, status, phase, phases_config
FROM cycles
WHERE status IN ('active','selection','review','adjustment');

SELECT COUNT(*) AS waitlisted_count
FROM applications a JOIN topics t ON t.id = a.topic_id
WHERE t.cycle_id = :cycle_id AND a.status = 'waitlisted';

SELECT COUNT(*) AS accepted_count
FROM applications a JOIN topics t ON t.id = a.topic_id
WHERE t.cycle_id = :cycle_id AND a.status = 'accepted';

SELECT t.id, t.title, t.teacher_id, t.max_students,
       SUM(a.status = 'accepted') AS accepted_count
FROM topics t LEFT JOIN applications a ON a.topic_id = t.id
WHERE t.cycle_id = :cycle_id
GROUP BY t.id, t.title, t.teacher_id, t.max_students;
```

另行核对：

- `phases_config.teacher_review.end` 或兼容字段中的审核截止时间有效；
- `teacher_student_limit > 0` 时，每位教师名下已发布课题名额总和不超过该值；
- 当前周期没有同一学生多条 `accepted`；
- 记录数据库和上传目录备份文件名、时间与校验值。

## 隔离数据库人工验收

| # | 准备数据 | 页面/API 操作 | 预期状态 | 证据 |
|---|---|---|---|---|
| 1 | 分别准备 3、4、5、6 个连续志愿及一组跳号志愿 | 学生整组提交 | 连续志愿成功，跳号返回明确错误 | 请求响应与申请 SQL |
| 2 | 含第 4–6 志愿的学生 | 查看学生、教师、管理员页面和导出 | 均显示正确数字志愿 | 四处截图及导出文件 |
| 3 | 教师未提交的课题 | 保存拟录取/候补/不录取草稿 | `applications.status` 不变 | 页面截图与前后 SQL |
| 4 | 至少两名候补 | 调整顺序后保存，再提交 | 顺序保存；提交后只读 | 页面截图与草稿表 SQL |
| 5 | 所有有申请课题均提交 | 提交最后一个课题 | 只生成一条完成结算 | 结算表与操作日志 |
| 6 | 至少一个课题未提交，截止时间到达 | 运行截止检查 | 自动提交后结算 | 批次时间与容器日志 |
| 7 | 有申请但无任何草稿的课题 | 到期自动提交 | 无学生被该课题自动录取 | 草稿项与申请 SQL |
| 8 | 同一学生被多个课题拟录取 | 统一结算 | 只录取最高志愿 | 学生全部申请 SQL |
| 9 | 高志愿为不录取、低志愿为拟录取 | 统一结算 | 低志愿录取 | 申请与草稿 SQL |
| 10 | 低志愿拟录取学生转入高志愿且低志愿有候补 | 统一结算 | 低志愿按教师顺序递补 | 草稿排序与结果 SQL |
| 11 | 接近课题容量和教师上限 | 保存、提交、结算 | 均不超限，冲突被阻断 | 错误响应与统计 SQL |
| 12 | 当前周期已有锁定录取 | 统一结算 | 原录取不变且不重复录取 | 发布前后 SQL |
| 13 | 截止时停止服务 | 截止后再启动 | 启动检查补做结算 | 时间线与容器日志 |
| 14 | 并发触发两次结算 | 同时调用管理员接口 | 只有一个执行者和一份结果 | 命名锁响应与结算表 |
| 15 | 在通知写入前制造数据库错误 | 执行结算 | 正式状态全部回滚，结算标记失败 | 错误日志与前后 SQL |
| 16 | 已提交课题及一次失败结算 | 管理员退回、教师重提、管理员重试 | 操作成功且日志、通知完整 | 三角色截图与日志 SQL |

## 发布步骤

1. 确认上述基线并备份数据库、上传目录。
2. 确认本地 `git diff --check` 和 `npm run build:all` 成功。
3. 获得提交与推送确认后，将本地提交推送到 `main`。
4. 观察 GitHub Actions；部署脚本重建 `gpss-app` 前必须先完成备份。
5. 查看容器启动日志，确认 `initDb`、`migrateAddProcessStages` 和 `migrateSelectionDrafts` 均完成。
6. 核对 `selection_batches`、`selection_draft_items`、`selection_settlements` 三张表存在。
7. 将迁移日志中的 `migrated` 与上线前 `waitlisted_count` 对比。
8. 检查 `/api/health`，再分别查看教师遴选页、管理员录取结算页和学生结果页。

## 回滚

- 仅应用异常：切回上一版本镜像或源码并重建 `gpss-app`；保留三张新增表，旧版本不会读取。
- 数据已结算且业务结果异常：停止写入，使用发布前数据库备份恢复；不得通过再次结算覆盖。
- 上传文件异常：从同一次发布前上传目录备份恢复。
- 回滚后再次检查健康接口、当前周期、录取数量和一生一题约束。

## 发布后监控

- 容器日志没有重复结算、命名锁或数据库异常；
- 管理员页面显示定时任务最后检查时间持续更新；
- `selection_settlements` 每周期最多一条，完成后不再重写；
- 学生端结算前只显示“等待教师遴选/统一录取”；
- 教师已提交课题保持只读，管理员可在结算前退回。
