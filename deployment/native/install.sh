#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PACKAGE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
APP_DIR=/opt/gpss
CONFIG_DIR=/etc/gpss
DATA_DIR=/var/lib/gpss/uploads
ENV_FILE="$CONFIG_DIR/gpss.env"

[ "$(id -u)" -eq 0 ] || { echo "请使用 sudo 运行 native/install.sh" >&2; exit 1; }
"$SCRIPT_DIR/preflight.sh"

escape_env() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

if [ ! -f "$ENV_FILE" ]; then
  public_url=${PUBLIC_URL:-}
  if [ -z "$public_url" ]; then
    read -r -p "访问地址（例如 http://10.0.0.10）：" public_url
  fi
  db_host=${DB_HOST:-127.0.0.1}
  db_port=${DB_PORT:-3306}
  db_name=${DB_NAME:-gpss}
  db_user=${DB_USER:-gpss}
  db_password=${DB_PASSWORD:-}
  if [ -z "$db_password" ]; then
    read -r -s -p "数据库用户 $db_user 的密码：" db_password
    echo
  fi
  jwt_secret=$(openssl rand -hex 32)

  install -d -m 750 "$CONFIG_DIR"
  umask 077
  {
    printf 'NODE_ENV=production\nHOST=127.0.0.1\nPORT=3011\n'
    printf 'DB_HOST="%s"\n' "$(escape_env "$db_host")"
    printf 'DB_PORT=%s\n' "$db_port"
    printf 'DB_NAME="%s"\n' "$(escape_env "$db_name")"
    printf 'DB_USER="%s"\n' "$(escape_env "$db_user")"
    printf 'DB_PASSWORD="%s"\n' "$(escape_env "$db_password")"
    printf 'USE_SOCKET=false\nDB_CREATE_IF_MISSING=false\n'
    printf 'JWT_SECRET=%s\nJWT_EXPIRES_IN=7d\n' "$jwt_secret"
    printf 'ENABLE_DEMO_LOGIN=false\n'
    printf 'FRONTEND_URL="%s"\n' "$(escape_env "$public_url")"
    printf 'UPLOAD_DIR=%s\nTZ=Asia/Shanghai\n' "$DATA_DIR"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo "保留现有配置：$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

MYSQL_PWD="$DB_PASSWORD" mysqladmin ping -h "$DB_HOST" -P "$DB_PORT" -u"$DB_USER" --silent \
  || { echo "数据库连接失败；请先按文档创建数据库和专用用户" >&2; exit 1; }

if ! id gpss >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin gpss
fi

install -d -o gpss -g gpss -m 755 "$APP_DIR/dist" "$APP_DIR/server" "$DATA_DIR"
cp -R "$PACKAGE_ROOT/app/dist/." "$APP_DIR/dist/"
cp -R "$PACKAGE_ROOT/app/server/dist" "$APP_DIR/server/"
cp "$PACKAGE_ROOT/app/server/package.json" "$PACKAGE_ROOT/app/server/package-lock.json" "$APP_DIR/server/"
npm --prefix "$APP_DIR/server" ci --omit=dev
chown -R gpss:gpss "$APP_DIR" "$DATA_DIR"

(cd "$APP_DIR/server" && node dist/scripts/initDb.js)
(cd "$APP_DIR/server" && node dist/scripts/migrateAddProcessStages.js)

admin_count=$(MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names -h "$DB_HOST" -P "$DB_PORT" -u"$DB_USER" "$DB_NAME" -e "SELECT COUNT(*) FROM users WHERE username='admin' AND role='admin';")
if [ "$admin_count" = "0" ]; then
  admin_password=${ADMIN_INITIAL_PASSWORD:-Admin-$(openssl rand -hex 8)}
  (cd "$APP_DIR/server" && ADMIN_INITIAL_PASSWORD="$admin_password" node dist/scripts/bootstrapAdmin.js)
else
  admin_password=''
  echo "管理员 admin 已存在，未覆盖密码"
fi

install -m 644 "$SCRIPT_DIR/gpss.service" /etc/systemd/system/gpss.service
install -m 644 "$SCRIPT_DIR/nginx-gpss.conf" /etc/nginx/conf.d/gpss.conf
systemctl daemon-reload
systemctl enable --now gpss
nginx -t
systemctl reload nginx

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3011/api/health >/dev/null 2>&1; then
    echo "原生部署完成：$FRONTEND_URL"
    echo "管理员：admin"
    if [ -n "$admin_password" ]; then
      echo "初始密码：$admin_password"
      echo "请首次登录后立即修改密码。"
    fi
    exit 0
  fi
  sleep 2
done

systemctl status gpss --no-pager >&2 || true
exit 1
