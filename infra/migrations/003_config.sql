CREATE TABLE IF NOT EXISTS orchestrator_config (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  version integer NOT NULL,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_config_tenant_name_version_idx
  ON orchestrator_config (tenant_id, name, version);

CREATE TABLE IF NOT EXISTS config_pointer (
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  config_id uuid NOT NULL REFERENCES orchestrator_config(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS config_pointer_config_idx ON config_pointer (config_id);
