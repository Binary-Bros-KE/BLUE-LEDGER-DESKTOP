# Blue Ledger Desktop Structure

Blue Ledger Desktop is split into three runtime zones.

## Main Process

`src/main` owns Electron, native APIs, SQLite, migrations, file system access, sync workers, and IPC handlers. Renderer code must not import from this folder.

- `app`: bootstrapping and lifecycle orchestration.
- `database`: SQLite connection, migrations, repositories, and seed data.
- `ipc`: typed channel handlers exposed through preload.
- `services`: tenant, sync, theme, licensing, device, and reporting services.
- `security`: CSP and future permission policy helpers.
- `windows`: BrowserWindow factories.

## Preload

`src/preload` is the only bridge between Electron and React. Keep it small, typed, and explicit. Do not expose `ipcRenderer`, `fs`, `process`, or raw Node APIs.

## Renderer

`src/renderer` is the React app.

- `app`: layouts, route shells, and top-level composition.
- `features`: POS domain modules such as sales, inventory, tenancy, sync, reports, customers, and settings.
- `shared`: reusable components, stores, styles, utilities, and UI primitives.

## Shared

`src/shared` contains pure TypeScript contracts that can safely be imported by main, preload, and renderer. Put IDs, schemas, IPC types, sync contracts, and tenant contracts here.

## Multi-Tenant Rules

Every business row must carry `tenant_id`. Rows that will sync to cloud should also carry local `id`, optional `server_id`, `sync_status`, `created_at`, and `updated_at`. Sales additionally carry `client_id` and `workstation_id` so uploads can be traced back to the offline client that created them.
