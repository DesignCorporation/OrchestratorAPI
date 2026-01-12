# Архитектура Orchestrator

## Модули (high-level)

### Control Plane API
- Управление: configs, policies, connectors, secret refs
- Аудит: operator actions (изменения конфигов, DLQ replay, impersonation)

### Execution Plane API
- `POST /execute` (sync)
- `POST /jobs` + workers (async)
- Применение policy: timeouts/retries/circuit breaker/rate limits/idempotency

### Webhook Ingress
- `POST /webhooks/:provider`
- verify signature, dedupe, запись в WebhookInbox, enqueue job

### Workers + Queue + DLQ
- Очереди: `webhook`, `critical`, `default`, `low`
- DLQ: отдельная для каждой

### Observability Layer
- RequestLog / EventLog
- OTel traces
- Метрики (latency, error rate, queue depth, DLQ)
- Event stream (SSE/WS) для Operator Console

## Anti-blast-radius: доступность control plane

### Принцип: separate control plane access
- Operator Console (UI) — отдельный деплой/сервис (может быть статический фронт на CDN + backend API).
- Orchestrator Control Plane API — отдельный сервис/под, доступный через отдельный домен/ingress (или через VPN/zero-trust).
- Execution Plane и продуктовый backend могут падать — но control plane остаётся доступен.

### Минимальные зависимости Operator Console
- хранение сессий/авторизации — независимо (лучше внешний IdP или отдельный auth-сервис)
- данные для UI — только из Orchestrator DB
- event stream — напрямую из Orchestrator (`/events/stream`)

### Break-glass доступ
- отдельная роль `BreakGlassAdmin` (мультифакторная)
- отдельный URL/ingress (доступ только из allowlist/VPN)
- строгий audit: каждое использование break-glass фиксируется

### Автовосстановление и перезапуски
- Kubernetes: liveness/readiness probes, restartPolicy/Deployments, separate namespaces или отдельные deployments для operator plane
- Docker Compose: systemd unit или `restart=always`, healthchecks, отдельный proxy/ingress контейнер

## Пример бизнес-кейса (Stripe webhook)
1) Stripe → `POST /webhooks/stripe`
2) verify signature → WebhookInbox(received) → EventLog(webhook_received)
3) enqueue Job(stripe_webhook_process)
4) Worker применяет policy → вызывает BuildOS Billing API → обновляет Subscription
5) RequestLog + EventLog(billing_state_updated)
6) Ошибка после retries → DLQ, Operator может replay (reason + audit)
