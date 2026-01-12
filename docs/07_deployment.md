# Deployment (Compose → Prod)

## Env vars (минимум для коробки)

**Orchestrator API**
- `DATABASE_URL`
- `REDIS_URL`
- `NODE_ENV`
- `PORT`
- `LOG_LEVEL`
- `ORCH_JWT_ISSUER`
- `ORCH_JWT_AUDIENCE_CONTROL` / `ORCH_JWT_AUDIENCE_EXEC`
- `ORCH_JWT_JWKS_URL` (или `ORCH_JWT_SHARED_SECRET` для MVP)
- `OTEL_EXPORTER_OTLP_ENDPOINT` (optional)
- `PAYLOAD_STORE_ENDPOINT` / `PAYLOAD_STORE_BUCKET` (MinIO/S3)

**Worker**
- `DATABASE_URL`
- `REDIS_URL`
- `LOG_LEVEL`
- `OTEL_EXPORTER_OTLP_ENDPOINT` (optional)

## docker-compose.dev.yml (MVP)
Обязательные сервисы:
- postgres
- redis
- orchestrator-api
- orchestrator-worker
- (optional) otel-collector

Требования:
- внутренние сети (api/worker не публикуются наружу напрямую)
- healthchecks
- restart policies
- миграции как отдельный шаг (`scripts/migrate.sh`)

## docker-compose.prod.yml (production-ready минимум)
- разделить сети: `public` (только proxy), `internal` (api/worker/db/redis)
- прокси (nginx/traefik) публикует:
  - `operator.<domain>` → operator-console
  - `orchestrator-control.<domain>` → control plane endpoints
  - `orchestrator-exec.<domain>` → execution endpoints (внутренний доступ, желательно)

Рекомендация: execution endpoints держать внутренними (только из backend сети/VPN).

## Kubernetes: нужен ли сразу

**Kubernetes (K8s)** — платформа оркестрации контейнеров. Она управляет:
- запуском нескольких экземпляров сервисов (scaling)
- автоматическими рестартами при сбоях
- rolling updates (обновления без даунтайма)
- service discovery, networking, ingress
- конфигами и секретами (через ConfigMaps/Secrets)

**Когда Kubernetes оправдан**
- много сервисов и окружений
- нужна высокая доступность и автоскейл
- нужны безопасные rolling updates и изоляция

**Что делать «правильно» сейчас**
- стартовать с Docker Compose, но сделать сервисы K8s-ready
- минимизировать зависимости Operator Console (out-of-band доступ)
- health checks + graceful shutdown
- миграции БД отдельным шагом

**План перехода к Kubernetes**
1) разделить deploy на `api` и `worker`
2) добавить readiness/liveness
3) вынести secrets в Vault/managed secrets
4) добавить autoscaling по queue depth
