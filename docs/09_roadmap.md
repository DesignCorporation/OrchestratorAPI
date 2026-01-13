# Роадмап

## MVP (2 недели) — «один боевой сценарий»
Цель: Stripe webhook → enqueue → обработка → update subscription (в BuildOS) → logs/events/traces → DLQ + replay.

**Week 1**
- База Orchestrator API (Fastify/Nest/Hono — выбрать и зафиксировать)
- Postgres schema (минимально необходимые таблицы)
- Redis + BullMQ + worker + DLQ
- Webhook ingress `/webhooks/stripe` (verify + dedupe + inbox + enqueue)
- EventLog + RequestLog (минимальная запись)

**Week 2**
- `/execute` (sync) + idempotency
- Policy engine v0 (timeout + retry/backoff + circuit breaker базово)
- OTel traces end-to-end (API → worker)
- Event stream endpoint `/events/stream` (SSE)
- Operator Console integration v0 (read-only страницы + DLQ replay)

## v1 (4–6 недель)
- Коннекторы: SMTP, S3/MinIO, Generic HTTP
- Политики: per-workspace quotas, concurrency limits, staged rollout конфигов
- Config versioning + activate/rollback UI
- Улучшение диагностики: request replay (без секретов)

## v2 (2–3 месяца)
- mTLS (SPIFFE/SPIRE или service mesh) + строгий service identity
- Переход на NATS/Kafka (если нужен большой event streaming)
- Secret rotation workflows
- Multi-region readiness (EU/US)
- Автоматические mitigation-политики (auto-disable provider при массовых 5xx)
