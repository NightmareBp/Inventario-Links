#!/bin/bash
# Ejecutar como root. Requiere mysql_config_editor --login-path=respaldo.
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
install -d -m 700 /var/backups/bodega
exec 9>/var/run/backup-bodega.lock
flock -n 9 || exit 0
archivo="/var/backups/bodega/bodega_$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
temporal="${archivo}.part"
trap 'rm -f -- "$temporal"' EXIT
mysqldump --login-path=respaldo --single-transaction --quick --routines --events --triggers --no-tablespaces --set-gtid-purged=OFF --hex-blob bodega | gzip > "$temporal"
gzip -t "$temporal"
mv -- "$temporal" "$archivo"
find /var/backups/bodega -maxdepth 1 -type f -name 'bodega_*.sql.gz' -mtime +30 -delete
printf 'Respaldo creado: %s\n' "$archivo"
