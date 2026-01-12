# Orchestrator API — Tenant Onboarding Guide (BuildOS/Beauty) + Implementation Checklist

Документ объясняет **как подключать новые продукты** (BuildOS, Beauty и др.) к Orchestrator API через модель **Tenant/Workspace**, и даёт **чеклист реализации**, чтобы масштабироваться без путаницы.

---

## 1) Ключевая модель: SaaS Install vs Onboard

### 1.1 Install Orchestrator (один раз на окружение)
Это развёртывание инфраструктуры Orchestrator SaaS:
- Orchestrator API (control+exec)
- Worker + queue
- Postgres/Redis
- Storage для payload_ref (S3/MinIO)
- Nginx/TLS, домены
- CI/CD, systemd/Compose (или K8s позже)

**Результат:** есть живой Orchestrator SaaS в `dev` и `prod`, готовый обслуживать несколько продуктов.

### 1.2 Onboard Product (для каждого продукта)
Это подключение продукта как **Workspace** в Orchestrator SaaS:
- создаём tenant (например `buildos-prod`)
- настраиваем connectors/policies/configs
- выдаём S2S доступ (JWT claims/scopes)
- настраиваем webhooks routing
- настраиваем RBAC операторов

**Результат:** продукт начинает использовать `/execute`, `/jobs`, webhooks и получает единые политики надёжности/наблюдаемости.

---

## 2) Рекомендуемый operating mode

### 2.1 Shared Orchestrator (общий на компанию)
Один Orchestrator SaaS обслуживает несколько продуктов (BuildOS, Beauty) и изолирует их через tenant_id.

**Почему:** меньше ops, меньше стоимости, единый процесс эксплуатации, единый Operator Console.

### 2.2 Строгое разделение окружений
- `orch.prod` обслуживает только `*-prod` tenants
- `orch.dev` обслуживает только `*-dev` tenants

**Запрещено:** использовать prod секреты в dev или наоборот.

---

## 3) Архитектура взаимодействия (простая схема)

1) Product Backend (BuildOS/Beauty) вызывает Orchestrator **по публичному exec API** (S2S auth обязателен):
   - `POST /execute`
   - `POST /jobs`
2) Внешние webhooks (Stripe) идут в Orchestrator webhook ingress:
   - `POST /webhooks/stripe`
3) Orchestrator:
   - verify signature + dedupe
   - пишет WebhookInbox + EventLog
   - enqueue job
4) Worker:
   - применяет policy (timeouts/retries/breaker/ratelimit)
   - вызывает Product Backend callback endpoint (например billing update)
   - пишет RequestLog/EventLog

### 3.1 Outbound от Orchestrator к продукту
Основной путь: **callback endpoint** (product принимает входящие).
Fallback: **polling** через `/jobs/:id` и `/events`.

**Принцип:** продукт не реализует retries/breakers/ratelimits — это ответственность Orchestrator.

---

## 4) Что именно создаём внутри Workspace

Для каждого workspace (например `buildos-prod`) в Orchestrator должны существовать:

1) **Policies**
- timeouts/retries/breaker/rate limits

2) **Connectors**
- Stripe, SMTP, S3/MinIO, generic HTTP и т.п.
- настройки без секретов

3) **SecretRefs**
- ссылки на секреты (env/docker/vault)

4) **Configs (versioned)**
- иммутабельные версии конфигов
- `ConfigPointer` → активная версия
- rollback = смена pointer

5) **RBAC операторов**
- кто может изменять (Admin)
- кто может делать DLQ replay (Support)
- кто только читать (ReadOnly)
- BreakGlass (аварийно)

6) **Webhook routing**
- маппинг `provider_account_id`/signing_secret → tenant

---

## 5) Чеклист: Onboard нового продукта (BuildOS/Beauty)

### 5.1 Подготовка (в продукте)
- [ ] Определить какие интеграции нужны (Stripe, email, storage, etc.)
- [ ] Определить internal endpoints продукта, которые будет дергать Orchestrator (например `POST /internal/billing/stripe-event`)
- [ ] Определить SLO (ожидаемая нагрузка, RPS) и критичность операций

### 5.2 Создание workspace
- [ ] Создать workspace: `buildos-prod` (и `buildos-dev`)
- [ ] Добавить операторов и роли для workspace

### 5.3 S2S auth и доступы
- [ ] Создать сервисный identity для продукта (например `svc:buildos-backend`)
- [ ] Настроить JWT `aud=orchestrator-exec`, `tid=<tenant_id>`, scopes:
  - `orchestrator.execute`
  - `orchestrator.jobs.write`
  - `orchestrator.jobs.read`
- [ ] Для operator-console: `aud=orchestrator-control` и admin scopes
- [ ] Хранение токенов: в secrets file (`/opt/orchestrator/secrets/...`) или vault

### 5.4 Policies
- [ ] Создать default policy для tenant
- [ ] Зафиксировать лимиты (rate/concurrency)
- [ ] Подключить policy к connector(ам)

### 5.5 Secrets
- [ ] Создать SecretRef (Stripe signing secret, API keys)
- [ ] Проверить: секреты не попадают в БД/логи

### 5.6 Connectors
- [ ] Создать connector(ы) для tenant
- [ ] Привязать policy + secret refs

### 5.7 Webhooks
- [ ] Настроить Stripe webhook endpoint на Orchestrator
- [ ] Проверить verify signature
- [ ] Проверить dedupe (повторный event_id)
 - [ ] Привязать routing provider account_id → workspace

### 5.8 Тестовый прогон (обязателен)
- [ ] /execute happy path
- [ ] timeout/retry/breaker сценарий
- [ ] webhook → inbox → job → worker → product callback
- [ ] Event stream показывает полный путь
 - [ ] Fallback polling (если callback невозможен)

### 5.9 Ops readiness
- [ ] Retention политика согласована
- [ ] DLQ включён и runbook доступен
- [ ] Alerts/metrics готовы (queue depth, error rate)

---

## 6) Implementation checklist (для дальнейшей реализации платформы)

Этот чеклист — для развития Orchestrator как "коробки".

### 6.1 Workspace onboarding automation
- [ ] Endpoint/команда: `POST /workspaces` (или seed script) для создания workspace + дефолт policy
- [ ] Шаблоны: default policies per environment (dev/prod)
- [ ] UI wizard: create workspace → add connector → activate config
- [ ] JSON import/export bundle (policies/connectors/secret refs/configs) для быстрого онбординга

### 6.2 Webhook routing v1
- [ ] Таблица `WebhookRoute` (provider, key/account_id, tenant_id, connector_id)
- [ ] UI для управления routing
- [ ] Защита от misroute

### 6.3 SecretRef resolvers
- [ ] Encrypted secrets store (envelope encryption) в Postgres
- [ ] Vault/KMS resolver (v2)
- [ ] rotation workflow + health check

### 6.4 DLQ полноценный
- [ ] API: list/replay/purge
- [ ] UI: DLQ list + replay reason
- [ ] Audit trail на replay/purge

### 6.5 Payload storage
- [ ] S3/MinIO payload_ref
- [ ] size threshold (когда inline json → ref)
- [ ] encryption at rest (если нужно)

### 6.6 Observability maturity
- [ ] OpenTelemetry exporter + collector
- [ ] Prometheus dashboards (rate limit, breaker, queue, DLQ)
- [ ] log sampling policy

### 6.7 Security maturity
- [ ] Impersonation token only (prod)
- [ ] Break-glass flow + separate ingress allowlist
- [ ] mTLS (v2) or service mesh identity

---

## 7) Acceptance criteria (как понять, что модель работает)

Считаем модель "Workspace Onboarding" успешной, если:
- [ ] можно поднять новый workspace (Beauty) без изменения кода Orchestrator core
- [ ] можно подключить webhooks и увидеть end-to-end trace + events
- [ ] можно сделать rollback config за 1 действие
- [ ] есть изоляция: события/секреты/лимиты одного workspace не затрагивают другой

---

## 8) Шаблоны именования

- Workspaces: `buildos-dev`, `buildos-prod`, `beauty-dev`, `beauty-prod`
- Domains:
  - Control: `orch.<env>.designcorp.eu` (или текущие `orch.designcorp.eu`, `dev.orch.designcorp.eu`)
  - Operator: `operator.orch.<env>.designcorp.eu`
- Service identities:
  - `svc:buildos-backend`, `svc:beauty-backend`, `svc:operator-console`

---

## 9) Next step

Рекомендуемый следующий практический шаг:
- **Onboard Beauty-dev** как второй tenant и прогнать весь flow (execute + stripe webhook fixture), чтобы подтвердить мульти-тенант разделение и процедуры.
