#!/usr/bin/env bash
set -euo pipefail
DUMP_FILE="${1:?Usage: ./db-restore.sh <dump-file> [container-name]}"
CONTAINER_NAME="${2:-paint-day-postgres-db-prod}"
docker exec -i "$CONTAINER_NAME" pg_restore -U paint -d paint_tracker --clean --if-exists < "$DUMP_FILE"
