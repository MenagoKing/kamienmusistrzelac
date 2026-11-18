import crypto from 'node:crypto';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function b58encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
  return s;
}

export function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new HttpError(400, 'Invalid base58');
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c === '1') out.unshift(0); else break; }
  return Uint8Array.from(out);
}

export const randomB58 = (len: number) => b58encode(crypto.randomBytes(len));
export const randomHex = (len: number) => crypto.randomBytes(len).toString('hex');
export const uid = (prefix: string) => prefix + '_' + crypto.randomBytes(9).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Same draw as shared/fair.ts drawPick, synchronous (runs inside DB transactions). */
export function drawPickSync(serverSeed: string, scope: string, nonce: number, clientSeed: string, pool: number) {
  const h = crypto.createHmac('sha256', serverSeed).update(`${scope}:${nonce}:${clientSeed}`).digest('hex');
  const x = parseInt(h.slice(0, 13), 16) / 2 ** 52;
  return Math.min(pool - 1, Math.floor(x * pool));
}

export class HttpError extends Error {
  status: number;
  /** Extra fields sent with the error (e.g. code: 'price_changed' and the fresh price). */
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const fail = (status: number, message: string): never => { throw new HttpError(status, message); };

export const cents = (x: number) => Math.round(x * 100) / 100;

export function str(v: unknown, name: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim()) fail(400, `${name} is required`);
  const s = (v as string).trim();
  if (s.length > max) fail(400, `${name} is too long`);
  return s;
}

export function optStr(v: unknown, max = 2000): string {
  if (v == null) return '';
  if (typeof v !== 'string') fail(400, 'Expected text');
  return (v as string).trim().slice(0, max);
}

export function num(v: unknown, name: string, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) fail(400, `${name} must be a number`);
  if ((n as number) < min || (n as number) > max) fail(400, `${name} is out of range`);
  return n as number;
}
