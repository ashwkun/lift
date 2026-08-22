/**
 * UUIDv7 (RFC 9562): time-ordered identifiers.
 *
 * Why v7 and not v4: every row in this app is created on-device, often offline.
 * Client-generated IDs mean a workout can be saved with no network round-trip,
 * and because v7 embeds a millisecond timestamp in its high bits the IDs sort
 * chronologically. That gives us stable list ordering and index locality in
 * Postgres for free, which random v4 keys would destroy.
 */

/** Fills `out` with cryptographically random bytes, falling back if unavailable. */
function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);

  // Expo/Hermes expose the WebCrypto global; Node ≥18 does too. Typed
  // structurally rather than via `Crypto` so this package doesn't need the DOM lib.
  const webcrypto = (
    globalThis as {
      crypto?: { getRandomValues?: <T extends ArrayBufferView>(array: T) => T };
    }
  ).crypto;

  if (webcrypto?.getRandomValues) {
    webcrypto.getRandomValues(out);
    return out;
  }

  // Last-resort fallback. Only reachable if the crypto global is missing, which
  // would indicate a misconfigured runtime. IDs stay unique enough to not
  // collide in practice, but this should never run in production.
  for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/**
 * Generates a UUIDv7 string.
 *
 * Layout: 48-bit big-endian unix-ms | version(7) | 12 random | variant(0b10) | 62 random
 */
export function uuidv7(now: number = Date.now()): string {
  const b = new Uint8Array(16);

  // 48-bit timestamp, big-endian. Division (not >>>) because the value exceeds
  // 32 bits and bitwise ops in JS coerce to int32.
  b[0] = Math.floor(now / 2 ** 40) & 0xff;
  b[1] = Math.floor(now / 2 ** 32) & 0xff;
  b[2] = Math.floor(now / 2 ** 24) & 0xff;
  b[3] = Math.floor(now / 2 ** 16) & 0xff;
  b[4] = Math.floor(now / 2 ** 8) & 0xff;
  b[5] = now & 0xff;

  b.set(randomBytes(10), 6);

  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant

  const h = HEX;
  return (
    h[b[0]!]! + h[b[1]!]! + h[b[2]!]! + h[b[3]!]! + '-' +
    h[b[4]!]! + h[b[5]!]! + '-' +
    h[b[6]!]! + h[b[7]!]! + '-' +
    h[b[8]!]! + h[b[9]!]! + '-' +
    h[b[10]!]! + h[b[11]!]! + h[b[12]!]! + h[b[13]!]! + h[b[14]!]! + h[b[15]!]!
  );
}

/** Extracts the creation timestamp (unix ms) embedded in a UUIDv7. */
export function uuidv7Timestamp(uuid: string): number {
  const hex = uuid.replace(/-/g, '').slice(0, 12);
  return parseInt(hex, 16);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
