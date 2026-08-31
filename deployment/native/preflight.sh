#!/usr/bin/env bash
set -euo pipefail

failures=0

check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "通过：$1"
  else
    echo "缺少：$1" >&2
    failures=$((failures + 1))
  fi
}

[ "$(uname -s)" = "Linux" ] || { echo "仅支持 Linux 原生部署" >&2; exit 1; }

case "$(uname -m)" in
  x86_64|amd64|aarch64|arm64) echo "通过：CPU $(uname -m)" ;;
  *) echo "不支持的 CPU：$(uname -m)" >&2; exit 1 ;;
esac

for cmd in node npm mysql mysqladmin nginx systemctl curl openssl; do
  check_command "$cmd"
done

if command -v node >/dev/null 2>&1; then
  node_major=$(node -p "Number(process.versions.node.split('.')[0])")
  if [ "$node_major" -lt 24 ]; then
    echo "Node.js 版本过低：需要 24，当前 $(node --version)" >&2
    failures=$((failures + 1))
  fi
fi

[ "$failures" -eq 0 ] || exit 1
echo "原生部署环境预检通过"
