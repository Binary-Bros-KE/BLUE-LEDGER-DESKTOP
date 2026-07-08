/** Strips Electron's IPC wrapper ("Error invoking remote method 'x': Error: ...") down to the real message. */
const IPC_WRAPPER_PATTERN = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]*)$/;

/** Renders a caught error for display — unwraps IPC noise so the service's own message shows through. */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const match = err.message.match(IPC_WRAPPER_PATTERN);
  return match ? match[1]!.trim() || fallback : err.message;
}
