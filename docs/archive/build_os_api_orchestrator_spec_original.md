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
- какой фреймворк Node выбрать (Fastify vs Nest)
- где хранить payload_ref (S3/MinIO)
- будет ли отдельный event store (позже)
- SLA/SLO и алерты (p95/error budgets)

- какой фреймворк Node выбрать (Fastify vs Nest)
- где хранить payload_ref (S3/MinIO)
- будет ли отдельный event store (позже)
- SLA/SLO и алерты (p95/error budgets)

