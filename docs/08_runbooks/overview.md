# Runbooks (MVP)

## RB-01: локальный запуск docker-compose
## RB-02: отправить тестовый stripe webhook (fixture)
## RB-03: симулировать падение провайдера и увидеть breaker open
## RB-04: найти задачу в DLQ и сделать replay (с reason)
## RB-05: rollback активного конфига через ConfigPointer
## RB-06: break-glass доступ (как включить, как закрыть, где смотреть audit)

---

## MVP тестовый сценарий (end-to-end)

Цель: проверить поток без UI, затем подключить Operator Console.

1) Поднять `docker-compose.dev.yml`.
2) Применить миграции + `seed-dev.sh` (создать workspace + stripe connector + policy).
3) Отправить fixture webhook на `POST /webhooks/stripe`.

Ожидаемые EventLog (по порядку):
- `webhook_received` (severity=info)
- `job_enqueued` (type=stripe.webhook.process)
- `job_started`
- `connector_call` (upstream)
- `billing_state_updated` (или `handler_completed`)
- `job_succeeded`

Ожидаемые trace spans (пример naming):
- `http.webhooks.stripe` (server span)
- `queue.process` (consumer span)
- `connector.stripe.*` (client span)
- `http.buildos.billing.update` (client span)

4) Симулировать upstream failure (подменить secret/endpoint) → убедиться:
- retries происходят
- при исчерпании → DLQ
- event `job_failed`/`job_deadlettered`
