#!/usr/bin/env bash
# 导出「半山学堂 + 毕业设计管理系统（GPSS）」统一部署升级源码包。
# 顶层为两个兄弟目录(gpss-src/ + banshan-academy/)，与
# banshan-academy/deployment/unified/docker-compose.yml 的 gpss-app build context
# (../../../gpss-src) 一致。gpss-src 为 GPSS 的 ASCII 部署名(真实项目目录可以是中文名)。
# 排除构建产物、数据目录与真实 .env（含密钥），保留全部 .env.example。
# 输出到两个项目的父目录，并生成包外的 .sha256 校验文件(权威)。
set -euo pipefail

PARENT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
GPSS_DIR="$PARENT_DIR/20260823_学生教师体验改版"
BANSHAN_DIR="$PARENT_DIR/banshan-academy"
TS=$(date +%Y%m%d)
PKG_NAME="gpss-upgrade-$TS"
ARCHIVE="$PARENT_DIR/$PKG_NAME.tar.gz"
STAGE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/gpss-upgrade.XXXXXX")
trap 'rm -rf -- "$STAGE_ROOT"' EXIT

[ -d "$GPSS_DIR" ] || { echo "找不到 GPSS 目录：$GPSS_DIR" >&2; exit 1; }
[ -d "$BANSHAN_DIR" ] || { echo "找不到半山学堂目录：$BANSHAN_DIR" >&2; exit 1; }
[ ! -e "$ARCHIVE" ] || { echo "已存在：$ARCHIVE" >&2; exit 1; }

# 按「基本名」匹配的排除项(rsync 对不含 / 的模式按末级名称匹配)
EXCLUDES=(
  '.DS_Store' '.git' '.claude'
  'node_modules' 'dist' 'release' 'test-results' 'qa' 'screenshots'
  '.env' '.env.production' '.env.local'
  'uploads' 'uploads-private' 'seed-data'
  '*.log'
  '系统使用说明.pdf' '系统使用说明.html'
)

EXCLUDE_ARGS=()
for p in "${EXCLUDES[@]}"; do EXCLUDE_ARGS+=(--exclude="$p"); done

rsync -a "${EXCLUDE_ARGS[@]}" "$GPSS_DIR"/ "$STAGE_ROOT/gpss-src"/
rsync -a "${EXCLUDE_ARGS[@]}" "$BANSHAN_DIR"/ "$STAGE_ROOT/banshan-academy"/

COPYFILE_DISABLE=1 tar -C "$STAGE_ROOT" -czf "$ARCHIVE" "gpss-src" "banshan-academy"
SHA=$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')
# 校验文件放在包外(权威):包内文档里的校验值可能滞后一位,以本文件为准
echo "$SHA  $PKG_NAME.tar.gz" > "$PARENT_DIR/$PKG_NAME.tar.gz.sha256"

echo "完成："
echo "  升级包   → $ARCHIVE"
echo "  校验文件 → $PARENT_DIR/$PKG_NAME.tar.gz.sha256"
echo "  顶层结构 → $(tar -tzf "$ARCHIVE" | awk -F/ 'NF>1 {print $1}' | sort -u | tr '\n' ' ')"
echo "  sha256   → $SHA"
