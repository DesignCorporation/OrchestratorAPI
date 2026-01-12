# Idempotency / Dedupe

## /execute
- ключ: `(tenant_id, idempotency_key)`
- хранить: `request_hash` + `response_blob` (или response ref) + `created_at`
- TTL (MVP): 24–72 часа (настроечный параметр)

**Поведение:**
- повтор с тем же body hash: вернуть cached response (200) + `idempotency.replayed=true`
- повтор с другим body hash: 409 `IDEMPOTENCY_CONFLICT`

## /jobs
- ключ: `(tenant_id, idempotency_key)`
- TTL: 24–72 часа
- повтор: вернуть существующий `job_id` (202) без дублирования

## /webhooks/:provider
- dedupe key: `(tenant_id, provider, event_id)`
- TTL хранения inbox записи: 14–30 дней (см. retention)
- повтор: 200 + `duplicate: true` и не enqueue повторно
