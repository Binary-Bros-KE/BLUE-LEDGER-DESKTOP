// Lets `node --test` run the app's own TypeScript: every .ts file is an ES module with its types
// stripped, the @main/ @shared/ path aliases resolve like they do in the build, extensionless imports
// find their .ts file, and the few modules that need Electron (the real database file, the signed-in
// session, the tenant) are swapped for the in-memory stand-ins in tests/stubs.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url);
const STUBS = {
  "main/database/connection.ts": new URL("./stubs/connection.ts", import.meta.url),
  "main/services/auth-service.ts": new URL("./stubs/auth-service.ts", import.meta.url),
  "main/services/tenant-service.ts": new URL("./stubs/tenant-service.ts", import.meta.url)
};

function withTsExtension(url) {
  const path = fileURLToPath(url);
  for (const candidate of [path, `${path}.ts`, `${path}/index.ts`]) {
    if (candidate.endsWith(".ts") && existsSync(candidate)) return pathToFileURL(candidate);
  }
  return null;
}

function stubFor(url) {
  const relative = fileURLToPath(url).replaceAll("\\", "/").split("/src/")[1];
  return relative ? STUBS[relative] : undefined;
}

export async function resolve(specifier, context, nextResolve) {
  let target = null;
  if (specifier.startsWith("@main/") || specifier.startsWith("@shared/")) {
    target = withTsExtension(new URL(specifier.slice(1), SRC));
  } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.endsWith(".ts")) {
    target = withTsExtension(new URL(specifier, context.parentURL));
  }
  if (target) {
    const stub = stubFor(target);
    return { url: (stub ?? target).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts")) return nextLoad(url, { ...context, format: "module-typescript" });
  return nextLoad(url, context);
}
