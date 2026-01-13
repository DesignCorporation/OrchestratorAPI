# Error Codes (MVP)

## Error envelope
All error responses use the same JSON shape:

```json
{
  "code": "rate_limited",
  "message": "rate_limited",
  "details": {
    "limit": 100,
    "remaining": 0,
    "reset_ms": 60000
  },
  "request_id": "uuid",
  "trace_id": "uuid-or-traceparent"
}
```

`details` can be `null` when there is no extra payload.

## Codes
- `infra_not_ready`
- `missing_stripe_secret`
- `missing_signature`
- `missing_raw_body`
- `invalid_signature`
- `missing_type`
- `db_not_configured`
- `missing_connector_or_operation`
- `IDEMPOTENCY_CONFLICT`
- `CONNECTOR_NOT_FOUND`
- `RATE_LIMITED`
- `CIRCUIT_OPEN`
- `job_not_found`
- `redis_not_configured`
- `missing_queue_job_or_reason`
- `missing_queue_or_reason`
- `missing_name_config_or_reason`
- `config_not_found`
- `missing_name`
- `config_not_active`
- `missing_type_or_name`
- `missing_provider_ref_or_reason`
- `missing_provider_or_ref`
- `missing_name_or_reason`
- `missing_name_or_env`
- `invalid_env`
- `workspace_name_taken`
- `missing_status_or_reason`
- `invalid_status`
- `workspace_not_found`
- `workspace_disabled`
- `not_found`
- `auth_required`
- `invalid_token`
- `breakglass_reason_required`
- `impersonation_forbidden`
- `impersonation_headers_disabled`
- `invalid_impersonation_token`
- `impersonation_secret_not_configured`
- `missing_reason`
- `invalid_impersonate_sub`
- `invalid_impersonate_tenant`
- `bundle_invalid_payload`
- `missing_config_json`
- `missing_name_or_config_id`
- `invalid_secret_ref_id`
- `invalid_policy_id`
- `policy_not_found`
- `secret_ref_not_found`
- `policy_insert_failed`
- `secret_ref_insert_failed`
- `connector_insert_failed`
- `config_insert_failed`
- `upstream_timeout`
- `internal_error`
- `request_error`
