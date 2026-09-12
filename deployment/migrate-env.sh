#!/usr/bin/env bash
# ============================================================
# 统一部署 .env 迁移与预检
#
# 问题背景：
#   统一部署（unified）的 compose 把「数据库密码」从旧的单个
#   DB_PASSWORD 拆分成了 BANSHAN_DB_PASSWORD / GPSS_DB_PASSWORD，
#   且用户从 app 拆成 banshan / gpss。这些变量用 `${VAR:?...}` 必填语法，
#   变量缺失时 `docker compose config` 直接退出非 0，升级脚本随即中止
#   —— 表现为「每次升级都失败 / 版本冲突」，但实际一个字节都没部署。
#
# 本脚本：
#   1. 备份现有 .env
#   2. 按 .env.example 补全缺失的键（不覆盖任何已有值）
#   3. 旧 DB_PASSWORD → 新 BANSHAN_DB_PASSWORD / GPSS_DB_PASSWORD 继承
#   4. 预检：必填变量是否齐全，缺失则明确报错并列出
#
# 用法：
#   bash migrate-env.sh            # 迁移 + 预检
#   bash migrate-env.sh --check    # 只预检，不写入
#   bash migrate-env.sh --dry-run  # 显示将要做的改动，不写入
# ============================================================
set -uo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/banshan-academy/deployment/unified}"
MODE="apply"
for a in "$@"; do
  case "$a" in
    --check)   MODE="check" ;;
    --dry-run) MODE="dry-run" ;;
  esac
done

ENV_FILE="$DEPLOY_DIR/.env"
EXAMPLE_FILE="$DEPLOY_DIR/.env.example"

say()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m错误: %s\033[0m\n' "$*" >&2; }

[ -d "$DEPLOY_DIR" ] || { err "未找到部署目录: $DEPLOY_DIR"; exit 1; }
[ -f "$ENV_FILE" ]    || { err "未找到 .env: $ENV_FILE"; exit 1; }
[ -f "$EXAMPLE_FILE" ] || { err "未找到 .env.example: $EXAMPLE_FILE"; exit 1; }

# 从 .env.example 取某个键的默认值（跳过「请设置…」这类占位符）
example_value() {
  local key="$1" v
  v=$(grep -E "^${key}=" "$EXAMPLE_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
  case "$v" in
    *请设置*|*你的域名*|"") return 1 ;;
    *) printf '%s' "$v"; return 0 ;;
  esac
}

has_key() { grep -qE "^[[:space:]]*$1=" "$ENV_FILE"; }
get_key() { grep -E "^[[:space:]]*$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

ADDED=()
ADD_LINES=()

add_key() {
  local key="$1" val="$2" why="$3"
  has_key "$key" && return 0
  ADD_LINES+=("${key}=${val}")
  ADDED+=("${key}  ← ${why}")
}

# ---------- 迁移规则 ----------
say "检查 .env（$ENV_FILE）"

OLD_DB_PW=$(get_key DB_PASSWORD || true)
NEW_NAMES=$(grep -oE '\$\{[A-Z_]+' "$EXAMPLE_FILE" 2>/dev/null | tr -d '${' | sort -u)

# 规则 1：旧 DB_PASSWORD 继承给两个新的库密码
for k in BANSHAN_DB_PASSWORD GPSS_DB_PASSWORD; do
  if ! has_key "$k"; then
    if [ -n "$OLD_DB_PW" ]; then
      add_key "$k" "$OLD_DB_PW" "继承旧 DB_PASSWORD"
    else
      v=$(example_value "$k") && add_key "$k" "$v" "取自 .env.example" \
        || warn "$k 缺失且无旧值可继承，需手工填写"
    fi
  fi
done

# 规则 2：按 .env.example 补全其余缺失键（仅当 example 有可用默认值）
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  key="${line%%=*}"
  case "$key" in *[!A-Za-z0-9_]*) continue ;; esac
  has_key "$key" && continue
  # 已在前一步处理过的跳过
  printf '%s\n' "${ADDED[@]:-}" | grep -q "^${key} " && continue
  v=$(example_value "$key") && add_key "$key" "$v" "取自 .env.example"
done < "$EXAMPLE_FILE"

# ---------- 输出 ----------
if [ "${#ADDED[@]}" -eq 0 ]; then
  ok "无需补全，所有键都已存在"
else
  say "将补全 ${#ADDED[@]} 个键"
  for a in "${ADDED[@]}"; do ok "$a"; done
fi

if [ "$MODE" = "dry-run" ] || [ "$MODE" = "check" ]; then
  [ "$MODE" = "dry-run" ] && warn "dry-run：未写入任何改动"
else
  if [ "${#ADDED[@]}" -gt 0 ]; then
    STAMP=$(date +%Y%m%d-%H%M%S)
    cp -a "$ENV_FILE" "$ENV_FILE.bak-$STAMP"
    ok "已备份 → $ENV_FILE.bak-$STAMP"
    {
      printf '\n# ---- 由 migrate-env.sh 于 %s 自动补全 ----\n' "$(date '+%Y-%m-%d %H:%M:%S')"
      printf '%s\n' "${ADD_LINES[@]}"
    } >> "$ENV_FILE"
    ok "已写入 $ENV_FILE"
  fi
fi

# ---------- 预检：必填变量 ----------
say "预检必填变量"
REQUIRED=$(grep -oE '\$\{[A-Z_]+:\?' "$DEPLOY_DIR/docker-compose.yml" 2>/dev/null \
           | sed 's/\${//; s/:?//' | sort -u)
[ -z "$REQUIRED" ] && REQUIRED=$(printf '%s\n' MYSQL_ROOT_PASSWORD BANSHAN_DB_PASSWORD GPSS_DB_PASSWORD BANSHAN_JWT_SECRET GPSS_JWT_SECRET PUBLIC_URL)

MISSING=()
for k in $REQUIRED; do
  if has_key "$k"; then
    v=$(get_key "$k")
    if [ -z "$v" ]; then MISSING+=("$k (值为空)"); else ok "$k 已设置"; fi
  else
    MISSING+=("$k (缺失)")
  fi
done

if [ "${#MISSING[@]}" -gt 0 ]; then
  echo
  err "以下必填变量仍未就绪，docker compose 会直接报错中止："
  for m in "${MISSING[@]}"; do printf '      - %s\n' "$m" >&2; done
  echo >&2
  printf '请编辑 %s 填好后重试。\n' "$ENV_FILE" >&2
  exit 1
fi

echo
printf '\033[32m.env 就绪\033[0m\n'
