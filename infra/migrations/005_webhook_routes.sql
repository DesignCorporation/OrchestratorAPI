CREATE TABLE IF NOT EXISTS webhook_route (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  account_id text NOT NULL,
  tenant_id uuid NOT NULL,
  connector_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_route_provider_account_uidx
  ON webhook_route (provider, account_id);

CREATE INDEX IF NOT EXISTS webhook_route_tenant_idx
  ON webhook_route (tenant_id);
