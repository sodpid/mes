#!/bin/bash
set -euo pipefail
umask 077
backup_dir=/opt/mes/backups
[ "$(realpath "$backup_dir")" = /opt/mes/backups ] || exit 1
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$backup_dir/mes-$stamp.sql.gz"
temporary="$file.partial"
trap 'rm -f "$temporary"' EXIT
# Password is read through stdin as a protected MySQL option file, never argv.
docker exec -i wgroup-demo-mysql-1 mysqldump --defaults-extra-file=/dev/stdin --single-transaction --no-tablespaces --set-gtid-purged=OFF --triggers --events mes </opt/mes/shared/backup.cnf | gzip >"$temporary"
gzip -t "$temporary"
[ -s "$temporary" ]
mv "$temporary" "$file"
sha256sum "$file" >"$file.sha256"
find "$backup_dir" -maxdepth 1 -type f -name 'mes-*.sql.gz*' -mtime +14 -delete
available=$(df -Pk "$backup_dir" | awk 'NR==2 {print $4}')
[ "$available" -ge 2097152 ] || printf 'WARNING: backup filesystem has less than 2GiB free\n' >&2
printf 'MES backup completed: %s\n' "$file"
