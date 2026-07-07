# Database Notes

SQLite is the source of truth while the desktop app is offline. Cloud sync should be modeled as a projection from local changes, not as a blocker for local selling.

Core sync columns:

- `id`: local stable ID created on the device.
- `tenant_id`: isolates every client/business.
- `client_id`: identifies the desktop client install.
- `server_id`: remote ID once the cloud accepts the record.
- `workstation_id`: identifies the till/device that created a sale.
- `sync_status`: local status for upload/download state.

Use `sync_outbox` for idempotent uploads. Every queued mutation needs an `idempotency_key` so retries are safe.
