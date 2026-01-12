ALTER TABLE run
  ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE run
SET tenant_id = job.tenant_id
FROM job
WHERE run.job_id = job.id
  AND run.tenant_id IS NULL;

ALTER TABLE run
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS run_tenant_job_started_idx
  ON run (tenant_id, job_id, started_at);
