# Orchestrator SaaS (Control + Execution Plane) — Master Documentation

**Purpose:** This documentation set describes the reusable **Orchestrator SaaS** (not BuildOS-specific) that provides API orchestration: integrations, policies, queues, audit/security, and observability.

**Primary goals**
- Reusable foundation for multiple products (BuildOS, Beauty, future projects).
- Separate **control plane** from **execution plane** to avoid admin lockout and reduce blast radius.
- Production-ready basics: auth, audit, rate limits, retries, circuit breakers, idempotency, DLQ, metrics, tracing.
- SaaS-first: no installs inside client projects; all access is via HTTPS API + tokens.

**Non-goals (MVP)**
- No AI/agents.
- No business-domain logic in core (domain logic lives in bindings/handlers).

---

## 0) Documentation hierarchy (recommended split)

This master doc is the **index** and decision anchor. Keep the rest as separate docs (or separate canvases).

### 0.1 Docs tree (source of truth)

```
/docs
  00_index.md
  01_architecture.md
  02_api_contracts.md
  02_api_errors.md
  03_data_model.md
  04_security_model.md
  04_secrets.md
  04_multi_tenant.md
  05_reliability_policies.md
  05_idempotency.md
  05_retention.md
  05_payload_storage.md
  06_observability.md
  06_observability_dashboard.json
  07_deployment.md
  07_ci_cd.md
  07_production_readiness.md
  08_runbooks/
  09_roadmap_backlog.md
  09_roadmap.md
  10_repo_structure.md
  10_repo_bootstrap.md
  10_reuse_strategy.md
  11_onboarding_guide.md
  12_decision_log.md
  13_definition_of_done.md
  archive/
```

### 0.2 Canvas plan (separate “holsts”)
1) **Architecture** (planes, components, boundaries)
2) **API Contracts** (execute/jobs/webhooks/events/errors)
3) **Security** (S2S auth, RBAC, audit, secret refs, impersonation)
4) **Observability & Ops** (logs/traces/metrics, retention, runbooks)
5) **Roadmap & GitHub Issues** (epics, milestones, DoD)
6) **Deployment & CI/CD** (compose/k8s, registry, env, systemd)
7) **Extension model** (connector definitions, JSON Schema, UI forms)

---

## 0.3 Current implementation status (Codex report snapshot)

Environment & deploy:
- VM + Docker Compose + systemd for **prod** and **dev**.
- Nginx + Let's Encrypt domains:
  - prod: `orch.designcorp.eu`, `operator.orch.designcorp.eu`
  - dev: `dev.orch.designcorp.eu`, `operator.dev.orch.designcorp.eu`
- Ports:
  - prod: control 4000, exec 4001 (public), operator 4002
  - dev: control/exec 4100, operator 4102
- Separate dev stack `orchestrator-dev` (own DB/Redis/volumes).

Backend:
- Fastify API: `/health`, `/execute`, `/jobs`, `/jobs/:id`, `/events`, `/events/stream` (SSE), `/metrics`.
- Control endpoints: `/connectors`, `/policies`, `/secret-refs`, `/configs`, `/configs/activate`, `/configs/active`.
- Idempotency for `/execute` (cache + conflict semantics).
- Stripe webhook ingress: verify + dedupe + enqueue.
- Policy engine MVP: retry/timeout, rate limit, circuit breaker.
- Multi-tenant: `tenant_id` from JWT + impersonation.
- Impersonation currently via `x-impersonate-*` headers + audit.
- Worker: job lifecycle + event_log + JSON logging with correlation/trace.

Operator Console:
- Happy path demo: create policy+connector → execute → stream events.
- Proxy for control and exec.

DB/model:
- `OrchestratorConfig` + `ConfigPointer` present (immutable config + active pointer).

---

## 0.4 Next execution plan (anti-chaos gates)

**Gate A — MVP Stabilization (1–2 weeks, no feature expansion until done):**
1) Security hardening:
   - operator.* protected (allowlist + basic auth + JWT) 
   - `AUTH_MODE=enabled` in prod; anonymous access forbidden
2) Minimal Operator RBAC (prod): Admin / Support / ReadOnly / BreakGlass
3) Contract tests: execute/jobs/webhooks (positive + negative)
4) Normalize error responses (single envelope + stable error codes)
5) Impersonation hardening:
   - replace header-only impersonation with **signed impersonation token** (TTL + reason + audit)

**Gate B — Management UI:** Configs create/activate/rollback, Connectors/Policies CRUD, Audit view.

**Gate C — Ops maturity:** retention/cleanup jobs, payload_ref (S3/MinIO), Prometheus dashboards.

**Gate D — Integrations:** real connectors, full DLQ UI, webhook inbox UI + retry.

---

## 1) Product definition

### 1.1 What Orchestrator Kit is
A reusable control + execution system to standardize:
- external integrations (Stripe, email, storage, webhooks)
- runtime policies (rate limits, retries, timeouts, circuit breakers)
- async jobs + queue + DLQ
- observability (event log, request log, tracing, metrics)
- security & audit (operator actions, impersonation)

### 1.2 Operating model (SaaS-first)
- **Operator Console** manages the **Control Plane**.
- Product backends call the **Execution Plane** over public HTTPS (S2S auth required).
- Webhooks are accepted by ingress and pushed to queue.
- Outbound callbacks to product are the default; polling is supported as fallback.

### 1.3 Project = Workspace (multi-product)
Each product (BuildOS, Beauty, future apps) is a **workspace**. Workspaces are isolated by `tenant_id`, and **dev/prod must be separated**:
- `orch.dev` serves only `*-dev` workspaces
- `orch.prod` serves only `*-prod` workspaces

### 1.4 Bootstrap flow (minimal, repeatable)
1) **Create workspace** (API or seed) → get `tenant_id`.
2) **Create default policy** for workspace.
3) **Create service identities**:
   - `svc:<product>-backend` for exec plane (`aud=orchestrator-exec`)
   - `svc:operator-console` for control plane (`aud=orchestrator-control`)
4) **Import JSON bundle** (policies/connectors/secret refs/configs).
5) **Webhook routing**: map provider account id → tenant.

### 1.5 JSON bundle (ops-friendly)
Support an import/export format so onboarding is fast and consistent across tenants.
Minimal bundle structure:
```json
{
  "tenant": { "name": "buildos-dev" },
  "policies": [{ "name": "default", "timeout_json": { "total_ms": 5000 } }],
  "secret_refs": [{ "name": "stripe_signing", "ref": "env://STRIPE_SIGNING_SECRET" }],
  "connectors": [{ "type": "http", "name": "stripe", "policy": "default", "secret_ref": "stripe_signing" }],
  "configs": [{ "name": "default", "version": "v1", "data": { "foo": "bar" }, "activate": true }]
}
```

---

## 2) Architecture (high level)

### 2.1 Planes
- **Control Plane**: configs, policies, connectors, secret refs, audit, admin views.
- **Execution Plane**: `/execute`, `/jobs`, worker processing.

### 2.2 Core components
- Orchestrator API (Fastify)
- Worker (BullMQ)
- Postgres (source of truth)
- Redis (queue + rate limiting)
- Nginx/TLS for published domains

### 2.3 Key principles
- Control plane must remain reachable even if product services are down.
- Exec endpoints should be internal (no public ingress).
- Immutable versioned configs with pointer-based activation/rollback.
- Secrets are **not stored** in DB (SecretRef only).

---

## 3) Extension model ("LEGO" / CMS-like)

### 3.1 Connector Definition (declarative)
Each connector type is defined by:
- `type`
- `config_schema` (JSON Schema)
- `secret_schema` (what secrets are required)
- operations list: `operation_id`, `payload_schema`, `output_schema`
- optional webhook schema + verification method

### 3.2 UI generation
Operator Console generates forms from JSON Schema:
- field rendering
- validation
- defaulting

### 3.3 Runtime execution
- generic HTTP connector for simple APIs
- code-based handlers for complex providers (Stripe, SMTP)
- project-specific bindings remain outside core (thin adapters)

---

## 4) Data model (summary)

Core tables (tenant-scoped unless stated otherwise):
- `Connector`
- `Policy`
- `SecretRef`
- `OrchestratorConfig` + `ConfigPointer`
- `WebhookInbox`
- `Job` + `Run`
- `EventLog` + `RequestLog`
- `OperatorAuditLog` (operator-scoped)

Retention policy and payload storage should be documented separately.

---

## 5) Security model (summary)

### 5.1 Service-to-service auth
- Short-lived JWT (aud/iss/scopes/tid) for MVP.
- Invite-only access in v1 (no public signup).
- mTLS (SPIFFE/SPIRE or mesh) in v2.

### 5.2 Operator RBAC
- Roles: OperatorAdmin, Support, BillingAdmin, ReadOnlyAuditor, BreakGlassAdmin.
- Every mutating action requires `reason` and is audited.

### 5.3 Impersonation
- Must be token-based (signed, TTL), not header-only in production.
- Start/stop events are audited.

### 5.4 Secrets
- SecretRef only in DB.
- v1: encrypted secrets in Postgres (envelope encryption), master key in VM env/Docker secret.
- v2: Vault/KMS integration without API changes.
- Rotation workflow + health checks.

---

## 6) Reliability (summary)

- Timeouts: connect/read/total
- Retries: exponential backoff + jitter, capped attempts
- Circuit breaker: rolling window + thresholds + half-open probes
- Rate limits: token bucket (tenant+connector+operation)
- Quotas v1: tenant-level RPS, concurrency, queue depth, plus edge rate limit.
- Idempotency: `/execute` and `/jobs` keyed by `(tenant_id, idempotency_key)`
- DLQ: replay/purge with audit
- Degradation: fail-fast on open breaker, or queue with delay

---

## 7) Observability & Ops (summary)

- Structured JSON logs (request_id/trace_id/tenant_id)
- OpenTelemetry traces (API → queue → worker → upstream)
- Metrics: latency, error rate, queue depth, DLQ depth, retries, breaker state
- Event stream (SSE) for terminal-like UI
- Runbooks: deploy, rollback, DLQ replay, breaker incidents

---

## 8) Deployment & CI/CD (summary)

### 8.1 Current production baseline
- VM + Docker Compose + systemd
- GHCR images (tag by SHA)
- Nginx/TLS vhosts:
  - `orchestrator-control` published
  - `operator-console` published
  - `orchestrator-exec` internal-only

### 8.2 Path to Kubernetes
- split API/worker deployments
- readiness/liveness
- secrets manager
- autoscaling by queue depth

---

## 9) Roadmap (summary)

### 9.1 Stabilization (1–2 weeks)
- enforce AUTH_MODE in prod
- operator plane protection (allowlist/basic auth/JWT)
- minimal operator RBAC
- normalize error responses
- contract tests for execute/jobs/webhooks
- impersonation hardening (token-based)

### 9.2 Management UI
- Configs create/activate/rollback
- Connectors/Policies CRUD
- Audit view

### 9.3 Ops maturity
- retention cleanup jobs
- payload_ref (S3/MinIO)
- DLQ UI (list/replay/purge)

### 9.4 Integrations
- expand connectors and real handlers

---

## 10) Decision log (high level)

- Separate service (control+exec) over embedding in product backend.
- Exec plane internal-only (no public ingress).
- Versioned immutable configs + pointer activation.
- No secrets in DB; SecretRef only.

---

## 11) Appendix: naming conventions

- Services: `orchestrator-api`, `orchestrator-worker`, `operator-console`
- Domains (recommended pattern):
  - `orch.<env>.<domain>` (control)
  - `operator.<env>.orch.<domain>` (UI)
  - exec internal only
