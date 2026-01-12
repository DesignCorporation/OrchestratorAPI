import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;
const defaultQueueName = process.env.DEFAULT_QUEUE || 'default';
const webhookQueueName = process.env.WEBHOOK_QUEUE || 'webhook';
const defaultTenantId = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';
const retentionIntervalMinutes = Number(process.env.RETENTION_INTERVAL_MINUTES || 1440);
const eventLogTtlDays = Number(process.env.EVENT_LOG_TTL_DAYS || 30);
const requestLogTtlDays = Number(process.env.REQUEST_LOG_TTL_DAYS || 30);
const webhookInboxTtlDays = Number(process.env.WEBHOOK_INBOX_TTL_DAYS || 14);
const jobTtlDays = Number(process.env.JOB_TTL_DAYS || 14);
const operatorAuditTtlDays = Number(process.env.OPERATOR_AUDIT_TTL_DAYS || 365);

if (!redisUrl) {
  throw new Error('REDIS_URL is required');
}

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const connection = new Redis(redisUrl);
const pgPool = new Pool({ connectionString: databaseUrl });

const queues = [
  new Queue(defaultQueueName, { connection }),
  new Queue(webhookQueueName, { connection })
];

function log(level: 'info' | 'error', message: string, data?: Record<string, unknown>) {
  const payload = {
    level,
    message,
    ...data
  };
  if (level === 'error') {
    console.error(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}

let retentionRunning = false;
async function runRetentionCleanup() {
  if (retentionRunning) return;
  retentionRunning = true;
  const results: Record<string, number> = {};
  try {
    if (eventLogTtlDays > 0) {
      const res = await pgPool.query(
        `DELETE FROM event_log WHERE created_at < now() - ($1 || ' days')::interval`,
        [eventLogTtlDays]
      );
      results.event_log = res.rowCount ?? 0;
    }
    if (requestLogTtlDays > 0) {
      const res = await pgPool.query(
        `DELETE FROM request_log WHERE created_at < now() - ($1 || ' days')::interval`,
        [requestLogTtlDays]
      );
      results.request_log = res.rowCount ?? 0;
    }
    if (webhookInboxTtlDays > 0) {
      const res = await pgPool.query(
        `DELETE FROM webhook_inbox WHERE received_at < now() - ($1 || ' days')::interval`,
        [webhookInboxTtlDays]
      );
      results.webhook_inbox = res.rowCount ?? 0;
    }
    if (jobTtlDays > 0) {
      const res = await pgPool.query(
        `DELETE FROM job WHERE created_at < now() - ($1 || ' days')::interval`,
        [jobTtlDays]
      );
      results.job = res.rowCount ?? 0;
    }
    if (operatorAuditTtlDays > 0) {
      const res = await pgPool.query(
        `DELETE FROM operator_audit_log WHERE created_at < now() - ($1 || ' days')::interval`,
        [operatorAuditTtlDays]
      );
      results.operator_audit_log = res.rowCount ?? 0;
    }
    log('info', 'retention_cleanup_done', results);
  } catch (error) {
    log('error', 'retention_cleanup_failed', { error: (error as Error).message });
  } finally {
    retentionRunning = false;
  }
}

async function processJob(jobId: string, jobName: string, context?: { correlationId?: string; traceId?: string }) {
  const jobMeta = await pgPool.query('SELECT tenant_id, type FROM job WHERE id = $1', [jobId]);
  const hasJobMeta = (jobMeta.rowCount ?? 0) > 0;
  const tenantId = hasJobMeta ? jobMeta.rows[0].tenant_id : defaultTenantId;
  const jobType = hasJobMeta ? jobMeta.rows[0].type : jobName;
  const runId = randomUUID();
  await pgPool.query(
    `INSERT INTO run (id, job_id, tenant_id, status) VALUES ($1, $2, $3, $4)`,
    [runId, jobId, tenantId, 'running']
  );
  await pgPool.query(`UPDATE job SET status = $1, attempts = attempts + 1, updated_at = now() WHERE id = $2`, [
    'running',
    jobId
  ]);

  await pgPool.query(
    `INSERT INTO event_log (id, tenant_id, severity, type, message, data_json, correlation_id, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      tenantId,
      'info',
      'job_started',
      'Job started',
      { job_id: jobId, type: jobType },
      context?.correlationId || null,
      context?.traceId || null
    ]
  );
  log('info', 'job_started', { job_id: jobId, job_type: jobType, request_id: context?.correlationId, trace_id: context?.traceId });

  try {
    await pgPool.query('SELECT 1');
    await pgPool.query(
      `UPDATE run SET status = $1, finished_at = now() WHERE id = $2`,
      ['success', runId]
    );
    await pgPool.query(`UPDATE job SET status = $1, updated_at = now() WHERE id = $2`, ['success', jobId]);
    await pgPool.query(
      `INSERT INTO event_log (id, tenant_id, severity, type, message, data_json, correlation_id, trace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        tenantId,
        'info',
        'job_succeeded',
        'Job succeeded',
        { job_id: jobId, type: jobType },
        context?.correlationId || null,
        context?.traceId || null
      ]
    );
    log('info', 'job_succeeded', { job_id: jobId, job_type: jobType, request_id: context?.correlationId, trace_id: context?.traceId });
    return { ok: true, jobId, jobName };
  } catch (error) {
    await pgPool.query(
      `UPDATE run SET status = $1, finished_at = now(), error_json = $2 WHERE id = $3`,
      ['failed', { message: (error as Error).message }, runId]
    );
    await pgPool.query(`UPDATE job SET status = $1, updated_at = now() WHERE id = $2`, ['failed', jobId]);
    await pgPool.query(
      `INSERT INTO event_log (id, tenant_id, severity, type, message, data_json, correlation_id, trace_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        tenantId,
        'error',
        'job_failed',
        'Job failed',
        { job_id: jobId, type: jobType, error: (error as Error).message },
        context?.correlationId || null,
        context?.traceId || null
      ]
    );
    log('error', 'job_failed', {
      job_id: jobId,
      job_type: jobType,
      error: (error as Error).message,
      request_id: context?.correlationId,
      trace_id: context?.traceId
    });
    throw error;
  }
}

const workers = [
  new Worker(
    defaultQueueName,
    async (job) => {
      const jobId = typeof job.data?.jobId === 'string' ? job.data.jobId : (job.id || randomUUID()).toString();
      return processJob(jobId, job.name, {
        correlationId: typeof job.data?.correlationId === 'string' ? job.data.correlationId : undefined,
        traceId: typeof job.data?.traceId === 'string' ? job.data.traceId : undefined
      });
    },
    { connection }
  ),
  new Worker(
    webhookQueueName,
    async (job) => {
      const jobId = typeof job.data?.jobId === 'string' ? job.data.jobId : (job.id || randomUUID()).toString();
      return processJob(jobId, job.name, {
        correlationId: typeof job.data?.correlationId === 'string' ? job.data.correlationId : undefined,
        traceId: typeof job.data?.traceId === 'string' ? job.data.traceId : undefined
      });
    },
    { connection }
  )
];

workers.forEach((worker) => {
  worker.on('completed', (job) => {
    log('info', 'job_completed', {
      job_id: job.id,
      request_id: typeof job.data?.correlationId === 'string' ? job.data.correlationId : undefined,
      trace_id: typeof job.data?.traceId === 'string' ? job.data.traceId : undefined
    });
  });

  worker.on('failed', (job, error) => {
    log('error', 'job_failed', {
      job_id: job?.id,
      error: (error as Error).message,
      request_id: typeof job?.data?.correlationId === 'string' ? job.data.correlationId : undefined,
      trace_id: typeof job?.data?.traceId === 'string' ? job.data.traceId : undefined
    });
  });
});

if (retentionIntervalMinutes > 0) {
  setInterval(() => {
    runRetentionCleanup().catch(() => undefined);
  }, retentionIntervalMinutes * 60 * 1000);
}

async function shutdown() {
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all(queues.map((queue) => queue.close()));
  await pgPool.end();
  await connection.quit();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
