#!/bin/bash
set -euo pipefail
umask 077
# Installed only for BIGINT_UUID25. Original app.env/backup.cnf/backup.sh remain rollback assets.
: "${MES_RELEASE_ENV:?Set the approved BIGINT release environment path}"
: "${MES_BACKUP_CNF:?Set the approved BIGINT backup option-file path}"
[ "$(realpath "$MES_RELEASE_ENV")" = /opt/mes/shared/app-bigint-20261024.env ] || exit 1
[ "$(realpath "$MES_BACKUP_CNF")" = /opt/mes/shared/backup-bigint-20261024.cnf ] || exit 1
backup_dir=/opt/mes/backups
[ "$(realpath "$backup_dir")" = /opt/mes/backups ] || exit 1
# Parse dotenv as data, never source executable shell text or print a connection URL.
database=$(python3 - "$MES_RELEASE_ENV" "$MES_BACKUP_CNF" <<'PY'
import os, stat, sys
from urllib.parse import urlparse, unquote
for path in sys.argv[1:]:
    meta=os.stat(path)
    if not stat.S_ISREG(meta.st_mode) or meta.st_mode & 0o077 or meta.st_uid not in (0, os.geteuid()):
        raise SystemExit('Backup configuration permissions rejected')
values=[]
with open(sys.argv[1],encoding='utf-8-sig') as f:
    for raw in f:
        line=raw.strip()
        if line.startswith('DATABASE_URL='):
            value=line.split('=',1)[1].strip()
            if value[:1] in ('"', "'") and value[-1:]==value[:1]: value=value[1:-1]
            values.append(value)
if len(values)!=1: raise SystemExit('Exactly one database URL required')
u=urlparse(values[0])
if u.scheme!='mysql' or unquote(u.path) != '/mes_bigint_20261024' or u.query or u.fragment:
    raise SystemExit('BIGINT backup database assertion failed')
print('mes_bigint_20261024')
PY
)
[ "$database" = mes_bigint_20261024 ] || exit 1
# Validate the release lineage before taking a dump. Credentials only travel through stdin.
expected_checksum=687b43e99872bf968717df8fb0f4c5017658dcb78497bf015da8979ff0e1c11d
lineage=$(docker exec -i wgroup-demo-mysql-1 mysql --defaults-extra-file=/dev/stdin --batch --skip-column-names --database="$database" --execute="SELECT checksum FROM schema_migrations WHERE version='001_bigint_uuid_baseline.json' AND state='APPLIED' AND error_step IS NULL AND (SELECT COUNT(*) FROM schema_migrations)=1" <"$MES_BACKUP_CNF")
[ "$lineage" = "$expected_checksum" ] || { printf 'Backup refused: migration lineage mismatch\n' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$backup_dir/mes-bigint-20261024-$stamp.sql.gz"
[ ! -e "$file" ] || exit 1
temporary="$file.partial"
trap 'rm -f "$temporary"' EXIT
docker exec -i wgroup-demo-mysql-1 mysqldump --defaults-extra-file=/dev/stdin --single-transaction --no-tablespaces --set-gtid-purged=OFF --triggers --events "$database" <"$MES_BACKUP_CNF" | gzip >"$temporary"
gzip -t "$temporary"
[ -s "$temporary" ]
mv "$temporary" "$file"
sha256sum "$file" >"$file.sha256"
find "$backup_dir" -maxdepth 1 -type f -name 'mes-bigint-20261024-*.sql.gz*' -mtime +14 -delete
available=$(df -Pk "$backup_dir" | awk 'NR==2 {print $4}')
[ "$available" -ge 2097152 ] || printf 'WARNING: backup filesystem has less than 2GiB free\n' >&2
printf 'MES BIGINT backup completed: %s\n' "$file"
