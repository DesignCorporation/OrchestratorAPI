CREATE TABLE IF NOT EXISTS idempotency_cache (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idempotency_tenant_key_uidx ON idempotency_cache (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idempotency_created_idx ON idempotency_cache (created_at);
