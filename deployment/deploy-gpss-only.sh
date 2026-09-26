#!/usr/bin/env bash
# Run on the production server as root. Only replaces GPSS source and gpss-app.
set -Eeuo pipefail
umask 077

ARCHIVE=${1:-}
CHECKSUM=${2:-}
if [[ -f /opt/banshan-gpss-deploy/docker-compose.yml && -d /opt/banshan-gpss-deploy/gpss ]]; then
  SOURCE=/opt/banshan-gpss-deploy/gpss
  COMPOSE_DIR=/opt/banshan-gpss-deploy
elif [[ -f /opt/banshan-academy/deployment/unified/docker-compose.yml && -d /opt/gpss-src ]]; then
  SOURCE=/opt/gpss-src
  COMPOSE_DIR=/opt/banshan-academy/deployment/unified
else
  printf 'ERROR: Supported GPSS source and Compose directory not found\n' >&2
  exit 1
fi
BACKUP_ROOT=/opt/gpss/backup
STAGE_ROOT=/opt/gpss/deploy-staging
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/deploy-$STAMP-$$"
STAGE_DIR="$STAGE_ROOT/deploy-$STAMP-$$"
SWAPPED=0

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[gpss-deploy] %s\n' "$*"; }

health() {
  local attempt
  for attempt in $(seq 1 60); do
    if docker compose exec -T gpss-app node -e \
      "fetch('http://127.0.0.1:3011/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

on_error() {
  local code=$1 line=$2
  trap - ERR
  log "Failed at line $line (exit $code). Backups: $BACKUP_DIR"
  if [[ $SWAPPED == 1 ]]; then
    cd "$COMPOSE_DIR" || exit "$code"
    if [[ -d $SOURCE ]]; then mv "$SOURCE" "$BACKUP_DIR/failed-new-source" || true; fi
    if [[ -d $BACKUP_DIR/old-source ]]; then
      mv "$BACKUP_DIR/old-source" "$SOURCE" || true
      if [[ -d $SOURCE ]]; then
        docker compose build gpss-app && docker compose up -d --no-deps gpss-app && health \
          && log 'Old GPSS service restored' || log 'Automatic rollback failed; inspect Docker logs and backup immediately'
      fi
    fi
  fi
  exit "$code"
}
trap 'on_error "$?" "$LINENO"' ERR

[[ $(id -u) == 0 ]] || fail 'Run as root on the production server'
[[ -f $ARCHIVE && -f $CHECKSUM ]] || fail 'Usage: deploy-gpss-only.sh ARCHIVE SHA256_FILE'
ARCHIVE=$(realpath "$ARCHIVE")
CHECKSUM=$(realpath "$CHECKSUM")
[[ -d $COMPOSE_DIR && -d $SOURCE ]] || fail 'Expected unified deployment not found'
[[ ! -L $SOURCE ]] || fail 'GPSS source must not be a symlink'
for command in docker python3 sha256sum tar gzip realpath; do command -v "$command" >/dev/null || fail "Missing $command"; done
[[ $(basename "$CHECKSUM") == "$(basename "$ARCHIVE").sha256" ]] || fail 'Checksum filename does not match archive'

cd "$(dirname "$ARCHIVE")"
sha256sum --check --status "$(basename "$CHECKSUM")"
python3 - "$ARCHIVE" <<'PY'
import pathlib
import sys
import tarfile

with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    names = set()
    if not members:
        raise SystemExit('Empty archive')
    for member in members:
        path = pathlib.PurePosixPath(member.name)
        if (not member.isfile() or len(path.parts) < 2 or path.parts[0] != 'gpss-src'
                or '..' in path.parts or member.name in names):
            raise SystemExit(f'Unsafe archive member: {member.name}')
        names.add(member.name)
    required = {'gpss-src/vite.config.ts', 'gpss-src/package.json',
                'gpss-src/server/package.json', 'gpss-src/deployment/aliyun/Dockerfile',
                'gpss-src/DEPLOY_COMMIT'}
    if not required.issubset(names):
        raise SystemExit(f'Missing required files: {required - names}')
PY
log 'Archive checksum and member paths verified'

mkdir -p "$BACKUP_ROOT" "$STAGE_ROOT"
mkdir "$BACKUP_DIR" "$STAGE_DIR"
tar -xzf "$ARCHIVE" -C "$STAGE_DIR"
[[ -f $STAGE_DIR/gpss-src/DEPLOY_COMMIT ]] || fail 'Staged source is incomplete'

cd "$COMPOSE_DIR"
docker compose config >/dev/null
docker compose ps --services --status running | grep -qx mysql || fail 'MySQL is not running'
log 'Backing up GPSS database and uploads'
docker compose exec -T mysql sh -c \
  'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --no-tablespaces --single-transaction --routines --triggers "$MYSQL_DATABASE"' \
  | gzip > "$BACKUP_DIR/gpss.sql.gz"
[[ -s $BACKUP_DIR/gpss.sql.gz ]]
gzip -t "$BACKUP_DIR/gpss.sql.gz"
for path in /opt/gpss/uploads /opt/gpss/uploads-private; do
  if [[ -d $path ]]; then tar -czf "$BACKUP_DIR/$(basename "$path").tar.gz" -C "$path" .; fi
done

log 'Switching GPSS source; existing container remains running during build'
mv "$SOURCE" "$BACKUP_DIR/old-source"
SWAPPED=1
mv "$STAGE_DIR/gpss-src" "$SOURCE"
docker compose build gpss-app
docker compose up -d --no-deps gpss-app
health
log "GPSS healthy. Commit: $(cat "$SOURCE/DEPLOY_COMMIT")"
log "Backups retained at $BACKUP_DIR"
