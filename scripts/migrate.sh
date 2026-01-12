#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../infra/migrations" && pwd)"
NETWORK_NAME="${MIGRATION_NETWORK:-internal}"

for file in "$MIGRATIONS_DIR"/*.sql; do
  if [[ -f "$file" ]]; then
    echo "Applying migration: $file"
    docker run --rm \
      --network "$NETWORK_NAME" \
      -e DATABASE_URL="$DATABASE_URL" \
      -v "$MIGRATIONS_DIR":/migrations:ro \
      postgres:16-alpine \
      sh -c "psql \"$DATABASE_URL\" -f /migrations/$(basename "$file")"
  fi
done
