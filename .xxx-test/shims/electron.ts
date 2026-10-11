// Harness stub for the "electron" package itself (a bare import, unlike @main/* path aliases which
// relative imports like migrate.ts's "./connection" bypass entirely) — this lets the REAL
// connection.ts, tenant-service.ts etc. run unmodified under plain Node. app.getPath("userData")
// returns HARNESS_USERDATA_DIR, which must contain a data/blue-ledger.sqlite exactly like the real
// app's layout, so getDatabasePath()'s own join(app.getPath("userData"), "data", "blue-ledger.sqlite")
// resolves to our test DB copy without needing to shim connection.ts at all.
function getPath(name: string): string {
  if (name === "userData") {
    const p = process.env.HARNESS_USERDATA_DIR;
    if (!p) throw new Error("HARNESS_USERDATA_DIR env var not set");
    return p;
  }
  throw new Error(`electron stub: unhandled app.getPath("${name}")`);
}

const app = {
  getPath,
  getVersion: () => "0.0.0-harness",
  isPackaged: false
};

export default { app };
export { app };
