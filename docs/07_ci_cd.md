# CI/CD checklist (GitHub Actions)

Минимальный pipeline (на PR и на main).

## PR checks
- [ ] Install (pnpm/npm) + lockfile enforcement
- [ ] Typecheck (tsc)
- [ ] Lint (eslint)
- [ ] Unit tests
- [ ] Build всех сервисов/пакетов
- [ ] Docker build (api/worker) — smoke

## Integration smoke (опционально, но желательно)
- [ ] поднять docker-compose.dev.yml
- [ ] применить миграции
- [ ] healthcheck: `/health`
- [ ] enqueue тестовый job → worker обработал → event появился в `/events`

## Release (main)
- [ ] semantic versioning для packages (если отдельный kit)
- [ ] build+push docker images
- [ ] generate SBOM (желательно)
