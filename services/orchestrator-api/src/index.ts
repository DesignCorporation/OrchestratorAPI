import Fastify from 'fastify';
import rawBody from 'fastify-raw-body';
import type { FastifyPluginAsync } from 'fastify';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import Redis from 'ioredis';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { jwtVerify, createRemoteJWKSet, SignJWT } from 'jose';
import { getEffectiveScopes, hasScope as hasScopeFromRole } from './rbac';

const app = Fastify({ logger: true });

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripeApiKey = process.env.STRIPE_API_KEY || 'sk_test_placeholder';
const defaultTenantId = process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000';
const defaultQueueName = process.env.DEFAULT_QUEUE || 'default';
const webhookQueueName = process.env.WEBHOOK_QUEUE || 'webhook';
const authMode = process.env.AUTH_MODE || 'disabled';
const jwtIssuer = process.env.ORCH_JWT_ISSUER;
const jwtAudienceControl = process.env.ORCH_JWT_AUDIENCE_CONTROL;
const jwtAudienceExec = process.env.ORCH_JWT_AUDIENCE_EXEC;
const jwtSharedSecret = process.env.ORCH_JWT_SHARED_SECRET;
const jwtJwksUrl = process.env.ORCH_JWT_JWKS_URL;
const idempotencyTtlHours = Number(process.env.IDEMPOTENCY_TTL_HOURS || 72);
const apiMode = process.env.API_MODE || 'all';
const impersonationSecret = process.env.ORCH_IMPERSONATION_SECRET;
const impersonationTtlMinutes = Number(process.env.IMPERSONATION_TTL_MINUTES || 15);
const impersonationHeadersAllowed = process.env.IMPERSONATION_HEADERS_ALLOWED === 'true';
const payloadStoreEndpoint = process.env.PAYLOAD_STORE_ENDPOINT || '';
const payloadStoreBucket = process.env.PAYLOAD_STORE_BUCKET || '';
const payloadStoreAccessKey = process.env.PAYLOAD_STORE_ACCESS_KEY || '';
const payloadStoreSecretKey = process.env.PAYLOAD_STORE_SECRET_KEY || '';
const payloadStoreRegion = process.env.PAYLOAD_STORE_REGION || 'us-east-1';
const payloadStorePrefix = process.env.PAYLOAD_STORE_PREFIX || 'payloads';
const payloadStoreThresholdBytes = Number(process.env.PAYLOAD_STORE_THRESHOLD_BYTES || 20000);
const payloadStoreForcePathStyle = process.env.PAYLOAD_STORE_FORCE_PATH_STYLE === 'true';

const metrics = {
  httpRequestsTotal: new Map<string, number>(),
  httpErrorsTotal: new Map<string, number>(),
  rateLimitedTotal: new Map<string, number>(),
  circuitOpenTotal: new Map<string, number>(),
  retriesTotal: new Map<string, number>()
};

type AuthUser = {
  sub?: string;
  scopes?: string[];
  tid?: string;
  role?: string;
  impersonatedSub?: string;
  impersonatedTid?: string;
};

function metricKey(route: string, method: string, status: number): string {
  return `${route}|${method}|${status}`;
}

const pgPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const redis = redisUrl ? new Redis(redisUrl) : null;
const webhookQueue = redis ? new Queue(webhookQueueName, { connection: redis }) : null;
const jobQueue = redis ? new Queue(defaultQueueName, { connection: redis }) : null;
const stripe = new Stripe(stripeApiKey, { apiVersion: '2025-02-24.acacia' });

const payloadStoreEnabled = Boolean(payloadStoreEndpoint && payloadStoreBucket);
const payloadStoreClient = payloadStoreEnabled
  ? new S3Client({
      region: payloadStoreRegion,
      endpoint: payloadStoreEndpoint,
      forcePathStyle: payloadStoreForcePathStyle,
      credentials:
        payloadStoreAccessKey && payloadStoreSecretKey
          ? { accessKeyId: payloadStoreAccessKey, secretAccessKey: payloadStoreSecretKey }
          : undefined
    })
  : null;

function getRequestId(headers: Record<string, unknown>): string {
  const headerValue = headers['x-request-id'];
  return typeof headerValue === 'string' && headerValue.length > 0 ? headerValue : randomUUID();
}

function getTraceId(headers: Record<string, unknown>, fallback: string): string {
  const headerValue = headers['x-trace-id'];
  if (typeof headerValue === 'string' && headerValue.length > 0) {
    return headerValue;
  }
  const traceparent = headers['traceparent'];
  if (typeof traceparent === 'string' && traceparent.length > 0) {
    return traceparent;
  }
  return fallback;
}

function getRequestContext(request: { headers: Record<string, unknown> }) {
  const requestId = getRequestId(request.headers);
  const traceId = getTraceId(request.headers, requestId);
  return { requestId, traceId };
}

function getContext(request: { headers: Record<string, unknown> }) {
  const existing = (request as { context?: { requestId: string; traceId: string } }).context;
  return existing || getRequestContext(request);
}

function isOpenPath(pathname: string): boolean {
  return pathname === '/health' || pathname === '/health/live' || pathname === '/webhooks/stripe';
}

function sendError(
  reply: { status: (code: number) => { send: (payload: Record<string, unknown>) => unknown } },
  request: { headers: Record<string, unknown> },
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  const { requestId, traceId } = getContext(request);
  return reply.status(status).send({
    code,
    message,
    details: details || null,
    request_id: requestId,
    trace_id: traceId
  });
}

function isMutatingMethod(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

function requestNeedsExecAudience(pathname: string): boolean {
  return pathname.startsWith('/execute') || pathname.startsWith('/jobs');
}

async function verifyJwt(token: string, audience: string | undefined) {
  const encoder = new TextEncoder();
  if (jwtSharedSecret) {
    const key = encoder.encode(jwtSharedSecret);
    return jwtVerify(token, key, {
      issuer: jwtIssuer,
      audience
    });
  }

  if (jwtJwksUrl) {
    const jwks = createRemoteJWKSet(new URL(jwtJwksUrl));
    return jwtVerify(token, jwks, {
      issuer: jwtIssuer,
      audience
    });
  }

  throw new Error('jwt_not_configured');
}

async function issueImpersonationToken(params: {
  operatorId: string;
  tenantId: string;
  impersonatedSub?: string;
  impersonatedTid?: string;
  reason: string;
  ttlMinutes: number;
}) {
  if (!impersonationSecret) {
    throw new Error('impersonation_secret_not_configured');
  }
  const now = Math.floor(Date.now() / 1000);
  const exp = now + params.ttlMinutes * 60;
  const payload = new SignJWT({
    sub: params.impersonatedSub || params.operatorId,
    tid: params.impersonatedTid || params.tenantId,
    reason: params.reason,
    operator_id: params.operatorId
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer(jwtIssuer || 'orchestrator')
    .setAudience('orchestrator-impersonation');

  const token = await payload.sign(new TextEncoder().encode(impersonationSecret));
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

async function verifyImpersonationToken(token: string) {
  if (!impersonationSecret) {
    throw new Error('impersonation_secret_not_configured');
  }
  return jwtVerify(token, new TextEncoder().encode(impersonationSecret), {
    issuer: jwtIssuer || 'orchestrator',
    audience: 'orchestrator-impersonation'
  });
}

function requireScope(request: { user?: { scopes?: string[]; role?: string } }, scope: string): boolean {
  if (authMode !== 'enabled') {
    return true;
  }
  const scopes = getEffectiveScopes(request.user?.role, request.user?.scopes);
  return hasScopeFromRole(scopes, scope);
}

function getTenantId(request: { user?: AuthUser }): string {
  return request.user?.impersonatedTid || request.user?.tid || defaultTenantId;
}

function getActorId(request: { user?: AuthUser }): string | null {
  return request.user?.impersonatedSub || request.user?.sub || null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');
}

async function maybeStorePayload(
  payload: unknown,
  context: { tenantId: string; kind: string; contentType?: string }
): Promise<{ payloadJson: Record<string, unknown>; payloadRef: string | null }> {
  const body = JSON.stringify(payload ?? {});
  const sizeBytes = Buffer.byteLength(body);
  const hash = createHash('sha256').update(body).digest('hex');

  if (payloadStoreEnabled && payloadStoreClient && sizeBytes > payloadStoreThresholdBytes) {
    const key = `${payloadStorePrefix}/${context.tenantId}/${context.kind}/${randomUUID()}.json`;
    await payloadStoreClient.send(
      new PutObjectCommand({
        Bucket: payloadStoreBucket,
        Key: key,
        Body: body,
        ContentType: context.contentType || 'application/json',
        Metadata: {
          sha256: hash,
          tenant_id: context.tenantId,
          kind: context.kind
        }
      })
    );
    return {
      payloadJson: { stored: true, size_bytes: sizeBytes, sha256: hash },
      payloadRef: `s3://${payloadStoreBucket}/${key}`
    };
  }

  if (payload && typeof payload === 'object') {
    return { payloadJson: payload as Record<string, unknown>, payloadRef: null };
  }
  return { payloadJson: { value: payload, size_bytes: sizeBytes, sha256: hash }, payloadRef: null };
}

async function logEvent(params: {
  tenantId: string;
  severity: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
  correlationId?: string;
  traceId?: string | null;
}) {
  if (!pgPool) return;
  await pgPool.query(
    `INSERT INTO event_log (id, tenant_id, severity, type, message, data_json, correlation_id, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      params.tenantId,
      params.severity,
      params.type,
      params.message,
      params.data || {},
      params.correlationId || null,
      params.traceId || null
    ]
  );
}

async function logRequest(params: {
  tenantId: string;
  requestId: string;
  traceId?: string | null;
  actorType: string;
  actorId?: string | null;
  operation?: string | null;
  status: string;
  httpStatus: number;
  latencyMs: number;
  idempotencyKey?: string | null;
  retryCount?: number;
}) {
  if (!pgPool) return;
  await pgPool.query(
    `INSERT INTO request_log
     (id, tenant_id, request_id, trace_id, actor_type, actor_id, operation, status, http_status, latency_ms, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      randomUUID(),
      params.tenantId,
      params.requestId,
      params.traceId || null,
      params.actorType,
      params.actorId || null,
      params.operation || null,
      params.status,
      params.httpStatus,
      params.latencyMs,
      params.idempotencyKey || null
    ]
  );
}

async function logAudit(params: {
  operatorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  diff?: Record<string, unknown>;
  reason: string;
}) {
  if (!pgPool) return;
  await pgPool.query(
    `INSERT INTO operator_audit_log (id, operator_user_id, action, resource_type, resource_id, diff_json, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      params.operatorId,
      params.action,
      params.resourceType,
      params.resourceId,
      params.diff || {},
      params.reason
    ]
  );
}

async function resolveSecret(ref: string): Promise<string | null> {
  if (ref.startsWith('env://')) {
    const key = ref.slice('env://'.length);
    return process.env[key] || null;
  }
  return null;
}

function getRateLimitConfig(policySettings: Record<string, unknown> | null) {
  if (!policySettings) return null;
  const rateLimit = asObject((policySettings as { rate_limit_json?: unknown }).rate_limit_json);
  const maxRequests = typeof rateLimit.max_requests === 'number' ? rateLimit.max_requests : null;
  const intervalMs = typeof rateLimit.interval_ms === 'number' ? rateLimit.interval_ms : null;
  if (!maxRequests || !intervalMs || maxRequests <= 0 || intervalMs <= 0) {
    return null;
  }
  const scope = rateLimit.scope === 'tenant' ? 'tenant' : 'connector';
  return { maxRequests, intervalMs, scope };
}

async function checkRateLimit(tenantId: string, connectorId: string, policySettings: Record<string, unknown> | null) {
  if (!redis) return { allowed: true, limit: 0, remaining: 0, resetMs: 0 };
  const config = getRateLimitConfig(policySettings);
  if (!config) return { allowed: true, limit: 0, remaining: 0, resetMs: 0 };

  const key =
    config.scope === 'tenant' ? `rl:${tenantId}` : `rl:${tenantId}:${connectorId}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.pexpire(key, config.intervalMs);
  }
  const ttl = await redis.pttl(key);
  const remaining = Math.max(config.maxRequests - count, 0);
  return {
    allowed: count <= config.maxRequests,
    limit: config.maxRequests,
    remaining,
    resetMs: ttl > 0 ? ttl : config.intervalMs
  };
}

function getCircuitBreakerConfig(policySettings: Record<string, unknown> | null) {
  if (!policySettings) return null;
  const cb = asObject((policySettings as { circuit_breaker_json?: unknown }).circuit_breaker_json);
  const enabled =
    typeof cb.enabled === 'boolean' ? cb.enabled : Object.keys(cb).length > 0;
  if (!enabled) return null;
  const failureThreshold =
    typeof cb.failure_threshold === 'number' ? cb.failure_threshold : 5;
  const windowMs = typeof cb.window_ms === 'number' ? cb.window_ms : 60000;
  const openMs = typeof cb.open_ms === 'number' ? cb.open_ms : 30000;
  return { failureThreshold, windowMs, openMs };
}

async function isCircuitOpen(tenantId: string, connectorId: string, policySettings: Record<string, unknown> | null) {
  if (!redis) return false;
  const config = getCircuitBreakerConfig(policySettings);
  if (!config) return false;
  const openKey = `cb:${tenantId}:${connectorId}:open`;
  const isOpen = await redis.exists(openKey);
  return isOpen === 1;
}

async function recordCircuitResult(
  tenantId: string,
  connectorId: string,
  policySettings: Record<string, unknown> | null,
  success: boolean
) {
  if (!redis) return;
  const config = getCircuitBreakerConfig(policySettings);
  if (!config) return;

  const openKey = `cb:${tenantId}:${connectorId}:open`;
  if (success) {
    await redis.del(openKey);
    await redis.del(`cb:${tenantId}:${connectorId}:failures`);
    return;
  }

  const failureKey = `cb:${tenantId}:${connectorId}:failures`;
  const failures = await redis.incr(failureKey);
  if (failures === 1) {
    await redis.pexpire(failureKey, config.windowMs);
  }
  if (failures >= config.failureThreshold) {
    await redis.set(openKey, '1', 'PX', config.openMs);
    await redis.del(failureKey);
  }
}

function registerRoutes() {
  app.get('/health', async (request, reply) => {
    const pgOk = pgPool !== null ? await checkPostgres(pgPool) : false;
    const redisOk = redis !== null ? await checkRedis(redis) : false;

    if (!pgOk || !redisOk) {
      return reply.status(500).send({
        status: 'degraded',
        postgres: pgOk,
        redis: redisOk
      });
    }

    return reply.status(200).send({
      status: 'ok',
      postgres: true,
      redis: true
    });
  });

  app.get('/health/live', async () => {
    return { status: 'ok' };
  });

  if (process.env.ENABLE_TEST_ROUTES === 'true') {
    app.get('/__test/delay', async (request, reply) => {
      const query = request.query as { ms?: string };
      const ms = Math.min(Number(query.ms || 0), 30000);
      if (ms > 0) {
        await sleep(ms);
      }
      return reply.status(200).send({ delayed_ms: ms });
    });
  }

  app.post('/webhooks/stripe', { config: { rawBody: true } }, async (request, reply) => {
  const { requestId, traceId } = getContext(request as { headers: Record<string, unknown> });
  const startedAt = Date.now();
  if (!redis || !webhookQueue || !pgPool) {
    return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'infra_not_ready', 'infra_not_ready');
  }

  if (!stripeSecret) {
    return sendError(
      reply,
      request as { headers: Record<string, unknown> },
      500,
      'missing_stripe_secret',
      'missing_stripe_secret'
    );
  }

  const signature = request.headers['stripe-signature'];
  if (typeof signature !== 'string') {
    return sendError(
      reply,
      request as { headers: Record<string, unknown> },
      400,
      'missing_signature',
      'missing_signature'
    );
  }

  const raw = request.rawBody;
  if (!raw || !(raw instanceof Buffer)) {
    return sendError(
      reply,
      request as { headers: Record<string, unknown> },
      400,
      'missing_raw_body',
      'missing_raw_body'
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, stripeSecret);
  } catch (error) {
    app.log.warn({ error }, 'invalid stripe signature');
    return sendError(
      reply,
      request as { headers: Record<string, unknown> },
      400,
      'invalid_signature',
      'invalid_signature'
    );
  }

  const dedupeKey = `webhook:stripe:${event.id}`;
  const setResult = await (redis as unknown as { set: (...args: unknown[]) => Promise<string | null> }).set(
    dedupeKey,
    '1',
    'EX',
    60 * 60 * 24,
    'NX'
  );
  if (!setResult) {
    return reply.status(200).send({ received: true, duplicate: true });
  }

  const inboxId = randomUUID();
  const jobId = randomUUID();
  const { payloadJson: webhookPayloadBase, payloadRef: webhookPayloadRef } = await maybeStorePayload(event, {
    tenantId: defaultTenantId,
    kind: 'webhook/stripe'
  });
  const webhookPayload = { ...webhookPayloadBase, type: event.type, event_id: event.id };

  await pgPool.query(
    `INSERT INTO webhook_inbox (id, tenant_id, provider, event_id, signature_valid, status, payload_ref, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [inboxId, defaultTenantId, 'stripe', event.id, true, 'received', webhookPayloadRef, webhookPayload]
  );

  await pgPool.query(
    `INSERT INTO job (id, tenant_id, type, status, attempts, max_attempts, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [jobId, defaultTenantId, 'stripe.webhook', 'queued', 0, 4, { inboxId, eventId: event.id }]
  );

  await webhookQueue.add(
    'stripe.webhook',
    { jobId, inboxId, eventId: event.id, correlationId: requestId, traceId },
    { jobId, removeOnComplete: true }
  );

  await logEvent({
    tenantId: defaultTenantId,
    severity: 'info',
    type: 'webhook_received',
    message: 'Stripe webhook received',
    data: { inbox_id: inboxId, event_id: event.id, event_type: event.type },
    correlationId: requestId,
    traceId
  });
  await logEvent({
    tenantId: defaultTenantId,
    severity: 'info',
    type: 'job_enqueued',
    message: 'Webhook job enqueued',
    data: { job_id: jobId, queue: webhookQueueName },
    correlationId: requestId,
    traceId
  });
  await logRequest({
    tenantId: defaultTenantId,
    requestId,
    traceId,
    actorType: 'webhook',
    operation: 'webhooks.stripe',
    status: 'success',
    httpStatus: 200,
    latencyMs: Date.now() - startedAt
  });

  return reply.status(200).send({ received: true, duplicate: false, inbox_id: inboxId });
  });

  app.post('/jobs', async (request, reply) => {
    const { requestId, traceId } = getContext(request as { headers: Record<string, unknown> });
    const startedAt = Date.now();
    const tenantId = getTenantId(request);
    const actorId = getActorId(request);
    if (!pgPool || !jobQueue) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'infra_not_ready', 'infra_not_ready');
    }

    const body = request.body as {
      type?: string;
      payload?: Record<string, unknown>;
      run_at?: string | null;
      idempotency_key?: string;
    };

    if (!body?.type) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 400, 'missing_type', 'missing_type');
    }

    const jobId = randomUUID();
    const runAt = body.run_at ? new Date(body.run_at) : null;
    const maxAttempts = Number(process.env.DEFAULT_MAX_ATTEMPTS || 4);

    const { payloadJson, payloadRef } = await maybeStorePayload(body.payload || {}, {
      tenantId,
      kind: `job/${body.type}`
    });
    await pgPool.query(
      `INSERT INTO job (id, tenant_id, type, status, attempts, max_attempts, run_at, payload_json, payload_ref, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        jobId,
        tenantId,
        body.type,
        'queued',
        0,
        maxAttempts,
        runAt,
        payloadJson,
        payloadRef,
        body.idempotency_key || null
      ]
    );

    await jobQueue.add(
      body.type,
      { jobId, correlationId: requestId, traceId },
      { jobId, delay: runAt ? Math.max(runAt.getTime() - Date.now(), 0) : 0 }
    );

    await logEvent({
      tenantId,
      severity: 'info',
      type: 'job_enqueued',
      message: 'Job enqueued',
      data: { job_id: jobId, queue: defaultQueueName },
      correlationId: requestId,
      traceId
    });
    await logRequest({
      tenantId,
      requestId,
      traceId,
      actorType: 'api',
      actorId,
      operation: 'jobs.create',
      status: 'success',
      httpStatus: 202,
      latencyMs: Date.now() - startedAt,
      idempotencyKey: body.idempotency_key
    });

    return reply.status(202).send({
      job_id: jobId,
      status: 'queued',
      queued_at: new Date().toISOString()
    });
  });

  app.post('/execute', async (request, reply) => {
    const { requestId, traceId } = getContext(request as { headers: Record<string, unknown> });
    const startedAt = Date.now();
    const tenantId = getTenantId(request);
    const actorId = getActorId(request);
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const idempotencyHeader = request.headers['idempotency-key'];
    const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader : null;

    const body = request.body as {
      connector?: { id?: string };
      operation?: string;
      input?: Record<string, unknown>;
      options?: Record<string, unknown>;
    };

    if (!body?.connector?.id || !body.operation) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        400,
        'missing_connector_or_operation',
        'missing_connector_or_operation'
      );
    }

    const requestHash = hashPayload(body);
    if (idempotencyKey) {
      const existing = await pgPool.query(
        `SELECT request_hash, response_json FROM idempotency_cache WHERE tenant_id = $1 AND idempotency_key = $2`,
        [tenantId, idempotencyKey]
      );
      if ((existing.rowCount ?? 0) > 0) {
        const row = existing.rows[0] as { request_hash: string; response_json: Record<string, unknown> };
        if (row.request_hash !== requestHash) {
          return sendError(
            reply,
            request as { headers: Record<string, unknown> },
            409,
            'IDEMPOTENCY_CONFLICT',
            'IDEMPOTENCY_CONFLICT'
          );
        }

        const cached = row.response_json || {};
        const responsePayload = {
          ...cached,
          idempotency: { ...(cached as { idempotency?: Record<string, unknown> }).idempotency, key: idempotencyKey, replayed: true },
          request_id: requestId
        };

        await logRequest({
          tenantId,
          requestId,
          traceId,
          actorType: 'api',
          actorId,
          operation: 'execute',
          status: 'success',
          httpStatus: 200,
          latencyMs: Date.now() - startedAt,
          idempotencyKey
        });

        return reply.status(200).send(responsePayload);
      }
    }

    const connectorRes = await pgPool.query('SELECT * FROM connector WHERE id = $1 AND tenant_id = $2', [
      body.connector.id,
      tenantId
    ]);
    if (connectorRes.rowCount === 0) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        404,
        'CONNECTOR_NOT_FOUND',
        'CONNECTOR_NOT_FOUND'
      );
    }

    const connector = connectorRes.rows[0] as {
      id: string;
      type: string;
      settings_json: Record<string, unknown>;
      secret_ref_id: string | null;
      policy_id: string | null;
    };

    let output: Record<string, unknown> | null = null;
    let upstreamStatus = 0;
    let retryCount = 0;
    let lastErrorWasTimeout = false;

    const policy = connector.policy_id
      ? await pgPool.query('SELECT * FROM policy WHERE id = $1 AND tenant_id = $2', [connector.policy_id, tenantId])
      : { rowCount: 0, rows: [] };
    const policySettings = (policy.rowCount ?? 0) > 0 ? policy.rows[0] : null;
    const retryJson = asObject((policySettings as { retry_json?: unknown })?.retry_json);
    const timeoutJson = asObject((policySettings as { timeout_json?: unknown })?.timeout_json);
    const maxAttempts =
      typeof retryJson.max_attempts === 'number' ? retryJson.max_attempts : Number(process.env.DEFAULT_MAX_ATTEMPTS || 4);
    const baseBackoffMs = typeof retryJson.base_ms === 'number' ? retryJson.base_ms : 250;
    const maxBackoffMs = typeof retryJson.max_ms === 'number' ? retryJson.max_ms : 5000;
    const timeoutCandidate = typeof timeoutJson.total_ms === 'number'
      ? timeoutJson.total_ms
      : Number(timeoutJson.total_ms);
    const timeoutMs = Number.isFinite(timeoutCandidate) && timeoutCandidate > 0 ? timeoutCandidate : 15000;

    const rateLimit = await checkRateLimit(tenantId, connector.id, policySettings);
    if (!rateLimit.allowed) {
      const rateKey = `${tenantId}|${connector.id}`;
      metrics.rateLimitedTotal.set(rateKey, (metrics.rateLimitedTotal.get(rateKey) || 0) + 1);
      await logRequest({
        tenantId,
        requestId,
        traceId,
        actorType: 'api',
        actorId,
        operation: 'execute',
        status: 'rate_limited',
        httpStatus: 429,
        latencyMs: Date.now() - startedAt,
        idempotencyKey
      });
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        429,
        'RATE_LIMITED',
        'RATE_LIMITED',
        { limit: rateLimit.limit, remaining: rateLimit.remaining, reset_ms: rateLimit.resetMs }
      );
    }

    if (await isCircuitOpen(tenantId, connector.id, policySettings)) {
      const circuitKey = `${tenantId}|${connector.id}`;
      metrics.circuitOpenTotal.set(circuitKey, (metrics.circuitOpenTotal.get(circuitKey) || 0) + 1);
      await logRequest({
        tenantId,
        requestId,
        traceId,
        actorType: 'api',
        actorId,
        operation: 'execute',
        status: 'circuit_open',
        httpStatus: 503,
        latencyMs: Date.now() - startedAt,
        idempotencyKey
      });
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        503,
        'CIRCUIT_OPEN',
        'CIRCUIT_OPEN'
      );
    }

    if (connector.type === 'http') {
      const settings = connector.settings_json || {};
      const baseUrl = typeof settings.base_url === 'string' ? settings.base_url : '';
      const operationPath = body.operation || '';
      const urlFromOptions = body.options && typeof (body.options as { url?: string }).url === 'string'
        ? (body.options as { url: string }).url
        : '';
      const url = urlFromOptions || `${baseUrl}${operationPath}`;
      const method =
        body.options && typeof (body.options as { method?: string }).method === 'string'
          ? (body.options as { method: string }).method
          : typeof settings.method === 'string'
            ? settings.method
            : 'POST';

      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (connector.secret_ref_id) {
        const secretRes = await pgPool.query('SELECT ref FROM secret_ref WHERE id = $1 AND tenant_id = $2', [
          connector.secret_ref_id,
          tenantId
        ]);
        if ((secretRes.rowCount ?? 0) > 0) {
          const secret = await resolveSecret(secretRes.rows[0].ref as string);
          if (secret) {
            const authHeader = typeof settings.auth_header === 'string' ? settings.auth_header : 'authorization';
            headers[authHeader] = `Bearer ${secret}`;
          }
        }
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const attemptTimeoutMs =
          body.options && typeof (body.options as { timeout_ms?: number }).timeout_ms === 'number'
            ? (body.options as { timeout_ms: number }).timeout_ms
            : timeoutMs;
        const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
        try {
          const sendBody = method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD';
          const upstream = await fetch(url, {
            method,
            headers,
            body: sendBody ? JSON.stringify(body.input ?? {}) : undefined,
            signal: controller.signal
          });
          upstreamStatus = upstream.status;
          const text = await upstream.text();
          output = {
            http_status: upstreamStatus,
            body: text
          };

          const retriable = upstreamStatus === 408 || upstreamStatus === 429 || upstreamStatus >= 500;
          if (!retriable || attempt === maxAttempts) {
            break;
          }
        } catch (error) {
          const err = error as Error;
          const errMessage = err.message || 'request_error';
          lastErrorWasTimeout =
            err.name === 'AbortError' || errMessage.toLowerCase().includes('aborted');
          output = { error: errMessage };
          if (attempt === maxAttempts) {
            break;
          }
        } finally {
          clearTimeout(timeout);
        }

        retryCount += 1;
        const backoff = Math.min(baseBackoffMs * Math.pow(2, attempt - 1), maxBackoffMs);
        const jitter = Math.floor(Math.random() * 100);
        await sleep(backoff + jitter);
      }
    } else {
      output = { error: 'unsupported_connector_type' };
    }

    if (lastErrorWasTimeout) {
      await logRequest({
        tenantId,
        requestId,
        traceId,
        actorType: 'api',
        actorId,
        operation: 'execute',
        status: 'timeout',
        httpStatus: 504,
        latencyMs: Date.now() - startedAt,
        idempotencyKey,
        retryCount
      });
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        504,
        'upstream_timeout',
        'upstream_timeout'
      );
    }

    const failure =
      !output ||
      (typeof output.http_status === 'number' && (output.http_status === 408 || output.http_status === 429 || output.http_status >= 500)) ||
      (typeof output.error === 'string' && output.error.length > 0);
    await recordCircuitResult(tenantId, connector.id, policySettings, !failure);

    if (retryCount > 0) {
      const retryKey = `${tenantId}|${connector.id}`;
      metrics.retriesTotal.set(retryKey, (metrics.retriesTotal.get(retryKey) || 0) + retryCount);
    }

    const responsePayload = {
      status: 'ok',
      output,
      latency_ms: Date.now() - startedAt,
      attempts: 1 + retryCount,
      idempotency: { key: idempotencyKey, replayed: false },
      request_id: requestId
    };

    if (idempotencyKey) {
      await pgPool.query(
        `INSERT INTO idempotency_cache (id, tenant_id, idempotency_key, request_hash, response_json)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
        [randomUUID(), tenantId, idempotencyKey, requestHash, responsePayload]
      );
    }

    await logRequest({
      tenantId,
      requestId,
      traceId,
      actorType: 'api',
      actorId,
      operation: 'execute',
      status: 'success',
      httpStatus: 200,
      latencyMs: Date.now() - startedAt,
      idempotencyKey,
      retryCount
    });

    return reply.status(200).send(responsePayload);
  });

  app.get('/jobs/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const jobId = (request.params as { id: string }).id;
    const jobRes = await pgPool.query('SELECT * FROM job WHERE id = $1 AND tenant_id = $2', [jobId, tenantId]);
    if (jobRes.rowCount === 0) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 404, 'job_not_found', 'job_not_found');
    }

    const runsRes = await pgPool.query(
      'SELECT * FROM run WHERE job_id = $1 AND tenant_id = $2 ORDER BY started_at',
      [jobId, tenantId]
    );
    return reply.status(200).send({ job: jobRes.rows[0], runs: runsRes.rows });
  });

  app.get('/events', async (request, reply) => {
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const query = request.query as {
      tenant_id?: string;
      type?: string;
      severity?: string;
      trace_id?: string;
      limit?: string;
      since?: string;
    };

    const tenantId = query.tenant_id || getTenantId(request);
    const limit = Math.min(Number(query.limit || 50), 200);
    const params: Array<string | number> = [tenantId, limit];
    let where = 'tenant_id = $1';

    if (query.type) {
      params.push(query.type);
      where += ` AND type = $${params.length}`;
    }
    if (query.severity) {
      params.push(query.severity);
      where += ` AND severity = $${params.length}`;
    }
    if (query.since) {
      params.push(query.since);
      where += ` AND created_at >= $${params.length}`;
    }
    if (query.trace_id) {
      params.push(query.trace_id);
      where += ` AND trace_id = $${params.length}`;
    }

    const result = await pgPool.query(
      `SELECT * FROM event_log WHERE ${where} ORDER BY created_at DESC LIMIT $2`,
      params
    );
    return reply.status(200).send({ events: result.rows });
  });

  app.get('/events/stream', async (request, reply) => {
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const query = request.query as {
      tenant_id?: string;
      type?: string;
      severity?: string;
      trace_id?: string;
      since?: string;
    };
    const tenantId = query.tenant_id || getTenantId(request);
    const lastEventId = typeof request.headers['last-event-id'] === 'string' ? request.headers['last-event-id'] : null;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    let lastSeen = query.since ? new Date(query.since) : new Date();
    if (lastEventId) {
      const res = await pgPool.query('SELECT created_at FROM event_log WHERE id = $1', [lastEventId]);
      if ((res.rowCount ?? 0) > 0) {
        lastSeen = new Date(res.rows[0].created_at);
      }
    }

    const interval = setInterval(async () => {
      const params: Array<string> = [tenantId, lastSeen.toISOString()];
      let where = 'tenant_id = $1 AND created_at > $2';
      if (query.type) {
        params.push(query.type);
        where += ` AND type = $${params.length}`;
      }
      if (query.severity) {
        params.push(query.severity);
        where += ` AND severity = $${params.length}`;
      }
      if (query.trace_id) {
        params.push(query.trace_id);
        where += ` AND trace_id = $${params.length}`;
      }

      const result = await pgPool.query(
        `SELECT * FROM event_log WHERE ${where} ORDER BY created_at ASC LIMIT 100`,
        params
      );
      for (const row of result.rows) {
        lastSeen = new Date(row.created_at);
        const payload = JSON.stringify({
          event_id: row.id,
          ts: row.created_at,
          tenant_id: row.tenant_id,
          severity: row.severity,
          type: row.type,
          message: row.message,
          correlation_id: row.correlation_id,
          trace_id: row.trace_id,
          data: row.data_json
        });
        reply.raw.write(`id: ${row.id}\\n`);
        reply.raw.write(`data: ${payload}\\n\\n`);
      }
    }, 1000);

    request.raw.on('close', () => {
      clearInterval(interval);
    });
  });

  app.get('/admin/dlq', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.admin')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!redis) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'redis_not_configured', 'redis_not_configured');
    }

    const queueNames = [defaultQueueName, webhookQueueName];
    const results = [];
    for (const name of queueNames) {
      const queue = new Queue(name, { connection: redis });
      const dead = await queue.getJobs(['failed'], 0, 100);
      results.push({
        queue: name,
        jobs: dead.map((job) => ({ id: job.id, name: job.name, attemptsMade: job.attemptsMade }))
      });
    }

    return reply.status(200).send({ queues: results });
  });

  app.post('/admin/impersonation/issue', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.admin')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!impersonationSecret) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        500,
        'impersonation_secret_not_configured',
        'impersonation_secret_not_configured'
      );
    }

    const body = request.body as {
      impersonate_sub?: string;
      impersonate_tenant?: string;
      reason?: string;
      ttl_minutes?: number;
    };
    if (!body?.reason) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        400,
        'missing_reason',
        'missing_reason'
      );
    }
    if (body.impersonate_sub && !isUuid(body.impersonate_sub)) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        400,
        'invalid_impersonate_sub',
        'invalid_impersonate_sub'
      );
    }
    if (body.impersonate_tenant && !isUuid(body.impersonate_tenant)) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        400,
        'invalid_impersonate_tenant',
        'invalid_impersonate_tenant'
      );
    }

    const operatorId = request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
    const ttlMinutes =
      typeof body.ttl_minutes === 'number' && body.ttl_minutes > 0 ? body.ttl_minutes : impersonationTtlMinutes;
    const { token, expiresAt } = await issueImpersonationToken({
      operatorId,
      tenantId: getTenantId(request),
      impersonatedSub: body.impersonate_sub,
      impersonatedTid: body.impersonate_tenant,
      reason: body.reason,
      ttlMinutes
    });

    await logAudit({
      operatorId,
      action: 'impersonation.issue',
      resourceType: 'tenant',
      resourceId: body.impersonate_tenant || body.impersonate_sub || defaultTenantId,
      diff: { impersonated_sub: body.impersonate_sub || null, impersonated_tenant: body.impersonate_tenant || null },
      reason: body.reason
    });

    return reply.status(201).send({ token, expires_at: expiresAt, ttl_minutes: ttlMinutes });
  });

  app.post('/admin/impersonation/stop', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.admin')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    const body = request.body as { reason?: string };
    if (!body?.reason) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        400,
        'missing_reason',
        'missing_reason'
      );
    }

    const operatorId = request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
    await logAudit({
      operatorId,
      action: 'impersonation.stop',
      resourceType: 'request',
      resourceId: request.raw.url || 'unknown',
      diff: {},
      reason: body.reason
    });

    return reply.status(200).send({ status: 'stopped' });
  });

  app.post('/admin/dlq/replay', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.admin')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!redis || !pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'infra_not_ready', 'infra_not_ready');
    }

    const body = request.body as { queue?: string; job_id?: string; reason?: string };
    if (!body?.queue || !body?.job_id || !body?.reason) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        400,
        'missing_queue_job_or_reason',
        'missing_queue_job_or_reason'
      );
    }

    const queue = new Queue(body.queue, { connection: redis });
    const job = await queue.getJob(body.job_id);
    if (!job) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 404, 'job_not_found', 'job_not_found');
    }

    await job.retry();
    const operatorId = request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
    await logAudit({
      operatorId,
      action: 'dlq.replay',
      resourceType: 'job',
      resourceId: String(body.job_id),
      diff: { queue: body.queue },
      reason: body.reason
    });

    return reply.status(200).send({ status: 'replayed', job_id: body.job_id });
  });

  app.post('/admin/dlq/purge', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.admin')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!redis || !pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'infra_not_ready', 'infra_not_ready');
    }

    const body = request.body as { queue?: string; reason?: string };
    if (!body?.queue || !body?.reason) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 400, 'missing_queue_or_reason', 'missing_queue_or_reason');
    }

    const queue = new Queue(body.queue, { connection: redis });
    const removed = await queue.clean(0, 1000, 'failed');
    const operatorId = request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
    await logAudit({
      operatorId,
      action: 'dlq.purge',
      resourceType: 'queue',
      resourceId: body.queue,
      diff: { removed: removed.length },
      reason: body.reason
    });

    return reply.status(200).send({ status: 'purged', removed: removed.length });
  });

  app.get('/audit-logs', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.read')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const query = request.query as { operator_id?: string; action?: string; limit?: string };
    const tenantId = getTenantId(request);
    const limit = Math.min(Number(query.limit || 50), 200);
    const params: Array<string | number> = [tenantId, limit];
    let where = 'tenant_id = $1';

    if (query.operator_id) {
      params.push(query.operator_id);
      where += ` AND operator_user_id = $${params.length}`;
    }
    if (query.action) {
      params.push(query.action);
      where += ` AND action = $${params.length}`;
    }

    const result = await pgPool.query(
      `SELECT * FROM operator_audit_log WHERE ${where} ORDER BY created_at DESC LIMIT $2`,
      params
    );
    return reply.status(200).send({ audits: result.rows });
  });

  app.get('/metrics', async (request, reply) => {
    const lines: string[] = [];
    for (const [key, value] of metrics.httpRequestsTotal.entries()) {
      const [route, method, status] = key.split('|');
      lines.push(
        `orchestrator_http_requests_total{route="${route}",method="${method}",status="${status}"} ${value}`
      );
    }
    for (const [key, value] of metrics.httpErrorsTotal.entries()) {
      const [route, method, status] = key.split('|');
      lines.push(
        `orchestrator_http_errors_total{route="${route}",method="${method}",status="${status}"} ${value}`
      );
    }
    for (const [key, value] of metrics.rateLimitedTotal.entries()) {
      const [tenantId, connectorId] = key.split('|');
      lines.push(
        `orchestrator_rate_limited_total{tenant_id="${tenantId}",connector_id="${connectorId}"} ${value}`
      );
    }
    for (const [key, value] of metrics.circuitOpenTotal.entries()) {
      const [tenantId, connectorId] = key.split('|');
      lines.push(
        `orchestrator_circuit_open_total{tenant_id="${tenantId}",connector_id="${connectorId}"} ${value}`
      );
    }
    for (const [key, value] of metrics.retriesTotal.entries()) {
      const [tenantId, connectorId] = key.split('|');
      lines.push(
        `orchestrator_retry_total{tenant_id="${tenantId}",connector_id="${connectorId}"} ${value}`
      );
    }
    if (jobQueue) {
      const counts = await jobQueue.getJobCounts('waiting', 'active', 'delayed', 'failed');
      for (const [state, value] of Object.entries(counts)) {
        lines.push(`orchestrator_queue_depth{queue="${defaultQueueName}",state="${state}"} ${value}`);
      }
    }
    if (webhookQueue) {
      const counts = await webhookQueue.getJobCounts('waiting', 'active', 'delayed', 'failed');
      for (const [state, value] of Object.entries(counts)) {
        lines.push(`orchestrator_queue_depth{queue="${webhookQueueName}",state="${state}"} ${value}`);
      }
    }
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return reply.send(lines.join('\n'));
  });

  app.post('/configs', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.write')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const tenantId = getTenantId(request);
    const body = request.body as { name?: string; config?: Record<string, unknown>; reason?: string };
    if (!body?.name || !body?.config || !body?.reason) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        400,
        'missing_name_config_or_reason',
        'missing_name_config_or_reason'
      );
    }

    const versionRes = await pgPool.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM orchestrator_config WHERE tenant_id = $1 AND name = $2`,
      [tenantId, body.name]
    );
    const version = Number(versionRes.rows[0]?.next_version || 1);
    const configId = randomUUID();
    await pgPool.query(
      `INSERT INTO orchestrator_config (id, tenant_id, name, version, config_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [configId, tenantId, body.name, version, body.config]
    );

    const operatorId = request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
    await logAudit({
      operatorId,
      action: 'config.create',
      resourceType: 'orchestrator_config',
      resourceId: configId,
      diff: { name: body.name, version },
      reason: body.reason
    });

    return reply.status(201).send({ id: configId, name: body.name, version });
  });

  app.post('/configs/activate', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.write')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const tenantId = getTenantId(request);
    const body = request.body as { name?: string; config_id?: string; reason?: string };
    if (!body?.name || !body?.config_id || !body?.reason) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        400,
        'missing_name_config_or_reason',
        'missing_name_config_or_reason'
      );
    }

    const configRes = await pgPool.query(
      'SELECT id FROM orchestrator_config WHERE id = $1 AND tenant_id = $2 AND name = $3',
      [body.config_id, tenantId, body.name]
    );
    if ((configRes.rowCount ?? 0) === 0) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 404, 'config_not_found', 'config_not_found');
    }

    await pgPool.query(
      `INSERT INTO config_pointer (tenant_id, name, config_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, name)
       DO UPDATE SET config_id = EXCLUDED.config_id, updated_at = now()`,
      [tenantId, body.name, body.config_id]
    );

    const operatorId = request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
    await logAudit({
      operatorId,
      action: 'config.activate',
      resourceType: 'config_pointer',
      resourceId: body.config_id,
      diff: { name: body.name },
      reason: body.reason
    });

    return reply.status(200).send({ status: 'active', config_id: body.config_id });
  });

  app.get('/configs', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.read')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const tenantId = getTenantId(request);
    const query = request.query as { name?: string };
    const params: Array<string> = [tenantId];
    let where = 'tenant_id = $1';
    if (query.name) {
      params.push(query.name);
      where += ` AND name = $${params.length}`;
    }
    const result = await pgPool.query(
      `SELECT * FROM orchestrator_config WHERE ${where} ORDER BY created_at DESC`,
      params
    );
    return reply.status(200).send({ configs: result.rows });
  });

  app.get('/configs/active', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.read')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const tenantId = getTenantId(request);
    const query = request.query as { name?: string };
    if (!query.name) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 400, 'missing_name', 'missing_name');
    }

    const result = await pgPool.query(
      `SELECT cp.name, cp.config_id, oc.version, oc.config_json, oc.created_at
       FROM config_pointer cp
       JOIN orchestrator_config oc ON oc.id = cp.config_id
       WHERE cp.tenant_id = $1 AND cp.name = $2`,
      [tenantId, query.name]
    );
    if ((result.rowCount ?? 0) === 0) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 404, 'config_not_active', 'config_not_active');
    }
    return reply.status(200).send({ active: result.rows[0] });
  });

  app.post('/connectors', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.write')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const tenantId = getTenantId(request);
    const body = request.body as {
      type?: string;
      name?: string;
      settings?: Record<string, unknown>;
      secret_ref_id?: string | null;
      policy_id?: string | null;
      reason?: string;
    };

    if (!body?.type || !body?.name || !body?.reason) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 400, 'missing_type_or_name', 'missing_type_or_name');
    }

    const connectorId = randomUUID();
    await pgPool.query(
      `INSERT INTO connector (id, tenant_id, type, name, status, settings_json, secret_ref_id, policy_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        connectorId,
        tenantId,
        body.type,
        body.name,
        'active',
        body.settings || {},
        body.secret_ref_id || null,
        body.policy_id || null
      ]
    );

    const operatorId = request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
    await logAudit({
      operatorId,
      action: 'connector.create',
      resourceType: 'connector',
      resourceId: connectorId,
      diff: { type: body.type, name: body.name, policy_id: body.policy_id || null },
      reason: body.reason
    });

    await logEvent({
      tenantId,
      severity: 'info',
      type: 'connector_created',
      message: 'Connector created',
      data: { connector_id: connectorId, type: body.type, name: body.name }
    });

    return reply.status(201).send({ id: connectorId });
  });

  app.get('/connectors', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.read')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const tenantId = getTenantId(request);
    const result = await pgPool.query('SELECT * FROM connector WHERE tenant_id = $1 ORDER BY created_at DESC', [
      tenantId
    ]);
    return reply.status(200).send({ connectors: result.rows });
  });

  app.post('/secret-refs', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.write')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const tenantId = getTenantId(request);
    const body = request.body as { provider?: string; ref?: string; version?: string; reason?: string };
    if (!body?.provider || !body?.ref || !body?.reason) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        400,
        'missing_provider_ref_or_reason',
        'missing_provider_ref_or_reason'
      );
    }

    const secretId = randomUUID();
    await pgPool.query(
      `INSERT INTO secret_ref (id, tenant_id, provider, ref, version)
       VALUES ($1, $2, $3, $4, $5)`,
      [secretId, tenantId, body.provider, body.ref, body.version || null]
    );

    const operatorId = request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
    await logAudit({
      operatorId,
      action: 'secret_ref.create',
      resourceType: 'secret_ref',
      resourceId: secretId,
      diff: { provider: body.provider, ref: body.ref, version: body.version || null },
      reason: body.reason
    });

    return reply.status(201).send({ id: secretId });
  });

  app.get('/secret-refs', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.read')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const tenantId = getTenantId(request);
    const result = await pgPool.query('SELECT * FROM secret_ref WHERE tenant_id = $1 ORDER BY created_at DESC', [
      tenantId
    ]);
    return reply.status(200).send({ secret_refs: result.rows });
  });

  app.post('/policies', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.write')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const tenantId = getTenantId(request);
    const body = request.body as {
      name?: string;
      rate_limit_json?: Record<string, unknown>;
      retry_json?: Record<string, unknown>;
      timeout_json?: Record<string, unknown>;
      circuit_breaker_json?: Record<string, unknown>;
      concurrency_json?: Record<string, unknown>;
      reason?: string;
    };

    if (!body?.name || !body?.reason) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 400, 'missing_name_or_reason', 'missing_name_or_reason');
    }

    const policyId = randomUUID();
    await pgPool.query(
      `INSERT INTO policy (id, tenant_id, name, rate_limit_json, retry_json, timeout_json, circuit_breaker_json, concurrency_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        policyId,
        tenantId,
        body.name,
        body.rate_limit_json || {},
        body.retry_json || {},
        body.timeout_json || {},
        body.circuit_breaker_json || {},
        body.concurrency_json || {}
      ]
    );

    const operatorId = request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
    await logAudit({
      operatorId,
      action: 'policy.create',
      resourceType: 'policy',
      resourceId: policyId,
      diff: { name: body.name },
      reason: body.reason
    });

    return reply.status(201).send({ id: policyId });
  });

  app.get('/policies', async (request, reply) => {
    if (!requireScope(request, 'orchestrator.control.read')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 403, 'forbidden', 'forbidden');
    }
    if (!pgPool) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 500, 'db_not_configured', 'db_not_configured');
    }

    const tenantId = getTenantId(request);
    const result = await pgPool.query('SELECT * FROM policy WHERE tenant_id = $1 ORDER BY created_at DESC', [
      tenantId
    ]);
    return reply.status(200).send({ policies: result.rows });
  });
}

async function checkPostgres(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    app.log.error({ error }, 'postgres healthcheck failed');
    return false;
  }
}

async function checkRedis(client: Redis): Promise<boolean> {
  try {
    const result = await client.ping();
    return result === 'PONG';
  } catch (error) {
    app.log.error({ error }, 'redis healthcheck failed');
    return false;
  }
}

async function start() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';

  app.addHook('onRequest', async (request, reply) => {
    const context = getRequestContext(request as { headers: Record<string, unknown> });
    (request as { context?: { requestId: string; traceId: string } }).context = context;
    request.log = request.log.child({ request_id: context.requestId, trace_id: context.traceId });
    reply.header('x-request-id', context.requestId);
    reply.header('x-trace-id', context.traceId);
    request.log.info({ method: request.method, url: request.url }, 'request_received');

    if (authMode !== 'enabled') return;
    const pathname = request.raw.url?.split('?')[0] || '';
    if (isOpenPath(pathname)) return;

    if (apiMode === 'control' && requestNeedsExecAudience(pathname)) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 404, 'not_found', 'not_found');
    }
    if (
      apiMode === 'exec' &&
      (pathname.startsWith('/admin') || pathname.startsWith('/events') || pathname.startsWith('/webhooks') || pathname.startsWith('/metrics'))
    ) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 404, 'not_found', 'not_found');
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return sendError(reply, request as { headers: Record<string, unknown> }, 401, 'auth_required', 'auth_required');
    }

    const token = authHeader.slice('Bearer '.length);
    const audience = requestNeedsExecAudience(pathname) ? jwtAudienceExec : jwtAudienceControl;
    try {
      const { payload } = await verifyJwt(token, audience);
      request.user = {
        sub: payload.sub,
        scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
        tid: typeof payload.tid === 'string' ? payload.tid : undefined,
        role: typeof payload.role === 'string' ? payload.role : undefined
      };
    } catch (error) {
      app.log.warn({ error }, 'jwt verification failed');
      return sendError(reply, request as { headers: Record<string, unknown> }, 401, 'invalid_token', 'invalid_token');
    }

    if (request.user?.role === 'BreakGlassAdmin' && isMutatingMethod(request.method)) {
      const reasonHeader = request.headers['x-breakglass-reason'];
      const reason = typeof reasonHeader === 'string' && reasonHeader.length > 0 ? reasonHeader : null;
      if (!reason) {
        return sendError(
          reply,
          request as { headers: Record<string, unknown> },
          403,
          'breakglass_reason_required',
          'breakglass_reason_required'
        );
      }
      const operatorId = request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
      await logAudit({
        operatorId,
        action: 'breakglass',
        resourceType: 'request',
        resourceId: request.raw.url || 'unknown',
        diff: { method: request.method },
        reason
      });
    }

    const impersonationTokenHeader = request.headers['x-impersonation-token'];
    const impersonateSubHeader = request.headers['x-impersonate-sub'];
    const impersonateTenantHeader = request.headers['x-impersonate-tenant'];

    if ((impersonateSubHeader || impersonateTenantHeader) && !impersonationHeadersAllowed) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        403,
        'impersonation_headers_disabled',
        'impersonation_headers_disabled'
      );
    }

    if (impersonationTokenHeader) {
      if (!requireScope(request, 'orchestrator.impersonate') && !requireScope(request, 'orchestrator.admin')) {
        return sendError(
          reply,
          request as { headers: Record<string, unknown> },
          403,
          'impersonation_forbidden',
          'impersonation_forbidden'
        );
      }
      if (typeof impersonationTokenHeader !== 'string') {
        return sendError(
          reply,
          request as { headers: Record<string, unknown> },
          400,
          'invalid_impersonation_token',
          'invalid_impersonation_token'
        );
      }
      try {
        const { payload } = await verifyImpersonationToken(impersonationTokenHeader);
        const impersonatedSub = typeof payload.sub === 'string' ? payload.sub : undefined;
        const impersonatedTid = typeof payload.tid === 'string' ? payload.tid : undefined;
        const reason = typeof payload.reason === 'string' ? payload.reason : 'not_provided';

        request.user = {
          ...(request.user as AuthUser),
          impersonatedSub,
          impersonatedTid,
          tid: impersonatedTid || (request.user as AuthUser).tid
        };

        const operatorId =
          request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
        await logAudit({
          operatorId,
          action: 'impersonation.start',
          resourceType: 'tenant',
          resourceId: impersonatedTid || impersonatedSub || defaultTenantId,
          diff: { impersonated_sub: impersonatedSub || null, impersonated_tenant: impersonatedTid || null },
          reason
        });
      } catch (error) {
        app.log.warn({ error }, 'invalid impersonation token');
        return sendError(
          reply,
          request as { headers: Record<string, unknown> },
          401,
          'invalid_impersonation_token',
          'invalid_impersonation_token'
        );
      }
    } else if (impersonateSubHeader || impersonateTenantHeader) {
      if (!requireScope(request, 'orchestrator.impersonate') && !requireScope(request, 'orchestrator.admin')) {
        return sendError(
          reply,
          request as { headers: Record<string, unknown> },
          403,
          'impersonation_forbidden',
          'impersonation_forbidden'
        );
      }

      const impersonatedSub = typeof impersonateSubHeader === 'string' ? impersonateSubHeader : undefined;
      const impersonatedTid = typeof impersonateTenantHeader === 'string' ? impersonateTenantHeader : undefined;

      if (impersonatedSub && !isUuid(impersonatedSub)) {
        return sendError(
          reply,
          request as { headers: Record<string, unknown> },
          400,
          'invalid_impersonate_sub',
          'invalid_impersonate_sub'
        );
      }
      if (impersonatedTid && !isUuid(impersonatedTid)) {
        return sendError(
          reply,
          request as { headers: Record<string, unknown> },
          400,
          'invalid_impersonate_tenant',
          'invalid_impersonate_tenant'
        );
      }

      request.user = {
        ...(request.user as AuthUser),
        impersonatedSub: impersonatedSub || undefined,
        impersonatedTid: impersonatedTid || undefined,
        tid: impersonatedTid || (request.user as AuthUser).tid
      };

      const operatorId =
        request.user?.sub && isUuid(request.user.sub) ? request.user.sub : defaultTenantId;
      const reasonHeader = request.headers['x-impersonate-reason'];
      const reason = typeof reasonHeader === 'string' && reasonHeader.length > 0 ? reasonHeader : 'not_provided';
      await logAudit({
        operatorId,
        action: 'impersonation.start',
        resourceType: 'tenant',
        resourceId: impersonatedTid || impersonatedSub || defaultTenantId,
        diff: { impersonated_sub: impersonatedSub || null, impersonated_tenant: impersonatedTid || null },
        reason
      });
    }
  });

  await app.register(rawBody as unknown as FastifyPluginAsync, {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true
  } as unknown as Record<string, unknown>);
  registerRoutes();

  app.setNotFoundHandler((request, reply) => {
    return sendError(reply, request as { headers: Record<string, unknown> }, 404, 'not_found', 'not_found');
  });

  app.setErrorHandler((error, request, reply) => {
    const statusValue = (error as { statusCode?: number }).statusCode;
    const status = typeof statusValue === 'number' ? statusValue : 500;
    const code = status === 500 ? 'internal_error' : 'request_error';
    const message = status === 500 ? 'internal_error' : (error instanceof Error ? error.message : 'request_error');
    app.log.error({ error }, 'request_error');
    if (!reply.sent) {
      return sendError(
        reply,
        request as { headers: Record<string, unknown> },
        status,
        code,
        message,
        status === 500 ? undefined : { message: error instanceof Error ? error.message : 'request_error' }
      );
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions?.url || request.raw.url || 'unknown';
    const method = request.method;
    const status = reply.statusCode;
    const key = metricKey(route, method, status);
    metrics.httpRequestsTotal.set(key, (metrics.httpRequestsTotal.get(key) || 0) + 1);
    if (status >= 400) {
      metrics.httpErrorsTotal.set(key, (metrics.httpErrorsTotal.get(key) || 0) + 1);
    }
    request.log.info({ status }, 'request_completed');
  });

  if (pgPool && idempotencyTtlHours > 0) {
    setInterval(async () => {
      await pgPool.query(
        `DELETE FROM idempotency_cache WHERE created_at < now() - ($1 || ' hours')::interval`,
        [idempotencyTtlHours]
      );
    }, 60 * 60 * 1000);
  }

  await app.listen({ port, host });
}

start().catch((error) => {
  app.log.error({ error }, 'failed to start server');
  process.exit(1);
});

process.on('SIGINT', async () => {
  await shutdown();
});

process.on('SIGTERM', async () => {
  await shutdown();
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    await app.close();
  } catch (error) {
    app.log.error({ error }, 'error while closing server');
  }

  try {
    await pgPool?.end();
  } catch (error) {
    app.log.error({ error }, 'error while closing postgres pool');
  }

  try {
    await redis?.quit();
  } catch (error) {
    app.log.error({ error }, 'error while closing redis');
  }

  process.exit(0);
}
