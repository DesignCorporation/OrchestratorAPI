# Workspace isolation (MVP)

## Где enforced tenant_id
- Middleware на входе: workspace берётся из JWT (`tid`) и прокидывается в context.
- Любая операция записи/чтения обязана фильтровать по `tenant_id`.

## DB уровень (опционально, v1)
- Postgres RLS для таблиц с tenant_id, если нужно максимальное усиление.

## Индексы (обязательные)
- почти везде: `(tenant_id, created_at)`
- WebhookInbox: unique `(tenant_id, provider, event_id)`
- RequestLog: unique `(tenant_id, request_id)`
