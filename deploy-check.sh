#!/bin/bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

passed=0
failed=0

pass() {
  echo "✅ $1"
  passed=$((passed + 1))
}

fail() {
  echo "❌ $1"
  failed=$((failed + 1))
}

for command_name in node npm mysqladmin curl; do
  if command -v "$command_name" >/dev/null 2>&1; then
    pass "$command_name 可用"
  else
    fail "$command_name 不可用"
  fi
done

if [ "$(node -p 'process.arch')" = "arm64" ]; then
  pass "Node 运行于 arm64"
else
  fail "Node 未运行于 arm64"
fi

if [ -f node_modules/@rollup/rollup-darwin-arm64/rollup.darwin-arm64.node ]; then
  pass "前端 Rollup arm64 二进制存在"
else
  fail "缺少前端 Rollup arm64 二进制，请运行 npm ci"
fi

if [ -f server/node_modules/@esbuild/darwin-arm64/bin/esbuild ]; then
  pass "后端 esbuild arm64 二进制存在"
else
  fail "缺少后端 esbuild arm64 二进制，请运行 cd server && npm ci"
fi

for key in PORT HOST DB_HOST DB_PORT DB_USER DB_NAME JWT_SECRET FRONTEND_URL; do
  if grep -q "^${key}=." server/.env; then
    pass "server/.env 已配置 $key"
  else
    fail "server/.env 缺少 $key"
  fi
done

if grep -q '^PORT=3011$' server/.env; then
  pass "候选版本端口为 3011"
else
  fail "候选版本端口不是 3011"
fi

if grep -q '^DB_NAME=gpss_ui_20260823$' server/.env; then
  pass "使用独立验证数据库 gpss_ui_20260823"
else
  fail "未配置独立验证数据库 gpss_ui_20260823"
fi

if grep -q '^HOST=127.0.0.1$' server/.env && grep -q '^FRONTEND_URL=http://127.0.0.1:3011$' server/.env; then
  pass "服务仅绑定本机回环地址"
else
  fail "服务绑定地址或前端地址不符合候选版本配置"
fi

if mysqladmin --protocol=socket --socket=/tmp/mysql.sock -uroot --connect-timeout=5 ping >/dev/null 2>&1; then
  pass "MySQL socket 可连接"
else
  fail "MySQL socket 不可连接"
fi

if [ -f dist/index.html ] && [ -f server/dist/index.js ]; then
  pass "前后端构建产物存在"
else
  fail "缺少构建产物，请运行 npm run build:all"
fi

if ./node_modules/.bin/vue-tsc; then
  pass "前端类型检查通过"
else
  fail "前端类型检查失败"
fi

if ./server/node_modules/.bin/tsc -p server/tsconfig.json --noEmit; then
  pass "后端类型检查通过"
else
  fail "后端类型检查失败"
fi

echo "通过：${passed}；失败：${failed}"
test "$failed" -eq 0
