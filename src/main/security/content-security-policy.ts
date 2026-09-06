export function buildRendererCsp(isDev: boolean): string {
  const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    // https: added for hosted product photos in the Online Store tab — the object-storage host
    // (Cloudflare R2, R2_PUBLIC_BASE_URL on the server) isn't known here at build time. Images
    // can't execute, so widening img-src to any HTTPS origin is a low-risk relaxation.
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' http://localhost:* ws://localhost:*",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}
