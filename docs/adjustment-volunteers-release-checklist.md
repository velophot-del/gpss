# 调剂志愿与统一结算上线清单

## 变更范围

- 仅 GPSS 应用；半山学堂服务不变。
- 容器入口运行 `initDb.js`，会幂等创建四张新表；`db:migrate-adjustment` 可供维护时单独补建结构。
- 保留旧 `adjustments` 表与记录，旧写入/逐条审批接口返回 `410`，历史查询只读。
- 本功能代码未在此清单中部署；必须通过项目既定审批后再推送和发布。

## 上线前备份与数据基线

1. 通过既有 GPSS 部署脚本备份 MySQL 数据库和上传目录，记录备份目录、生成时间与校验值。
2. 保存当前进行中周期配置：

```sql
SELECT id, name, status, phase, phases_config
FROM cycles
WHERE status IN ('active','selection','review','adjustment');
```

3. 保存旧调剂、首次申请和当前已录取基线：

```sql
SELECT status, COUNT(*) AS records FROM adjustments GROUP BY status;

SELECT a.status, COUNT(*) AS records
FROM applications a JOIN topics t ON t.id = a.topic_id
WHERE t.cycle_id = :cycle_id
GROUP BY a.status;

SELECT t.id, t.title, t.teacher_id, t.max_students,
       SUM(a.status = 'accepted') AS accepted_count
FROM topics t LEFT JOIN applications a ON a.topic_id = t.id
WHERE t.cycle_id = :cycle_id
GROUP BY t.id, t.title, t.teacher_id, t.max_students;
```

4. 在管理员周期编辑页配置调剂开始时间和精确截止时间，再将周期切换到“调剂”。没有有效的 `phases_config.adjustment.end` 时，服务端拒绝进入调剂阶段。

## 发布后核对

1. 查看容器启动日志，确认 `initDb.js`、全流程迁移和遴选草稿迁移成功。
2. 确认 `adjustment_volunteers`、`adjustment_batches`、`adjustment_draft_items`、`adjustment_settlements` 四张表存在；确认旧 `adjustments` 行数与发布前基线一致。
3. 查询当前周期新记录：

```sql
SELECT COUNT(*) AS volunteers FROM adjustment_volunteers WHERE cycle_id = :cycle_id;
SELECT status, COUNT(*) AS batches FROM adjustment_batches WHERE cycle_id = :cycle_id GROUP BY status;
SELECT status, COUNT(*) AS results FROM adjustment_volunteers WHERE cycle_id = :cycle_id GROUP BY status;
SELECT status, trigger_type, started_at, completed_at FROM adjustment_settlements WHERE cycle_id = :cycle_id;
```

4. 检查 `/api/health`。
5. 管理员核对调剂结算页显示的资格人数、志愿数、课题提交状态和截止时间；确认旧学生单题记录只读，页面没有逐条批准按钮。
6. 教师核对调剂遴选页能读取学生技能/兴趣并给出提示；保存草稿不改变正式录取；提交后名单只读。
7. 学生核对只出现本专业未满员已发布课题，教师资料不在页面和学生响应中出现；提交志愿满足 3–6 项及两位教师覆盖。
8. 结算后核对每位学生最多一个 `accepted`、各课题与教师不超额、首次申请理由/优先级仍可追溯，以及操作日志和通知存在。

## 回滚

- 仅页面/API异常：通过既有部署流程回退 GPSS 源码或镜像；保留四张新增表，旧版本不使用这些表。
- 统一结算已经写入而业务结果异常：暂停调剂写入，使用同一次发布前数据库备份恢复；不要再次运行结算来覆盖错误结果。
- 上传目录异常：恢复同一次发布前上传目录备份。
- 回滚后检查健康接口、旧 `adjustments` 数量、首次申请状态、当前周期和已录取人数。

## 人工验收安排

在隔离数据库准备覆盖规格 13 个场景的数据后，由学生、教师和管理员分别验收：专业/资格限制、3–6 连续志愿、两教师覆盖、学生端身份隐藏、技能兴趣提示、并发冻结、教师退回、提前结算、截止自动提交、最高志愿优先、候补递补、容量上限、事务回滚和重试。验收证据记录角色、数据准备、操作、结果和 SQL 快照；生产数据不用于模拟故障。
