#!/usr/bin/env bash
# ============================================================
# 统一部署 MySQL 用户迁移（幂等）
#
# 问题背景：
#   旧部署用一个共享账号 app 访问两个库；统一部署改为
#   banshan / gpss 两个独立账号。新账号本该由
#   mysql-init/01-create-databases.sh 创建，但该脚本只在
#   MySQL **数据目录为空**（首次初始化）时执行。服务器上的数据卷
#   /opt/banshan/mysql 是持久化的、已有数据 —— 脚本不会再跑，
#   于是新账号永远不会被创建，应用启动即连库失败。
#
#   本脚本在容器内以 root 身份幂等补建账号、授权并校验连接。
#
# 用法：
#   bash migrate-db-users.sh            # 补建 + 校验连接
#   bash migrate-db-users.sh --check    # 只检查现状，不改动
# ============================================================
set -uo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/banshan-academy/deployment/unified}"
MODE="apply"
[ "${1:-}" = "--check" ] && MODE="check"

say()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m错误: %s\033[0m\n' "$*" >&2; }

[ -f "$DEPLOY_DIR/.env" ] || { err "未找到 $DEPLOY_DIR/.env"; exit 1; }
cd "$DEPLOY_DIR"
COMPOSE=(docker compose)

# 只取需要的键，不 source 整个文件
env_get() { grep -E "^[[:space:]]*$1=" .env | head -1 | cut -d= -f2-; }

DB_NAME_1=$(env_get BANSHAN_DB_NAME); DB_NAME_1=${DB_NAME_1:-banshan}
DB_NAME_2=$(env_get GPSS_DB_NAME);    DB_NAME_2=${DB_NAME_2:-gpss}
DB_USER_1=$(env_get BANSHAN_DB_USER); DB_USER_1=${DB_USER_1:-banshan}
DB_USER_2=$(env_get GPSS_DB_USER);    DB_USER_2=${DB_USER_2:-gpss}
DB_PASS_1=$(env_get BANSHAN_DB_PASSWORD)
DB_PASS_2=$(env_get GPSS_DB_PASSWORD)

for v in "BANSHAN_DB_PASSWORD:$DB_PASS_1" "GPSS_DB_PASSWORD:$DB_PASS_2"; do
  [ -n "${v#*:}" ] || { err "${v%%:*} 为空，请先运行 migrate-env.sh"; exit 1; }
done

if ! "${COMPOSE[@]}" ps --services --status running 2>/dev/null | grep -qx mysql; then
  err "mysql 服务未运行，请先执行：${COMPOSE[*]} up -d mysql"
  exit 1
fi

say "当前 MySQL 账号"
"${COMPOSE[@]}" exec -T mysql sh -c \
  'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B -e "SELECT user, host FROM mysql.user ORDER BY user;"' \
  2>/dev/null | sed 's/^/    /' || warn "无法列出账号（root 密码可能不对）"

if [ "$MODE" = "check" ]; then
  echo; warn "--check：未做任何改动"; exit 0
fi

# 把值通过 -e 传进容器，再在容器内用 shell 展开，避免宿主机引号嵌套地狱
say "幂等补建账号与授权"
"${COMPOSE[@]}" exec -T \
  -e N1="$DB_NAME_1" -e N2="$DB_NAME_2" \
  -e U1="$DB_USER_1" -e U2="$DB_USER_2" \
  -e P1="$DB_PASS_1" -e P2="$DB_PASS_2" \
  mysql bash -c '
    mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<EOSQL
CREATE DATABASE IF NOT EXISTS \`$N1\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS \`$N2\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '"'"'$U1'"'"'@'"'"'%'"'"' IDENTIFIED BY '"'"'$P1'"'"';
CREATE USER IF NOT EXISTS '"'"'$U2'"'"'@'"'"'%'"'"' IDENTIFIED BY '"'"'$P2'"'"';
ALTER USER '"'"'$U1'"'"'@'"'"'%'"'"' IDENTIFIED BY '"'"'$P1'"'"';
ALTER USER '"'"'$U2'"'"'@'"'"'%'"'"' IDENTIFIED BY '"'"'$P2'"'"';
GRANT ALL PRIVILEGES ON \`$N1\`.* TO '"'"'$U1'"'"'@'"'"'%'"'"';
GRANT ALL PRIVILEGES ON \`$N2\`.* TO '"'"'$U2'"'"'@'"'"'%'"'"';
FLUSH PRIVILEGES;
EOSQL
  ' 2>&1 | sed 's/^/    /'
if [ "${PIPESTATUS[0]}" != "0" ]; then err "补建账号失败"; exit 1; fi
ok "账号与授权已就绪"

say "校验两个账号能否连库"
RC=0
check_conn() {
  local u="$1" p="$2" d="$3"
  if "${COMPOSE[@]}" exec -T \
       -e CU="$u" -e CP="$p" -e CD="$d" \
       mysql sh -c 'exec mysql -u"$CU" -p"$CP" -D "$CD" -N -B -e "SELECT 1;"' >/dev/null 2>&1; then
    ok "$u → $d 连接正常"
  else
    err "$u → $d 连接失败"; RC=1
  fi
}
check_conn "$DB_USER_1" "$DB_PASS_1" "$DB_NAME_1"
check_conn "$DB_USER_2" "$DB_PASS_2" "$DB_NAME_2"

exit "$RC"
