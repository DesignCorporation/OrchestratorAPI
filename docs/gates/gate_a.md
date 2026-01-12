# Gate A — MVP Stabilization

## 1) Цель и правило гейта
Gate A блокирует любые новые фичи до завершения стабилизации. Гейт считается закрытым, когда безопасность, контракт, тесты и impersonation стабилизированы.

## 2) Scope (входит / не входит)

**Входит:**
- защита operator/control plane
- `AUTH_MODE=enabled` в проде
- минимальный RBAC
- единый error envelope + error codes
- contract tests
- impersonation token-based
- security verification runbook

**Не входит:**
- новые UI фичи (кроме необходимого для проверки Gate A)
- новые интеграции
- расширение connector'ов

## 3) Checklist по задачам (DoD/Acceptance)

### ISSUE-29: Operator protection
**Acceptance:**
- operator.* защищен минимум двумя слоями (например allowlist + basic auth; JWT обязателен на API)
- orch.* (control) закрыт allowlist'ом (prod) + JWT
- exec не публикуется наружу и не проксируется nginx

**DoD:**
- curl с внешнего IP на control/operator без авторизации → 401/403
- попытка открыть exec через домен → 404/403
- все изменения в конфиге Nginx отражены в репо и задокументированы

### ISSUE-30: AUTH_MODE=enabled
**Acceptance:**
- при AUTH_MODE=enabled все mutating endpoints требуют auth
- при AUTH_MODE=disabled (dev-only) поведение явно задокументировано

**DoD:**
- тесты/проверка, что auth enforcement реально работает (не только env выставлен)

### ISSUE-31: Minimal RBAC
**Roles:** OperatorAdmin / Support / ReadOnlyAuditor / BreakGlassAdmin

**Acceptance:**
- Support: нет доступа к секретам и опасным операциям без reason
- ReadOnly: только read endpoints
- BreakGlass: отдельный flow + обязательный audit

**DoD:**
- минимум один integration test или e2e проверка на запреты

### ISSUE-37: Error envelope
**Acceptance:**
- единый формат ошибок по всем endpoints
- стабильные error codes (список в docs)

**DoD:**
- контракт подтвержден тестами (или snapshot тесты)

### ISSUE-43: Contract tests
**Acceptance:**
- execute/jobs/webhooks покрыты позитивными и негативными кейсами
- тесты идут в CI и блокируют merge

**DoD:**
- минимальный набор кейсов (см. ниже)

### ISSUE-44: Impersonation hardening
**Acceptance:**
- impersonation работает только через signed token (TTL + reason)
- header-only impersonation запрещен в prod

**DoD:**
- audit фиксирует start/stop impersonation, TTL, reason
- попытка использовать старые headers в prod → отказ

### ISSUE-45: Security verification runbook
**Acceptance:**
- есть пошаговый curl checklist (prod + dev)
- включает проверки: auth, rbac, exec закрыт, error envelope, impersonation, webhooks

**DoD:**
- runbook воспроизводим на чистой VM/окружении

## 4) Definition of Done (Gate A)
Gate A закрыт, если:
- все issues в milestone закрыты
- runbook пройден на prod
- CI зеленый на main
- нет известных обходов (exec наружу, impersonation headers в prod, anonymous mutating)

## 5) Минимальный набор тест-кейсов для ISSUE-43

### /execute
- 200 OK
- idempotency replay (200 + replayed=true)
- idempotency conflict (409)
- rate limited (429)
- circuit open (503)
- upstream timeout (504)

### /jobs
- enqueue (202)
- get status

### /webhooks/stripe
- valid signature (200)
- invalid signature (401/403)
- dedupe same event_id (200 duplicate=true)

## Дополнительное правило выполнения Gate A
Freeze: любые PR, не относящиеся к Gate A, отклоняются до закрытия milestone.
