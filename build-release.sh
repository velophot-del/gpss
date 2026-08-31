#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
RELEASE_DIR="$ROOT_DIR/release"
PACKAGE_NAME=GPSS_20260823_linux_multiarch
ARCHIVE_PATH="$RELEASE_DIR/${PACKAGE_NAME}.tar.gz"
CHECKSUM_PATH="$ARCHIVE_PATH.sha256"
STAGE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/gpss-release.XXXXXX")
PACKAGE_DIR="$STAGE_ROOT/$PACKAGE_NAME"

cleanup() {
  if [ -n "${STAGE_ROOT:-}" ] && [ -d "$STAGE_ROOT" ]; then
    rm -rf -- "$STAGE_ROOT"
  fi
}
trap cleanup EXIT

[ ! -e "$ARCHIVE_PATH" ] || { echo "发布包已存在：$ARCHIVE_PATH" >&2; exit 1; }
[ ! -e "$CHECKSUM_PATH" ] || { echo "校验文件已存在：$CHECKSUM_PATH" >&2; exit 1; }

mkdir -p "$PACKAGE_DIR/app/server" "$RELEASE_DIR"

echo "检查前端类型..."
(cd "$ROOT_DIR" && npm exec vue-tsc -- --noEmit)

echo "构建关闭演示模式的前端..."
(cd "$ROOT_DIR" && VITE_ENABLE_DEMO=false npm exec vite -- build --outDir "$PACKAGE_DIR/app/dist" --emptyOutDir)

echo "构建后端..."
(cd "$ROOT_DIR/server" && npm exec tsc -- --outDir "$PACKAGE_DIR/app/server/dist")

cp "$ROOT_DIR/server/package.json" "$ROOT_DIR/server/package-lock.json" "$PACKAGE_DIR/app/server/"
cp -R "$ROOT_DIR/deployment/." "$PACKAGE_DIR/"
find "$PACKAGE_DIR" -type f -name '.DS_Store' -delete
chmod 755 "$PACKAGE_DIR/deploy.sh" "$PACKAGE_DIR/native/install.sh" "$PACKAGE_DIR/native/preflight.sh"

{
  echo '2026.08.23-ui1'
} > "$PACKAGE_DIR/VERSION"

{
  echo 'version=2026.08.23-ui1'
  echo 'build_date=2026-08-23'
  echo 'runtime=node24+mysql8.4+nginx'
  echo 'platforms=linux/amd64,linux/arm64'
  echo 'frontend_demo=false'
  echo 'initial_data=empty+admin'
} > "$PACKAGE_DIR/BUILD_INFO.txt"

if find "$PACKAGE_DIR" -type d \( -name node_modules -o -name .git -o -name phpmyadmin -o -name qa -o -name uploads \) -print -quit | grep -q .; then
  echo "发布包含禁止目录" >&2
  exit 1
fi
if find "$PACKAGE_DIR" -type f \( -name '*.node' -o -name 'server.env' -o -name '.env' -o -name '.DS_Store' \) -print -quit | grep -q .; then
  echo "发布包含本机二进制或真实环境文件" >&2
  exit 1
fi
if grep -R -F '/Users/tangwang/' "$PACKAGE_DIR" >/dev/null 2>&1; then
  echo "发布包含本机绝对路径" >&2
  exit 1
fi

(cd "$PACKAGE_DIR" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 shasum -a 256 > MANIFEST.sha256)

COPYFILE_DISABLE=1 tar -C "$STAGE_ROOT" -czf "$ARCHIVE_PATH" "$PACKAGE_NAME"
(cd "$RELEASE_DIR" && shasum -a 256 "${PACKAGE_NAME}.tar.gz" > "${PACKAGE_NAME}.tar.gz.sha256")

echo "发布包：$ARCHIVE_PATH"
echo "校验文件：$CHECKSUM_PATH"
