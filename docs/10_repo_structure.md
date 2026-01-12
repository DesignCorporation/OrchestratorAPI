# Repo structure

## Варианты стратегии репозитория
1) **Mono-repo** (рекомендуется, если нужен единый CI/CD):
   - `/packages/orchestrator-core`
   - `/packages/orchestrator-connectors`
   - `/services/orchestrator-api`
   - `/services/orchestrator-worker`
   - `/services/operator-console`
2) **Отдельный репозиторий Orchestrator Kit** (если хотите переиспользовать вне BuildOS):
   - публикуемый пакет `@org/orchestrator-core`
   - сервис-шаблон `orchestrator-service`
   - набор connectors

## Рекомендуемые папки (минимум)
- `/services/orchestrator-api`
- `/services/orchestrator-worker`
- `/packages/orchestrator-core` (policy engine, types, schemas)
- `/packages/orchestrator-connectors` (stripe/smtp/s3/http)
- `/infra/docker-compose`
- `/docs`
