# GPSS 自动部署启用说明

## 已实现的流程

`.github/workflows/deploy-gpss.yml` 会执行：安装锁定依赖、构建前后端、打包该提交中的 GPSS 源码、通过 SSH 上传服务器、校验包、备份数据、仅构建并替换 `gpss-app`、检查健康状态。向 `main` 推送包含应用或部署文件改动的提交后会自动运行，也可在 GitHub Actions 中手动运行；仅修改工作流本身或 `docs/**` 的提交跳过自动部署。日常保存文件不会触发上线，未提交的本地修改也不会进入发布包。

服务器脚本是 `deployment/deploy-gpss-only.sh`。它要求以 root 身份运行，并会识别已核实的 `/opt/banshan-gpss-deploy/gpss` 与 `/opt/banshan-gpss-deploy/docker-compose.yml` 布局（同时兼容旧布局）。它不会修改半山学堂源码、容器、Nginx、MySQL 数据卷或真实 `.env`。构建或健康检查失败时会尝试恢复旧 GPSS 源码并重新构建；数据库如已执行迁移，需要根据备份和迁移日志人工判断是否恢复。

## 首次启用前必须完成

1. 核对服务器实际路径、Compose 服务名、Docker 权限、磁盘余量，并核对数据库及上传文件备份位置。请在服务器上直接检查，不要在聊天中发送密码或私钥。
2. 已指定私有仓库 `velophot-del/gpss` 并将本地 `origin` 连接到 HTTPS 地址。首次推送前审阅全部未提交文件，尤其是原有业务改动和手册；不要将 `.env`、上传文件、数据库备份、私钥或本地浏览器文件纳入提交。
3. 为发布单独准备 SSH 密钥。私钥放在 GitHub 仓库 Secret `GPSS_DEPLOY_SSH_KEY`；公钥配置在服务器允许登录的账户。生产部署账户现需能写 `/opt/banshan-gpss-deploy/gpss`、`/opt/gpss/backup` 并运行 Docker；脚本当前要求 root。建议后续改用权限受限的专用部署账户。
4. 将服务器的 SSH 主机公钥经可信渠道核对指纹后，保存一整行 `known_hosts` 记录到 Secret `GPSS_DEPLOY_KNOWN_HOSTS`。不要用自动接受未知主机密钥代替核对。
5. 设置 Secret `GPSS_DEPLOY_HOST` 为服务器地址、`GPSS_DEPLOY_USER` 为登录用户名。不要把登录密码写入 Secret 或代码；此流程使用 SSH 密钥。
6. 首次手动发布已确认构建日志、备份位置和容器健康状态；学生和管理员页面的真实账号操作仍需单独验收。后续应用或部署文件推送到 `main` 时自动发布。

## 上线与回退边界

- 只允许 `main` 分支发布。仓库必须保护 `main`，限制谁能推送、合并；否则任何能推送该分支的人都能触发生产部署。
- 同一时间只运行一个 GPSS 发布任务，后续任务排队。
- 旧源码与数据库、上传文件备份位于 `/opt/gpss/backup/deploy-<时间>-<进程号>/`；脚本不自动删除历史备份，须另设保留期与磁盘监控。
- 自动回退只覆盖应用源码和容器。数据库迁移可能改变结构，不能自动还原数据库；出现迁移兼容问题时暂停后续推送，依据备份和迁移记录人工处理。
- 现有 `deployment/upgrade-gpss.sh` 会连带替换、重建半山学堂，不用于此自动流程。

## 当前状态

2026-09-26 已使用 `release/gpss-upgrade-20260926-141500.tar.gz` 手工升级阿里云上的 `gpss-app`。服务器备份位于 `/opt/gpss/backup/deploy-20260926T060320Z-4033168/`；容器健康检查、`http://www.bsxt.cc/gpss/` 访问和公网前端资源哈希已核对。此包包含当时本地未提交的业务修改，标记为 `3e30ce100b11b7e147e732a278f2ab191995035e-dirty-snapshot-20260926-135654`。此后本地仓库已连接私有 GitHub 仓库并完成命令行登录，四个部署 Secrets 与专用 SSH 密钥已配置。

同日使用 `release/gpss-two-teachers-20260926-142808.tar.gz` 再次手工升级，仅替换 `gpss-app`，使整批志愿须覆盖至少两位指导教师。用户已在当前周期的管理页面将数字媒体专业 `130508` 授权查看本专业和智能交互 `080906T` 课题；升级前后均只读核验了该矩阵，可选课题涉及 4 位教师。升级备份位于 `/opt/gpss/backup/deploy-20260926T063659Z-4046990/`，此前额外的配置变更前备份位于 `/opt/gpss/backup/policy-two-teachers-20260926T063253Z/`。GPSS 容器健康、公网 HTTP 页面及本次资源哈希已核对。

GitHub Actions 首次手动发布运行 `36231407334` 成功，服务器部署提交为 `1971970c97def7104cec2a802929f606335e583a`，备份位于 `/opt/gpss/backup/deploy-20260926T090012Z-4097782/`。发布后 `gpss-app`、MySQL 与半山学堂容器均为 healthy，公网 GPSS 页面及健康接口返回 HTTP 200。推送自动触发规则在本说明对应的提交进入 `main` 后启用；真实学生和管理员业务操作尚未验收。
