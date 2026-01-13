# Security модель (MVP)

## S2S JWT claims (пример)
- `iss`: `buildos-internal`
- `aud`: `orchestrator-exec` или `orchestrator-control`
- `sub`: `svc:buildos-backend` / `svc:operator-console`
- `exp`/`iat` (TTL 1–5 минут)
- `jti` (защита от replay при необходимости)
- `scopes`: массив строк, напр. `orchestrator.execute`, `orchestrator.jobs.write`, `orchestrator.control.read`
- `tid`: workspace id (tenant_id)

## Service identities и выпуск токенов

### Audience
- `orchestrator-control`: для Control Plane API.
- `orchestrator-exec`: для Execution Plane API.

### TTL и ротация
- Рекомендуемый TTL: 5–15 минут для S2S токенов.
- Ротация shared secret: плановая (например, раз в 30–90 дней) с коротким overlap окном.
- Выдача токенов должна быть автоматизирована (скрипт/CLI), хранить токены в секретах.

### Где хранить токены
- Для internal сервисов: файл секрета (`CONTROL_PLANE_TOKEN_FILE`) или Vault/secret manager.
- Для внешних клиентов: хранение у клиента (secret manager), выдача через secure канал.
- Токены и секреты не логировать и не выводить в аудит/logs.

### Скрипт для генерации токена (shared secret)

```
node scripts/generate-service-token.mjs \
  --aud orchestrator-control \
  --sub svc:operator-console \
  --tid <workspace-id> \
  --scopes orchestrator.control.read,orchestrator.control.write \
  --ttl 600 \
  --iss orchestrator \
  --secret <shared-secret>
```

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
