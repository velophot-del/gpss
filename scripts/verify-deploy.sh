#!/usr/bin/env bash
# ============================================================
# GPSS + 半山学堂 部署后校验
#
# 用途：升级/重建后，从外部验证线上产物是否真的更新了。
#       不依赖时间戳（时间戳会骗人），直接抓 bundle 内容比对。
#
# 用法：
#   bash verify-deploy.sh                          # 默认服务器
#   bash verify-deploy.sh 1.2.3.4                  # 指定 IP
#   bash verify-deploy.sh 1.2.3.4 8080             # 指定 IP + 端口
#   bash verify-deploy.sh --url http://127.0.0.1:4180   # 指定完整 base（本地预览自查）
#   bash verify-deploy.sh --baseline               # 把当前结果存为基线
#   bash verify-deploy.sh --compare                # 与基线比对，报告变化
# ============================================================
set -uo pipefail

MODE="verify"
BASE_OVERRIDE=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    --baseline|--compare) MODE="$1"; shift ;;
    --url) BASE_OVERRIDE="$2"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

IP="${ARGS[0]:-123.56.104.61}"
PORT="${ARGS[1]:-80}"

if [ -n "$BASE_OVERRIDE" ]; then
  BASE="${BASE_OVERRIDE%/}"
  # 从 --url 反推 IP:PORT，供相对资源拼接使用
  _hostport="${BASE#http://}"; _hostport="${_hostport#https://}"; _hostport="${_hostport%%/*}"
  IP="${_hostport%%:*}"
  PORT="${_hostport##*:}"; [ "$PORT" = "$IP" ] && PORT=80
else
  BASE="http://${IP}${PORT:+:$PORT}"
  [ "$PORT" = "80" ] && BASE="http://$IP"
fi

MODE_ARG="$MODE"
STATE_DIR="${TMPDIR:-/tmp}/gpss-deploy-verify"
mkdir -p "$STATE_DIR"
BASELINE="$STATE_DIR/baseline.txt"

C_OK=$'\033[32m'; C_BAD=$'\033[31m'; C_WARN=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
pass() { printf "  ${C_OK}✓${C_OFF} %s\n" "$*"; }
fail() { printf "  ${C_BAD}✗ %s${C_OFF}\n" "$*"; FAILED=$((FAILED+1)); }
warn() { printf "  ${C_WARN}!${C_OFF} %s\n" "$*"; }
dim()  { printf "  ${C_DIM}%s${C_OFF}\n" "$*"; }

FAILED=0

# ---------- 工具 ----------
fetch() { curl -s --max-time 20 "$1" 2>/dev/null; }
head_of() { curl -s -I --max-time 15 "$1" 2>/dev/null; }

# 下载页面引用的所有 js/css，输出 "url<TAB>sha256"，并缓存正文供后续 grep
snapshot_assets() {
  local page_url="$1" tag="$2"
  local html; html=$(fetch "$page_url")
  [ -z "$html" ] && return 1
  local dir="$STATE_DIR/$tag"; rm -rf "$dir"; mkdir -p "$dir"
  printf '%s' "$html" > "$dir/index.html"

  local assets
  assets=$(printf '%s' "$html" | grep -oE '(src|href)="[^"]*\.(js|css)"' \
           | sed -E 's/.*="([^"]*)".*/\1/' | sort -u)
  [ -z "$assets" ] && return 1

  local a url body hash
  local -a seen=()
  # 记录已抓过的「基本名」，避免 ./X.js 与 assets/X.js 重复下载同一文件
  already() {
    local b; b=$(basename "$1"); local s
    for s in "${seen[@]:-}"; do [ "$s" = "$b" ] && return 0; done
    return 1
  }
  note() { seen+=("$(basename "$1")"); }

  # 先抓页面直接引用的资源
  for a in $assets; do
    already "$a" && continue
    case "$a" in
      http*) url="$a" ;;
      /*)    url="http://${IP}${PORT:+:$PORT}$a" ;;
      *)     url="$page_url$a" ;;
    esac
    body=$(fetch "$url")
    [ -z "$body" ] && continue
    case "$body" in '<!DOCTYPE'*|'<!doctype'*) continue ;; esac
    note "$a"
    hash=$(printf '%s' "$body" | shasum -a 256 | awk '{print $1}')
    printf '%s\t%s\n' "$a" "$(printf '%s' "$hash" | cut -c1-16)"
    printf '%s' "$body" > "$dir/$(basename "$a")"
  done

  # 再顺着一层懒加载分包抓（页脚、布局等常在这些 chunk 里，入口 bundle 不含其文案）
  local chunk
  for chunk in $(cat "$dir"/*.js 2>/dev/null \
                 | grep -oE '"[^"]*\.js"' | tr -d '"' | sort -u | head -80); do
    already "$chunk" && continue
    case "$chunk" in
      http*) url="$chunk" ;;
      /*)    url="http://${IP}${PORT:+:$PORT}$chunk" ;;
      *)     url="$page_url$chunk" ;;
    esac
    body=$(fetch "$url")
    [ -z "$body" ] && continue
    # 排除 SPA fallback 返回的 HTML
    case "$body" in '<!DOCTYPE'*|'<!doctype'*) continue ;; esac
    note "$chunk"
    hash=$(printf '%s' "$body" | shasum -a 256 | awk '{print $1}')
    printf '%s\t%s\n' "$chunk" "$(printf '%s' "$hash" | cut -c1-16)"
    printf '%s' "$body" > "$dir/$(basename "$chunk")"
  done
}

# ============================================================
report_snapshot() {
  local tag="$1" label="$2" page_url="$3"
  echo "── $label ──────────────────────────────────────────"
  local lm; lm=$(head_of "$page_url" | grep -i '^last-modified' | sed 's/^[^:]*: *//' | tr -d '\r')
  [ -n "$lm" ] && dim "index.html Last-Modified: $lm"

  local snap; snap=$(snapshot_assets "$page_url" "$tag")
  if [ -z "$snap" ]; then fail "$label 无法获取页面或资源"; echo; return; fi
  while IFS=$'\t' read -r a h; do
    [ -n "$a" ] && dim "$h  $a"
  done <<< "$snap"
  echo "$snap" > "$STATE_DIR/$tag.snapshot"
  echo
}

# ---------- 基线模式 ----------
if [ "$MODE_ARG" = "--baseline" ]; then
  echo "把当前线上状态存为基线…"
  snapshot_assets "$BASE/gpss/" gpss  > "$STATE_DIR/gpss.snapshot"
  snapshot_assets "$BASE/"        acad  > "$STATE_DIR/acad.snapshot"
  cat "$STATE_DIR/gpss.snapshot" "$STATE_DIR/acad.snapshot" > "$BASELINE"
  echo "基线已保存: $BASELINE"
  exit 0
fi

# ---------- 比对模式 ----------
if [ "$MODE_ARG" = "--compare" ]; then
  [ -f "$BASELINE" ] || { echo "尚无基线，请先运行: bash $0 --baseline" >&2; exit 1; }
  echo "与基线比对（$BASELINE）"
  echo
  for tag in gpss acad; do
    snap=$(snapshot_assets "$([ "$tag" = gpss ] && echo "$BASE/gpss/" || echo "$BASE/")" "$tag")
    echo "── $tag ──────────────────────────────"
    local_changed=0
    while IFS=$'\t' read -r a h; do
      [ -z "$a" ] && continue
      old=$(grep -F "$(printf '%s\t' "$a")" "$BASELINE" | head -1 | cut -f2)
      if [ -z "$old" ]; then
        printf "  ${C_OK}+ 新增${C_OFF} %s  %s\n" "$h" "$a"; local_changed=1
      elif [ "$old" != "$h" ]; then
        printf "  ${C_OK}~ 已更新${C_OFF} %s → %s  %s\n" "$old" "$h" "$a"; local_changed=1
      fi
    done <<< "$snap"
    while IFS=$'\t' read -r a h; do
      [ -z "$a" ] && continue
      printf '%s' "$snap" | grep -qF "$(printf '%s\t' "$a")" || printf "  ${C_DIM}- 已移除 %s${C_OFF}\n" "$a"
    done < "$BASELINE"
    [ "$local_changed" = 0 ] && warn "无任何资源哈希变化（可能没有真正重建）"
    echo
  done
  exit 0
fi

# ---------- 校验模式 ----------
echo "校验目标: $BASE"
echo

snap_gpss=$(snapshot_assets "$BASE/gpss/" gpss)
snap_acad=$(snapshot_assets "$BASE/"     acad)
dir_gpss="$STATE_DIR/gpss"; dir_acad="$STATE_DIR/acad"

# ===== GPSS =====
echo "═══ GPSS 毕业设计管理系统 ($BASE/gpss/) ═══"
echo
if [ -z "$snap_gpss" ]; then
  fail "无法获取 /gpss/ 页面"
else
  lm=$(head_of "$BASE/gpss/" | grep -i '^last-modified' | sed 's/^[^:]*: *//' | tr -d '\r')
  dim "Last-Modified: $lm"
  echo

  # 1. favicon 应已删除
  if [ "$(grep -c 'rel="icon"' "$dir_gpss/index.html" 2>/dev/null)" = "0" ]; then
    pass "index.html 已无 rel=\"icon\"（favicon 已移除）"
  else
    fail "index.html 仍含 rel=\"icon\" —— 前端产物是旧版"
  fi

  # 2. 品牌文案
  if grep -rq 'GPSS系统' "$dir_gpss" 2>/dev/null; then
    pass "产物含「GPSS系统」"
  else
    fail "产物不含「GPSS系统」—— 品牌改动未生效"
  fi

  if grep -rq '半山堂' "$dir_gpss" 2>/dev/null; then
    pass "产物含「半山堂」"
  else
    fail "产物不含「半山堂」—— 页脚改动未生效"
  fi

  # 3. 旧文案应消失
  if grep -rq '视觉传达设计学院' "$dir_gpss" 2>/dev/null; then
    warn "产物仍含旧文案「视觉传达设计学院」（可能来自 VITE_APP_TITLE 环境变量，属遗留配置）"
  else
    pass "产物无旧文案「视觉传达设计学院」"
  fi

  # 4. bundle 指纹
  echo
  echo "  资源指纹:"
  while IFS=$'\t' read -r a h; do [ -n "$a" ] && dim "$h  $a"; done <<< "$snap_gpss"

  # 5. API
  hc=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/gpss/api/health" 2>/dev/null)
  [ "$hc" = "200" ] && pass "API 健康检查 200" || fail "API 健康检查返回 $hc"
fi

echo
# ===== 半山学堂 =====
echo "═══ 半山学堂 ($BASE/) ═══"
echo
if [ -z "$snap_acad" ]; then
  fail "无法获取 / 页面"
else
  lm=$(head_of "$BASE/" | grep -i '^last-modified' | sed 's/^[^:]*: *//' | tr -d '\r')
  dim "Last-Modified: $lm"
  echo

  # 1. ICP 备案（站点应有）
  if grep -rq '鲁ICP备2026052694' "$dir_acad" 2>/dev/null; then
    pass "产物含 ICP 备案号「鲁ICP备2026052694号-1」"
  else
    fail "产物不含 ICP 备案号 —— 前端产物是旧版（早于 7493e32）"
  fi

  # 2. 「进入毕业设计管理系统」按钮应已移除
  if grep -rq '进入毕业设计管理系统' "$dir_acad" 2>/dev/null; then
    warn "产物仍含「进入毕业设计管理系统」（若仅出现在 CSS 注释中属正常，请人工确认）"
  else
    pass "产物已无「进入毕业设计管理系统」按钮"
  fi

  # 3. 板块内容应可加载（排查后端未起导致的空页面）
  cc=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$BASE/api/categories" 2>/dev/null)
  [ "$cc" = "200" ] && pass "API /api/categories 200" || fail "API /api/categories 返回 $cc（后端可能未起，首页会空白）"

  echo
  echo "  资源指纹:"
  while IFS=$'\t' read -r a h; do [ -n "$a" ] && dim "$h  $a"; done <<< "$snap_acad"
fi

echo
echo "──────────────────────────────────────────────"
if [ "$FAILED" = 0 ]; then
  printf "${C_OK}全部通过${C_OFF}\n"
else
  printf "${C_BAD}%d 项未通过${C_OFF}\n" "$FAILED"
fi
echo
echo "提示：首次校验后运行 'bash $0 --baseline' 存基线，"
echo "      之后用 'bash $0 --compare' 只报告哪些资源变了（判断是否真重建）。"
exit "$FAILED"
