# Дизайн: перенос продакшен-сервера на новый хост

## Контекст

Продакшен — один Docker Compose стек (`docker-compose.prod.yml`): `postgres` +
`app` + `caddy` (реверс-прокси с авто-HTTPS). На сервере не крутится ничего
кроме этого стека. Деплой — GitHub Actions workflow
(`.github/workflows/deploy.yml`) с `runs-on: ubuntu-latest`, который по SSH
(секреты `SSH_HOST`/`SSH_USER`/`SSH_PRIVATE_KEY`) заходит на сервер и делает
`git pull && docker compose up -d --build`. Собственного self-hosted раннера
нет — "раннер" в этой задаче означает SSH-таргет деплоя, не GitHub Actions
runner как отдельный сервис.

Домен и `SITE_ADDRESS` не меняются — меняется только IP-адрес, на который
указывает A-запись.

## Цель

1. Снять бэкап текущего продакшен-сервера.
2. Перенести и развернуть стек на новом сервере.
3. Переключить деплой (GitHub Actions SSH-таргет) на новый сервер.

## Подход

Подготовка нового сервера и сборка образов идут заранее, без даунтайма.
Даунтайм ограничен минимальным критическим путём: остановка записи на старом
сервере → дамп → перенос дампа → восстановление → запуск нового стека →
переключение DNS. Ожидаемый даунтайм — несколько минут плюс время
DNS-пропагации (снижаем заранее TTL A-записи, чтобы это сократить).

Бэкап БД — логический дамп через `pg_dump`/`pg_restore` (не сырое
копирование docker volume): оба сервера используют один и тот же образ
`postgres:16-alpine`, так что версии совпадают, а `pg_dump` даёт консистентный
снапшот без остановки БД (останавливаем только `app`, чтобы не терять записи
между дампом и восстановлением).

### Фаза 1 — подготовка нового сервера (без даунтайма)

1. Настройка нового сервера: deploy-пользователь, Docker, firewall,
   клонирование репозитория — переиспользуем шаги 2–6 существующего
   `docs/deploy-runbook.md`.
2. Копирование `.env` со старого сервера на новый (`scp`) — тот же пароль БД
   и `SITE_ADDRESS`, ничего не генерируем заново.
3. На новом сервере: `docker compose -f docker-compose.prod.yml build app` и
   `docker compose -f docker-compose.prod.yml up -d postgres` — поднимаем
   только Postgres и ждём healthy. `app`/`caddy` пока не стартуем, чтобы
   избежать гонки с восстановлением БД и чтобы Caddy не начал преждевременно
   пытаться получить сертификат по старому DNS.
4. Рекомендация: за день до переезда снизить TTL A-записи в GoDaddy.
5. Добавить существующий публичный ключ деплоя (`paint-deploy-key.pub`) в
   `authorized_keys` пользователя `deploy` на новом сервере. Ключевая пара не
   пересоздаётся — приватная часть в GitHub-секрете `SSH_PRIVATE_KEY` не
   меняется, меняется только хост, на который он даёт доступ.

### Фаза 2 — окно даунтайма

6. На старом сервере: `docker compose -f docker-compose.prod.yml stop app` —
   останавливаем запись новых данных (Postgres и Caddy можно не трогать).
7. На старом сервере: `./scripts/db-backup.sh` — снимаем дамп.
8. `scp` дампа со старого сервера на новый.
9. На новом сервере: `./scripts/db-restore.sh <файл-дампа>`.
10. На новом сервере: `docker compose -f docker-compose.prod.yml up -d --build`
    — поднимаем `app` + `caddy`.
11. Переключаем A-запись в GoDaddy на новый IP.

### Фаза 3 — после переключения

12. Обновляем секрет `SSH_HOST` в GitHub Actions (Settings → Secrets and
    variables → Actions) на новый IP. `SSH_USER`/`SSH_PRIVATE_KEY` не
    меняются. Workflow остаётся `runs-on: ubuntu-latest` — self-hosted раннер
    не нужен.
13. Проверка: `curl -I https://paint.<домен>.ru`, ручной проход
    (регистрация/вход/бронирование), тестовый коммит в `main` — убедиться,
    что автодеплой отработал уже на новом сервере.

## Скрипты

Новая директория `scripts/` в репозитории, оба скрипта выполняются прямо на
сервере через `docker exec` (используют уже работающие контейнеры, отдельные
учётки для Postgres не нужны):

**`scripts/db-backup.sh`** (на старом сервере):
```bash
#!/usr/bin/env bash
set -euo pipefail
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUT="paint_tracker-${TIMESTAMP}.dump"
docker exec paint-day-postgres-db-prod pg_dump -U paint -d paint_tracker -F c > "$OUT"
echo "Backup saved to $OUT"
```

**`scripts/db-restore.sh`** (на новом сервере, после `scp` дампа):
```bash
#!/usr/bin/env bash
set -euo pipefail
DUMP_FILE="${1:?Usage: ./db-restore.sh <dump-file>}"
docker exec -i paint-day-postgres-db-prod pg_restore -U paint -d paint_tracker --clean --if-exists < "$DUMP_FILE"
```

Формат `-F c` (custom) даёт компактный дамп и поддержку `--clean --if-exists`
в `pg_restore`, что безопасно перезаписывает таблицы, которые `server.js` уже
создал при старте нового Postgres.

## Документация

Пошаговый ранбук `docs/server-migration-runbook.md` (по аналогии с
существующим `docs/deploy-runbook.md`) с точными командами для всех 13 шагов
выше, плюс:

- **Rollback до переключения DNS:** старый сервер не трогали ничем, кроме
  `stop app` — откатывается через `docker compose up -d` на старом сервере,
  DNS переключать не пришлось.
- **Rollback после переключения DNS:** вернуть A-запись на старый IP,
  `docker compose -f docker-compose.prod.yml up -d` на старом сервере —
  данные там не удалялись, отстают максимум на несколько минут (с момента
  `stop app`).
- **После подтверждения успеха:** старый сервер можно оставить как холодный
  fallback на некоторое время; решение о его отключении — ручное, вне
  скриптов.

## Вне рамок

- Self-hosted GitHub Actions runner не настраивается — не требуется для этой
  задачи.
- Домен/DNS-провайдер не меняются, только IP в существующей A-записи.
- Другие сервисы (VPN и т.п.) не переносятся — на старом сервере их нет.
