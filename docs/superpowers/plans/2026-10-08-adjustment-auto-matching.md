# 调剂补录学生志愿自动匹配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 将 GPSS 调剂补录改为学生提交 1–6 个有序志愿、截止后按学生偏好和确定性随机优先规则自动录取，并上线到生产环境。

**Architecture:** 保留现有调剂志愿、事务、截止任务、结算锁和正式申请表；替换教师审批驱动的匹配计划为学生提议式匹配。学生端和服务端共用一致的专业、课题余量及教师总名额资格，教师调剂页面和写接口停用，管理员页面显示自动匹配进度。

**Tech Stack:** Vue 3、TypeScript、Express、MySQL 8、Node.js 内置测试、Docker Compose、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-10-08-adjustment-auto-matching-design.md`

## Global Constraints

- 学生补录志愿数量为 1–6，不要求覆盖多位教师。
- 匹配在调剂截止后运行；截止前学生可以编辑。
- 同一教师名额竞争使用由周期、教师、学生标识确定的可复核哈希优先序，不使用 GPA 或提交先后。
- 一名学生最多录取一个课题；不突破课题容量和教师总指导上限。
- 保留旧批次、草稿项、`adjustments` 历史记录，不执行破坏性迁移。
- 部署前备份数据库与上传目录；本次不手工写生产业务数据、不触发生产调剂结算。
- 生产部署仅重建 GPSS 服务，不重建半山学堂。
- 只提交本计划的文件；保留工作区既有手册修改及 `output/`、`tmp/` 文件。

## Review Focus

- 多课题共用教师总名额时，匹配结果同时满足课题容量和教师上限；Task 1 测试共享教师容量且候选继续尝试下一志愿。
- 学生获得更高志愿课题后，低志愿已暂留名额须释放并继续递补；Task 1 测试置换后名额释放。
- 同一输入在不同候选数组顺序和重试中必须产生相同结果；Task 1 测试输入乱序稳定性。
- 截止前没有教师提交批次也不能提前结算，截止后即使无志愿也完成幂等结算；Task 3 测试截止门槛和空结算。
- 教师旧页面/API不能再改变补录录取结果；Task 4 测试旧写接口停用且管理员不能提前结束填报。

---

## Files and Interfaces

- Modify `server/src/services/selectionMatcher.ts`: export `buildAdjustmentMatchingPlan(input: AdjustmentMatchingInput): AdjustmentMatchingPlan`; use student preference order and deterministic teacher/student lottery ranks.
- Modify `server/src/services/adjustmentVolunteerService.ts`: compute eligible topics with per-topic accepted count and per-teacher accepted count; enforce 1–6 distinct same-major open topics without teacher diversity constraint.
- Modify `server/src/services/adjustmentSettlementService.ts`: wait until deadline; snapshot eligible candidates and locked accepted assignments; call matcher, atomically write accepted/withdrawn/rejected states, notifications, logs, and result summary.
- Modify `server/src/routes/adjustmentVolunteers.ts` and `server/src/routes/selectionAdmin.ts`: retire teacher mutation/unlock routes and disallow early admin settlement while retaining failed-settlement retry.
- Modify `src/views/student/Adjustment.vue`, `src/views/teacher/AdjustmentReview.vue`, `src/layouts/MainLayout.vue`, `src/views/admin/AdjustmentSettlement.vue`: update student requirements, remove teacher workflow entry, show retired teacher page, and show automatic matching progress/results to admins.
- Create `test/adjustment-auto-matching.test.mjs`: exercise the compiled pure matching function and source/API regression cases using existing Node test conventions.
- Modify `docs/adjustment-volunteers-release-checklist.md`: replace teacher review acceptance items with automatic matching and publish checks.
- Modify `docs/superpowers/specs/2026-10-08-adjustment-auto-matching-design.md`: keep implementation/deployment status current only if necessary.

### Task 1: Deterministic student preference matcher

**Files:**
- Modify: `server/src/services/selectionMatcher.ts`
- Create: `test/adjustment-auto-matching.test.mjs`

**Interface:**
- Input contains volunteers `{ applicationId, studentId, topicId, teacherId, priority }`, topics `{ topicId, teacherId, capacity }`, existing accepted assignments, `teacherLimit`, and `cycleId`.
- Output contains accepted, withdrawn, rejected volunteer IDs, unmatched students, accepted topic counts, and lottery algorithm version.

- [ ] Write failing tests for one student getting their top available topic, a rejected high choice advancing to the next, same-topic competition, shared teacher quota, displacement/requeue, stable tie resolution with shuffled inputs, and existing accepted students staying locked.
- [ ] Run `npm --prefix server run build && node --test test/adjustment-auto-matching.test.mjs`; confirm failures are due to the missing matcher.
- [ ] Implement the deterministic deferred acceptance algorithm. Rank candidates by SHA-256 of `cycleId:teacherId:studentId`; apply the same teacher rank across that teacher's topics so the shared teacher quota is coherent.
- [ ] Re-run the targeted test file and require all assertions to pass.

### Task 2: Student eligibility and 1–6 volunteer validation

**Files:**
- Modify: `server/src/services/adjustmentVolunteerService.ts`
- Modify: `src/views/student/Adjustment.vue`
- Modify: `test/adjustment-auto-matching.test.mjs`

- [ ] Add regression assertions for count bounds, no two-teacher requirement, same-major published topic filtering, topic capacity, and teacher aggregate capacity.
- [ ] Run the relevant matcher/regression checks and confirm new assertions fail against current behavior.
- [ ] Update eligible-topic SQL to count accepted students by topic and teacher. Respect `teacher_student_limit <= 0` as unlimited, and hide topics for teachers already at limit.
- [ ] Update save validation to accept 1–6 unique topics and remove teacher-count validation; recheck eligibility under transaction locks before replacing a student's list.
- [ ] Update the page copy and empty states to explain the 1–6 preference workflow, deadline, and automatic matching; remove the minimum-three and multi-teacher checks.
- [ ] Build frontend/backend and re-run focused matching regressions.

### Task 3: Deadline-only automatic settlement

**Files:**
- Modify: `server/src/services/adjustmentSettlementService.ts`
- Modify: `server/src/services/selectionDeadlineWorker.ts` only if trigger wiring needs adjustment
- Modify: `test/adjustment-auto-matching.test.mjs`

- [ ] Add regression checks that pre-deadline requests wait, deadline requests settle even with zero volunteers, and a completed settlement is idempotent.
- [ ] Run the checks and confirm current all-topics-submitted behavior fails the deadline-only assertions.
- [ ] Remove dependency on `adjustment_batches` and `adjustment_draft_items` from readiness and match planning; keep the legacy tables untouched.
- [ ] Lock the cycle and relevant applications/topics, filter students already accepted, build the input from `adjustment_volunteers` with `status='submitted'`, then call Task 1 matcher.
- [ ] Within the existing transaction and named lock, write formal accepted applications, volunteer terminal states, topic fullness, notifications, audit log, and settlement summary. Record algorithm version and deterministic priority method.
- [ ] Make admin retry available only for failed settlement; ensure no route can finalize a not-yet-due cycle.
- [ ] Run targeted tests and TypeScript builds.

### Task 4: Remove teacher review and update administrator progress

**Files:**
- Modify: `server/src/routes/adjustmentVolunteers.ts`
- Modify: `server/src/routes/selectionAdmin.ts`
- Modify: `src/views/teacher/AdjustmentReview.vue`
- Modify: `src/layouts/MainLayout.vue`
- Modify: `src/views/admin/AdjustmentSettlement.vue`
- Modify: `test/adjustment-auto-matching.test.mjs`

- [ ] Add regression checks for retired teacher write routes and no early admin settlement action.
- [ ] Change teacher save/submit endpoints to return `410`; preserve read-only historical data. Remove the teacher menu item and make direct route visits show an explanatory retired-workflow state.
- [ ] Remove admin unlock and pre-deadline run controls. Show eligible students, volunteer totals, deadline, settlement status, and result summary; offer retry only after failure.
- [ ] Re-run route/UI regressions and frontend/backend builds.

### Task 5: Release documentation, production backup, deployment, and acceptance

**Files:**
- Modify: `docs/adjustment-volunteers-release-checklist.md`
- Modify: only implementation files from Tasks 1–4 in the deploy commit; preserve unrelated workspace changes.

- [ ] Update the release checklist for automatic matching, student 1–6 preference entry, deadline-only settlement, role checks, and rollback evidence.
- [ ] Run `npm run build:all` and the focused automatic matching test file; inspect `git diff --check` and ensure no secrets or unrelated files are staged.
- [ ] Create a commit containing only this implementation, push to `main`, and monitor `.github/workflows/deploy-gpss.yml` through completion; the existing deploy script backs up the production database and upload directories and deploys GPSS only.
- [ ] Confirm deploy workflow health check succeeds; verify production `/api/health`, current active cycle/deadline, adjustment configuration, student eligibility/list rendering, teacher page retirement, and admin settlement status without executing a settlement.
- [ ] Record deployment run, backup location/checksum, deployed commit, role checks, and any unverified production state in the final report.

## Deployment Stop Conditions

- If the production workflow, backup creation, release artifact, or post-deploy health check fails, stop automatic progression and follow the existing rollback script/runbook; do not manually rewrite production data.
- If production has an already-running or completed adjustment settlement for the active cycle, do not overwrite it; report the observed status and stop before any business-data mutation.
- If role acceptance requires real student/teacher accounts unavailable to the deployment session, verify through permitted read-only API/config evidence and state the exact role flows not exercised.
