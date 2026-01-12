import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

const baseUrl = process.env.ORCH_BASE_URL || 'http://localhost:4100';
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_contract';
const stripe = new Stripe('sk_test_placeholder', { apiVersion: '2025-02-24.acacia' });

async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

test('contract: execute/jobs/webhooks', async () => {
  const policyRate = await request('POST', '/policies', {
    name: 'contract-rate-limit',
    reason: 'contract test',
    rate_limit_json: { max_requests: 1, interval_ms: 60000, scope: 'tenant' }
  });
  assert.equal(policyRate.status, 201);
  const ratePolicyId = (policyRate.json as { id: string }).id;

  const policyCircuit = await request('POST', '/policies', {
    name: 'contract-circuit',
    reason: 'contract test',
    circuit_breaker_json: { enabled: true, failure_threshold: 1, window_ms: 60000, open_ms: 60000 }
  });
  assert.equal(policyCircuit.status, 201);
  const circuitPolicyId = (policyCircuit.json as { id: string }).id;

  const policyTimeout = await request('POST', '/policies', {
    name: 'contract-timeout',
    reason: 'contract test',
    timeout_json: { total_ms: 100 }
  });
  assert.equal(policyTimeout.status, 201);
  const timeoutPolicyId = (policyTimeout.json as { id: string }).id;

  const okConnector = await request('POST', '/connectors', {
    type: 'http',
    name: 'contract-ok',
    reason: 'contract test',
    settings: { base_url: 'https://postman-echo.com', method: 'POST' }
  });
  assert.equal(okConnector.status, 201);
  const okConnectorId = (okConnector.json as { id: string }).id;

  const rateConnector = await request('POST', '/connectors', {
    type: 'http',
    name: 'contract-rate',
    reason: 'contract test',
    policy_id: ratePolicyId,
    settings: { base_url: 'https://postman-echo.com', method: 'POST' }
  });
  assert.equal(rateConnector.status, 201);
  const rateConnectorId = (rateConnector.json as { id: string }).id;

  const circuitConnector = await request('POST', '/connectors', {
    type: 'http',
    name: 'contract-circuit',
    reason: 'contract test',
    policy_id: circuitPolicyId,
    settings: { base_url: 'https://httpstat.us', method: 'GET' }
  });
  assert.equal(circuitConnector.status, 201);
  const circuitConnectorId = (circuitConnector.json as { id: string }).id;

  const timeoutConnector = await request('POST', '/connectors', {
    type: 'http',
    name: 'contract-timeout',
    reason: 'contract test',
    policy_id: timeoutPolicyId,
    settings: { base_url: 'http://orchestrator-api:4100', method: 'GET' }
  });
  assert.equal(timeoutConnector.status, 201);
  const timeoutConnectorId = (timeoutConnector.json as { id: string }).id;

  const executeOk = await request('POST', '/execute', {
    connector: { id: okConnectorId },
    operation: '/post',
    input: { hello: 'world' }
  });
  assert.equal(executeOk.status, 200);
  assert.equal((executeOk.json as { status: string }).status, 'ok');

  const idemKey = `idem-${Date.now()}`;
  const executeIdem1 = await request(
    'POST',
    '/execute',
    { connector: { id: okConnectorId }, operation: '/post', input: { idempotent: true } },
    { 'idempotency-key': idemKey }
  );
  assert.equal(executeIdem1.status, 200);
  const executeIdem2 = await request(
    'POST',
    '/execute',
    { connector: { id: okConnectorId }, operation: '/post', input: { idempotent: true } },
    { 'idempotency-key': idemKey }
  );
  assert.equal(executeIdem2.status, 200);
  assert.equal(
    (executeIdem2.json as { idempotency: { replayed: boolean } }).idempotency.replayed,
    true
  );

  const executeConflict = await request(
    'POST',
    '/execute',
    { connector: { id: okConnectorId }, operation: '/post', input: { different: true } },
    { 'idempotency-key': idemKey }
  );
  assert.equal(executeConflict.status, 409);
  assert.equal((executeConflict.json as { code: string }).code, 'IDEMPOTENCY_CONFLICT');

  const rateFirst = await request('POST', '/execute', {
    connector: { id: rateConnectorId },
    operation: '/post',
    input: { test: 1 }
  });
  assert.equal(rateFirst.status, 200);
  const rateSecond = await request('POST', '/execute', {
    connector: { id: rateConnectorId },
    operation: '/post',
    input: { test: 2 }
  });
  assert.equal(rateSecond.status, 429);
  assert.equal((rateSecond.json as { code: string }).code, 'RATE_LIMITED');

  const circuitFail = await request('POST', '/execute', {
    connector: { id: circuitConnectorId },
    operation: '/500',
    input: {}
  });
  assert.equal(circuitFail.status, 200);
  const circuitOpen = await request('POST', '/execute', {
    connector: { id: circuitConnectorId },
    operation: '/500',
    input: {}
  });
  assert.equal(circuitOpen.status, 503);
  assert.equal((circuitOpen.json as { code: string }).code, 'CIRCUIT_OPEN');

  const timeoutRes = await request('POST', '/execute', {
    connector: { id: timeoutConnectorId },
    operation: '/__test/delay?ms=5000',
    input: {}
  });
  assert.equal(timeoutRes.status, 504);
  assert.equal((timeoutRes.json as { code: string }).code, 'upstream_timeout');

  const jobRes = await request('POST', '/jobs', { type: 'contract.test', payload: { ok: true } });
  assert.equal(jobRes.status, 202);
  const jobId = (jobRes.json as { job_id: string }).job_id;
  assert.ok(jobId);
  const jobGet = await request('GET', `/jobs/${jobId}`);
  assert.equal(jobGet.status, 200);

  const payload = JSON.stringify({ id: 'evt_contract_1', type: 'payment_intent.succeeded' });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: stripeSecret
  });

  const webhookValid = await fetch(`${baseUrl}/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'stripe-signature': signature,
      'content-type': 'application/json'
    },
    body: payload
  });
  assert.equal(webhookValid.status, 200);
  const webhookBody = await webhookValid.json();
  assert.equal(webhookBody.received, true);
  assert.equal(webhookBody.duplicate, false);

  const webhookDup = await fetch(`${baseUrl}/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'stripe-signature': signature,
      'content-type': 'application/json'
    },
    body: payload
  });
  assert.equal(webhookDup.status, 200);
  const webhookDupBody = await webhookDup.json();
  assert.equal(webhookDupBody.duplicate, true);

  const webhookBad = await fetch(`${baseUrl}/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'stripe-signature': 'invalid',
      'content-type': 'application/json'
    },
    body: payload
  });
  assert.equal(webhookBad.status, 400);
  const webhookBadBody = await webhookBad.json();
  assert.equal(webhookBadBody.code, 'invalid_signature');
});
