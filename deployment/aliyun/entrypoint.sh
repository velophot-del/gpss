#!/bin/sh
set -eu

cd /app/server

echo "[gpss] 初始化数据库结构（幂等）..."
node dist/scripts/initDb.js

echo "[gpss] 执行全流程迁移（幂等）..."
node dist/scripts/migrateAddProcessStages.js

# 仅在不存在管理员时创建；bootstrapAdmin.ts 不会覆盖已有管理员密码。
# 未显式提供密码时生成一次性随机密码并输出到容器日志，首次登录后必须立即修改。
if [ -z "${ADMIN_INITIAL_PASSWORD:-}" ]; then
  ADMIN_INITIAL_PASSWORD=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))")
  generated_admin_password=1
else
  generated_admin_password=0
fi

ADMIN_INITIAL_PASSWORD="$ADMIN_INITIAL_PASSWORD" node dist/scripts/bootstrapAdmin.js
if [ "$generated_admin_password" = 1 ]; then
  echo "[gpss] 管理员 admin 初始密码（仅本次日志可见）：$ADMIN_INITIAL_PASSWORD"
  echo "[gpss] 请首次登录后立即修改管理员密码。"
fi

exec node dist/index.js
