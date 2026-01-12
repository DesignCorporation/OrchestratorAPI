# Repo bootstrap plan (первый спринт)

Цель спринта: поднять Orchestrator Kit как отдельный проект, с базовой архитектурой, CI и минимальным сквозным сценарием (health + events + queue).

## Структура репозитория (mono-repo recommended)

```
/buildos-orchestrator-kit
  /services
    /orchestrator-api
    /orchestrator-worker
    /operator-console
    /otel-collector            # optional
  /packages
    /orchestrator-core         # policy engine, types, execution primitives
    /orchestrator-connectors   # stripe/smtp/s3/http
    /orchestrator-schemas      # JSON Schemas, UI form schemas
  /infra
    /docker-compose
      docker-compose.dev.yml
      docker-compose.prod.yml
      nginx/                   # optional reverse-proxy
    /k8s
      base/                    # manifests skeleton (v2)
  /docs
    api-orchestrator.md        # этот документ
    runbooks.md
    threat-model.md
  /scripts
    migrate.sh
    seed-dev.sh
    dev.sh
```

## Пакеты и границы ответственности
- `@kit/orchestrator-core`
  - policy engine (timeouts, retries, breaker, rate limit primitives)
  - idempotency primitives
  - common types (TenantContext, ConnectorRef, PolicyRef)
  - OpenTelemetry helpers (propagation)

- `@kit/orchestrator-connectors`
  - code handlers (stripe, smtp, s3/minio)
  - generic HTTP connector (declarative)

- `@kit/orchestrator-schemas`
  - JSON Schema для каждого connector definition
  - UI schemas (если требуется)

- `services/orchestrator-api`
  - Control Plane API + Execution API

- `services/orchestrator-worker`
  - BullMQ workers + DLQ

- `services/operator-console`
  - UI: events stream + webhook inbox + DLQ
