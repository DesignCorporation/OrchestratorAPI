# Operations runbook

## Services and domains
- Prod API (control): `https://orch.designcorp.eu`
- Prod operator: `https://operator.orch.designcorp.eu`
- Dev API (control): `https://dev.orch.designcorp.eu`
- Dev operator: `https://operator.dev.orch.designcorp.eu`
- Exec plane is internal only.

## Health checks
- API: `GET /health` (expects `200` and db/redis checks).
- Operator: `GET /health` on operator console service.

## Deploy (main)
Deployment is automatic via GitHub Actions:
- Build and push images to GHCR.
- SSH deploy runs:
  - `docker compose pull`
  - `docker compose run --rm orchestrator-migrate`
  - `docker compose up -d`

Manual deploy (fallback):
```
cd /opt/orchestrator
ORCHESTRATOR_IMAGE_TAG=<sha> OPERATOR_CONSOLE_IMAGE_TAG=<sha> \
  docker compose -f infra/docker-compose/docker-compose.prod.yml pull
ORCHESTRATOR_IMAGE_TAG=<sha> OPERATOR_CONSOLE_IMAGE_TAG=<sha> \
  docker compose -f infra/docker-compose/docker-compose.prod.yml run --rm orchestrator-migrate
ORCHESTRATOR_IMAGE_TAG=<sha> OPERATOR_CONSOLE_IMAGE_TAG=<sha> \
  docker compose -f infra/docker-compose/docker-compose.prod.yml up -d
```

## Rollback
Rollback by pinning previous image SHA:
```
cd /opt/orchestrator
ORCHESTRATOR_IMAGE_TAG=<old_sha> OPERATOR_CONSOLE_IMAGE_TAG=<old_sha> \
  docker compose -f infra/docker-compose/docker-compose.prod.yml pull
ORCHESTRATOR_IMAGE_TAG=<old_sha> OPERATOR_CONSOLE_IMAGE_TAG=<old_sha> \
  docker compose -f infra/docker-compose/docker-compose.prod.yml up -d
```

## Migrations
Migrations are run by `orchestrator-migrate` profile (Postgres client).
Use:
```
docker compose -f infra/docker-compose/docker-compose.prod.yml run --rm orchestrator-migrate
```

## Logs
```
docker compose -f infra/docker-compose/docker-compose.prod.yml logs -f
```

## Certificate renewal (Let’s Encrypt)
Certificates are managed by Nginx/Certbot on the VM.
Typical renewal:
```
sudo certbot renew --nginx
sudo systemctl reload nginx
```

## Security checks
Use `docs/runbooks/security_verification_runbook.md` for auth/allowlist checks.

## Retention cleanup
Nightly cleanup runs in worker. See `docs/runbooks/retention_cleanup.md`.

## Common incidents
- 502 from Nginx: check container health and `docker compose ps`.
- 401/403 on operator: check basic auth and allowlist.
- No events in UI: verify `/events/stream` returns 200 with auth.
