# API контракт (MVP)

Минимальный контракт, чтобы:
- строить UI Operator Console
- единообразно логировать/трассировать вызовы
- обеспечить идемпотентность и дедупликацию

## Общие правила (headers/ids)

**Correlation/Tracing**
- `x-request-id` — входящий request id (если нет, генерируем).
- `traceparent` — W3C Trace Context (если нет, создаём новый trace).
- `x-correlation-id` — опционально (если клиент хочет связать несколько вызовов). По умолчанию = `x-request-id`.

**Idempotency**
- `Idempotency-Key` — для `/execute` и `/jobs` (опционально, но рекомендуется для клиентов).

**Workspace context**
- Внутренние сервисы передают workspace через JWT claim `tid` (tenant_id).
- Внешние webhooks определяют workspace по endpoint mapping (MVP: один workspace; v1: routing table по `:provider` + `account_id`/`signing_secret`).

## Единый формат ошибок

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

## `POST /execute` (sync)

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

## `POST /workspaces` (control)

**Назначение:** создание workspace (invite-only).

**Request**
```json
{
  "name": "buildos-dev",
  "env": "dev",
  "reason": "init"
}
```

**Response**
```json
{
  "id": "uuid",
  "default_policy_id": "uuid"
}
```

## `POST /workspaces/:id/invite` (control)

**Назначение:** создать invite link с TTL.

**Request**
```json
{
  "ttl_hours": 24,
  "reason": "invite"
}
```

**Response**
```json
{
  "invite_id": "uuid",
  "token": "string",
  "expires_at": "iso8601",
  "invite_url": "https://operator.orch.designcorp.eu/invite/<token>"
}
```

## `GET /bundle/export` (control)

**Назначение:** экспортировать текущие сущности workspace в JSON bundle.

**Response**
```json
{
  "policies": [],
  "connectors": [],
  "secret_refs": [],
  "configs": [],
  "config_pointers": []
}
```

## `POST /bundle/import` (control)

**Назначение:** импортировать JSON bundle в workspace.

**Request**
```json
{
  "reason": "initial onboarding",
  "policies": [
    {"id": "uuid", "name": "default", "retry_json": {"max_attempts": 3}}
  ],
  "secret_refs": [
    {"id": "uuid", "provider": "env", "ref": "env://STRIPE_KEY"}
  ],
  "connectors": [
    {"id": "uuid", "type": "http", "name": "stripe", "policy_id": "uuid"}
  ],
  "configs": [
    {"id": "uuid", "name": "feature_flags", "version": 1, "config_json": {"demo": true}}
  ],
  "config_pointers": [
    {"name": "feature_flags", "config_id": "uuid"}
  ]
}
```

**Response**
```json
{
  "status": "ok",
  "imported": {"policies": 1, "connectors": 1, "secret_refs": 1, "configs": 1, "config_pointers": 1},
  "skipped": {"policies": 0, "connectors": 0, "secret_refs": 0, "configs": 0, "config_pointers": 0},
  "errors": []
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

## `POST /jobs` (async enqueue)

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

## `GET /jobs/:id`

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

## `GET /events/stream` (SSE)
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

## `POST /webhooks/:provider`

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

**Routing**
- account_id берётся из payload/headers провайдера.
- если account_id отсутствует, используется значение `default` и должен существовать route `provider + default`.

## `POST /webhook-routes` (control)

**Назначение:** создать webhook route (provider + account_id → workspace).

**Request**
```json
{
  "provider": "stripe",
  "account_id": "acct_123",
  "tenant_id": "uuid",
  "connector_id": "uuid",
  "reason": "onboarding"
}
```

**Response**
```json
{
  "id": "uuid"
}
```

## `GET /webhook-routes` (control)

**Query params:** `provider`, `account_id`, `tenant_id`.

**Response**
```json
{
  "routes": [
    {
      "id": "uuid",
      "provider": "stripe",
      "account_id": "acct_123",
      "tenant_id": "uuid",
      "connector_id": "uuid"
    }
  ]
}
```

## `PATCH /webhook-routes/:id` (control)

**Request**
```json
{
  "tenant_id": "uuid",
  "connector_id": "uuid",
  "reason": "change target"
}
```

**Response**
```json
{
  "status": "ok"
}
```

## `DELETE /webhook-routes/:id` (control)

**Request**
```json
{
  "reason": "cleanup"
}
```

**Response**
```json
{
  "status": "deleted"
}
```
