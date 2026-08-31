#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
PORT=3011
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"

cd "$ROOT_DIR"

for required in node npm mysqladmin curl; do
  if ! command -v "$required" >/dev/null 2>&1; then
    echo "缺少命令：$required"
    exit 1
  fi
done

if [ ! -f "dist/index.html" ] || [ ! -f "server/dist/index.js" ]; then
  echo "缺少构建产物，请先运行：npm run build:all"
  exit 1
fi

if ! mysqladmin --protocol=socket --socket=/tmp/mysql.sock -uroot --connect-timeout=5 ping >/dev/null 2>&1; then
  echo "MySQL 未就绪，请先运行：brew services run mysql"
  exit 1
fi

cd server
NODE_ENV=production HOST=127.0.0.1 PORT="$PORT" npm run start &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    echo "系统已启动：http://127.0.0.1:${PORT}"
    echo "按 Ctrl+C 停止系统（MySQL 保持运行）。"
    wait "$SERVER_PID"
    exit $?
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 1
done

echo "服务未在 10 秒内通过健康检查。"
exit 1
