# Server Migration Scripts & Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backup/restore scripts and the migration runbook needed to move the `painting-evenings` production stack from the old server to a new one, with the Postgres backup/restore path validated end-to-end locally before it's ever used against production data.

**Architecture:** Two small, container-name-parameterized shell scripts (`scripts/db-backup.sh`, `scripts/db-restore.sh`) wrap `pg_dump`/`pg_restore` via `docker exec`. A third script (`scripts/test-db-backup-restore.sh`) exercises both against the existing local dev stack (`docker-compose.yml`) so the backup/restore mechanics are proven without touching any real server. A markdown runbook (`docs/server-migration-runbook.md`) documents the full cutover sequence from the design doc, including the manual steps (new server provisioning, DNS, GitHub secret update) that can't be scripted.

**Tech Stack:** bash, Docker Compose, PostgreSQL 16 (`pg_dump`/`pg_restore`, custom format `-F c`).

## Global Constraints

- Scripts live in `scripts/` at repo root (new directory).
- Production Postgres container name: `paint-day-postgres-db-prod` (default when no argument is given) — from `docker-compose.prod.yml`.
- Local dev Postgres container name: `paint-day-postgres-db` — from `docker-compose.yml`, used only for testing.
- DB name: `paint_tracker`, DB user: `paint` (same in both compose files).
- Dump format: custom (`pg_dump -F c`); restore uses `pg_restore --clean --if-exists` so it safely overwrites tables `server.js` already created at startup.
- Runbook file: `docs/server-migration-runbook.md` (new file, sibling to existing `docs/deploy-runbook.md`).
- No changes to `.github/workflows/deploy.yml` — it stays `runs-on: ubuntu-latest`; only the `SSH_HOST` secret changes (manual GitHub UI step, documented but not scripted).
- Design source of truth: `docs/superpowers/specs/2026-07-10-server-migration-design.md`.

---

### Task 1: `scripts/db-backup.sh`

**Files:**
- Create: `scripts/db-backup.sh`

**Interfaces:**
- Produces: executable script `scripts/db-backup.sh [container-name]`. Positional arg 1 (optional) is the Postgres container name, defaulting to `paint-day-postgres-db-prod`. On success, writes `paint_tracker-<YYYYMMDD-HHMMSS>.dump` to the current directory and prints `Backup saved to <filename>`. Exits non-zero on any failure (`set -euo pipefail`).
- Consumes: nothing (no dependency on other tasks).

- [ ] **Step 1: Write the failing check**

There's no test framework in this repo for shell scripts, so the "test" is a syntax check that must fail because the file doesn't exist yet.

Run: `bash -n scripts/db-backup.sh`
Expected: FAIL with `scripts/db-backup.sh: No such file or directory`

- [ ] **Step 2: Create the script**

```bash
#!/usr/bin/env bash
set -euo pipefail
CONTAINER_NAME="${1:-paint-day-postgres-db-prod}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUT="paint_tracker-${TIMESTAMP}.dump"
docker exec "$CONTAINER_NAME" pg_dump -U paint -d paint_tracker -F c > "$OUT"
echo "Backup saved to $OUT"
```

Save to `scripts/db-backup.sh`, then:
```bash
chmod +x scripts/db-backup.sh
```

- [ ] **Step 3: Run syntax check to verify it passes**

Run: `bash -n scripts/db-backup.sh`
Expected: no output, exit code 0

- [ ] **Step 4: Commit**

```bash
git add scripts/db-backup.sh
git commit -m "Add production DB backup script"
```

---

### Task 2: `scripts/db-restore.sh`

**Files:**
- Create: `scripts/db-restore.sh`

**Interfaces:**
- Produces: executable script `scripts/db-restore.sh <dump-file> [container-name]`. Positional arg 1 (required) is the dump file path; arg 2 (optional) is the Postgres container name, defaulting to `paint-day-postgres-db-prod`. Restores into DB `paint_tracker`, user `paint`, dropping/recreating existing objects (`--clean --if-exists`). Exits non-zero on any failure.
- Consumes: dump file produced by `scripts/db-backup.sh` (Task 1) — same custom `-F c` format.

- [ ] **Step 1: Write the failing check**

Run: `bash -n scripts/db-restore.sh`
Expected: FAIL with `scripts/db-restore.sh: No such file or directory`

- [ ] **Step 2: Create the script**

```bash
#!/usr/bin/env bash
set -euo pipefail
DUMP_FILE="${1:?Usage: ./db-restore.sh <dump-file> [container-name]}"
CONTAINER_NAME="${2:-paint-day-postgres-db-prod}"
docker exec -i "$CONTAINER_NAME" pg_restore -U paint -d paint_tracker --clean --if-exists < "$DUMP_FILE"
```

Save to `scripts/db-restore.sh`, then:
```bash
chmod +x scripts/db-restore.sh
```

- [ ] **Step 3: Run syntax check to verify it passes**

Run: `bash -n scripts/db-restore.sh`
Expected: no output, exit code 0

- [ ] **Step 4: Verify the no-argument case fails clearly**

Run: `./scripts/db-restore.sh`
Expected: FAIL with `scripts/db-restore.sh: line 3: 1: Usage: ./db-restore.sh <dump-file> [container-name]`

- [ ] **Step 5: Commit**

```bash
git add scripts/db-restore.sh
git commit -m "Add production DB restore script"
```

---

### Task 3: End-to-end backup/restore validation against the local dev stack

**Files:**
- Create: `scripts/test-db-backup-restore.sh`

**Interfaces:**
- Consumes: `scripts/db-backup.sh [container-name]` and `scripts/db-restore.sh <dump-file> [container-name]` (Tasks 1–2), and the existing local dev stack defined in `docker-compose.yml` (container `paint-day-postgres-db`, DB `paint_tracker`, user `paint`, password `paint`, port `55432`).
- Produces: executable script `scripts/test-db-backup-restore.sh` that starts the local Postgres container, proves the backup/restore round-trip preserves data and drops post-backup writes, then cleans up after itself. Prints `PASS` and exits 0 on success; exits non-zero with a clear message on any check failure.

This is the real testable deliverable for this plan — it proves the scripts in Tasks 1–2 actually work before they're ever pointed at production data.

- [ ] **Step 1: Write the failing check**

Run: `bash -n scripts/test-db-backup-restore.sh`
Expected: FAIL with `scripts/test-db-backup-restore.sh: No such file or directory`

- [ ] **Step 2: Create the script**

```bash
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
```

Save to `scripts/test-db-backup-restore.sh`, then:
```bash
chmod +x scripts/test-db-backup-restore.sh
```

- [ ] **Step 3: Run syntax check to verify it passes**

Run: `bash -n scripts/test-db-backup-restore.sh`
Expected: no output, exit code 0

- [ ] **Step 4: Run the end-to-end test**

Run: `./scripts/test-db-backup-restore.sh`
Expected: last line of output is `PASS`, exit code 0. This proves: backup captures the pre-mutation state, the post-backup insert (`should-be-gone-after-restore`) does not survive, and restore leaves exactly the original row (`hello-before-backup`).

- [ ] **Step 5: Confirm cleanup left no residue**

Run: `docker exec paint-day-postgres-db psql -U paint -d paint_tracker -c "\dt"` and `ls paint_tracker-*.dump 2>/dev/null; echo done`
Expected: `migration_test` is not listed among the tables (or the DB has no other tables from this test), and the second command prints only `done` (no dump files left over).

- [ ] **Step 6: Commit**

```bash
git add scripts/test-db-backup-restore.sh
git commit -m "Add local end-to-end test for DB backup/restore scripts"
```

---

### Task 4: `docs/server-migration-runbook.md`

**Files:**
- Create: `docs/server-migration-runbook.md`

**Interfaces:**
- Consumes: `scripts/db-backup.sh` and `scripts/db-restore.sh` (Tasks 1–2, validated by Task 3), the phased sequence from `docs/superpowers/specs/2026-07-10-server-migration-design.md`, and the existing setup steps 2–6 in `docs/deploy-runbook.md` (deploy user, Docker, firewall, repo clone).
- Produces: a markdown runbook a human follows step-by-step during the actual migration. No other task depends on this file.

- [ ] **Step 1: Write the runbook**

Save to `docs/server-migration-runbook.md`:

```markdown
# Runbook: перенос продакшен-сервера на новый хост

Выполняется один раз при переезде на новый сервер. Домен и `SITE_ADDRESS` не
меняются — меняется только IP-адрес в DNS. Раннер GitHub Actions остаётся
`ubuntu-latest` (GitHub-hosted) — меняется только SSH-таргет деплоя.

Везде ниже замените `<OLD_IP>` / `<NEW_IP>` на реальные адреса и
`<домен>.ru` на ваш домен.

## Фаза 1 — подготовка нового сервера (без даунтайма)

### 1. Базовая настройка нового сервера

Выполните шаги 2–6 из [`docs/deploy-runbook.md`](./deploy-runbook.md):
пользователь `deploy`, Docker, клонирование репозитория, файрвол. Пропустите
шаг 7 (`docker compose up`) — стек здесь поднимать рано.

### 2. Перенос `.env`

С локальной машины:
```bash
scp deploy@<OLD_IP>:~/painting-evenings/.env /tmp/paint.env
scp /tmp/paint.env deploy@<NEW_IP>:~/painting-evenings/.env
rm /tmp/paint.env
```

### 3. Сборка образа и запуск только Postgres на новом сервере

На новом сервере, в директории репозитория:
```bash
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.prod.yml ps
```
Дождитесь статуса `healthy` у `postgres`. `app` и `caddy` пока не трогаем.

### 4. Снижение TTL DNS-записи (рекомендуется, за день до переезда)

В GoDaddy → DNS → запись `A` для `paint.<домен>.ru` → уменьшите TTL (например
до 300 секунд). Это сократит время пропагации на шаге переключения.

### 5. Добавление SSH-ключа деплоя на новый сервер

Ключевая пара не пересоздаётся. На новом сервере под пользователем `deploy`:
```bash
echo "<содержимое paint-deploy-key.pub>" >> ~/.ssh/authorized_keys
```

## Фаза 2 — окно даунтайма

### 6. Остановка записи на старом сервере

На старом сервере:
```bash
docker compose -f docker-compose.prod.yml stop app
```

### 7. Снятие дампа на старом сервере

На старом сервере, в директории репозитория:
```bash
./scripts/db-backup.sh
```
Скрипт напечатает `Backup saved to paint_tracker-<timestamp>.dump`.

### 8. Перенос дампа на новый сервер

С локальной машины:
```bash
scp deploy@<OLD_IP>:~/painting-evenings/paint_tracker-*.dump ./
scp paint_tracker-*.dump deploy@<NEW_IP>:~/painting-evenings/
```

### 9. Восстановление на новом сервере

На новом сервере, в директории репозитория:
```bash
./scripts/db-restore.sh paint_tracker-<timestamp>.dump
```

### 10. Запуск приложения на новом сервере

На новом сервере:
```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```
Все три сервиса должны быть `running`/`healthy`.

### 11. Переключение DNS

В GoDaddy → DNS → запись `A` для `paint.<домен>.ru` → значение `<NEW_IP>`.

## Фаза 3 — после переключения

### 12. Обновление секрета GitHub Actions

В репозитории на GitHub: Settings → Secrets and variables → Actions →
`SSH_HOST` → обновить значение на `<NEW_IP>`. `SSH_USER` и `SSH_PRIVATE_KEY`
не меняются, воркфлоу остаётся `runs-on: ubuntu-latest`.

### 13. Проверка

1. `curl -I https://paint.<домен>.ru` — `HTTP/2 200`, валидный сертификат
   (Caddy сам переоформит Let's Encrypt на новом IP).
2. Ручной проход в браузере: регистрация → вход → создание вечера покраса →
   бронирование места.
3. Тестовый коммит в `main` — убедиться, что workflow `Deploy` в GitHub
   Actions прошёл успешно и изменения применились на новом сервере.

## Rollback

**До переключения DNS (шаг 11):** старый сервер не тронут ничем, кроме
`stop app` на шаге 6. Откат:
```bash
docker compose -f docker-compose.prod.yml up -d
```
на старом сервере — DNS переключать не пришлось, ничего менять не нужно.

**После переключения DNS:** верните A-запись на `<OLD_IP>` и на старом
сервере выполните тот же `docker compose -f docker-compose.prod.yml up -d`.
Данные там не удалялись и отстают максимум на несколько минут (с момента
шага 6).

## После подтверждения успеха

Старый сервер можно оставить на некоторое время как холодный fallback.
Решение о его отключении — ручное, вне этого раннбука.
```

- [ ] **Step 2: Verify every script command in the runbook matches the actual files**

Run: `grep -n 'scripts/db-' docs/server-migration-runbook.md`
Expected output includes exactly these two lines (paths must exist as real files from Tasks 1–2):
```
./scripts/db-backup.sh
./scripts/db-restore.sh paint_tracker-<timestamp>.dump
```
Then confirm both files exist: `ls scripts/db-backup.sh scripts/db-restore.sh`
Expected: both paths printed, no "No such file" error.

- [ ] **Step 3: Verify the runbook references the design doc's phases**

Run: `grep -n '^##' docs/server-migration-runbook.md`
Expected: three phase headers matching the design doc — "Фаза 1", "Фаза 2", "Фаза 3" — plus "Rollback" and "После подтверждения успеха".

- [ ] **Step 4: Commit**

```bash
git add docs/server-migration-runbook.md
git commit -m "Add step-by-step server migration runbook"
```

---

## Self-Review Notes

- **Spec coverage:** Phase 1 (steps 1–5), Phase 2 (steps 6–11), Phase 3 (steps 12–13), and the rollback plan from the design doc are all present in Task 4's runbook content verbatim. The two scripts from the design doc's "Скрипты" section are Tasks 1–2, with a container-name parameter added (default matches the design doc exactly) solely to make Task 3's local test possible. GitHub `SSH_HOST` secret update is documented as a manual step in Task 4, matching the design doc's explicit choice not to script it.
- **Placeholder scan:** no TBD/TODO; the only bracketed placeholders (`<OLD_IP>`, `<NEW_IP>`, `<домен>.ru`, `<содержимое paint-deploy-key.pub>`, `<timestamp>`) are runbook-user-facing substitution points, consistent with the same convention already used in `docs/deploy-runbook.md`.
- **Type/interface consistency:** container name default (`paint-day-postgres-db-prod`), DB name (`paint_tracker`), and user (`paint`) are identical across Tasks 1, 2, and 3. Task 3's test container name (`paint-day-postgres-db`) is passed explicitly as an argument, never assumed as a default, so it can't leak into production usage.
