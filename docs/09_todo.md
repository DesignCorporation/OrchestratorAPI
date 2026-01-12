# TODO (следующая итерация)

- какой фреймворк Node выбрать (Fastify vs Nest vs Hono)
- где хранить payload_ref (S3/MinIO) и какие лимиты для inline `payload_json`
- будет ли отдельный event store / event bus (v2: NATS/Kafka)
- SLA/SLO и алерты (p95/error budgets) + on-call runbooks
- Postgres RLS (нужно ли включать в v1) и стратегия partitioning для логов
