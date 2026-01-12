# Payload storage (payload_ref)

## Purpose
Large payloads are stored in S3/MinIO and only metadata is kept in Postgres.

## Behavior
- If payload size exceeds `PAYLOAD_STORE_THRESHOLD_BYTES`, the payload is uploaded to object storage.
- DB stores metadata in `payload_json` and the location in `payload_ref`.
- If storage is not configured or payload is small, the payload stays in `payload_json`.

## Configuration
Required:
- `PAYLOAD_STORE_ENDPOINT`
- `PAYLOAD_STORE_BUCKET`

Optional:
- `PAYLOAD_STORE_ACCESS_KEY`
- `PAYLOAD_STORE_SECRET_KEY`
- `PAYLOAD_STORE_REGION` (default: `us-east-1`)
- `PAYLOAD_STORE_PREFIX` (default: `payloads`)
- `PAYLOAD_STORE_THRESHOLD_BYTES` (default: `20000`)
- `PAYLOAD_STORE_FORCE_PATH_STYLE` (`true` for MinIO path-style)

## Stored metadata
`payload_json` contains:
- `stored: true`
- `size_bytes`
- `sha256`
