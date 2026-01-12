# Retention / Storage политика (MVP)

**TTL (ориентиры, настраиваемые):**
- `EventLog`: 30 дней
- `RequestLog`: 30 дней
- `WebhookInbox`: 14 дней (или 30 при необходимости)
- `Job/Run`: 14 дней
- `OperatorAuditLog`: 365 дней (или больше по требованиям комплаенса)

**Большие payload:**
- хранить в S3/MinIO (bucket) → `payload_ref`
- в БД держать только метаданные (size, hash, content-type)

**Реализация TTL:**
- MVP: nightly job cleanup по индексам `(created_at)`
- v1: partitioning по месяцам для Event/Request logs (drop partitions)
