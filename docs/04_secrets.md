# SecretRef — источники истины и формат

**Принцип:** в БД только ссылки.

## Форматы ref (URI-like)
- `env://STRIPE_SIGNING_SECRET`
- `docker://stripe_signing_secret`
- `vault://kv/buildos/tenants/<tid>/stripe#signing_secret?version=3`

## Resolution (MVP)
- по `provider` выбираем резолвер (env/docker/vault)
- кешируем в памяти на короткий TTL (например 60s) + принудительное обновление при rotation
