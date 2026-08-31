#!/usr/bin/env bash
# 导出「毕业设计管理系统」的两种发布产物：
#   1) 源码备份（含 .env、docs 全套，用于本地归档）
#   2) 阿里云 ECS 部署包（剔除真实 .env、node_modules、截图/PDF 等，供 Docker Compose 构建）
# 输出到项目上一级目录。
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
OUT_DIR=$(cd "$ROOT_DIR/.." && pwd)
TS=$(date +%Y%m%d)
STAGE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/gpss-export.XXXXXX")

cleanup() { rm -rf -- "$STAGE_ROOT"; }
trap cleanup EXIT

# 两种包共同排除的目录/文件（按「基本名」匹配，openrsync 对不含 / 的模式按末级名称匹配）
COMMON=(
  '.DS_Store'
  '.git'
  'node_modules'
  'dist'
  'release'
  'qa'
  'test-results'
  '.claude'
  'uploads'
  'GPSS_*'
)

# 拼装 --exclude 参数
excludes() {
  local p
  for p in "${COMMON[@]}" "$@"; do
    printf ' --exclude=%s' "$p"
  done
}

# ---------- 1) 源码备份 ----------
BACKUP_NAME="gpss-backup-$TS"
BACKUP_ARCHIVE="毕业设计管理系统_源码备份_$TS.tar.gz"
mkdir -p "$STAGE_ROOT/$BACKUP_NAME"
# shellcheck disable=SC2046
rsync -a $(excludes) "$ROOT_DIR"/ "$STAGE_ROOT/$BACKUP_NAME"/
COPYFILE_DISABLE=1 tar -C "$STAGE_ROOT" -czf "$OUT_DIR/$BACKUP_ARCHIVE" "$BACKUP_NAME"

# ---------- 2) 阿里云部署包 ----------
DEPLOY_NAME="gpss"
DEPLOY_ARCHIVE="毕业设计管理系统_阿里云部署包_$TS.tar.gz"
DEPLOY_EXTRA=(
  '.vscode'
  '.env'
  '.env.production'
  'screenshots'
  '系统使用说明.pdf'
  '系统使用说明.html'
)
mkdir -p "$STAGE_ROOT/$DEPLOY_NAME"
# shellcheck disable=SC2046
rsync -a $(excludes "${DEPLOY_EXTRA[@]}") "$ROOT_DIR"/ "$STAGE_ROOT/$DEPLOY_NAME"/
COPYFILE_DISABLE=1 tar -C "$STAGE_ROOT" -czf "$OUT_DIR/$DEPLOY_ARCHIVE" "$DEPLOY_NAME"

# ---------- 校验和 ----------
(
  cd "$OUT_DIR"
  rm -f "毕业设计管理系统_发布校验_$TS.sha256"
  shasum -a 256 "$BACKUP_ARCHIVE" "$DEPLOY_ARCHIVE" > "毕业设计管理系统_发布校验_$TS.sha256"
)

echo "完成："
echo "  源码备份  → $OUT_DIR/$BACKUP_ARCHIVE"
echo "  阿里部署  → $OUT_DIR/$DEPLOY_ARCHIVE"
echo "  校验文件  → $OUT_DIR/毕业设计管理系统_发布校验_$TS.sha256"
