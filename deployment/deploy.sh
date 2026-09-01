#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
ENV_FILE="$ROOT_DIR/.env.deploy"
COMPOSE_ARGS=(--env-file "$ENV_FILE" -f "$ROOT_DIR/compose.yaml")

fail() {
  echo "错误：$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "缺少命令：$1"
}

compose() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}

load_env() {
  [ -f "$ENV_FILE" ] || fail "缺少 .env.deploy，请先执行 ./deploy.sh install"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

detect_ip() {
  local ip
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  printf '%s' "${ip:-127.0.0.1}"
}

create_env() {
  if [ -f "$ENV_FILE" ]; then
    echo "保留现有配置：$ENV_FILE"
    return
  fi

  require_command openssl
  local public_url db_password root_password jwt_secret
  public_url=${PUBLIC_URL:-http://$(detect_ip)}
  db_password=$(openssl rand -hex 24)
  root_password=$(openssl rand -hex 24)
  jwt_secret=$(openssl rand -hex 32)

  umask 077
  {
    printf 'PUBLIC_URL=%s\n' "$public_url"
    printf 'HTTP_PORT=%s\n' "${HTTP_PORT:-80}"
    printf 'HTTPS_PORT=%s\n' "${HTTPS_PORT:-443}"
    printf 'TZ=Asia/Shanghai\n'
    printf 'DB_NAME=gpss\n'
    printf 'DB_USER=gpss\n'
    printf 'DB_PASSWORD=%s\n' "$db_password"
    printf 'MYSQL_ROOT_PASSWORD=%s\n' "$root_password"
    printf 'JWT_SECRET=%s\n' "$jwt_secret"
    printf 'JWT_EXPIRES_IN=7d\n'
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "已生成安全配置：$ENV_FILE"
}

preflight() {
  require_command docker
  require_command curl
  require_command openssl
  docker compose version >/dev/null
  docker info >/dev/null 2>&1 || fail "Docker 服务未运行"
  [ "$(uname -s)" = "Linux" ] || echo "提示：当前不是 Linux，仅建议用于构建验收"
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64|aarch64|arm64) ;;
    *) fail "不支持的 CPU 架构：$arch" ;;
  esac
}

wait_mysql() {
  local attempt
  for attempt in $(seq 1 60); do
    if compose exec -T mysql mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent >/dev/null 2>&1; then
      return
    fi
    sleep 2
  done
  fail "MySQL 在 120 秒内未就绪"
}

wait_http() {
  local attempt health_url
  health_url="http://127.0.0.1:${HTTP_PORT:-80}/api/health"
  for attempt in $(seq 1 60); do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      echo "服务健康：$health_url"
      return
    fi
    sleep 2
  done
  compose logs --tail=100 app nginx >&2 || true
  fail "应用在 120 秒内未就绪"
}

mysql_query() {
  compose exec -T -e MYSQL_PWD="$DB_PASSWORD" mysql \
    mysql --batch --skip-column-names -u"$DB_USER" "$DB_NAME" -e "$1"
}

install_all() {
  preflight
  create_env
  load_env
  compose config >/dev/null
  compose build app
  compose up -d mysql
  wait_mysql
  # app entrypoint 按顺序执行 node dist/scripts/initDb.js、
  # node dist/scripts/migrateAddProcessStages.js 和 bootstrapAdmin.js。
  compose up -d app nginx
  wait_http
  echo "访问地址：$PUBLIC_URL"
  echo "管理员初始化与数据库迁移由 app entrypoint 完成；请执行：docker compose logs --tail=100 app"
}

doctor() {
  preflight
  load_env
  compose config >/dev/null
  compose ps
  wait_mysql
  mysql_query 'SELECT 1;' >/dev/null
  wait_http
  local demo_status
  demo_status=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X POST "http://127.0.0.1:${HTTP_PORT:-80}/api/auth/demo-login" \
    -H 'Content-Type: application/json' -d '{"username":"admin"}')
  [ "$demo_status" = "404" ] || fail "演示登录接口未关闭，HTTP $demo_status"
  echo "部署自检通过"
}

backup() {
  load_env
  require_command gzip
  require_command sha256sum
  local stamp backup_dir
  stamp=$(date '+%Y%m%d-%H%M%S')
  backup_dir="$ROOT_DIR/backups/$stamp"
  mkdir -p "$backup_dir"

  compose exec -T -e MYSQL_PWD="$DB_PASSWORD" mysql \
    mysqldump -u"$DB_USER" --no-tablespaces --single-transaction --routines --triggers "$DB_NAME" \
    | gzip > "$backup_dir/database.sql.gz"
  compose run --rm --no-deps --entrypoint sh --user 0:0 -v "$backup_dir:/backup" app \
    tar -czf /backup/uploads.tar.gz -C /data/uploads .
  (cd "$backup_dir" && sha256sum database.sql.gz uploads.tar.gz > MANIFEST.sha256)
  echo "备份完成：$backup_dir"
}

restore() {
  load_env
  local backup_dir=${1:-}
  [ -n "$backup_dir" ] || fail "用法：./deploy.sh restore /完整/备份目录"
  backup_dir=$(cd "$backup_dir" 2>/dev/null && pwd) || fail "备份目录不存在"
  [ -f "$backup_dir/database.sql.gz" ] || fail "缺少 database.sql.gz"
  [ -f "$backup_dir/uploads.tar.gz" ] || fail "缺少 uploads.tar.gz"
  [ -f "$backup_dir/MANIFEST.sha256" ] || fail "缺少 MANIFEST.sha256"
  (cd "$backup_dir" && sha256sum -c MANIFEST.sha256)

  echo "恢复会覆盖当前数据库和上传文件。输入 RESTORE 继续："
  local confirmation
  read -r confirmation
  [ "$confirmation" = "RESTORE" ] || fail "已取消恢复"

  compose stop app nginx
  gunzip -c "$backup_dir/database.sql.gz" \
    | compose exec -T -e MYSQL_PWD="$DB_PASSWORD" mysql mysql -u"$DB_USER" "$DB_NAME"
  compose run --rm --no-deps --entrypoint sh --user 0:0 -v "$backup_dir:/backup:ro" app \
    sh -c 'find /data/uploads -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/uploads.tar.gz -C /data/uploads && chown -R node:node /data/uploads'
  compose up -d app nginx
  wait_http
  echo "恢复完成"
}

usage() {
  echo "用法：./deploy.sh {install|up|down|restart|status|logs|doctor|backup|restore}"
}

command=${1:-}
case "$command" in
  install) install_all ;;
  up) preflight; load_env; compose up -d; wait_http ;;
  down) load_env; compose down ;;
  restart) load_env; compose restart app nginx; wait_http ;;
  status) load_env; compose ps ;;
  logs) load_env; compose logs -f --tail=200 app nginx ;;
  doctor) doctor ;;
  backup) backup ;;
  restore) shift; restore "${1:-}" ;;
  *) usage; exit 1 ;;
esac
