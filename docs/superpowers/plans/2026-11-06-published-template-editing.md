# Published Template Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Administrators can edit published templates while preserving all bound student materials.
**Architecture:** A transaction service locks and rechecks the source version and bindings; the existing mapping dialog provides editing and preview. No schema or dependency changes.
**Tech Stack:** Vue 3, Element Plus, Express, TypeScript, MySQL, node:test.
**Spec:** docs/superpowers/specs/2026-11-06-published-template-editing-design.md

## Global Constraints

- 未被学生使用时直接修改；已有学生使用时自动另存新版，旧材料保留原版本。
- 上传原件不覆盖。不增加Word排版编辑器、文件替换、跨周期/资料类型移动。
- 只允许管理员；保留既有预览与确认；不修改学生填写记录。

## Review Focus

- Save after a student binds: recheck under the same template lock and create a new version.
- A stale administrator editor must fail rather than overwrite a newer edit.
- Duplicate version or database failure must not leave copied files or partial updates.
- A bound source and the new version must have independent files, so deleting one cannot break the other.
- Profile or metadata changes after preview must invalidate preview confirmation.

## Task 1: Transaction service and administrator routes

Files: create server/src/services/templateEditingService.ts and test/template-editing.test.mjs; modify server/src/routes/documentTemplates.ts and package.json.
Interfaces: getTemplateEditState(id); editPublishedTemplate(id, input, actor). GET/PUT /api/document-templates/:id/edit return the saved template ID, mode and version.
- [x] Write and run failing tests for unbound update, bound copy, concurrent binding, stale revision, unique version, invalid input and rollback cleanup.
- [x] Implement snapshot hashing, metadata/profile validation, transactional binding check, independent copy and operation log.
- [x] Attach administrator-only routes and run service/permission tests.

## Task 2: Existing dialog editing and verification

Files: modify src/api/index.ts, src/views/process/DocumentTemplates.vue, src/types/index.ts if required; extend test/template-editing.test.mjs.
- [x] Add edit API methods and a published-row Edit button; reuse the mapping dialog for metadata and content.
- [x] Explain update/new-version behavior; require current preview confirmation and invalidate it on changes.
- [x] Save atomically through the new route, reload the library and show actual saved mode/version.
- [x] Run complete npm test, npm run build and git diff --check; verify administrator UI in browser with isolated mock data.
- [x] Perform final code review; resolve findings and record verification. Do not mutate a real template as a test.

## Execution record

- User approved the recommended behavior with “执行”. Implemented inline in the existing isolated worktree on feat/edit-published-templates.
- 190 regression tests, frontend/server builds and git diff --check passed.
- Independent reviewer found no critical or important defect; reviewed template locks, immutable versions, revision checks, permission guards and file cleanup.
- Browser checks with local mock interfaces passed: metadata/fixed-content editing, preview invalidation, direct save and versioned save. No production template was changed to test this feature.
- Browser verification found expanded rows collapsed while typing; row-key="id" now preserves them.
- Database transaction/concurrency tests use test doubles; no real MySQL concurrent-writer test was run.

### Deployment verification ruling

The first publish loaded the correct feature source and compiled files, but its container retained an old equal-size DEPLOY_COMMIT with tar timestamp zero. Health-only CI incorrectly passed. The release marker now uses commit time, and the supported deploy path passes the complete validated hash as a Docker build argument and stamps it in an independent RUN; post-health comparison rejects stale versions and uses the existing rollback. Both normal build and rollback use the same build helper. Tests cover equal file size/timestamp with different hashes, actual temporary Git packaging and runtime version rejection. Full suite: 193 passing; deployment subset: 14 passing; independent follow-up review found no remaining important issue.
