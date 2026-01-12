# Observability

## Metrics endpoint
- `GET /metrics` (Prometheus format)
- Exposed on control and exec services.

## Metrics
- `orchestrator_http_requests_total{route,method,status}`
- `orchestrator_http_errors_total{route,method,status}`
- `orchestrator_rate_limited_total{tenant_id,connector_id}`
- `orchestrator_circuit_open_total{tenant_id,connector_id}`
- `orchestrator_retry_total{tenant_id,connector_id}`
- `orchestrator_queue_depth{queue,state}`

## PromQL examples
- Rate limit events:
  - `sum(rate(orchestrator_rate_limited_total[5m]))`
- Circuit open events:
  - `sum(rate(orchestrator_circuit_open_total[5m]))`
- Retries:
  - `sum(rate(orchestrator_retry_total[5m]))`
- Queue depth by queue/state:
  - `orchestrator_queue_depth`

## Grafana
See `docs/observability_dashboard.json` for a starter dashboard.
