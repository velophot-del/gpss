# GPSS 遴选草稿与统一录取 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将教师逐条即时录取改为可保存、可提交、到期自动提交的课题名单，并通过一次幂等的统一匹配生成正式录取结果。

**Architecture:** 保留 `applications` 作为学生志愿和正式结果表，新增批次、草稿项和结算表。匹配算法实现为无数据库依赖的确定性函数，业务服务负责锁、事务、日志和通知；教师、管理员页面分别通过独立路由读取和操作同一批次状态。容器启动沿用现有幂等建表流程，并执行可重复运行的旧 `waitlisted` 数据迁移。

**Tech Stack:** Vue 3、Pinia、Element Plus、TypeScript、Express、MySQL 8、Docker、GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-26-selection-draft-and-settlement-design.md`

## Global Constraints

- 不新增运行时依赖；定时检查使用 Node.js `setInterval`，拖动排序使用浏览器原生拖放能力。
- 学生每周期可提交 3–6 个连续志愿，合法顺序只能是 `1..N`。
- GPA 不参与录取；未保存决定不得自动推断为拟录取或候补。
- 每名学生每周期最多录取一个课题；不得超过课题 `max_students` 和大于 0 的 `teacher_student_limit`。
- `teacher_student_limit = 0` 表示不设置教师总上限；大于 0 时为硬限制。
- 教师草稿不修改 `applications.status`；只有统一结算事务写正式结果。
- 已提交批次仅管理员可在结算前退回；已完成结算不可再次执行。
- 当前周期既有 `accepted` 为锁定结果，占用学生、课题和教师名额，不参与重新分配。
- 历史周期以及当前周期既有 `accepted`、`rejected`、`withdrawn` 不由迁移脚本改写。
- 发布前备份数据库和上传目录；应用回滚保留新增表，业务回滚使用发布前数据库备份。
- 每次代码提交、推送和生产部署均按项目 `AGENTS.md` 单独征求确认。
- 本轮未获授权新增或运行自动化测试；各任务仅安排类型检查、构建、静态检查和人工验收准备，若用户后续要求验证，再补充隔离数据库测试。

## Review Focus

- 两个教师页面同时编辑同一课题时，旧 `version` 保存必须返回 `409`，不得覆盖新草稿。
- 服务在截止时停机后重启，必须补做自动提交与结算，且并发实例只能有一个执行者。
- 学生同时被多个课题选择时，只保留其最高志愿，释放名额必须继续按教师顺序递补。
- 既有录取占满课题或教师上限时，新结算不得挤掉既有结果，也不得超额录取。
- 数据库事务中任一正式状态、日志或通知写入失败时，整个结算必须回滚并留下可重试的失败状态。

---

### Task 1: 集中定义第 1–6 志愿规则并修复显示

**Files:**
- Create: `server/src/utils/volunteerRules.ts`
- Create: `src/utils/volunteerRules.ts`
- Modify: `server/src/routes/applications.ts`
- Modify: `src/types/index.ts`
- Modify: `src/views/Dashboard.vue`
- Modify: `src/views/student/TopicDetail.vue`
- Modify: `src/views/student/SelectionWorkspace.vue`
- Modify: `src/views/admin/ApplicationData.vue`
- Modify: `src/views/admin/StudentStatus.vue`

**Interfaces:**
- Produces: `VOLUNTEER_MIN = 3`、`VOLUNTEER_MAX = 6`、`formatPriority(priority: number): string`。
- Produces: `validateContinuousPriorities(priorities: number[]): string | null`，合法输入返回 `null`，否则返回可直接展示的中文错误。
- Produces: 前端 `Application.priority` 继续为 `number`，所有页面统一显示 `第 ${priority} 志愿`。

- [ ] **Step 1: 新建前后端志愿规则模块**

  集中声明 3、6 两个边界和显示函数；后端连续性校验先去重和升序，再要求长度在 3–6 且每项等于下标加一。

- [ ] **Step 2: 接入学生志愿提交校验**

  在整组志愿提交的事务入口调用 `validateContinuousPriorities`；拒绝少于 3 个、多于 6 个、重复、跳号或从非 1 开始的提交。

- [ ] **Step 3: 清除页面中的前三志愿硬编码**

  替换 `priorityLabel`、仅覆盖 1–3 的 `priorityType` 和工作台 `/3` 文案；保留颜色时按 `1`、`2`、`>=3` 分级，不再把 4–6 显示为空。

- [ ] **Step 4: 静态核对**

  Run: `rg -n "priorityLabel|/3|第一志愿.*第二志愿.*第三志愿|priority === 3" src server/src`

  Expected: 不再存在会截断第 4–6 志愿的页面映射；业务规则只在两个集中模块中声明。

- [ ] **Step 5: 构建检查**

  Run: `npm run build:all`

  Expected: Vue 和服务端 TypeScript 构建成功。

- [ ] **Step 6: 准备聚焦提交**

  展示 Task 1 diff；获得确认后提交，建议消息：`fix: unify volunteer priority rules`。

### Task 2: 新增遴选表和旧候补迁移

**Files:**
- Modify: `server/src/scripts/initDb.ts`
- Create: `server/src/scripts/migrateSelectionDrafts.ts`
- Modify: `server/package.json`
- Modify: `deployment/aliyun/entrypoint.sh`

**Interfaces:**
- Produces: 数据表 `selection_batches`、`selection_draft_items`、`selection_settlements`，字段和唯一键与规格一致。
- Produces: `migrateSelectionDrafts(): Promise<{ cycleId: number | null; migrated: number }>`。
- Consumes: Task 1 的志愿顺序定义，用于旧候补的确定性排序。

- [ ] **Step 1: 在幂等初始化中创建三个表**

  使用 `CREATE TABLE IF NOT EXISTS`；外键分别指向 `cycles`、`topics`、`applications`、`users`，为周期状态、课题状态和批次申请查询添加普通索引。

- [ ] **Step 2: 实现一次性兼容迁移**

  `migrateSelectionDrafts()` 只查询当前进行中周期的 `waitlisted`；在事务内按 `topic_id` 建立批次，按 `priority ASC, created_at ASC, id ASC` 生成连续 `reserve` 排名，写入草稿项后将这些申请恢复为 `pending`。使用唯一键和条件更新保证重复运行返回 `migrated: 0`。

- [ ] **Step 3: 增加迁移命令和容器启动入口**

  在 `server/package.json` 增加 `db:migrate-selection`；在 `entrypoint.sh` 的 `initDb` 和现有流程迁移之后、启动服务之前执行 `node dist/scripts/migrateSelectionDrafts.js`，输出迁移周期和数量。

- [ ] **Step 4: 检查迁移边界**

  人工审查 SQL，确认查询限定当前周期与 `waitlisted`，更新带原状态条件，且不会触碰 `accepted`、`rejected`、`withdrawn` 或历史周期。

- [ ] **Step 5: 构建检查**

  Run: `npm --prefix server run build`

  Expected: `dist/scripts/migrateSelectionDrafts.js` 存在且 TypeScript 无错误；不连接生产数据库执行迁移。

- [ ] **Step 6: 准备聚焦提交**

  展示 Task 2 diff；获得确认后提交，建议消息：`feat: add selection draft schema and migration`。

### Task 3: 实现确定性统一匹配核心

**Files:**
- Create: `server/src/services/selectionMatcher.ts`

**Interfaces:**
- Produces: `SelectionDecision = 'proposed' | 'reserve' | 'reject'`。
- Produces: `SettlementCandidate { applicationId; studentId; topicId; teacherId; priority; decision; decisionRank; appliedAt }`。
- Produces: `SettlementTopic { topicId; teacherId; capacity }`、`LockedAssignment { applicationId; studentId; topicId; teacherId }`。
- Produces: `buildSettlementPlan(input: SettlementInput): SettlementPlan`，结果包含 `acceptedApplicationIds`、`withdrawnApplicationIds`、`rejectedApplicationIds`、`unmatchedStudentIds` 和每课题录取数。

- [ ] **Step 1: 定义不可变输入输出类型**

  `SettlementInput` 包含候选、课题、既有锁定录取和教师上限；函数不读取时间、环境变量或数据库。

- [ ] **Step 2: 实现课题候选序列**

  每课题只保留 `proposed`、`reserve`，前者在前；组内依次按 `decisionRank ASC, appliedAt ASC, applicationId ASC`，`reject` 与未决定不进入要约序列。

- [ ] **Step 3: 实现要约与志愿保留循环**

  课题按 `topicId` 排序进入队列并向下一名候选发出要约；学生仅保留 `priority` 数字更小的要约，相同优先级以 `topicId` 兜底。学生换到更高志愿后，把释放座位的课题重新入队，直到队列为空。

- [ ] **Step 4: 扣除锁定名额并生成完整状态计划**

  先从学生、课题容量和教师额度中扣除 `LockedAssignment`；锁定学生的其他在途申请归入 `withdrawn`。新录取学生的其他在途申请也归入 `withdrawn`，其余未命中的申请归入 `rejected`。

- [ ] **Step 5: 对结果执行内部断言**

  在返回前检查学生唯一、课题容量、教师上限、结果集合互斥和输入申请全覆盖；违反时抛出带教师或课题标识的错误，不返回部分计划。

- [ ] **Step 6: 静态场景走查**

  用代码审查表手工推演：多课题同时选择同一学生、高志愿释放低志愿席位、候补递补、锁定录取占满课题、相同排序兜底五种输入，记录每轮要约与最终集合。

- [ ] **Step 7: 构建检查**

  Run: `npm --prefix server run build`

  Expected: 匹配模块类型检查通过且不依赖 Express/MySQL。

- [ ] **Step 8: 准备聚焦提交**

  展示 Task 3 diff 和五种推演记录；获得确认后提交，建议消息：`feat: add deterministic selection matcher`。

### Task 4: 实现教师草稿服务和接口

**Files:**
- Create: `server/src/services/selectionDraftService.ts`
- Create: `server/src/routes/selectionDrafts.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/routes/applications.ts`

**Interfaces:**
- Produces: `getSelectionDraft(topicId: string, actor: SessionUser): Promise<SelectionDraftView>`。
- Produces: `saveSelectionDraft(topicId: string, actor: SessionUser, expectedVersion: number, items: DraftItemInput[]): Promise<SelectionDraftView>`。
- Produces: `submitSelectionBatch(topicId: string, actor: SessionUser, expectedVersion: number): Promise<SelectionDraftView>`。
- Produces: 规格中的三个 `/api/applications/topics/:topicId/...` 接口。
- Consumes: Task 2 表结构、Task 1 志愿规则和现有 `getTeacherStudentLimit`、`getReviewDeadline`。

- [ ] **Step 1: 实现课题访问和阶段校验**

  教师只能处理自己的当前周期课题；管理员只能读取，退回走 Task 7 专用接口。写操作只允许教师遴选阶段且必须存在有效审核截止时间，截止后返回 `409`。

- [ ] **Step 2: 实现完整草稿读取**

  返回课题、全部有效申请、当前决定、排序、批次状态、版本、截止时间、教师总限额和该教师全部课题的已选统计；学生信息沿用当前教师遴选页需要的字段。

- [ ] **Step 3: 实现带乐观锁的整份保存**

  在事务中锁批次；要求数据库 `version === expectedVersion`，否则返回 `409`。校验申请归属、决定枚举、每组排名为不重复正整数、拟录取不超过课题容量、教师跨课题拟录取总数不超过有效上限；用删除后批量插入表达“整份草稿”，最后 `version + 1` 并写操作日志。

- [ ] **Step 4: 实现名单提交**

  再次校验版本、阶段、课题容量、教师上限和配置冲突；将批次改为 `submitted` 并记录提交人/时间，不修改申请正式状态。全部课题是否已提交由 Task 5 接入结算服务后判断。

- [ ] **Step 5: 注册路由并封锁旧即时录取入口**

  将新路由挂到 `/api/applications`。当前周期进入新教师遴选阶段后，旧 `PUT /:id/review` 与 `POST /finalize-topic` 返回 `409` 和刷新页面提示，避免旧浏览器绕过结算；历史数据读取不受影响。

- [ ] **Step 6: 构建与路由审查**

  Run: `npm --prefix server run build`

  Expected: 构建成功；路由顺序确保 `/topics/:topicId/...` 不会被 `/:id` 捕获。

- [ ] **Step 7: 准备聚焦提交**

  展示 Task 4 diff；获得确认后提交，建议消息：`feat: add teacher selection draft API`。

### Task 5: 实现事务结算、幂等锁和截止任务

**Files:**
- Create: `server/src/services/selectionSettlementService.ts`
- Create: `server/src/services/selectionDeadlineWorker.ts`
- Modify: `server/src/services/selectionDraftService.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/routes/cycles.ts`

**Interfaces:**
- Produces: `runSelectionSettlement(cycleId: number, trigger: SettlementTrigger): Promise<SettlementSummary>`。
- Produces: `requestSettlementIfReady(cycleId: number, trigger: SettlementTrigger): Promise<SettlementRunResult>`。
- Produces: `checkSelectionDeadlines(now?: Date): Promise<DeadlineCheckSummary>`。
- Produces: `startSelectionDeadlineWorker(): { stop(): void }`，启动立即检查一次，此后每 60 秒检查。
- Consumes: Task 3 `buildSettlementPlan`、Task 2 数据表、现有 `transaction`、`getReviewDeadline` 和通知表。

- [ ] **Step 1: 实现结算准备与配置阻断**

  锁定周期并读取有申请课题；全部提交或已到截止时间才允许结算。校验截止配置、课题容量，以及每位教师课题名额总和不超过大于 0 的教师上限；错误信息列出教师、名额合计和上限。

- [ ] **Step 2: 将教师提交接入提前结算**

  在 `submitSelectionBatch` 提交事务完成后调用 `requestSettlementIfReady(cycleId, 'all_submitted')`；尚有课题未提交时返回等待状态，全部提交时立即进入结算。结算失败不回滚已经成功提交的教师批次，而是记录失败状态供管理员重试。

- [ ] **Step 3: 实现 MySQL 命名锁和结算状态机**

  在同一专用连接上执行 `GET_LOCK('gpss:selection-settlement:<cycleId>', 0)` 和 `RELEASE_LOCK`。已 `completed` 返回既有摘要；`running` 且锁不可得返回进行中；失败写 `failed` 和错误文本，允许管理员以 `admin_retry` 重试。

- [ ] **Step 4: 实现截止自动提交**

  到期时为每个有申请且未提交的课题创建或锁定批次，将状态改为 `auto_submitted`；保留已有草稿，没有草稿的申请不补决定。批量动作写操作日志。

- [ ] **Step 5: 在单事务中应用匹配计划**

  使用 Task 3 计划批量写 `accepted`、`withdrawn`、`rejected`，更新课题 `full/published`，写学生和教师通知、操作日志、批次 `settled` 和结算摘要。任何一步失败都回滚正式结果，再在独立短事务中把结算记录标为 `failed`。

- [ ] **Step 6: 启动截止工作器并处理退出**

  `app.listen` 成功后启动工作器；保存 interval 句柄，在 `SIGTERM`/`SIGINT` 时停止 interval 后关闭 HTTP server。启动检查覆盖截止期间停机后的补执行。

- [ ] **Step 7: 阻断无截止时间的阶段切换**

  在周期更新接口中，当目标阶段为 `teacher_review` 时要求 `getReviewDeadline` 有效，并执行教师名额配置检查；返回可供管理员页面直接展示的中文阻断原因。

- [ ] **Step 8: 构建和事务边界审查**

  Run: `npm --prefix server run build`

  Expected: 构建成功；人工确认命名锁始终在 `finally` 释放、正式状态只在一个事务内写入、失败记录不伪装为部分成功。

- [ ] **Step 9: 准备聚焦提交**

  展示 Task 5 diff；获得确认后提交，建议消息：`feat: settle selections at review deadline`。

### Task 6: 改造教师遴选页面

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/index.ts`
- Create: `src/stores/selectionDraft.ts`
- Modify: `src/views/teacher/SelectionReview.vue`
- Modify: `src/views/Dashboard.vue`

**Interfaces:**
- Produces: `selectionDraftApi.get(topicId)`、`.save(topicId, payload)`、`.submit(topicId, payload)`。
- Produces: Pinia store `useSelectionDraftStore()`，管理按课题缓存的 `SelectionDraftView`、保存中、提交中和版本冲突状态。
- Consumes: Task 4 教师接口、Task 1 `formatPriority`。

- [ ] **Step 1: 增加前端草稿类型、API 和 store**

  类型与后端字段保持一致；保存成功用响应中的新版本覆盖本地版本。`409` 时提示“草稿已被其他页面更新”，重新拉取后由教师决定是否继续编辑。

- [ ] **Step 2: 将逐条即时审批改为本地草稿编辑**

  每行提供“拟录取、候补、不录取、清除决定”；操作仅更新本地草稿。顶部显示课题名额、四类数量、教师总上限与审核截止时间。

- [ ] **Step 3: 增加拟录取和候补排序**

  两组分别使用原生拖放手柄，并提供上移/下移按钮；每次移动重新生成从 1 开始的 `decisionRank`，键盘和移动端也可完成排序。

- [ ] **Step 4: 接入保存和提交**

  “保存草稿”发送整份决定与当前版本；“提交本课题名单”先保存未保存修改，再展示容量、拟录取、候补和未处理数，二次确认后提交。提交态和自动提交态变为只读。

- [ ] **Step 5: 更新教师工作台状态**

  待办数量改为未提交课题数；已提交显示“等待统一结算”，结算完成后引导查看正式结果。

- [ ] **Step 6: 构建检查**

  Run: `npm run build`

  Expected: Vue 类型检查与生产构建成功；页面不再调用 `reviewApplication` 或 `finalizeTopic`。

- [ ] **Step 7: 准备聚焦提交**

  展示 Task 6 diff；获得确认后提交，建议消息：`feat: add teacher selection draft workspace`。

### Task 7: 增加管理员结算监控和退回能力

**Files:**
- Create: `server/src/routes/selectionAdmin.ts`
- Modify: `server/src/index.ts`
- Modify: `src/api/index.ts`
- Create: `src/views/admin/SelectionSettlement.vue`
- Modify: `src/router/index.ts`
- Modify: `src/layouts/MainLayout.vue`
- Modify: `src/views/admin/CycleManagement.vue`

**Interfaces:**
- Produces: `GET /api/admin/selection-settlement/:cycleId`。
- Produces: `POST /api/admin/selection-topics/:topicId/unlock`，请求体 `{ reason: string }`。
- Produces: `POST /api/admin/selection-settlement/:cycleId/run`，仅在全部提交、已截止或上次失败时执行。
- Consumes: Task 5 的结算与截止检查服务。

- [ ] **Step 1: 实现管理员进度查询**

  返回周期截止时间、最后检查时间、结算状态/摘要/错误，以及每课题教师、申请数、已决定数、最后保存时间、提交方式和配置冲突；无申请课题标为无需提交。

- [ ] **Step 2: 实现结算前退回**

  要求非空原因；仅 `submitted` 或 `auto_submitted` 且结算未 `running/completed` 时改回 `draft`，保留草稿项，递增版本并写包含原因的操作日志。

- [ ] **Step 3: 实现人工检查与失败重试**

  手动运行先复用准备条件；未全部提交且未截止返回 `409`。失败记录使用 `admin_retry`，已完成直接返回原摘要且不重写结果。

- [ ] **Step 4: 新增管理员页面和导航**

  路由为 `/admin/selection-settlement`，菜单名“录取结算”。页面提供进度表、未保存/未提交/配置冲突筛选、截止倒计时、退回对话框、立即检查/重试按钮和结果摘要。

- [ ] **Step 5: 在周期页面显示阶段阻断信息**

  教师遴选截止缺失或教师名额配置冲突时，保存/切换失败提示直接展示后端具体原因，并提供跳转到“录取结算”。

- [ ] **Step 6: 构建检查**

  Run: `npm run build:all`

  Expected: 前后端构建成功；管理员路由受 `admin` 角色保护，教师无法调用退回和重试。

- [ ] **Step 7: 准备聚焦提交**

  展示 Task 7 diff；获得确认后提交，建议消息：`feat: add selection settlement administration`。

### Task 8: 对齐学生状态、通知和结果页

**Files:**
- Modify: `src/views/student/SelectionWorkspace.vue`
- Modify: `src/views/student/MyResult.vue`
- Modify: `src/views/student/Adjustment.vue`
- Modify: `src/views/process/NotificationView.vue`
- Modify: `src/views/teacher/MyResults.vue`
- Modify: `server/src/routes/applications.ts`
- Modify: `server/src/routes/statistics.ts`
- Modify: `server/src/routes/admin.ts`

**Interfaces:**
- Consumes: Task 5 写入的正式 `applications.status` 和通知类型。
- Produces: 结算前学生统一文案“等待教师遴选/统一录取”，结算后只显示正式结果和调剂入口。

- [ ] **Step 1: 隐藏草稿语义并统一等待状态**

  学生端将 `pending/submitted/pending_review` 统一显示为等待统一录取；迁移后不再向学生展示 `waitlisted` 候补身份。兼容遗留数据时也显示中性等待文案。

- [ ] **Step 2: 完善正式结果和调剂入口**

  `accepted` 显示唯一录取课题；全部志愿 `rejected/withdrawn` 且周期进入调剂阶段时显示调剂入口。不得把某一条 `withdrawn` 误判为学生未录取。

- [ ] **Step 3: 对齐通知和统计口径**

  通知页识别统一结算完成、录取、未录取三类消息；教师结果、管理员申请数据和统计仍以正式 `accepted` 为录取依据，等待统计不再依赖新增草稿状态。

- [ ] **Step 4: 全仓状态和志愿显示扫描**

  Run: `rg -n "候补待定|priorityLabel|第.*志愿|waitlisted|accepted" src server/src`

  Expected: 每个命中均被分类为迁移兼容、正式结果或中性等待，不存在把教师草稿暴露给学生的代码路径。

- [ ] **Step 5: 构建检查**

  Run: `npm run build:all`

  Expected: 前后端构建成功。

- [ ] **Step 6: 准备聚焦提交**

  展示 Task 8 diff；获得确认后提交，建议消息：`fix: align selection status across role views`。

### Task 9: 准备隔离验收与生产发布

**Files:**
- Create: `docs/releases/selection-settlement-rollout.md`
- Modify: `deployment/aliyun/README.md`

**Interfaces:**
- Consumes: Tasks 1–8 的构建产物、迁移输出和规格中的 16 个验收场景。
- Produces: 发布前检查、备份、迁移核对、人工验收、回滚和监控步骤。

- [ ] **Step 1: 编写发布检查清单**

  记录生产前必须查询的当前周期、`waitlisted` 数、既有 `accepted` 数、每课题容量、教师名额冲突和审核截止时间；明确不在聊天或文档中保存服务器密码、私钥和数据库密码。

- [ ] **Step 2: 编写隔离数据库人工验收清单**

  将规格第 11 节的 16 个场景逐条转成“准备数据、页面/API 操作、预期状态、需截图/SQL 证据”四列。执行验收需用户后续明确要求验证。

- [ ] **Step 3: 编写发布和回滚步骤**

  沿用现有 GitHub Actions 自动发布：推送前先确认，线上脚本先备份数据库与上传文件，再重建 `gpss-app`。迁移后核对三个新表、迁移数量和容器日志；应用回滚保留新表，业务异常从部署前数据库备份恢复。

- [ ] **Step 4: 最终静态检查**

  Run: `git diff --check`

  Run: `npm run build:all`

  Expected: 无空白错误，前后端构建成功。自动化测试和隔离数据库验收在获得用户明确验证授权后执行。

- [ ] **Step 5: 准备文档提交**

  展示 Task 9 diff；获得确认后提交，建议消息：`docs: add selection settlement rollout guide`。

- [ ] **Step 6: 请求推送与生产发布确认**

  汇总全部本地提交、数据库影响、迁移预估数量、构建结果和未执行的验收项。用户确认后才推送 `main`；推送触发自动部署后，核对 GitHub Actions、健康检查、迁移日志和三个角色页面。
