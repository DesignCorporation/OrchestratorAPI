-- Minimal MVP schema

CREATE TABLE IF NOT EXISTS connector (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  type text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  settings_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ref_id uuid,
  policy_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS connector_tenant_name_uidx ON connector (tenant_id, name);
CREATE INDEX IF NOT EXISTS connector_tenant_type_idx ON connector (tenant_id, type);

CREATE TABLE IF NOT EXISTS policy (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  version int NOT NULL DEFAULT 1,
  rate_limit_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  retry_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  circuit_breaker_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  concurrency_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_tenant_name_idx ON policy (tenant_id, name);

CREATE TABLE IF NOT EXISTS secret_ref (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  provider text NOT NULL,
  ref text NOT NULL,
  version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS secret_ref_tenant_provider_idx ON secret_ref (tenant_id, provider);

CREATE TABLE IF NOT EXISTS webhook_inbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  provider text NOT NULL,
  event_id text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'received',
  payload_ref text,
  payload_json jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_inbox_dedupe_uidx ON webhook_inbox (tenant_id, provider, event_id);
CREATE INDEX IF NOT EXISTS webhook_inbox_tenant_received_idx ON webhook_inbox (tenant_id, received_at);

CREATE TABLE IF NOT EXISTS job (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 0,
  run_at timestamptz,
  payload_ref text,
  payload_json jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_tenant_status_idx ON job (tenant_id, status);
CREATE INDEX IF NOT EXISTS job_tenant_created_idx ON job (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS run (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES job(id) ON DELETE CASCADE,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_json jsonb
);

CREATE INDEX IF NOT EXISTS run_job_started_idx ON run (job_id, started_at);

CREATE TABLE IF NOT EXISTS event_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  severity text NOT NULL,
  type text NOT NULL,
  message text NOT NULL,
  data_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_log_tenant_created_idx ON event_log (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS event_log_tenant_type_created_idx ON event_log (tenant_id, type, created_at);
CREATE INDEX IF NOT EXISTS event_log_trace_idx ON event_log (trace_id);

CREATE TABLE IF NOT EXISTS request_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  request_id text NOT NULL,
  trace_id text,
  actor_type text NOT NULL,
  actor_id text,
  connector_id uuid,
  operation text,
  status text,
  http_status int,
  latency_ms int,
  retry_count int NOT NULL DEFAULT 0,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS request_log_tenant_request_uidx ON request_log (tenant_id, request_id);
CREATE INDEX IF NOT EXISTS request_log_tenant_created_idx ON request_log (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS operator_audit_log (
  id uuid PRIMARY KEY,
  operator_user_id uuid NOT NULL,
  action text NOT NULL,
  tenant_id uuid,
  resource_type text NOT NULL,
  resource_id text,
  diff_json jsonb,
  reason text NOT NULL,
  ip text,
  user_agent text,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_audit_user_created_idx ON operator_audit_log (operator_user_id, created_at);
CREATE INDEX IF NOT EXISTS operator_audit_tenant_created_idx ON operator_audit_log (tenant_id, created_at);
