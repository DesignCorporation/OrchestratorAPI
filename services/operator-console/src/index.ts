import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';

const app = Fastify({ logger: true });

app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('cache-control', 'no-store');
    }
  }
});

const controlPlaneUrl = process.env.CONTROL_PLANE_URL || 'http://orchestrator-control:4000';
const execPlaneUrl = process.env.EXEC_PLANE_URL || '';
const serviceTokenFile = process.env.CONTROL_PLANE_TOKEN_FILE || '';
let serviceToken = process.env.CONTROL_PLANE_TOKEN || '';
if (!serviceToken && serviceTokenFile) {
  try {
    serviceToken = fs.readFileSync(serviceTokenFile, 'utf8').trim();
  } catch {
    serviceToken = '';
  }
}

app.get('/health', async () => {
  return { status: 'ok' };
});

app.get('/api/events', async (request, reply) => {
  const url = new URL('/events', controlPlaneUrl);
  for (const [key, value] of Object.entries(request.query as Record<string, string>)) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {};
  if (serviceToken) {
    headers.authorization = `Bearer ${serviceToken}`;
  }

  const upstream = await fetch(url.toString(), { headers });
  const body = await upstream.text();
  reply.status(upstream.status);
  reply.header('content-type', upstream.headers.get('content-type') || 'application/json');
  return reply.send(body);
});

function buildHeaders(request: FastifyRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  if (serviceToken) {
    headers.authorization = `Bearer ${serviceToken}`;
  }
  const impersonateSub = request.headers['x-impersonate-sub'];
  const impersonateTenant = request.headers['x-impersonate-tenant'];
  const impersonateReason = request.headers['x-impersonate-reason'];
  if (typeof impersonateSub === 'string') headers['x-impersonate-sub'] = impersonateSub;
  if (typeof impersonateTenant === 'string') headers['x-impersonate-tenant'] = impersonateTenant;
  if (typeof impersonateReason === 'string') headers['x-impersonate-reason'] = impersonateReason;
  const requestId = request.headers['x-request-id'];
  const traceId = request.headers['x-trace-id'];
  if (typeof requestId === 'string') headers['x-request-id'] = requestId;
  if (typeof traceId === 'string') headers['x-trace-id'] = traceId;
  return headers;
}

async function proxyJson(request: FastifyRequest, reply: FastifyReply, url: URL, method = 'GET') {
  const headers = buildHeaders(request);
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
  }
  const body = method !== 'GET' ? JSON.stringify(request.body || {}) : undefined;
  const upstream = await fetch(url.toString(), { method, headers, body });
  const text = await upstream.text();
  reply.status(upstream.status);
  reply.header('content-type', upstream.headers.get('content-type') || 'application/json');
  return reply.send(text);
}

app.get('/api/connectors', async (request, reply) => {
  const url = new URL('/connectors', controlPlaneUrl);
  for (const [key, value] of Object.entries(request.query as Record<string, string>)) {
    url.searchParams.set(key, value);
  }
  return proxyJson(request, reply, url);
});

app.post('/api/connectors', async (request, reply) => {
  const url = new URL('/connectors', controlPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.get('/api/policies', async (request, reply) => {
  const url = new URL('/policies', controlPlaneUrl);
  for (const [key, value] of Object.entries(request.query as Record<string, string>)) {
    url.searchParams.set(key, value);
  }
  return proxyJson(request, reply, url);
});

app.post('/api/policies', async (request, reply) => {
  const url = new URL('/policies', controlPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.post('/api/configs', async (request, reply) => {
  const url = new URL('/configs', controlPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.post('/api/configs/activate', async (request, reply) => {
  const url = new URL('/configs/activate', controlPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.get('/api/configs/active', async (request, reply) => {
  const url = new URL('/configs/active', controlPlaneUrl);
  for (const [key, value] of Object.entries(request.query as Record<string, string>)) {
    url.searchParams.set(key, value);
  }
  return proxyJson(request, reply, url);
});

app.get('/api/audit-logs', async (request, reply) => {
  const url = new URL('/audit-logs', controlPlaneUrl);
  for (const [key, value] of Object.entries(request.query as Record<string, string>)) {
    url.searchParams.set(key, value);
  }
  return proxyJson(request, reply, url);
});

app.get('/api/dlq', async (request, reply) => {
  const url = new URL('/admin/dlq', controlPlaneUrl);
  return proxyJson(request, reply, url);
});

app.post('/api/dlq/replay', async (request, reply) => {
  const url = new URL('/admin/dlq/replay', controlPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.post('/api/dlq/purge', async (request, reply) => {
  const url = new URL('/admin/dlq/purge', controlPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.get('/api/webhook-inbox', async (request, reply) => {
  const url = new URL('/admin/webhook-inbox', controlPlaneUrl);
  for (const [key, value] of Object.entries(request.query as Record<string, string>)) {
    url.searchParams.set(key, value);
  }
  return proxyJson(request, reply, url);
});

app.get('/api/workspaces', async (request, reply) => {
  const url = new URL('/workspaces', controlPlaneUrl);
  for (const [key, value] of Object.entries(request.query as Record<string, string>)) {
    url.searchParams.set(key, value);
  }
  return proxyJson(request, reply, url);
});

app.post('/api/workspaces', async (request, reply) => {
  const url = new URL('/workspaces', controlPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.patch('/api/workspaces/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const url = new URL(`/workspaces/${id}`, controlPlaneUrl);
  return proxyJson(request, reply, url, 'PATCH');
});

app.post('/api/workspaces/:id/invite', async (request, reply) => {
  const { id } = request.params as { id: string };
  const url = new URL(`/workspaces/${id}/invite`, controlPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.get('/api/bundle/export', async (request, reply) => {
  const url = new URL('/bundle/export', controlPlaneUrl);
  return proxyJson(request, reply, url);
});

app.post('/api/bundle/import', async (request, reply) => {
  const url = new URL('/bundle/import', controlPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.post('/api/execute', async (request, reply) => {
  if (!execPlaneUrl) {
    reply.status(503);
    return reply.send({ error: 'exec_plane_not_configured' });
  }
  const url = new URL('/execute', execPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.post('/api/jobs', async (request, reply) => {
  if (!execPlaneUrl) {
    reply.status(503);
    return reply.send({ error: 'exec_plane_not_configured' });
  }
  const url = new URL('/jobs', execPlaneUrl);
  return proxyJson(request, reply, url, 'POST');
});

app.get('/api/events/stream', async (request, reply) => {
  const url = new URL('/events/stream', controlPlaneUrl);
  for (const [key, value] of Object.entries(request.query as Record<string, string>)) {
    url.searchParams.set(key, value);
  }

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.flushHeaders();

  const headers: Record<string, string> = {
    'last-event-id': typeof request.headers['last-event-id'] === 'string' ? request.headers['last-event-id'] : ''
  };
  if (serviceToken) {
    headers.authorization = `Bearer ${serviceToken}`;
  }

  const upstream = await fetch(url.toString(), { headers });

  const reader = upstream.body?.getReader();
  if (!reader) {
    reply.raw.write('event: error\ndata: upstream_unavailable\n\n');
    reply.raw.end();
    return;
  }

  const encoder = new TextDecoder();
  const pump = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        reply.raw.write(encoder.decode(value));
      }
    }
  };

  pump().catch(() => {
    reply.raw.end();
  });

  request.raw.on('close', () => {
    reader.cancel().catch(() => undefined);
  });
});

app.setNotFoundHandler((request, reply) => {
  reply.sendFile('index.html');
});

async function start() {
  const port = Number(process.env.PORT || 3002);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen({ port, host });
}

start().catch((error) => {
  app.log.error({ error }, 'failed to start operator console');
  process.exit(1);
});
