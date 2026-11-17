// Sessions for collectors (Solana wallet sign-in) and for the admin panel.
// Wallet sign-in: the server issues a one-time message, the wallet signs it (signMessage), the server
// checks the ed25519 signature against the address. No password, no custody.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { DATA_DIR, get, now, run } from './db.ts';
import { getRules } from './store.ts';
import { b58decode, b58encode, fail, randomHex } from './util.ts';

export const DAY = 86400000;
const SECURE = process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1';

export function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res: ServerResponse, name: string, value: string, maxAgeMs: number) {
  const c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${SECURE ? '; Secure' : ''}`;
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [String(prev)] : []), c]);
}

export function newSession(res: ServerResponse, cookie: string, subject: string, role: 'wallet' | 'admin', ttl: number) {
  const token = randomHex(32);
  run('INSERT INTO sessions (token, subject, role, expires_at) VALUES (?, ?, ?, ?)', token, subject, role, Date.now() + ttl);
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  setCookie(res, cookie, token, ttl);
}

function session(req: IncomingMessage, cookie: string, role: string) {
  const t = cookies(req)[cookie];
  if (!t) return null;
  const s = get<{ subject: string; role: string; expires_at: number }>('SELECT * FROM sessions WHERE token = ?', t);
  return s && s.role === role && s.expires_at > Date.now() ? s.subject : null;
}

export function endSession(req: IncomingMessage, res: ServerResponse, cookie: string) {
  const t = cookies(req)[cookie];
  if (t) run('DELETE FROM sessions WHERE token = ?', t);
  setCookie(res, cookie, '', 0);
}

/* ---------- wallets ---------- */

export const WALLET_COOKIE = 'sr_wallet';
export const ADMIN_COOKIE = 'sr_admin';

export const walletOf = (req: IncomingMessage) => session(req, WALLET_COOKIE, 'wallet');

export function requireWallet(req: IncomingMessage) {
  return walletOf(req) ?? fail(401, 'Connect a wallet first');
}

function checkAddress(a: unknown) {
  if (typeof a !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) fail(400, 'Invalid Solana address');
  if (b58decode(a as string).length !== 32) fail(400, 'Invalid Solana address');
  return a as string;
}

export function walletNonce(body: any, host: string) {
  const address = checkAddress(body?.address);
  const message = [
    `${host} wants you to sign in with your Solana account:`,
    address,
    '',
    'Sign in to Space Rocks. This request will not trigger a transaction or cost any fees.',
    '',
    `Nonce: ${randomHex(12)}`,
    `Issued At: ${now()}`,
  ].join('\n');
  run('INSERT INTO nonces (address, message, expires_at) VALUES (?, ?, ?) ON CONFLICT(address) DO UPDATE SET message = excluded.message, expires_at = excluded.expires_at', address, message, Date.now() + 5 * 60000);
  return { message };
}

const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

function verifyEd25519(address: string, message: string, signature: Uint8Array) {
  const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI, Buffer.from(b58decode(address))]), format: 'der', type: 'spki' });
  return crypto.verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signature));
}

export function touchWallet(address: string, kind: string) {
  run('INSERT INTO wallets (address, kind, created_at, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET last_seen = excluded.last_seen', address, kind, now(), now());
}

/** Checks a signed sign-in message for this address (one-time nonce). Returns the address. */
export function verifyWalletSignature(body: any) {
  const address = checkAddress(body?.address);
  const n = get<{ message: string; expires_at: number }>('SELECT * FROM nonces WHERE address = ?', address);
  if (!n || n.expires_at < Date.now()) fail(400, 'The sign-in request expired, try again');
  let sig: Uint8Array;
  try { sig = typeof body?.signature === 'string' ? Uint8Array.from(Buffer.from(body.signature, 'base64')) : new Uint8Array(); } catch { sig = new Uint8Array(); }
  if (sig.length !== 64 || !verifyEd25519(address, n!.message, sig)) fail(401, 'The signature does not match this wallet');
  run('DELETE FROM nonces WHERE address = ?', address);
  return address;
}

export function walletVerify(res: ServerResponse, body: any) {
  const address = verifyWalletSignature(body);
  const kind = ['phantom', 'solflare', 'backpack'].includes(body?.wallet) ? body.wallet : 'wallet';
  touchWallet(address, kind);
  newSession(res, WALLET_COOKIE, address, 'wallet', 30 * DAY);
  return { address, kind };
}

/** Demo wallet: a fresh address with no extension, for testing the flow. Disabled in settings for launch. */
export function walletDemo(res: ServerResponse) {
  if (!getRules().demo_wallet) fail(403, 'The demo wallet is turned off');
  const address = b58encode(crypto.randomBytes(32));
  touchWallet(address, 'demo');
  newSession(res, WALLET_COOKIE, address, 'wallet', 7 * DAY);
  return { address, kind: 'demo' };
}

/* ---------- admin ---------- */

let cachedHash: string | null = null;

/** ADMIN_PASSWORD from the environment, else a random one generated once into data/admin-password.txt. */
function adminHash() {
  if (cachedHash) return cachedHash;
  let pw = process.env.ADMIN_PASSWORD;
  if (!pw) {
    const file = path.join(DATA_DIR, 'admin-password.txt');
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, crypto.randomBytes(9).toString('base64url') + '\n', { mode: 0o600 });
      console.log(`\n  Space Rocks admin password generated in ${file}\n  (set ADMIN_PASSWORD to choose your own)\n`);
    }
    pw = fs.readFileSync(file, 'utf8').trim();
  }
  cachedHash = crypto.createHash('sha256').update(pw).digest('hex');
  return cachedHash;
}

const attempts = new Map<string, { n: number; until: number }>();

export function adminLogin(req: IncomingMessage, res: ServerResponse, body: any) {
  const ip = req.socket.remoteAddress ?? '?';
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) fail(429, 'Too many attempts, wait a minute');
  const given = crypto.createHash('sha256').update(String(body?.password ?? '')).digest();
  const ok = crypto.timingSafeEqual(given, Buffer.from(adminHash(), 'hex'));
  if (!ok) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(ip, { n, until: n >= 5 ? Date.now() + 60000 : 0 });
    fail(401, 'Wrong password');
  }
  attempts.delete(ip);
  newSession(res, ADMIN_COOKIE, 'admin', 'admin', 12 * 3600000);
  return { ok: true };
}

export const adminOf = (req: IncomingMessage) => session(req, ADMIN_COOKIE, 'admin');
export const requireAdmin = (req: IncomingMessage) => adminOf(req) ?? fail(401, 'Sign in to the admin panel');

/** Warm up so the generated password is printed at start. */
export const initAdmin = () => void adminHash();
