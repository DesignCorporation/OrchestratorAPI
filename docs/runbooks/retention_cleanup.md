# Retention cleanup

Retention cleanup runs inside `orchestrator-worker` on a timer and removes old rows from logs and job tables.

## Defaults (MVP)
- `EVENT_LOG_TTL_DAYS`: 30
- `REQUEST_LOG_TTL_DAYS`: 30
- `WEBHOOK_INBOX_TTL_DAYS`: 14
- `JOB_TTL_DAYS`: 14
- `OPERATOR_AUDIT_TTL_DAYS`: 365
- `RETENTION_INTERVAL_MINUTES`: 1440 (nightly)

## Behavior
- Deletes `event_log`, `request_log`, `webhook_inbox`, `job` (with cascading `run`), and `operator_audit_log` rows older than the TTL.
- TTL envs set to `0` disable deletion for that table.

## Verification
- Confirm worker logs include `retention_cleanup_done` with row counts.
- Validate no deletes happen when TTL is set to `0`.
