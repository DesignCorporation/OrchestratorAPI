# Production readiness (MVP → prod)

## Security
- secrets не в БД, только SecretRef
- audit log операторских действий обязателен
- S2S auth + network isolation
- webhook signature verify + dedupe
- ограничение доступа к Control Plane (internal only)

## Reliability
- timeouts + retries + backoff + circuit breaker
- idempotency keys для /execute и webhooks
- DLQ + replay с аудитом
- конфиги versioned + rollback

## Observability
- structured logs JSON
- trace_id/request_id сквозные
- метрики: latency/error/queue/DLQ/breaker
- event stream UI
