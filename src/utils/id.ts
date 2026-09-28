/** RFC 4122 v4 UUID (crypto.randomUUID when available). Used as client-chosen row ids for idempotent retries. */
export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += h[(Math.random() * 4) | 8];
    else out += h[(Math.random() * 16) | 0];
  }
  return out;
}
