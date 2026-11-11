export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts")) return nextLoad(url, { ...context, format: "module-typescript" });
  return nextLoad(url, context);
}
