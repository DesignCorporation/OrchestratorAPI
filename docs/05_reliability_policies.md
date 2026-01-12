# Политики по умолчанию (MVP)

**Timeouts (default)**
- connect: 3s
- read: 10s
- total: 15s

**Retries (default)**
- max attempts: 4 (1 + 3 retries)
- backoff: exponential (base 250ms, factor 2.0)
- jitter: full jitter
- max backoff: 5s
- retriable: 408/429/5xx + network errors
- non-retriable: 4xx (кроме 408/429)

**Circuit Breaker (default)**
- rolling window: 30s
- минимум запросов для оценки: 20
- threshold: 50% failures
- open duration: 30s
- half-open probes: 5

**Rate limit (default, per tenant + connector)**
- 10 rps, burst 20

**Concurrency (default, per tenant + connector)**
- 50 in-flight
