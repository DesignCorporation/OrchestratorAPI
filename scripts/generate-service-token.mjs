#!/usr/bin/env node
import { SignJWT } from 'jose';

function usage() {
  console.log(`Usage:
  node scripts/generate-service-token.mjs \\
    --aud orchestrator-control|orchestrator-exec \\
    --sub svc:your-service \\
    --tid <workspace-id> \\
    --scopes orchestrator.control.read,orchestrator.control.write \\
    --ttl 300 \\
    --iss orchestrator \\
    --secret <shared-secret>

Notes:
  - If --secret is omitted, ORCH_JWT_SHARED_SECRET is used.
  - Output is raw JWT unless --json is provided.`);
}

function parseArgs(argv) {
  const params = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      params[key] = 'true';
      continue;
    }
    params[key] = next;
    i += 1;
  }
  return params;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    process.exit(0);
  }

  const aud = args.aud;
  const tid = args.tid;
  if (!aud || !tid) {
    usage();
    process.exit(1);
  }

  const secret = args.secret || process.env.ORCH_JWT_SHARED_SECRET;
  if (!secret) {
    console.error('Missing shared secret: provide --secret or ORCH_JWT_SHARED_SECRET.');
    process.exit(1);
  }

  const iss = args.iss || 'orchestrator';
  const sub = args.sub || 'svc:orchestrator';
  const scopes = (args.scopes || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ttl = Number(args.ttl || 300);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    console.error('Invalid ttl (seconds).');
    process.exit(1);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ scopes, tid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .setIssuer(iss)
    .setAudience(aud)
    .setSubject(sub)
    .sign(new TextEncoder().encode(secret));

  if (args.json === 'true' || args.json === true) {
    const payload = {
      token,
      claims: { iss, aud, sub, tid, scopes, iat: now, exp: now + ttl }
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(token);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
