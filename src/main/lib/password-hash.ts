import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

/** Hashes a PIN or password for storage. Never store the plain value. */
export function hashSecret(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${derived}`;
}

/** Verifies a plain PIN/password against a hash produced by hashSecret. For the future login flow. */
export function verifySecret(plain: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(":");
  if (!salt || !derivedHex) return false;

  const candidate = scryptSync(plain, salt, KEY_LENGTH);
  const expected = Buffer.from(derivedHex, "hex");
  if (candidate.length !== expected.length) return false;

  return timingSafeEqual(candidate, expected);
}
