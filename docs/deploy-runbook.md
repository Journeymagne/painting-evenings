# Runbook: разовая настройка продакшен-сервера

Выполняется один раз при первом деплое. Дальнейшие обновления идут через
`git push` в `main` — GitHub Actions делает деплой сам (см.
`.github/workflows/deploy.yml`).

Везде ниже замените `<домен>.ru` на ваш реальный домен и `<SERVER_IP>` на
IP-адрес вашего сервера.

## 1. DNS на GoDaddy

1. Зайдите в панель GoDaddy → My Products → DNS для вашего домена.
2. Добавьте запись:
   - Тип: `A`
   - Имя: `paint`
   - Значение: `<SERVER_IP>`
   - TTL: по умолчанию
3. Подождите пропагации (обычно от нескольких минут до часа). Проверить:
   `dig +short paint.<домен>.ru` должен вернуть `<SERVER_IP>`.

## 2. Пользователь для деплоя и SSH-ключ

На локальной машине сгенерируйте отдельную ключевую пару для деплоя
(не используйте личный SSH-ключ):

```bash
ssh-keygen -t ed25519 -f ./paint-deploy-key -N "" -C "github-actions-deploy"
```

Это создаст `paint-deploy-key` (приватный) и `paint-deploy-key.pub`
(публичный).

Скопируйте публичный ключ на сервер:

```bash
scp paint-deploy-key.pub youruser@<SERVER_IP>:~/
```

На сервере (под существующим пользователем с sudo):

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo mkdir -p /home/deploy/.ssh
sudo tee /home/deploy/.ssh/authorized_keys < ~/paint-deploy-key.pub
sudo chown -R deploy:deploy /home/deploy/.ssh
sudo chmod 700 /home/deploy/.ssh
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

## 3. Docker на сервере

Если Docker ещё не установлен (Ubuntu/Debian):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
```

Проверить: `sudo -u deploy docker ps` должен отработать без ошибок доступа.

## 4. Клонирование репозитория

Под пользователем `deploy`:

```bash
sudo -iu deploy
git clone git@github.com:<ваш-аккаунт>/painting-evenings.git
cd painting-evenings
```

Репозиторий приватный — для клонирования на сервере понадобится либо
deploy-ключ репозитория (GitHub → Settings → Deploy keys), либо личный
SSH-ключ пользователя `deploy` с доступом к репозиторию.

## 5. Файл `.env`

Всё ещё под пользователем `deploy`, в директории репозитория:

```bash
cp .env.example .env
```

Откройте `.env` и замените значения:

- `POSTGRES_PASSWORD` — сгенерируйте случайный пароль, например
  `openssl rand -base64 24`.
- `PORT` — оставить `3000`.
- `SITE_ADDRESS` — ваш реальный поддомен, например `paint.<домен>.ru`
  (без `https://`, без слэша на конце).

`.env` не коммитится в git (уже покрыто `.gitignore` проекта — но
проверьте, что `.env` не попадёт в `git status` как отслеживаемый файл).

## 6. Файрвол

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Порты для Amnezia VPN добавляются отдельно при её установке — они не
пересекаются с портами 80/443/22, используемыми этим стеком.

## 7. Первый запуск

Под пользователем `deploy`, в директории репозитория:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Проверить: `docker compose -f docker-compose.prod.yml ps` — все три
сервиса (`postgres`, `app`, `caddy`) в статусе `running`/`healthy`.

Caddy сам запросит сертификат Let's Encrypt при первом обращении по
HTTPS — специальных действий не требуется.

## 8. Секреты в GitHub Actions

В репозитории на GitHub: Settings → Secrets and variables → Actions →
New repository secret. Добавить три секрета:

- `SSH_HOST` — `<SERVER_IP>`
- `SSH_USER` — `deploy`
- `SSH_PRIVATE_KEY` — содержимое файла `paint-deploy-key` (приватный
  ключ, сгенерированный в шаге 2), целиком, включая строки
  `-----BEGIN OPENSSH PRIVATE KEY-----` / `-----END OPENSSH PRIVATE KEY-----`.

После этого удалите локальную копию `paint-deploy-key` /
`paint-deploy-key.pub`, если она вам больше не нужна для ручного доступа.

## 9. Проверка

1. `curl -I https://paint.<домен>.ru` — ожидается `HTTP/2 200` и валидный
   сертификат.
2. Вручную пройти в браузере: регистрация → вход → создание вечера
   покраса → бронирование места.
3. Сделать тестовый коммит в `main`, убедиться что workflow `Deploy` в
   GitHub Actions прошёл успешно (вкладка Actions в репозитории) и
   изменения реально применились на сервере.
