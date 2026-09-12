#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# 半山学堂统一部署「一键升级」脚本(服务器端执行)
#
# 用法:
#   bash upgrade-gpss.sh <升级包.tar.gz> [升级包.tar.gz.sha256]
# 例:
#   bash upgrade-gpss.sh /tmp/gpss-upgrade-20260901.tar.gz \
#                        /tmp/gpss-upgrade-20260901.tar.gz.sha256
#
# 前置条件:
#   - root 或具备 docker 权限的用户
#   - 升级包(及校验文件)已上传到服务器
#   - 服务器上已有统一部署目录 /opt/banshan-academy/deployment/unified
#
# 脚本按顺序执行:
#   校验 → 备份 → 解压 → 环境迁移 → 校验 compose → 库账号迁移 → 重建(两个应用) → 重启 → 健康检查
# 数据卷(/opt/banshan/mysql、/opt/gpss/uploads、/opt/gpss/uploads-private)不会被删除。
#
# 重建范围:
#   同时重建 gpss-app(毕业设计管理系统, 3011) 与 banshan-app(半山学堂, 3012)。
#   两个应用同属一个 compose 项目、共享 MySQL 与 Nginx；只重建其中一个会造成
#   版本错配，因此本脚本默认一并重建。
#
# 关于「环境迁移」步骤(3/8):
#   统一部署把数据库密码从旧的单个 DB_PASSWORD 拆成了
#   BANSHAN_DB_PASSWORD / GPSS_DB_PASSWORD，用户从 app 拆成 banshan/gpss，
#   且用 ${VAR:?...} 必填语法。旧服务器上的 .env 没有新键时，
#   `docker compose config` 会直接退出非 0 导致升级中止(表现为「版本冲突」)。
#   本步骤在 compose 校验前自动补全缺失键（不覆盖已有值）。
#
# 关于「库账号迁移」步骤(5/8):
#   mysql-init 只在数据目录为空时执行；已有数据的服务器上新账号不会被创建。
#   本步骤幂等补建 banshan/gpss 账号与授权。
# ============================================================

PKG="${1:-}"
SHA_FILE="${2:-}"
DEPLOY_DIR=/opt/banshan-academy/deployment/unified

if [ -z "$PKG" ]; then
  echo "用法: bash upgrade-gpss.sh <升级包.tar.gz> [升级包.tar.gz.sha256]" >&2
  exit 1
fi

say()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m错误: %s\033[0m\n' "$*" >&2; exit 1; }
warn() { printf '\033[1;33m警告: %s\033[0m\n' "$*"; }

for cmd in tar docker; do
  command -v "$cmd" >/dev/null 2>&1 || err "缺少命令: $cmd"
done
CHECKSUM_CMD=sha256sum
command -v sha256sum >/dev/null 2>&1 || CHECKSUM_CMD="shasum -a 256"

[ -f "$PKG" ] || err "找不到升级包: $PKG"
[ -d "$DEPLOY_DIR" ] || err "未找到统一部署目录: $DEPLOY_DIR"

# 进入编排目录,使 docker compose 能读取同目录 .env(数据库密码/JWT 等真实配置)
cd "$DEPLOY_DIR"
COMPOSE=(docker compose)

# ---- 0. 校验包完整性 ----
say "0/8 校验包完整性"
if [ -n "$SHA_FILE" ] && [ -f "$SHA_FILE" ]; then
  expected=$($CHECKSUM_CMD "$PKG" | awk '{print $1}')
  recorded=$(awk '{print $1}' "$SHA_FILE")
  if [ "$expected" = "$recorded" ]; then
    echo "    ✓ 校验通过 ($recorded)"
  else
    err "校验失败(包被损坏或与校验文件不匹配),已中止"
  fi
else
  warn "未提供校验文件,跳过完整性校验(生产环境建议提供)"
fi

# ---- 1. 备份 ----
say "1/8 备份(数据库 + 上传文件 + 旧源码)"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/opt/gpss/backup
mkdir -p "$BACKUP_DIR"

if docker compose ps --services 2>/dev/null | grep -qx mysql; then
  "${COMPOSE[@]}" exec -T mysql sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --no-tablespaces --single-transaction --routines --triggers gpss' \
    | gzip > "$BACKUP_DIR/gpss-$STAMP.sql.gz" || err "数据库备份失败,已中止升级"
  echo "    ✓ 数据库 → $BACKUP_DIR/gpss-$STAMP.sql.gz"
else
  warn "MySQL 服务未运行,跳过数据库备份(如非首次升级请人工确认)"
fi

if [ -d /opt/gpss/uploads ]; then
  tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C /opt/gpss/uploads . || err "上传文件备份失败,已中止升级"
  echo "    ✓ 上传文件 → $BACKUP_DIR/uploads-$STAMP.tar.gz"
fi
[ -d /opt/gpss-src ] && cp -a /opt/gpss-src "/opt/gpss-src.bak-$STAMP" && echo "    ✓ 旧 GPSS 源码 → /opt/gpss-src.bak-$STAMP" || warn "未备份旧 gpss-src(不存在?)"
[ -d /opt/banshan-academy ] && cp -a /opt/banshan-academy "/opt/banshan-academy.bak-$STAMP" && echo "    ✓ 旧 banshan → /opt/banshan-academy.bak-$STAMP" || true
# 务必单独备份 .env —— 它不在源码包内,一旦损坏无法从包恢复
[ -f "$DEPLOY_DIR/.env" ] && cp -a "$DEPLOY_DIR/.env" "$BACKUP_DIR/env-$STAMP.bak" && echo "    ✓ .env → $BACKUP_DIR/env-$STAMP.bak" || warn "未找到 $DEPLOY_DIR/.env"

# ---- 2. 解压 ----
say "2/8 解压升级包"
cd /opt
rm -rf gpss-src banshan-academy
tar -xzf "$PKG"
[ -f /opt/gpss-src/vite.config.ts ] || err "解压后未找到 gpss-src 源码"
[ -f /opt/banshan-academy/deployment/unified/docker-compose.yml ] || err "解压后未找到统一编排文件"
echo "    ✓ gpss-src 与 banshan-academy 已就位"

# ---- 3. 环境迁移(必须在 compose 校验之前) ----
say "3/8 环境变量迁移与预检"
MIGRATE_ENV=/opt/gpss-src/deployment/migrate-env.sh
if [ -f "$MIGRATE_ENV" ]; then
  # 该脚本自己负责备份 .env 并输出缺失的必填变量
  DEPLOY_DIR="$DEPLOY_DIR" bash "$MIGRATE_ENV" || err "环境变量迁移失败(见上方提示)"
else
  warn "包内缺少 migrate-env.sh,跳过自动补全"
  # 无迁移脚本时的兜底：直接给出明确的缺失清单，而不是让 compose 报晦涩错误
  MISSING=""
  for k in $(grep -oE '\$\{[A-Z_]+:\?' "$DEPLOY_DIR/docker-compose.yml" 2>/dev/null | sed 's/\${//; s/:?//' | sort -u); do
    grep -qE "^[[:space:]]*$k=" "$DEPLOY_DIR/.env" 2>/dev/null || MISSING="$MISSING $k"
  done
  [ -n "$MISSING" ] && err "以下必填变量缺失，请补进 $DEPLOY_DIR/.env 后重试:$MISSING"
fi

# ---- 4. 校验 compose ----
say "4/8 校验 compose 配置"
cd "$DEPLOY_DIR"
if ! "${COMPOSE[@]}" config >/dev/null 2>"$BACKUP_DIR/compose-config-$STAMP.err"; then
  echo "    compose 报错原文:" >&2
  sed 's/^/      /' "$BACKUP_DIR/compose-config-$STAMP.err" >&2
  err "compose 配置无效(完整输出见 $BACKUP_DIR/compose-config-$STAMP.err)"
fi
check_ctx() {
  local svc="$1" c
  c=$("${COMPOSE[@]}" config | awk -v s="  $svc:" '$0==s{f=1} f&&/context:/{print $2; exit}')
  echo "    $svc build context: ${c:-未找到}"
  [ -n "$c" ] && [ -d "$c" ] || err "$svc 的构建上下文目录不存在: ${c:-空}"
}
check_ctx gpss-app
check_ctx banshan-app

# ---- 5. 库账号迁移 ----
say "5/8 迁移 MySQL 账号(幂等)"
MIGRATE_DB=/opt/gpss-src/deployment/migrate-db-users.sh
if [ -f "$MIGRATE_DB" ]; then
  # 确保 mysql 在运行(mysql-init 只在数据目录为空时生效,已有数据卷需显式补建账号)
  "${COMPOSE[@]}" up -d mysql >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    "${COMPOSE[@]}" ps --services --status running 2>/dev/null | grep -qx mysql && break
    sleep 2
  done
  DEPLOY_DIR="$DEPLOY_DIR" bash "$MIGRATE_DB" || err "库账号迁移失败(见上方提示)"
else
  warn "包内缺少 migrate-db-users.sh,跳过账号补建"
fi

# ---- 6. 构建 ----
say "6/8 构建镜像 gpss-app + banshan-app(首次约数分钟)"
# 不带服务名 = 构建 compose 中所有带 build 的服务，避免只重建一个造成版本错配
"${COMPOSE[@]}" build

# ---- 7. 重启 ----
say "7/8 重启应用(容器启动会自动执行幂等迁移)"
"${COMPOSE[@]}" up -d gpss-app banshan-app
# nginx 若被一并重建/移除，这里补起(已在运行则无操作)
"${COMPOSE[@]}" up -d nginx >/dev/null 2>&1 || true

# ---- 8. 等待就绪 ----
say "8/8 等待服务就绪(最多 120 秒)"
wait_ready() {
  local svc="$1" port="$2" label="$3" i
  for i in $(seq 1 60); do
    if "${COMPOSE[@]}" exec -T "$svc" node -e "fetch('http://127.0.0.1:$port/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      echo "    ✓ $label ($svc:$port) 已就绪"
      return 0
    fi
    sleep 2
  done
  return 1
}
wait_ready gpss-app    3011 "毕业设计管理系统" || err "gpss-app 120 秒内未就绪,请查看: ${COMPOSE[*]} logs --tail=100 gpss-app"
wait_ready banshan-app 3012 "半山学堂"         || err "banshan-app 120 秒内未就绪,请查看: ${COMPOSE[*]} logs --tail=100 banshan-app"

# ---- 完成 ----
say "升级完成"
"${COMPOSE[@]}" ps
echo ""
echo "浏览器访问验证:"
echo "  半山学堂          http://<服务器IP>/"
echo "  毕业设计管理系统  http://<服务器IP>/gpss/"
echo "登录后可抽查任务书/导出/公告；半山学堂页脚应有 ICP 备案号。"
echo "本次备份: $BACKUP_DIR/*-$STAMP*"
echo "回滚方法: 见 /opt/gpss-src/deployment/docs/统一部署升级.md(换回 .bak 目录再重建)。"
