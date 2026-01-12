# Decision Log

**D1. Архитектура:** отдельный сервис Orchestrator (Control Plane + Execution Plane), управляемый из Operator Console.
- Причины: изоляция отказов, безопасность control-plane, независимый деплой, централизованная observability.

**D2. Хранилища:** Postgres (source of truth) + Redis (queue/rate-limit).

**D3. Очереди:** Redis + BullMQ (MVP).

**D4. Секреты:** в БД не храним. Только `SecretRef`.

**D5. Observability:** structured JSON logs + OpenTelemetry traces + metrics.
