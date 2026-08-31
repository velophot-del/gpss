# 学生教师体验改版候选版本部署与验收报告

验收日期：2026-08-23（Asia/Shanghai）

## 环境

- 候选目录：`/Users/tangwang/Desktop/27毕业设计课题系统/20260823_学生教师体验改版`
- 原项目：`/Users/tangwang/Desktop/27毕业设计课题系统/20260624152159`，保留为稳定回退版本
- 访问地址：`http://127.0.0.1:3011`，仅本机回环地址
- Node.js：`v24.19.0`，`arm64`
- MySQL：现有 MySQL 9.6，通过 `/tmp/mysql.sock`
- 验证数据库：`gpss_ui_20260823`
- 原业务库：`gpss_db` 未作为候选版本连接目标

候选 `server/.env` 使用独立 JWT 密钥、`HOST=127.0.0.1`、`PORT=3011`、`FRONTEND_URL=http://127.0.0.1:3011`。`./start.sh` 只运行已构建的生产后端，由 Express 提供 `dist/` 静态前端，不会自动安装依赖、初始化数据库或执行种子脚本。

## 日常操作

```bash
cd "/Users/tangwang/Desktop/27毕业设计课题系统/20260823_学生教师体验改版"
./start.sh
```

停止：在运行 `start.sh` 的终端按 `Ctrl+C`。修改源代码后执行：

```bash
npm run build:all
./deploy-check.sh
./start.sh
```

## 验收结果

- `bash -n start.sh deploy-check.sh`：通过。
- `npm run build:all`：通过；前端 `dist/index.html`、后端 `server/dist/index.js` 存在。
- `./deploy-check.sh`：22 项通过、0 项失败；Rollup 与 esbuild 均为 arm64 原生包。
- `/api/health` 和 `/`：HTTP 200；未授权受保护接口：HTTP 401。
- 学生访问教师接口、教师访问管理员接口：HTTP 403。
- 服务监听：仅 `127.0.0.1:3011`。
- 学生浏览、筛选、加入清单、选择 3 个志愿、确认顺序、提交、查看凭证/记录并刷新保留。
- 教师查看待办、剩余名额并审批；已处理记录不再显示冲突操作。
- `390×844`、`768×1024`、`1440×900` 页面截图已保存到 `qa/screens/`。
- 候选库包含 9 张业务表。专用课题“验收专用｜教师学生体验｜20260823”审批后为 `status=full`、`max_students=1`、已录取数 1。
- 原 `gpss_db` 只读复核行数：`adjustments=0`、`applications=0`、`cycles=1`、`operation_logs=33`、`student_profiles=295`、`system_configs=7`、`topic_shortlist=1`、`topics=16`、`users=366`；原项目 Git 状态记录仍为 4320 条。

## 交付文件

- `改版说明.md`：界面方向、使用方式和限制。
- `验收记录.md`：静态、运行、浏览器和数据验收证据。
- `改版实施记录.md`：复制基线、实施范围与完整记录。

## 限制

- 这是候选版本，未替换原项目；未提交 Git、未发布公网、未删除数据库。
- 保留演示账号和 `xlsx` 依赖风险；不导入不可信 Excel。
- 本轮不处理公网生产化安全整改和审批并发之外的架构升级。
- 提交凭证保存在当前浏览器 `localStorage`，清理站点数据后需重新提交才会生成新的凭证。
