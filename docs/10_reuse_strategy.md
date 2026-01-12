# “Коробочная” стратегия: Orchestrator Kit

Цель: не переписывать оркестратор под каждый проект, а использовать как конструктор.

## Как правильно сделать «коробку»
1) **Core Engine** (не зависит от BuildOS):
   - execution runtime, policy engine, queue, webhook inbox, logging/tracing
2) **Adapters** (интеграции):
   - коннекторы (stripe, smtp, s3, http)
3) **Project Bindings** (тонкий слой):
   - специфичные обработчики событий (например “update subscription”)

## «Лего»-подход: расширяемость как в CMS
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

## Рекомендация для BuildOS
Сделать **Orchestrator Kit** в виде:
- отдельного репозитория или mono-repo package `@orchestrator/core`
- сервис `orchestrator-service` использует core
- BuildOS добавляет только bindings (обработчики бизнес-событий)

Важно: это не означает «делаем отдельный продукт». Это означает **архитектурно готовим переиспользование**.
