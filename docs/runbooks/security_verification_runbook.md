# Security Verification Runbook (Gate A)

Цель: подтвердить, что прод и dev защищены корректно. Все команды должны давать ожидаемый результат.

## Предпосылки
- Применён allowlist на `orch.*` и `operator.*`
- Basic auth применяется на `operator.*`
- `AUTH_MODE=enabled` в prod
- `IMPERSONATION_HEADERS_ALLOWED=false` в prod

## PROD checks

### 1) Control plane доступ только с allowlist
```bash
curl -I https://orch.designcorp.eu/health
```
**Ожидается:** `200 OK` (если IP в allowlist)

### 2) Operator UI защищён
```bash
curl -I https://operator.orch.designcorp.eu/
```
**Ожидается:** `401 Unauthorized`

```bash
curl -I -u orch-admin:'<PASSWORD>' https://operator.orch.designcorp.eu/
```
**Ожидается:** `200 OK`

### 3) Exec plane не доступен извне
```bash
curl -I https://orch.designcorp.eu/execute
```
**Ожидается:** `404` или `403`

### 4) AUTH_MODE enforcement (JWT обязателен на mutating)
```bash
curl -s -X POST https://orch.designcorp.eu/connectors -d '{}' -H 'content-type: application/json'
```
**Ожидается:** `401` или `403` (без токена)

### 5) Error envelope
```bash
curl -s https://orch.designcorp.eu/does-not-exist
```
**Ожидается:** JSON с `code/message/request_id/trace_id`

### 6) Impersonation headers disabled
```bash
curl -s -H 'Authorization: Bearer <TOKEN>' \
  -H 'x-impersonate-tenant: <TENANT_UUID_V4>' \
  https://orch.designcorp.eu/policies
```
**Ожидается:** `403` + `code=impersonation_headers_disabled`

### 7) Impersonation token flow
```bash
# issue token
curl -s -H 'Authorization: Bearer <TOKEN>' \
  -H 'content-type: application/json' \
  -d '{"impersonate_tenant":"<TENANT_UUID_V4>","reason":"support"}' \
  https://orch.designcorp.eu/admin/impersonation/issue
```
**Ожидается:** `201` + `token`

```bash
# use token
curl -s -H 'Authorization: Bearer <TOKEN>' \
  -H 'x-impersonation-token: <IMPERSONATION_TOKEN>' \
  https://orch.designcorp.eu/policies
```
**Ожидается:** `200` + policies list

### 8) Webhooks still open (only if needed)
```bash
curl -s -X POST https://orch.designcorp.eu/webhooks/stripe -d '{}' -H 'content-type: application/json'
```
**Ожидается:** `400`/`401` error envelope, но НЕ `401 auth_required`.

## DEV checks (baseline)
- В dev допускается `AUTH_MODE=disabled`.
- Headers impersonation allowed (`IMPERSONATION_HEADERS_ALLOWED=true`).

### 1) Control доступ без auth (dev)
```bash
curl -I https://dev.orch.designcorp.eu/health
```
**Ожидается:** `200 OK`

### 2) Dev operator UI доступен
```bash
curl -I https://operator.dev.orch.designcorp.eu/
```
**Ожидается:** `200 OK`

### 3) Impersonation headers allowed in dev
```bash
curl -s https://dev.orch.designcorp.eu/policies -H 'x-impersonate-tenant: 00000000-0000-0000-0000-000000000000'
```
**Ожидается:** `200`

---

## Pass/Fail
Gate A security runbook считается пройденным, если все проверки дают ожидаемый результат.
