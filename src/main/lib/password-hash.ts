import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

/** scrypt's "cost" (N) is the knob equivalent to bcrypt's salt rounds — doubling it roughly doubles
 * both the CPU time AND memory required per attempt, which is what actually matters against offline
 * brute-forcing a 6-digit PIN (only 1,000,000 possible values) now that hashes leave the device via
 * cloud sync (see sync-engine.ts's employees PAYLOAD_BUILDER). Node's own default is 16384 — this
 * doubles it. Embedded in the stored string (not just used at hash time) so it can be raised again
 * later without invalidating every employee's existing PIN — verifySecret always uses whichever
 * cost the hash was ACTUALLY created with, never the current default. */
const DEFAULT_COST = 32768;

/** Node's own default `maxmem` (32MB) is sized for its own default cost (16384) — scrypt's memory
 * requirement scales with cost (roughly cost * 1024 bytes at Node's default blockSize), so 32768
 * needs ~32MB and trips the default limit outright ("memory limit exceeded"). Confirmed directly:
 * cost 32768 throws under the default maxmem, succeeds (~140ms) at this one. Generous headroom
 * here means a future cost increase doesn't need this touched again either. */
const MAX_MEM = 64 * 1024 * 1024;

/** Hashes a PIN or password for storage. Never store the plain value. */
export function hashSecret(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, KEY_LENGTH, { cost: DEFAULT_COST, maxmem: MAX_MEM }).toString("hex");
  return `${DEFAULT_COST}:${salt}:${derived}`;
}

/** Verifies a plain PIN/password against a hash produced by hashSecret. Handles both the current
 * `cost:salt:derived` format and the original `salt:derived` format (no embedded cost — implicitly
 * Node's own default of 16384) from before this was added, so no existing employee's PIN/password
 * breaks when this ships. */
export function verifySecret(plain: string, stored: string): boolean {
  const parts = stored.split(":");
  const [cost, salt, derivedHex] =
    parts.length === 3 ? [Number(parts[0]), parts[1], parts[2]] : [16384, parts[0], parts[1]];
  if (!salt || !derivedHex || !Number.isFinite(cost)) return false;

  const candidate = scryptSync(plain, salt, KEY_LENGTH, { cost, maxmem: MAX_MEM });
  const expected = Buffer.from(derivedHex, "hex");
  if (candidate.length !== expected.length) return false;

  return timingSafeEqual(candidate, expected);
}
