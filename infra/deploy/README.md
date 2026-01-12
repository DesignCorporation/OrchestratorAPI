# Deploy (VM + Docker Compose)

## 1) Подготовка VM
- Установить Docker + Compose v2.
- Создать сеть для nginx: `docker network create public`.
- Скопировать репозиторий в `/opt/orchestrator`.
- Создать `/opt/orchestrator/.env.prod` (см. `.env.prod.example`).

## 2) Systemd unit
- Скопировать `infra/systemd/orchestrator-compose.service` в `/etc/systemd/system/`.
- `systemctl daemon-reload`
- `systemctl enable orchestrator-compose`

## 3) GHCR login
- На VM выполнить `docker login ghcr.io` (или в CI deploy job).

## 4) Запуск
- `systemctl start orchestrator-compose`
- Проверка: `curl -f http://127.0.0.1:4000/health`

## 4.1) Миграции (однократно)
- `docker compose -f infra/docker-compose/docker-compose.prod.yml --profile migrations run --rm orchestrator-migrate`
- Или `DATABASE_URL=... scripts/migrate.sh` (использует postgres container)

## 5) Nginx
- См. `infra/nginx/orchestrator-control.conf` и `infra/nginx/operator-console.conf`.
- Домены:
  - control plane: `orch.designcorp.eu`, `dev.orch.designcorp.eu`
  - operator console: `operator.orch.designcorp.eu`, `operator.dev.orch.designcorp.eu`

## Полная настройка VM
- См. `infra/deploy/VM_SETUP.md` для пошагового деплоя dev/prod.
