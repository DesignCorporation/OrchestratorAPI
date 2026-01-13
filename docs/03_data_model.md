# Data model (MVP)

Краткие схемы ключевых таблиц, чтобы консистентно делать миграции и UI.

## Workspace
- `id (uuid)`, `name (text, unique)`, `env (text)`
- `status (text)` (active|disabled)
- `created_at`, `updated_at`
- индексы: `(env, status)`

## WorkspaceInvite
- `id (uuid)`, `workspace_id (uuid)`
- `token (text, unique)`, `expires_at`, `used_at (nullable)`
- `created_by (uuid, nullable)`, `created_at`
- индексы: `(workspace_id)`

## Connector
- `id (uuid)`, `tenant_id (uuid)`
- `type (text)`, `name (text)`, `status (text)`
- `settings_json (jsonb)` (без секретов)
- `secret_ref_id (uuid, nullable)` → SecretRef
- `policy_id (uuid, nullable)` → Policy
- индексы: `(tenant_id, type)`, unique `(tenant_id, name)`

## Policy
- `id`, `tenant_id`, `name`, `version (int)`
- `rate_limit_json`, `retry_json`, `timeout_json`, `circuit_breaker_json`, `concurrency_json`
- индексы: `(tenant_id, name)`

## SecretRef
- `id`, `tenant_id`
- `provider (text)`, `ref (text)`, `version (text/int)`
- индексы: `(tenant_id, provider)`

## WebhookInbox
- `id`, `tenant_id`, `provider (text)`
- `event_id (text)` (dedupe key)
- `signature_valid (bool)`
- `received_at`, `processed_at (nullable)`
- `status (text)` (received|processed|ignored|failed)
- `payload_ref (text, nullable)` / `payload_json (jsonb, nullable)`
- unique `(tenant_id, provider, event_id)`
- индексы: `(tenant_id, received_at)`

## Job
- `id`, `tenant_id`, `type (text)`
- `status (text)` (queued|running|success|failed|dead)
- `attempts (int)`, `max_attempts (int)`
- `run_at (timestamptz, nullable)`
- `payload_ref (text, nullable)` / `payload_json (jsonb, nullable)`
- `idempotency_key (text, nullable)`
- индексы: `(tenant_id, status)`, `(tenant_id, created_at)`

## Run
- `id`, `job_id (uuid)` → Job
- `status (text)`
- `started_at`, `finished_at`
- `error_json (jsonb, nullable)`
- индекс: `(job_id, started_at)`

## EventLog
- `id`, `tenant_id`
- `severity (text)`, `type (text)`
- `message (text)`, `data_json (jsonb)`
- `correlation_id (text)`, `trace_id (text)`
- `created_at`
- индексы: `(tenant_id, created_at)`, `(tenant_id, type, created_at)`, `(trace_id)`

## RequestLog
- `id`, `tenant_id`
- `request_id (text)`, `trace_id (text)`
- `actor_type (text)`, `actor_id (uuid/text)`
- `connector_id (uuid, nullable)`
- `operation (text)`
- `status (text)`, `http_status (int)`
- `latency_ms (int)`, `retry_count (int)`
- `idempotency_key (text, nullable)`
- `created_at`
- индексы: `(tenant_id, created_at)`, unique `(tenant_id, request_id)`

## OperatorAuditLog
- `id`, `operator_user_id (uuid)`
- `action (text)`, `tenant_id (uuid, nullable)`
- `resource_type (text)`, `resource_id (uuid/text)`
- `diff_json (jsonb)`, `reason (text)`
- `ip (inet/text)`, `user_agent (text)`
- `trace_id (text)`
- `created_at`
- индексы: `(operator_user_id, created_at)`, `(tenant_id, created_at)`
