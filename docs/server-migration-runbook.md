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
