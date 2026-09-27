# 调剂志愿与统一结算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将调剂阶段改为学生整组志愿、教师遴选草稿和统一结算，同时只对学生端隐藏教师身份信息。

**Architecture:** 新增一套独立于首次志愿的调剂表、服务和路由；复用 `selectionMatcher.ts` 的确定性匹配算法，但将其输入改为调剂志愿和调剂教师草稿。课题接口按当前角色输出数据：学生响应剔除教师身份字段，仅返回不可逆的教师分组键；教师和管理员保持现有字段。

**Tech Stack:** Vue 3、TypeScript、Pinia、Element Plus、Express、MySQL 8、mysql2。

**Spec:** `docs/superpowers/specs/2026-09-27-adjustment-volunteers-and-settlement-design.md`

## Global Constraints

- 仅未录取且已有首次志愿的学生可在 `adjustment` 阶段提交调剂志愿。
- 每次整组保存 3–6 个不重复、连续编号的同专业且未满员已发布课题，并覆盖至少两位教师。
- 教师草稿、提交、管理员退回和统一结算只在 `adjustment` 阶段运行；结算使用每周期 MySQL 命名锁。
- 不能删除或修改既有 `adjustments` 历史数据；旧写入和审批接口改为 `410`。
- 不新增或运行自动化测试；按项目约定执行 `npm run build:all`、`git diff --check`，并完成规格中的手工验收场景。
- 不泄露教师身份：学生接口不返回姓名、职称、院系、邮箱、电话、头像或 `teacherId`；教师和管理员响应保持原样。

## Review Focus

- 学生尝试通过直接调用课题详情、调剂课题接口或历史结果接口获取教师字段时，响应中均不得包含教师身份信息；在任务 2 的角色化响应检查中验证。
- 学生将调剂志愿改为一个已被教师提交名单的课题时，保存必须返回 `409`，且旧志愿完整保留；在任务 4 的并发冻结检查中验证。
- 学生同时被不同课题拟录取时，较小调剂志愿序号必须获保留，释放出的名额按候补顺序递补；在任务 7 的手工结算场景中验证。
- 教师指导上限、课题余量和一生一题约束在教师保存、教师提交和结算事务三处都必须阻止超额；在任务 6 和任务 7 的容量检查中验证。
- 结算事务任一日志或通知写入失败时，调剂志愿、`applications`、课题状态和批次状态必须整体回滚，并将结算标记为 `failed`；在任务 7 的失败重试检查中验证。

## File Structure

- `server/src/scripts/initDb.ts`：新增调剂志愿、教师批次、草稿和结算表。
- `server/src/services/adjustmentVolunteerService.ts`：学生资格、可选课题、整组志愿保存和冻结校验。
- `server/src/services/adjustmentDraftService.ts`：教师调剂草稿、技能兴趣匹配提示、容量与乐观锁校验。
- `server/src/services/adjustmentSettlementService.ts`：自动提交、统一结算、结果落库、审计与通知。
- `server/src/services/selectionDeadlineWorker.ts`：将调剂截止检查接入既有一分钟工作器。
- `server/src/routes/adjustmentVolunteers.ts`：学生和教师调剂 API。
- `server/src/routes/selectionAdmin.ts`：新增调剂结算进度、退回和执行 API。
- `server/src/routes/applications.ts`：旧调剂写入/审批接口返回 `410`；历史查询只读。
- `server/src/routes/topics.ts`：学生角色化课题列表与详情响应。
- `server/src/index.ts`：挂载新路由及截止任务。
- `src/api/index.ts`、`src/types/index.ts`：新增调剂 API、DTO 和前端类型。
- `src/stores/adjustmentVolunteer.ts`：学生调剂志愿状态和教师调剂草稿请求。
- `src/views/student/Adjustment.vue`：替换为 3–6 志愿工作台。
- `src/views/teacher/AdjustmentReview.vue`：教师调剂遴选和匹配提示。
- `src/views/admin/AdjustmentSettlement.vue`：管理员调剂进度、退回和重试页面。
- `src/router/index.ts`、`src/layouts/MainLayout.vue`：新增教师/管理员入口和路由。
- `src/views/student/SelectionWorkspace.vue`、`src/views/student/TopicDetail.vue`、`src/views/Dashboard.vue`、`src/views/student/MyResult.vue`：移除学生端教师展示。

### Task 1: 建立调剂数据模型与迁移入口

**Files:**
- Modify: `server/src/scripts/initDb.ts`
- Create: `server/src/scripts/migrateAdjustmentVolunteers.ts`
- Modify: `server/package.json`

**Interfaces:**
- Produces: `adjustment_volunteers`、`adjustment_batches`、`adjustment_draft_items`、`adjustment_settlements` 四张表及 `npm run db:migrate-adjustment`。
- Consumed by: Tasks 3–7。

- [ ] 在 `initDb.ts` 按规格创建四张表、唯一键和索引；外键分别指向周期、学生、课题、批次和调剂志愿。
- [ ] 新建幂等迁移脚本，使用 `CREATE TABLE IF NOT EXISTS` 和必要的索引检查，禁止触碰既有 `adjustments` 数据。
- [ ] 在 `server/package.json` 注册 `db:migrate-adjustment`，并写明其只补建结构。
- [ ] 运行 TypeScript 构建与 `git diff --check`，确认迁移入口可编译。
- [ ] 提交本任务涉及的文件，提交信息为 `feat: add adjustment volunteer schema`。

### Task 2: 实现学生课题响应脱敏

**Files:**
- Modify: `server/src/routes/topics.ts`
- Modify: `src/types/index.ts`
- Modify: `src/stores/topic.ts`
- Modify: `src/views/student/SelectionWorkspace.vue`
- Modify: `src/views/student/TopicDetail.vue`
- Modify: `src/views/Dashboard.vue`
- Modify: `src/views/student/MyResult.vue`

**Interfaces:**
- Produces: 学生课题 DTO `StudentTopicView`，仅含 `teacherGroupKey` 作为教师去重依据。
- Consumed by: Tasks 3–4 的学生志愿规则。

- [ ] 在 `topics.ts` 提取 `toStudentTopicView(topic)`，将 `teacher_id` 和教师展示字段从学生列表及 `GET /:id` 响应移除；用服务端密钥派生稳定但不可反查的 `teacherGroupKey`。
- [ ] 保持教师、管理员的列表和详情响应字段不变，并确保学生的浏览量、专业可见性和课题余量计算不变。
- [ ] 在前端 `Topic` 类型增加可选 `teacherGroupKey`，将两位教师覆盖计算改为该键。
- [ ] 从所有学生浏览、详情、首页推荐和结果页移除教师姓名、职称和联系信息；保留课题、专业、方向、余量、标签和申请进度。
- [ ] 用学生、教师和管理员会话手工检查同一列表和详情响应，核对学生响应无身份字段且教师/管理员信息完整；再执行 `npm run build:all` 与 `git diff --check`。
- [ ] 提交本任务涉及的文件，提交信息为 `feat: hide teacher identities from student topics`。

### Task 3: 实现学生调剂志愿服务和 API

**Files:**
- Create: `server/src/services/adjustmentVolunteerService.ts`
- Create: `server/src/routes/adjustmentVolunteers.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/utils/policies.ts`

**Interfaces:**
- Produces: `getEligibleAdjustmentTopics(actor)`、`getMyAdjustmentVolunteers(actor)`、`saveMyAdjustmentVolunteers(actor, expectedVersion, items)`。
- Consumes: `StudentTopicView`、`teacherGroupKey`、`adjustment_volunteers`。
- Used by: Tasks 4–7。

- [ ] 通过当前周期、已有首次志愿和无 `accepted` 申请判定资格；非 `adjustment` 阶段及不合格学生统一返回 `409`。
- [ ] 查询本周期与学生 `major_code` 相同、`published` 且 `accepted_count < max_students` 的课题，复用任务 2 的学生脱敏 DTO。
- [ ] 对整组写入验证 3–6 条、不重复课题、优先级从 1 连续、每项理由、同专业、未满员和至少两个 `teacherGroupKey`；用事务覆盖更新同一学生本周期的志愿。
- [ ] 在保存前锁定学生现有志愿和相关 `adjustment_batches`；任一涉及课题已经提交、自动提交或开始结算时返回 `409`，不写入部分数据。
- [ ] 实现三个学生 API：`eligible-topics`、`mine`、`PUT mine`，并将教师路由挂载到 `/api/adjustment-volunteers`。
- [ ] 用本地 API 手工请求核对资格、专业隔离、三至六志愿、两教师覆盖和冻结错误；执行 `npm run build:all` 与 `git diff --check`。
- [ ] 提交本任务涉及的文件，提交信息为 `feat: add adjustment volunteer submission`。

### Task 4: 实现教师调剂草稿与匹配提示

**Files:**
- Create: `server/src/services/adjustmentDraftService.ts`
- Modify: `server/src/routes/adjustmentVolunteers.ts`
- Modify: `server/src/utils/policies.ts`

**Interfaces:**
- Produces: `getAdjustmentDraft(topicId, actor)`、`saveAdjustmentDraft(topicId, actor, version, items)`、`submitAdjustmentBatch(topicId, actor, version)`。
- Consumes: `adjustment_volunteers` 和学生档案的 `skills`、`interests`。
- Used by: Tasks 5–7。

- [ ] 按 `selectionDraftService.ts` 的批次、版本和提交约束实现调剂草稿，但草稿项引用 `volunteer_id`，不改变 `applications.status`。
- [ ] 仅允许课题教师在 `adjustment` 阶段处理本人仍有空位的课题；验证 `proposed`、`reserve` 排序各从 1 连续，`reject` 不带排序。
- [ ] 在读取申请人时返回专业、班级、调剂志愿序号、理由、个人陈述、技能和兴趣；将课题 `tags` 与技能、课题 `category` 与兴趣的精确交集及展示分数作为提示字段返回。
- [ ] 保存和提交前分别计算课题已录取人数、调剂拟录取人数和教师总上限；使用乐观锁防止覆盖他人草稿。
- [ ] 提交后调用任务 6 的 `requestAdjustmentSettlementIfReady`，并确认学生端该课题关联志愿已冻结。
- [ ] 用教师会话手工检查草稿保存、排序错误、教师越权、提交只读、技能兴趣提示及冻结行为；执行 `npm run build:all` 与 `git diff --check`。
- [ ] 提交本任务涉及的文件，提交信息为 `feat: add adjustment teacher drafts`。

### Task 5: 实现调剂统一结算和截止自动执行

**Files:**
- Create: `server/src/services/adjustmentSettlementService.ts`
- Modify: `server/src/services/selectionDeadlineWorker.ts`
- Modify: `server/src/services/selectionMatcher.ts`
- Modify: `server/src/index.ts`

**Interfaces:**
- Produces: `requestAdjustmentSettlementIfReady(cycleId, trigger)`、`runAdjustmentSettlement(cycleId, trigger)`。
- Consumes: 任务 4 的已提交批次和 `buildSettlementPlan`。
- Used by: Task 6。

- [ ] 为调剂结算定义独立触发类型、结算摘要和错误类型；命名锁使用 `gpss:adjustment-settlement:${cycleId}`。
- [ ] 在截止时将仍为草稿的、有调剂志愿课题批次标为 `auto_submitted`，不自动猜测拟录取或候补。
- [ ] 读取 `proposed`/`reserve` 调剂草稿、调剂志愿优先级、课题余量和首次录取结果，调用既有匹配器；如需将候选字段从 `applicationId` 抽象为通用 `candidateId`，保持首次结算调用兼容。
- [ ] 在同一事务中更新调剂志愿状态，复用或创建目标 `applications` 为 `accepted`，将同一学生其他调剂志愿写为 `withdrawn` 或 `rejected`，更新课题状态，写操作日志和通知；任一失败必须回滚业务事务并留下 `failed` 结算记录。
- [ ] 将 `selectionDeadlineWorker` 扩展为同时扫描 `phase = 'adjustment'` 的截止时间，并让服务器启动后即执行一次补偿检查。
- [ ] 手工构造多课题多志愿数据，核对优先级取舍、候补递补、容量/教师上限、一生一题、截止自动提交、并发锁和失败后重试；执行 `npm run build:all` 与 `git diff --check`。
- [ ] 提交本任务涉及的文件，提交信息为 `feat: settle adjustment volunteers centrally`。

### Task 6: 完成管理员接口、旧流程退役和页面入口

**Files:**
- Modify: `server/src/routes/selectionAdmin.ts`
- Modify: `server/src/routes/applications.ts`
- Modify: `src/api/index.ts`
- Modify: `src/router/index.ts`
- Modify: `src/layouts/MainLayout.vue`
- Create: `src/views/admin/AdjustmentSettlement.vue`
- Create: `src/views/teacher/AdjustmentReview.vue`

**Interfaces:**
- Consumes: 任务 4–5 的调剂批次与结算服务。
- Produces: 管理员调剂结算 API、教师调剂入口及只读历史调整记录。

- [ ] 新增管理员进度、退回和运行接口，按结算状态限制退回与重试；列表显示资格人数、志愿数、课题提交状态、截止时间、配置错误和结算摘要。
- [ ] 将旧 `POST /applications/adjustments` 与旧审批 `PUT /applications/adjustments/:id` 固定返回 `410`；保留 `GET` 历史查询但不再让页面显示审批动作或 GPA 排序提示。
- [ ] 新增教师“调剂遴选”页：课题切换、学生档案、匹配提示、拟录取/候补/不录取排序、保存和提交。
- [ ] 新增管理员“调剂结算”页：进度刷新、配置提示、退回、执行和重试；仅管理员可进入。
- [ ] 在路由和导航中按用户角色及 `adjustment` 阶段显示入口；非调剂阶段页面只显示状态说明，不发送写请求。
- [ ] 用三种角色手工验证菜单、路由保护、接口权限、旧接口 `410` 和管理员退回后的教师再编辑；执行 `npm run build:all` 与 `git diff --check`。
- [ ] 提交本任务涉及的文件，提交信息为 `feat: add adjustment review and settlement pages`。

### Task 7: 重写学生调剂工作台并完成发布前核验

**Files:**
- Modify: `src/views/student/Adjustment.vue`
- Create: `src/stores/adjustmentVolunteer.ts`
- Modify: `src/api/index.ts`
- Modify: `src/types/index.ts`
- Modify: `src/views/student/MyResult.vue`

**Interfaces:**
- Consumes: 任务 3 的学生 API。
- Produces: 调剂志愿浏览、排序、整组保存与结算结果展示。

- [ ] 用新 store 请求资格、可选课题、个人调剂志愿和整组保存；状态包含版本、冻结原因和结算摘要。
- [ ] 将 `Adjustment.vue` 改为同专业未满员课题列表加 3–6 志愿篮；支持连续排序和逐项理由，使用 `teacherGroupKey` 校验两位教师覆盖但不展示教师信息。
- [ ] 学生提交后显示“等待教师遴选/统一结算”，教师草稿决定不可见；冻结、资格不足、阶段错误和结算完成显示明确提示。
- [ ] 将结果页调剂入口和状态文案接到新工作台；只显示课题和最终状态，不显示教师身份。
- [ ] 按规格第 8 节完整手工走查 13 个验收场景，记录使用的角色、样例课题、预期与实际；运行 `npm run build:all` 和 `git diff --check`。
- [ ] 提交本任务涉及的文件，提交信息为 `feat: replace adjustment application workflow`。

### Task 8: 数据库迁移、上线前备份与发布后确认

**Files:**
- Modify: `docs/superpowers/specs/2026-09-27-adjustment-volunteers-and-settlement-design.md`
- Create: `docs/adjustment-volunteers-release-checklist.md`

**Interfaces:**
- Consumes: Tasks 1–7。
- Produces: 可执行迁移、备份、回滚和验收清单。

- [ ] 写入上线清单：数据库与上传目录备份、执行 `db:migrate-adjustment`、构建、发布、健康检查、三端页面核验和结算日志核验。
- [ ] 写明回滚条件：代码异常回退镜像/源码；已经写入调剂结果时按发布前数据库备份恢复，禁止二次结算覆盖。
- [ ] 核对迁移不会删除旧 `adjustments`，且新表、历史数据和已有首次结算数据均可读取。
- [ ] 执行 `npm run build:all`、`git diff --check`，完成发布前清单复核。
- [ ] 提交文档与所有未提交的功能文件，提交信息为 `docs: add adjustment release checklist`。

## Self-Review

- 规格第 1–5 节的学生资格、专业限制、3–6 志愿、教师草稿、统一结算、历史审计和教师信息保留分别由任务 2–7 覆盖。
- 规格第 6 节的所有 API 与页面分别由任务 3、4、6、7 覆盖；旧接口退役由任务 6 覆盖。
- 规格第 7 节的权限、乐观锁、命名锁、容量限制、截止补偿和兼容性由任务 3–6 覆盖。
- 规格第 8 节的 13 项验收在任务 7 汇总执行；上线备份与回滚在任务 8 覆盖。
- 当前仓库无针对这些业务流程的独立自动化测试；遵循项目约束，不新增或运行测试，采用构建、静态检查和手工验收。
