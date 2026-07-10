#!/usr/bin/env bash
set -euo pipefail

CONTAINER=paint-day-postgres-db
DB_ARGS=(-U paint -d paint_tracker)

cleanup() {
  docker exec "$CONTAINER" psql "${DB_ARGS[@]}" -c "DROP TABLE IF EXISTS migration_test;" >/dev/null 2>&1 || true
  rm -f paint_tracker-*.dump
}
trap cleanup EXIT

echo "Starting local postgres..."
docker compose up -d postgres

echo "Waiting for postgres to be healthy..."
for _ in $(seq 1 20); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "starting")
  [ "$status" = "healthy" ] && break
  sleep 1
done
if [ "$status" != "healthy" ]; then
  echo "FAIL: postgres never became healthy"
  exit 1
fi

echo "Seeding test data..."
docker exec "$CONTAINER" psql "${DB_ARGS[@]}" -c \
  "CREATE TABLE migration_test (id serial primary key, note text); INSERT INTO migration_test (note) VALUES ('hello-before-backup');"

echo "Running backup script..."
./scripts/db-backup.sh "$CONTAINER"
DUMP_FILE=$(ls -t paint_tracker-*.dump | head -1)

echo "Mutating data after backup (should not survive restore)..."
docker exec "$CONTAINER" psql "${DB_ARGS[@]}" -c \
  "INSERT INTO migration_test (note) VALUES ('should-be-gone-after-restore');"

echo "Running restore script..."
./scripts/db-restore.sh "$DUMP_FILE" "$CONTAINER"

echo "Verifying restored data..."
RESULT=$(docker exec "$CONTAINER" psql "${DB_ARGS[@]}" -t -A -c \
  "SELECT string_agg(note, ',' ORDER BY id) FROM migration_test;")

if [ "$RESULT" = "hello-before-backup" ]; then
  echo "PASS"
  exit 0
else
  echo "FAIL: expected 'hello-before-backup', got '$RESULT'"
  exit 1
fi
