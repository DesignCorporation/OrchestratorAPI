CREATE TABLE IF NOT EXISTS workspace (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  env text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_env_status_idx ON workspace (env, status);

CREATE TABLE IF NOT EXISTS workspace_invite (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_invite_workspace_idx ON workspace_invite (workspace_id);
