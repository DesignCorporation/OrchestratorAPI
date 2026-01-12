# GitHub Issues Checklist (Backlog)

Ниже — готовые «эпики» и задачи, которые можно переносить в GitHub как Issues. У каждой задачи — Definition of Done (DoD) и Acceptance Criteria.

## EPIC-00: Repo & Standards
- [ ] **ISSUE-001: Создать структуру репозитория orchestrator**
  - DoD: есть сервис `orchestrator-api`, сервис `orchestrator-worker`, общие пакеты `@orchestrator/core`.
  - Acceptance: проект собирается локально, есть базовые команды run/test.

- [ ] **ISSUE-002: Определить стандарт логов/корреляции**
  - DoD: единый формат JSON log + request_id + trace_id.
  - Acceptance: любой входящий запрос логируется с request_id; в worker передаётся correlation.

## EPIC-01: Persistence (Postgres) + Migrations
- [ ] **ISSUE-010: Схема БД v0 (минимум)**
  - Tables: Connector, Policy, SecretRef, WebhookInbox, Job, Run, EventLog, RequestLog, OperatorAuditLog.
  - DoD: миграции применяются из CI; есть индексы по tenant_id, created_at, event_id.

- [ ] **ISSUE-011: Иммутабельное версионирование Config (ConfigPointer)**
  - DoD: OrchestratorConfig + ConfigPointer; activate/rollback = смена pointer.

## EPIC-02: Queue + Workers + DLQ
- [ ] **ISSUE-020: Поднять Redis + BullMQ, очереди и DLQ**
  - DoD: есть очереди webhook/critical/default/low, DLQ на каждую.

- [ ] **ISSUE-021: Worker runtime + job lifecycle**
  - DoD: Job → Run с фиксацией attempt, error, timings.

- [ ] **ISSUE-022: Admin API для DLQ (list/replay/purge)**
  - DoD: endpoints + audit log на replay/purge.

## EPIC-03: Webhook Ingress (Stripe)
- [ ] **ISSUE-030: Endpoint `/webhooks/stripe` с verify signature**
  - DoD: проверка подписи, timestamp tolerance.

- [ ] **ISSUE-031: Dedupe (idempotency) по Stripe `event.id`**
  - DoD: повторный webhook не приводит к повторной обработке.

- [ ] **ISSUE-032: WebhookInbox + enqueue job + EventLog**
  - DoD: запись received/processed/failed; payload_ref при больших payload.

## EPIC-04: Execution API (/execute, /jobs)
- [ ] **ISSUE-040: Endpoint `POST /execute` (sync)**
  - DoD: принимает connector + operation + payload, возвращает ответ.

- [ ] **ISSUE-041: Idempotency-Key для /execute**
  - DoD: хранение результатов или processed-marker с TTL.

- [ ] **ISSUE-042: Endpoint `POST /jobs` (async enqueue) + GET /jobs/:id**
  - DoD: job status + run history.

## EPIC-05: Policy Engine v0
- [ ] **ISSUE-050: Timeouts (connect/read/total) per connector**
  - DoD: реальные timeout-ошибки, логируются и метрикуются.

- [ ] **ISSUE-051: Retries + backoff + jitter**
  - DoD: retriable ошибки повторяются по политике.

- [ ] **ISSUE-052: Circuit breaker per tenant+connector**
  - DoD: состояния closed/open/half-open, метрики состояния.

- [ ] **ISSUE-053: Rate limit v0 (token bucket) в Redis**
  - DoD: лимиты per tenant, drops логируются.

## EPIC-06: Security (S2S auth, RBAC, Audit)
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

## EPIC-07: Observability
- [ ] **ISSUE-070: OpenTelemetry traces (API + worker)**
  - DoD: trace_id в логах, spans для внешних вызовов.

- [ ] **ISSUE-071: Метрики p95/error rate/queue depth/DLQ/breaker state**
  - DoD: endpoint `/metrics` или экспортер.

- [ ] **ISSUE-072: Event stream endpoint `/events/stream` (SSE)**
  - DoD: фильтрация по tenant/connector/trace_id.

## EPIC-08: Operator Console Integration
- [ ] **ISSUE-080: Страница “Events (terminal-like)”**
  - DoD: поток событий, фильтры, drill-down.

- [ ] **ISSUE-081: Страница “Webhook Inbox”**
  - DoD: список событий stripe + статус + trace.

- [ ] **ISSUE-082: Страница “DLQ” + replay/purge**
  - DoD: replay требует reason, создаёт audit запись.
