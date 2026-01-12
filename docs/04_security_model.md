# Security модель (MVP)

## S2S JWT claims (пример)
- `iss`: `buildos-internal`
- `aud`: `orchestrator-exec` или `orchestrator-control`
- `sub`: `svc:buildos-backend` / `svc:operator-console`
- `exp`/`iat` (TTL 1–5 минут)
- `jti` (защита от replay при необходимости)
- `scopes`: массив строк, напр. `orchestrator.execute`, `orchestrator.jobs.write`, `orchestrator.control.read`
- `tid`: tenant_id (если вызов tenant-scoped)

## RBAC матрица (операторские роли)

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
