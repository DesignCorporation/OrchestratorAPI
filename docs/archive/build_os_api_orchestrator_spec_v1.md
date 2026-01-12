# BuildOS API Orchestrator (Control Plane + Execution Plane)

Цель: централизованно управлять интеграциями, политиками, очередями, наблюдаемостью и безопасностью для BuildOS (multi-tenant B2B SaaS).

Документ предназначен для:
- планирования и контроля разработки (roadmap)
- разбиения на GitHub Issues (backlog)
- использования как «живого» файла для обновлений

---

## 1) Принятые решения (Decision Log)

**D1. Архитектура:** отдельный сервис Orchestrator (Control Plane + Execution Plane), управляемый из Operator Console.
- Причины: изоляция отказов, безопасность control-plane, независимый деплой, централизованная observability.

**D2. Хранилища:** Postgres (source of truth) + Redis (queue/rate-limit).

**D3. Очереди:** Redis + BullMQ (MVP).

**D4. Секреты:** в БД не храним. Только `SecretRef`.

**D5. Observability:** structured JSON logs + OpenTelemetry traces + metrics.

---

## 2) Высокоуровневая архитектура (Modules)

### 2.1 Control Plane API
- Управление: configs, policies, connectors, secret refs
- Аудит: operator actions (изменения конфигов, DLQ replay, impersonation)

### 2.2 Execution Plane API
- `POST /execute` (sync)
- `POST /jobs` + workers (async)
- Применение policy: timeouts/retries/circuit breaker/rate limits/idempotency

### 2.3 Webhook Ingress
- `POST /webhooks/:provider`
- verify signature, dedupe, запись в WebhookInbox, enqueue job

### 2.4 Workers + Queue + DLQ
- Очереди: `webhook`, `critical`, `default`, `low`
- DLQ: отдельная для каждой

### 2.5 Observability Layer
- RequestLog / EventLog
- OTel traces
- Метрики (latency, error rate, queue depth, DLQ)
- Event stream (SSE/WS) для Operator Console

---

## 3) Роадмап

### 3.1 MVP (2 недели) — «один боевой сценарий»
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

### 3.2 v1 (4–6 недель)
- Коннекторы: SMTP, S3/MinIO, Generic HTTP
- Политики: per-tenant quotas, concurrency limits, staged rollout конфигов
- Config versioning + activate/rollback UI
- Улучшение диагностики: request replay (без секретов)

### 3.3 v2 (2–3 месяца)
- mTLS (SPIFFE/SPIRE или service mesh) + строгий service identity
- Переход на NATS/Kafka (если нужен большой event streaming)
- Secret rotation workflows
- Multi-region readiness (EU/US)
- Автоматические mitigation-политики (auto-disable provider при массовых 5xx)

---

## 4) GitHub Issues Checklist (Backlog)

Ниже — готовые «эпики» и задачи, которые можно переносить в GitHub как Issues. У каждой задачи — Definition of Done (DoD) и Acceptance Criteria.

### EPIC-00: Repo & Standards
- [ ] **ISSUE-001: Создать структуру репозитория orchestrator**
  - DoD: есть сервис `orchestrator-api`, сервис `orchestrator-worker`, общие пакеты `@orchestrator/core`.
  - Acceptance: проект собирается локально, есть базовые команды run/test.

- [ ] **ISSUE-002: Определить стандарт логов/корреляции**
  - DoD: единый формат JSON log + request_id + trace_id.
  - Acceptance: любой входящий запрос логируется с request_id; в worker передаётся correlation.

### EPIC-01: Persistence (Postgres) + Migrations
- [ ] **ISSUE-010: Схема БД v0 (минимум)**
  - Tables: Connector, Policy, SecretRef, WebhookInbox, Job, Run, EventLog, RequestLog, OperatorAuditLog.
  - DoD: миграции применяются из CI; есть индексы по tenant_id, created_at, event_id.

- [ ] **ISSUE-011: Иммутабельное версионирование Config (ConfigPointer)**
  - DoD: OrchestratorConfig + ConfigPointer; activate/rollback = смена pointer.

### EPIC-02: Queue + Workers + DLQ
- [ ] **ISSUE-020: Поднять Redis + BullMQ, очереди и DLQ**
  - DoD: есть очереди webhook/critical/default/low, DLQ на каждую.

- [ ] **ISSUE-021: Worker runtime + job lifecycle**
  - DoD: Job → Run с фиксацией attempt, error, timings.

- [ ] **ISSUE-022: Admin API для DLQ (list/replay/purge)**
  - DoD: endpoints + audit log на replay/purge.

### EPIC-03: Webhook Ingress (Stripe)
- [ ] **ISSUE-030: Endpoint `/webhooks/stripe` с verify signature**
  - DoD: проверка подписи, timestamp tolerance.

- [ ] **ISSUE-031: Dedupe (idempotency) по Stripe `event.id`**
  - DoD: повторный webhook не приводит к повторной обработке.

- [ ] **ISSUE-032: WebhookInbox + enqueue job + EventLog**
  - DoD: запись received/processed/failed; payload_ref при больших payload.

### EPIC-04: Execution API (/execute, /jobs)
- [ ] **ISSUE-040: Endpoint `POST /execute` (sync)**
  - DoD: принимает connector + operation + payload, возвращает ответ.

- [ ] **ISSUE-041: Idempotency-Key для /execute**
  - DoD: хранение результатов или processed-marker с TTL.

- [ ] **ISSUE-042: Endpoint `POST /jobs` (async enqueue) + GET /jobs/:id**
  - DoD: job status + run history.

### EPIC-05: Policy Engine v0
- [ ] **ISSUE-050: Timeouts (connect/read/total) per connector**
  - DoD: реальные timeout-ошибки, логируются и метрикуются.

- [ ] **ISSUE-051: Retries + backoff + jitter**
  - DoD: retriable ошибки повторяются по политике.

- [ ] **ISSUE-052: Circuit breaker per tenant+connector**
  - DoD: состояния closed/open/half-open, метрики состояния.

- [ ] **ISSUE-053: Rate limit v0 (token bucket) в Redis**
  - DoD: лимиты per tenant, drops логируются.

### EPIC-06: Security (S2S auth, RBAC, Audit)
- [ ] **ISSUE-060: Service-to-service auth (JWT short TTL)**
  - DoD: aud/iss/scopes; отказ по неверному audience.

- [ ] **ISSUE-061: Operator RBAC (separate from tenant RBAC)**
  - DoD: роли Support/Billing/Admin/ReadOnly; guard на endpoints.

- [ ] **ISSUE-062: OperatorAuditLog (diff_json + reason обязательны)**
  - DoD: любые изменения конфигов/политик/DLQ фиксируются.

- [ ] **ISSUE-063: Impersonation token (TTL + reason + audit)**
  - DoD: старт/стоп impersonation, все действия помечены.

- [ ] **ISSUE-064: SecretRef integration (no secrets in DB)**
  - DoD: настройки коннектора используют secret_ref; секреты подтягиваются из env/docker secrets/vault.

### EPIC-07: Observability
- [ ] **ISSUE-070: OpenTelemetry traces (API + worker)**
  - DoD: trace_id в логах, spans для внешних вызовов.

- [ ] **ISSUE-071: Метрики p95/error rate/queue depth/DLQ/breaker state**
  - DoD: endpoint `/metrics` или экспортер.

- [ ] **ISSUE-072: Event stream endpoint `/events/stream` (SSE)**
  - DoD: фильтрация по tenant/connector/trace_id.

### EPIC-08: Operator Console Integration
- [ ] **ISSUE-080: Страница “Events (terminal-like)”**
  - DoD: поток событий, фильтры, drill-down.

- [ ] **ISSUE-081: Страница “Webhook Inbox”**
  - DoD: список событий stripe + статус + trace.

- [ ] **ISSUE-082: Страница “DLQ” + replay/purge**
  - DoD: replay требует reason, создаёт audit запись.

---

## 5) Definition of Done (общий)

Любая задача считается завершённой, если:
- есть тесты или проверяемый сценарий (manual runbook)
- есть логи/ивенты/метрики для результата
- есть guardrails безопасности (authz/authn)
- есть миграции/обновления схемы (если нужно)
- в EventLog присутствуют ключевые этапы (received → queued → processing → done)

---

## 6) Мини-чеклист production readiness (MVP → prod)

### Security
- [ ] secrets не в БД, только SecretRef
- [ ] audit log операторских действий обязателен
- [ ] S2S auth + network isolation
- [ ] webhook signature verify + dedupe
- [ ] ограничение доступа к Control Plane (internal only)

### Reliability
- [ ] timeouts + retries + backoff + circuit breaker
- [ ] idempotency keys для /execute и webhooks
- [ ] DLQ + replay с аудитом
- [ ] конфиги versioned + rollback

### Observability
- [ ] structured logs JSON
- [ ] trace_id/request_id сквозные
- [ ] метрики: latency/error/queue/DLQ/breaker
- [ ] event stream UI

---

## 6A) API контракт (MVP) — запросы/ответы, ошибки, корреляция

Ниже — минимальный, но достаточно строгий контракт, чтобы:
- сразу строить UI Operator Console
- одинаково логировать/трассировать вызовы
- обеспечить идемпотентность и дедупликацию

### 6A.1 Общие правила (headers/ids)

**Correlation/Tracing**
- `x-request-id` — входящий request id (если нет, генерируем).
- `traceparent` — W3C Trace Context (если нет, создаём новый trace).
- `x-correlation-id` — опционально (если клиент хочет связать несколько вызовов). По умолчанию = `x-request-id`.

**Idempotency**
- `Idempotency-Key` — для `/execute` и `/jobs` (опционально, но рекомендуется для клиентов).

**Tenant context**
- Внутренние сервисы передают tenant в JWT claim `tid`.
- Внешние webhooks определяют tenant по endpoint mapping (MVP: один tenant; v1: routing table по `:provider` + `account_id`/`signing_secret`).

### 6A.2 Единый формат ошибок

**HTTP status + тело**
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded",
    "details": {"limit": 10, "window_s": 1}
  },
  "request_id": "...",
  "trace_id": "..."
}
```

**Коды ошибок (MVP)**
- `VALIDATION_ERROR` (400)
- `AUTH_REQUIRED` (401)
- `FORBIDDEN` (403)
- `TENANT_NOT_FOUND` (404)
- `CONNECTOR_NOT_FOUND` (404)
- `POLICY_VIOLATION` (422)
- `RATE_LIMITED` (429)
- `CIRCUIT_OPEN` (503)
- `UPSTREAM_TIMEOUT` (504)
- `UPSTREAM_ERROR` (502)
- `IDEMPOTENCY_CONFLICT` (409)
- `DUPLICATE_EVENT` (200/202 с флагом)
- `INTERNAL_ERROR` (500)

### 6A.3 `POST /execute` (sync)

**Назначение:** синхронный вызов коннектора/операции с применением политики.

**Request**
```json
{
  "connector": {"id": "uuid"},
  "operation": "charge.create",
  "input": {"amount": 1000, "currency": "PLN"},
  "options": {
    "timeout_ms": 15000,
    "dry_run": false,
    "metadata": {"project_id": "..."}
  }
}
```

**Response 200**
```json
{
  "status": "ok",
  "output": {"upstream_id": "..."},
  "upstream": {"http_status": 200},
  "latency_ms": 123,
  "attempts": 1,
  "idempotency": {"key": "...", "replayed": false},
  "request_id": "...",
  "trace_id": "..."
}
```

**Response 503 (circuit open)**
```json
{
  "error": {"code": "CIRCUIT_OPEN", "message": "Connector temporarily disabled by circuit breaker"},
  "request_id": "...",
  "trace_id": "..."
}
```

### 6A.4 `POST /jobs` (async enqueue)

**Request**
```json
{
  "type": "stripe.webhook.process",
  "payload": {"inbox_id": "uuid"},
  "run_at": null,
  "idempotency_key": "optional"
}
```

**Response 202**
```json
{
  "job_id": "uuid",
  "status": "queued",
  "queued_at": "2026-01-03T00:00:00Z",
  "request_id": "...",
  "trace_id": "..."
}
```

### 6A.5 `GET /jobs/:id`

**Response 200**
```json
{
  "job": {
    "id": "uuid",
    "tenant_id": "uuid",
    "type": "stripe.webhook.process",
    "status": "success",
    "attempts": 1,
    "max_attempts": 4,
    "created_at": "...",
    "updated_at": "..."
  },
  "runs": [
    {"id": "uuid", "status": "success", "started_at": "...", "finished_at": "...", "error": null}
  ]
}
```

### 6A.6 `GET /events/stream` (SSE)

- Content-Type: `text/event-stream`
- Фильтры query: `tenant_id`, `connector_id`, `severity`, `type`, `trace_id`, `since`

**SSE message (data)**
```json
{
  "event_id": "uuid",
  "ts": "2026-01-03T00:00:00Z",
  "tenant_id": "uuid",
  "severity": "info",
  "type": "job_enqueued",
  "message": "Job queued",
  "correlation_id": "...",
  "trace_id": "...",
  "data": {"job_id": "uuid"}
}
```

### 6A.7 `POST /webhooks/:provider`

**Поведение:** всегда отвечать быстро (Stripe ждёт 2xx), тяжёлую работу — в очередь.

- Verify signature (например `Stripe-Signature`)
- Dedupe по `event_id`

**Response 200**
```json
{
  "received": true,
  "inbox_id": "uuid",
  "duplicate": false
}
```

**Повторный webhook (dedupe)**
- HTTP 200
- `duplicate: true`
- повторно job не enqueue

---

## 6B) Data model (MVP) — минимальные поля/связи

Ниже — краткие схемы ключевых таблиц, чтобы консистентно делать миграции и UI.

### Connector
- `id (uuid)`, `tenant_id (uuid)`
- `type (text)`, `name (text)`, `status (text)`
- `settings_json (jsonb)` (без секретов)
- `secret_ref_id (uuid, nullable)` → SecretRef
- `policy_id (uuid, nullable)` → Policy
- индексы: `(tenant_id, type)`, unique `(tenant_id, name)`

### Policy
- `id`, `tenant_id`, `name`, `version (int)`
- `rate_limit_json`, `retry_json`, `timeout_json`, `circuit_breaker_json`, `concurrency_json`
- индексы: `(tenant_id, name)`

### SecretRef
- `id`, `tenant_id`
- `provider (text)`, `ref (text)`, `version (text/int)`
- индексы: `(tenant_id, provider)`

### WebhookInbox
- `id`, `tenant_id`, `provider (text)`
- `event_id (text)` (dedupe key)
- `signature_valid (bool)`
- `received_at`, `processed_at (nullable)`
- `status (text)` (received|processed|ignored|failed)
- `payload_ref (text, nullable)` / `payload_json (jsonb, nullable)`
- **unique** `(tenant_id, provider, event_id)`
- индексы: `(tenant_id, received_at)`

### Job
- `id`, `tenant_id`, `type (text)`
- `status (text)` (queued|running|success|failed|dead)
- `attempts (int)`, `max_attempts (int)`
- `run_at (timestamptz, nullable)`
- `payload_ref (text, nullable)` / `payload_json (jsonb, nullable)`
- `idempotency_key (text, nullable)`
- индексы: `(tenant_id, status)`, `(tenant_id, created_at)`

### Run
- `id`, `job_id (uuid)` → Job
- `status (text)`
- `started_at`, `finished_at`
- `error_json (jsonb, nullable)`
- индекс: `(job_id, started_at)`

### EventLog
- `id`, `tenant_id`
- `severity (text)`, `type (text)`
- `message (text)`, `data_json (jsonb)`
- `correlation_id (text)`, `trace_id (text)`
- `created_at`
- индексы: `(tenant_id, created_at)`, `(tenant_id, type, created_at)`, `(trace_id)`

### RequestLog
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

### OperatorAuditLog
- `id`, `operator_user_id (uuid)`
- `action (text)`, `tenant_id (uuid, nullable)`
- `resource_type (text)`, `resource_id (uuid/text)`
- `diff_json (jsonb)`, `reason (text)`
- `ip (inet/text)`, `user_agent (text)`
- `trace_id (text)`
- `created_at`
- индексы: `(operator_user_id, created_at)`, `(tenant_id, created_at)`

---

## 6C) Idempotency / Dedupe — ключи, TTL, поведение

### /execute
- ключ: `(tenant_id, idempotency_key)`
- хранить: `request_hash` + `response_blob` (или response ref) + `created_at`
- TTL (MVP): 24–72 часа (настроечный параметр)

Поведение:
- **повтор** с тем же body hash: вернуть cached response (200) + `idempotency.replayed=true`
- **повтор** с другим body hash: 409 `IDEMPOTENCY_CONFLICT`

### /jobs
- ключ: `(tenant_id, idempotency_key)`
- TTL: 24–72 часа
- повтор: вернуть существующий `job_id` (202) без дублирования

### /webhooks/:provider
- dedupe key: `(tenant_id, provider, event_id)`
- TTL хранения inbox записи: 14–30 дней (см. retention)
- повтор: 200 + `duplicate: true` и **не enqueue** повторно

---

## 6D) Политики по умолчанию (MVP) — чтобы не уйти в «открытый дизайн»

**Timeouts (default)**
- connect: 3s
- read: 10s
- total: 15s

**Retries (default)**
- max attempts: 4 (1 + 3 retries)
- backoff: exponential (base 250ms, factor 2.0)
- jitter: full jitter
- max backoff: 5s
- retriable: 408/429/5xx + network errors
- non-retriable: 4xx (кроме 408/429)

**Circuit Breaker (default)**
- rolling window: 30s
- минимум запросов для оценки: 20
- threshold: 50% failures
- open duration: 30s
- half-open probes: 5

**Rate limit (default, per tenant + connector)**
- 10 rps, burst 20

**Concurrency (default, per tenant + connector)**
- 50 in-flight

---

## 6E) Security модель (MVP)

### 6E.1 S2S JWT claims (пример)
- `iss`: `buildos-internal`
- `aud`: `orchestrator-exec` или `orchestrator-control`
- `sub`: `svc:buildos-backend` / `svc:operator-console`
- `exp`/`iat` (TTL 1–5 минут)
- `jti` (защита от replay при необходимости)
- `scopes`: массив строк, напр. `orchestrator.execute`, `orchestrator.jobs.write`, `orchestrator.control.read`
- `tid`: tenant_id (если вызов tenant-scoped)

### 6E.2 RBAC матрица (операторские роли)

Роли (MVP):
- `OperatorAdmin`
- `Support`
- `BillingAdmin`
- `ReadOnlyAuditor`
- `BreakGlassAdmin` (только аварийно)

Разрешения (пример):
- Просмотр Events/Logs: Admin/Support/Billing/ReadOnly/BreakGlass ✅
- Управление Connectors/Policies/Configs: Admin ✅, Support ❌, Billing ❌, ReadOnly ❌, BreakGlass ✅ (с reason)
- DLQ replay/purge: Admin ✅, Support ✅ (replay only, с reason), Billing ❌, ReadOnly ❌, BreakGlass ✅
- Impersonation: Admin ✅, Support ✅ (ограниченно), Billing ❌, ReadOnly ❌, BreakGlass ✅
- Управление SecretRef: Admin ✅, Billing ✅ (billing secrets), Support ❌, ReadOnly ❌, BreakGlass ✅

---

## 6F) SecretRef — источники истины и формат

**Принцип:** в БД только ссылки.

### Форматы ref (URI-like)
- `env://STRIPE_SIGNING_SECRET`
- `docker://stripe_signing_secret`
- `vault://kv/buildos/tenants/<tid>/stripe#signing_secret?version=3`

### Resolution (MVP)
- по `provider` выбираем резолвер (env/docker/vault)
- кешируем в памяти на короткий TTL (например 60s) + принудительное обновление при rotation

---

## 6G) Retention / Storage политика (MVP)

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

---

## 6H) Multi-tenant enforcement (MVP)

### Где enforced tenant_id
- Middleware на входе: tenant берётся из JWT (`tid`) и прокидывается в context.
- Любая операция записи/чтения обязана фильтровать по `tenant_id`.

### DB уровень (опционально, v1)
- Postgres RLS для таблиц с tenant_id, если нужно максимальное усиление.

### Индексы (обязательные)
- почти везде: `(tenant_id, created_at)`
- WebhookInbox: unique `(tenant_id, provider, event_id)`
- RequestLog: unique `(tenant_id, request_id)`

---

## 6I) MVP тестовый сценарий (runbook) — ожидаемые события/логи/трейсы

Цель: проверить end-to-end поток без UI, затем подключить Operator Console.

1) Поднять `docker-compose.dev.yml`.
2) Применить миграции + `seed-dev.sh` (создать tenant + stripe connector + policy).
3) Отправить fixture webhook на `POST /webhooks/stripe`.

Ожидаемые EventLog (по порядку):
- `webhook_received` (severity=info)
- `job_enqueued` (type=stripe.webhook.process)
- `job_started`
- `connector_call` (upstream)
- `billing_state_updated` (или `handler_completed`)
- `job_succeeded`

Ожидаемые trace spans (пример naming):
- `http.webhooks.stripe` (server span)
- `queue.process` (consumer span)
- `connector.stripe.*` (client span)
- `http.buildos.billing.update` (client span)

4) Симулировать upstream failure (подменить secret/endpoint) → убедиться:
- retries происходят
- при исчерпании → DLQ
- event `job_failed`/`job_deadlettered`

---

## 6J) Deployment env vars (минимум для коробки)

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

---

## 6K) Observability — метрики (naming + labels)

Рекомендуемый нейминг (Prometheus):
- `orchestrator_http_requests_total{route,method,status}`
- `orchestrator_http_request_duration_ms_bucket{route,method}` (histogram)
- `orchestrator_http_errors_total{route,code}`
- `orchestrator_queue_depth{queue}`
- `orchestrator_job_latency_ms_bucket{type}`
- `orchestrator_dlq_depth{queue}`
- `orchestrator_retry_total{connector,type}`
- `orchestrator_circuit_open_total{connector}`
- `orchestrator_rate_limit_dropped_total{tenant,connector}`

---

## 7) Пример бизнес-кейса (Stripe webhook)

1) Stripe → `POST /webhooks/stripe`
2) verify signature → WebhookInbox(received) → EventLog(webhook_received)
3) enqueue Job(stripe_webhook_process)
4) Worker применяет policy → вызывает BuildOS Billing API → обновляет Subscription
5) RequestLog + EventLog(billing_state_updated)
6) Ошибка после retries → DLQ, Operator может replay (reason + audit)

---

## 8) План “в коробку” (Reusable Orchestrator Kit)

Цель: не переписывать оркестратор под каждый проект, а использовать как конструктор.

### 8.1 Как правильно сделать «коробку»
1) **Core Engine** (не зависит от BuildOS):
   - execution runtime, policy engine, queue, webhook inbox, logging/tracing
2) **Adapters** (интеграции):
   - коннекторы (stripe, smtp, s3, http)
3) **Project Bindings** (тонкий слой):
   - специфичные обработчики событий (например “update subscription”)

### 8.2 «Лего»-подход: расширяемость как в CMS
Ключевая идея: **коннектор описывается декларативно**, а UI и валидация строятся из схем.

- `ConnectorDefinition` (в коде или в registry):
  - `type`
  - `config_schema` (JSON Schema)
  - `secret_schema` (какие секреты нужны)
  - `operations` (список операций + payload_schema)
  - `webhook_schema` (если есть)

- Operator Console может генерировать формы по JSON Schema:
  - добавлять поля как в CMS (без ручной верстки)
  - валидировать конфиг до сохранения

- Runtime исполняет операции через “handler”:
  - либо встроенный (кодовый) handler
  - либо generic HTTP handler (для простых случаев)

### 8.3 Рекомендация для BuildOS
Сделать **Orchestrator Kit** в виде:
- отдельного репозитория или mono-repo package `@orchestrator/core`
- сервис `orchestrator-service` использует core
- BuildOS добавляет только bindings (обработчики бизнес-событий)

Важно: это НЕ означает «делаем отдельный продукт». Это означает **архитектурно готовим переиспользование**.

---

## 9) Операционная устойчивость: как не потерять доступ в админку при падении сервисов

Проблема, которую ты описал ("сервис упал → в админку не попасть") — классическая ошибка, когда **панель управления живёт в том же blast radius**, что и управляемые сервисы.

### 9.1 Принцип: separate control plane access
Сделай так, чтобы **Operator Console и Orchestrator Control Plane** имели отдельный путь доступа и минимальные зависимости:

- **Operator Console (UI)** — отдельный деплой/сервис (может быть даже статический фронт на CDN + backend API).
- **Orchestrator Control Plane API** — отдельный сервис/под, доступный через отдельный домен/ingress (или через VPN/zero-trust).
- **Execution Plane** и продуктовый backend могут падать — но control plane остаётся доступен.

### 9.2 Минимальный набор зависимостей для Operator Console
Чтобы админка работала даже при проблемах в основной системе:
- хранение сессий/авторизации — независимо (лучше внешний IdP или отдельный auth-сервис)
- данные для UI — **только из Orchestrator DB** (не из продуктового backend)
- event stream — напрямую из Orchestrator (`/events/stream`)

### 9.3 "Break-glass" доступ
Обязательно предусмотреть аварийный доступ:
- отдельная роль `BreakGlassAdmin` (мультифакторная)
- отдельный URL/ingress (доступ только из allowlist/VPN)
- строгий audit: каждое использование break-glass фиксируется

### 9.4 Автовосстановление и перезапуски

**Если вы уже использовали Kubernetes в Beauty:**
- используйте liveness/readiness probes
- restartPolicy/Deployments
- separate namespaces или отдельные deployments для operator plane

**Если на старте Docker Compose:**
- запускать контейнеры через systemd unit (или docker compose + restart=always)
- healthchecks на контейнерах
- отдельный прокси/ingress контейнер, который живёт независимо

Ключ: **Operator Console и Control Plane должны подниматься первыми и быть максимально простыми**.

---

## 10) "Коробочная" стратегия: Orchestrator Kit как переиспользуемый проект

Ты прав: не нужно заново делать одно и то же. Правильная организация:

### 10.1 Repo strategy
Варианты:
1) **Mono-repo** (рекомендуется, если вы хотите единый CI/CD):
   - `/packages/orchestrator-core`
   - `/packages/orchestrator-connectors`
   - `/services/orchestrator-api`
   - `/services/orchestrator-worker`
   - `/services/operator-console` (UI)
2) **Отдельный репозиторий Orchestrator Kit** (если хотите переиспользовать вне BuildOS):
   - публикуемый пакет `@org/orchestrator-core`
   - сервис-шаблон `orchestrator-service`
   - набор connectors

Оба подхода поддерживают твою цель: «начать с этого проекта и потом подключать как лего».

### 10.2 Контракт расширяемости (как CMS)
- `ConnectorDefinition` + JSON Schema
- автогенерация форм в Operator Console
- runtime валидация по тем же схемам
- generic HTTP connector для простых API

---

## 11) Что такое Kubernetes (Кубернетис) и нужен ли он сразу?

**Kubernetes (K8s)** — платформа оркестрации контейнеров. Она управляет:
- запуском нескольких экземпляров сервисов (scaling)
- автоматическими рестартами при сбоях
- rolling updates (обновления без даунтайма)
- service discovery, networking, ingress
- конфигами и секретами (через ConfigMaps/Secrets)

### Когда Kubernetes оправдан
- много сервисов и окружений
- нужна высокая доступность и автоскейл
- нужны безопасные rolling updates и изоляция

### Что делать «правильно» сейчас
- стартовать с Docker Compose, но сделать сервисы K8s-ready
- минимизировать зависимости Operator Console (out-of-band доступ)
- health checks + graceful shutdown
- миграции БД отдельным шагом

### План перехода к Kubernetes
1) разделить deploy на `api` и `worker`
2) добавить readiness/liveness
3) вынести secrets в Vault/managed secrets
4) добавить autoscaling по queue depth

---

## 12) Appendix: рекомендуемые папки в репозитории

- `/services/orchestrator-api`
- `/services/orchestrator-worker`
- `/packages/orchestrator-core` (policy engine, types, schemas)
- `/packages/orchestrator-connectors` (stripe/smtp/s3/http)
- `/infra/docker-compose`
- `/docs` (этот файл, runbooks)

---

## 11) Repo bootstrap plan (первый спринт) — чтобы реально «начать с этого проекта»

Цель спринта: поднять Orchestrator Kit как отдельный проект, с базовой архитектурой, CI и минимальным сквозным сценарием (health + events + queue).

### 11.1 Структура репозитория (mono-repo recommended)

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

### 11.2 Пакеты и границы ответственности
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

---

## 12) CI/CD checklist (GitHub Actions) — baseline

Минимальный pipeline (на PR и на main):

### 12.1 PR checks
- [ ] Install (pnpm/npm) + lockfile enforcement
- [ ] Typecheck (tsc)
- [ ] Lint (eslint)
- [ ] Unit tests
- [ ] Build всех сервисов/пакетов
- [ ] Docker build (api/worker) — smoke

### 12.2 Integration smoke (опционально, но желательно)
- [ ] поднять docker-compose.dev.yml
- [ ] применить миграции
- [ ] healthcheck: `/health`
- [ ] enqueue тестовый job → worker обработал → event появился в `/events`

### 12.3 Release (main)
- [ ] semantic versioning для packages (если отдельный kit)
- [ ] build+push docker images
- [ ] generate SBOM (желательно)

---

## 13) Deployment baseline (Compose → Prod)

### 13.1 docker-compose.dev.yml (MVP)
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

### 13.2 docker-compose.prod.yml (production-ready минимум)
- разделить сети: `public` (только proxy), `internal` (api/worker/db/redis)
- прокси (nginx/traefik) публикует:
  - `operator.<domain>` → operator-console
  - `orchestrator-control.<domain>` → control plane endpoints
  - `orchestrator-exec.<domain>` → execution endpoints (внутренний доступ, желательно)

Рекомендация: execution endpoints держать внутренними (только из backend сети/VPN).

---

## 14) Control plane доступность (anti-blast-radius) — конкретные правила

### 14.1 Топология доступа
- Operator Console и Control Plane должны быть доступны даже если:
  - основной backend BuildOS упал
  - execution plane перегружен
  - один из провайдеров (Stripe) падает

### 14.2 Минимальные зависимости control plane
- auth (операторский) не зависит от BuildOS backend
- данные UI берутся из Orchestrator DB
- event stream отдаёт Orchestrator напрямую

### 14.3 SLO для operator plane (ориентир)
- Operator Console availability: 99.9%
- Control Plane API availability: 99.9%
- MTTR цели: breaker open + stop-the-bleed (disable connector) ≤ 5 минут

---

## 15) Runbooks (MVP)

- RB-01: локальный запуск docker-compose
- RB-02: отправить тестовый stripe webhook (fixture)
- RB-03: симулировать падение провайдера и увидеть breaker open
- RB-04: найти задачу в DLQ и сделать replay (с reason)
- RB-05: rollback активного конфига через ConfigPointer
- RB-06: break-glass доступ (как включить, как закрыть, где смотреть audit)

---

## 16) Bootstrap tasks (первый спринт) — готовый список Issues

### EPIC-BS: Bootstrap
- [ ] **BS-01: Создать mono-repo структуру + workspace**
  - DoD: packages/services видны; build проходит.

- [ ] **BS-02: docker-compose.dev.yml + healthchecks**
  - DoD: `docker compose up` поднимает postgres/redis/api/worker.

- [ ] **BS-03: База БД + миграции + seed-dev**
  - DoD: миграции применяются; есть dev seed (tenant + test connector).

- [ ] **BS-04: Minimal EventLog + `/events` + `/events/stream`**
  - DoD: при запуске сервис пишет startup event; SSE работает.

- [ ] **BS-05: Queue + worker smoke job**
  - DoD: enqueue job → worker выполнит → event log updated.

- [ ] **BS-06: Operator Console v0 (read-only)**
  - DoD: страницы events + dlq (пока пусто) + basic auth.

- [ ] **BS-07: CI PR checks**
  - DoD: typecheck/lint/test/build + docker build.

---

## 17) TODO: вопросы для фиксации в следующей итерации

- какой фреймворк Node выбрать (Fastify vs Nest vs Hono)
- где хранить payload_ref (S3/MinIO) и какие лимиты для inline `payload_json`
- будет ли отдельный event store / event bus (v2: NATS/Kafka)
- SLA/SLO и алерты (p95/error budgets) + on-call runbooks
- Postgres RLS (нужно ли включать в v1) и стратегия partitioning для логов

