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
# 脚本按顺序执行:校验 → 备份 → 解压 → 校验 compose → 重建 → 重启 → 健康检查。
# 数据卷(/opt/banshan/mysql、/opt/gpss/uploads、/opt/gpss/uploads-private)不会被删除。
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
say "0/7 校验包完整性"
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
say "1/7 备份(数据库 + 上传文件 + 旧源码)"
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

# ---- 2. 解压 ----
say "2/7 解压升级包"
cd /opt
rm -rf gpss-src banshan-academy
tar -xzf "$PKG"
[ -f /opt/gpss-src/vite.config.ts ] || err "解压后未找到 gpss-src 源码"
[ -f /opt/banshan-academy/deployment/unified/docker-compose.yml ] || err "解压后未找到统一编排文件"
echo "    ✓ gpss-src 与 banshan-academy 已就位"

# ---- 3. 校验 compose ----
say "3/7 校验 compose 配置"
cd "$DEPLOY_DIR"
"${COMPOSE[@]}" config >/dev/null || err "compose 配置无效,请检查"
ctx=$("${COMPOSE[@]}" config | awk '/^  gpss-app:/{f=1} f&&/context:/{print $2; exit}')
echo "    gpss-app build context: ${ctx:-未找到}"
[ -n "$ctx" ] && [ -d "$ctx" ] || err "构建上下文目录不存在: $ctx"

# ---- 4. 构建 ----
say "4/7 构建 gpss-app 镜像(首次约数分钟)"
"${COMPOSE[@]}" build gpss-app

# ---- 5. 重启 ----
say "5/7 重启 gpss-app(容器启动会自动执行幂等迁移)"
"${COMPOSE[@]}" up -d gpss-app

# ---- 6. 等待就绪 ----
say "6/7 等待服务就绪(最多 120 秒)"
ready=0
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T gpss-app node -e "fetch('http://127.0.0.1:3011/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" = 1 ] || err "120 秒内未就绪,请查看: ${COMPOSE[*]} logs --tail=100 gpss-app"

# ---- 7. 总结 ----
say "7/7 升级完成"
"${COMPOSE[@]}" ps
echo ""
echo "浏览器访问 http://<服务器IP>/gpss/ 验证(admin 登录抽查任务书/导出/公告)。"
echo "回滚方法: 见 /opt/gpss-src/deployment/docs/统一部署升级.md(换回 .bak 目录再重建)。"
