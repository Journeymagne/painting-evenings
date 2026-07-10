#!/usr/bin/env bash
set -euo pipefail
CONTAINER_NAME="${1:-paint-day-postgres-db-prod}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUT="paint_tracker-${TIMESTAMP}.dump"
docker exec "$CONTAINER_NAME" pg_dump -U paint -d paint_tracker -F c > "$OUT"
echo "Backup saved to $OUT"
