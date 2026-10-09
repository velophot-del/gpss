# 管理员调整正式录取结果 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员能在当前进行中周期内，将已录取学生改录到其已有志愿或取消录取，并原子地维护结果、名额、通知和审计记录。

**Architecture:** 新增独立的 accepted-result adjustment service 与 admin API。`applications` 保持当前结果唯一来源；调剂记录和课题状态在同一事务内同步，结算汇总 JSON 保留为原始匹配快照。管理员在申请数据页通过对话框查询目标志愿并提交带原因的调整。

**Tech Stack:** TypeScript、Express、MySQL transaction、Vue 3、Element Plus、Node test runner。

**Spec:** `docs/superpowers/specs/2026-10-09-admin-accepted-result-adjustment-design.md`

## Global Constraints

- 仅允许调整 `getActiveCycle()` 当前进行中周期内的正式录取。
- 目标必须是同一学生、同一周期已有的申请；不新增未提交志愿。
- 每名学生在一个周期最多保留一条 `accepted` 申请。
- 严格执行课题名额与周期教师上限；任何校验失败整笔回滚。
- 调整原因必填；结算汇总保留原始自动匹配快照。
- 管理员使用现有 `admin` 角色，不新增角色或依赖。

## Review Focus

- 并发调整同一学生：锁学生及其周期申请，不能出现多条录取；由 Task 1 测试。
- 改录到同一教师的另一课题：教师人数计算需排除学生旧录取后再计目标录取；由 Task 1 测试。
- 调剂结算历史行缺失或已撤回：只同步同周期、同学生、同课题记录，不误改其他志愿；由 Task 1 测试。
- 当前周期/录取在页面加载后变化：提交时重新验证，拒绝陈旧目标并保持原结果；由 Task 1 测试。
- 取消录取：不要求目标志愿，当前 accepted 行转 withdrawn，结果页不再显示录取；由 Task 1 与 Task 2 测试。

---

### Task 1: 原子录取调整服务与管理员 API

**Files:**
- Create: `server/src/services/acceptedResultAdjustmentService.ts`
- Modify: `server/src/routes/selectionAdmin.ts`
- Test: `test/admin-accepted-result-adjustment.test.mjs`
- Modify: `package.json`

**Interfaces:**
- `getAcceptedResultAdjustmentOptions(actor: SessionUser, applicationId: string)` returns the active-cycle accepted application, the student's existing same-cycle target applications, current topic and teacher counts/caps, and each target's `eligible` flag.
- `adjustAcceptedResult(actor: SessionUser, applicationId: string, targetApplicationId: string | null, reason: string, ipAddress: string | null)` returns `{ cycleId, studentId, oldApplicationId, newApplicationId }`; `null` target means cancel acceptance.
- `GET /api/admin/accepted-results/:applicationId/options` calls the options interface.
- `POST /api/admin/accepted-results/:applicationId/adjust` accepts `{ targetApplicationId: string | null, reason: string }`.

- [x] **Step 1: Add failing service regression cases**

Add cases for successful transfer, cancellation, non-current application, target belonging to another student/cycle, missing reason, topic cap, teacher cap, same-teacher move excluding old seat, settlement running, rollback on failure, audit/notifications, adjustment-volunteer synchronization, and preserving result JSON snapshots.

- [x] **Step 2: Run the new test and verify it fails for missing service behavior**

Run: `node --test test/admin-accepted-result-adjustment.test.mjs`
Expected: failures identify the missing service/API behavior.

- [x] **Step 3: Implement transactional adjustment service**

Lock active cycle, student, all same-cycle application rows, old/target topics, settlement rows, and related adjustment volunteers. Validate current accepted row, optional target ownership and cycle, non-empty reason, target topic availability, topic capacity and teacher capacity. Update application statuses, matching adjustment volunteer statuses, affected `published/full` topic statuses, operation log, and student/affected-teacher notifications in one transaction. Reject a running settlement and leave settlement `result_json` untouched.

- [x] **Step 4: Add admin-only options and adjust handlers**

Add the two routes to `selectionAdmin.ts`, which already applies `authMiddleware` and `requireRole(['admin'])`. Return domain errors with their status codes; log and return 500 for unexpected errors.

- [x] **Step 5: Add the test to the project test command and verify service/API behavior**

Run: `node --test test/admin-accepted-result-adjustment.test.mjs`
Expected: all new cases pass, including persisted state and rollback assertions.

- [ ] **Step 6: Commit backend change**

```bash
git add server/src/services/acceptedResultAdjustmentService.ts server/src/routes/selectionAdmin.ts test/admin-accepted-result-adjustment.test.mjs package.json
git commit -m "feat: add audited admin accepted result adjustment"
```

### Task 2: 管理员调整录取界面

**Files:**
- Modify: `src/api/index.ts`
- Modify: `src/views/admin/ApplicationData.vue`
- Test: `test/admin-accepted-result-adjustment-ui.test.mjs`
- Modify: `package.json`

**Interfaces:**
- `selectionAdminApi.getAcceptedResultOptions(applicationId: string)` calls the options endpoint from Task 1.
- `selectionAdminApi.adjustAcceptedResult(applicationId: string, data: { targetApplicationId: string | null; reason: string })` calls the adjustment endpoint from Task 1.

- [x] **Step 1: Add failing UI behavior tests**

Verify only accepted rows in the active cycle offer “调整录取”; the dialog shows current and eligible target choices with quota counts, supports cancellation without a target, requires a reason, confirms the precise before/after action, refreshes after success, and preserves form state after server rejection.

- [x] **Step 2: Run UI regression test and verify it fails before implementation**

Run: `node --test test/admin-accepted-result-adjustment-ui.test.mjs`
Expected: failures identify missing action, dialog, and submit behavior.

- [x] **Step 3: Add API client methods and adjustment dialog**

Add the two typed methods to `selectionAdminApi`. Add an action on active-cycle accepted rows in `ApplicationData.vue`; load server-calculated target eligibility and counts, show target/cancel choice and reason, require confirmation, submit, reload applications and report success/errors.

- [x] **Step 4: Run UI regression test and verify it passes**

Run: `node --test test/admin-accepted-result-adjustment-ui.test.mjs`
Expected: all UI behavior assertions pass.

- [x] **Step 5: Commit UI change**

```bash
git add src/api/index.ts src/views/admin/ApplicationData.vue test/admin-accepted-result-adjustment-ui.test.mjs package.json
git commit -m "feat: add admin accepted result adjustment dialog"
```

### Task 3: Full verification and production release

**Files:**
- No additional product files unless verification exposes a defect.

- [ ] **Step 1: Run the focused and full test suites**

Run: `node --test test/admin-accepted-result-adjustment.test.mjs test/admin-accepted-result-adjustment-ui.test.mjs`
Run: `npm test`
Expected: both commands exit 0.

- [ ] **Step 2: Build both applications and check the diff**

Run: `npm run build:all`
Run: `git diff --check`
Expected: build exits 0 and diff check reports no whitespace errors.

- [ ] **Step 3: Push authorized release to main**

Confirm working tree has only intended changes, commit any verification fixes, then push `main` to trigger `.github/workflows/deploy-gpss.yml`.

- [ ] **Step 4: Verify deployment completion and served assets**

Wait for the Actions run to succeed. Compare `/gpss/` entry JavaScript and the fresh `ApplicationData` lazy JavaScript asset against `dist` by SHA-256; verify `/gpss/api/health` returns 200. Report that database end-to-end adjustment and physical-device visual checks require authenticated user context if unavailable.
