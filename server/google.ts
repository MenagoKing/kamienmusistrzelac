// Sign in with Google. The browser gets an ID token from Google Identity Services; the server checks
// its RS256 signature against Google's published keys, the audience (our OAuth client ID), the issuer
// and the expiry. Only the public client ID is needed (Admin › Settings, or GOOGLE_CLIENT_ID).
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { get, now, run, tx } from './db.ts';
import { DAY, WALLET_COOKIE, newSession, touchWallet } from './auth.ts';
import { getRules } from './store.ts';
import { b58encode, fail } from './util.ts';

let keys: { list: any[]; until: number } | null = null;

async function googleKeys(): Promise<any[]> {
  if (keys && keys.until > Date.now()) return keys.list;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) fail(502, 'Could not reach Google. Try again.');
  const age = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  keys = { list: ((await r.json()) as { keys: any[] }).keys, until: Date.now() + age * 1000 };
  return keys.list;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export async function verifyGoogleToken(token: string, clientId: string) {
  const parts = String(token).split('.');
  if (parts.length !== 3) fail(400, 'Invalid Google credential');
  const header = JSON.parse(b64url(parts[0]).toString('utf8'));
  const payload = JSON.parse(b64url(parts[1]).toString('utf8'));
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') fail(401, 'Unknown Google signing key');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64url(parts[2]));
  if (!ok) fail(401, 'The Google credential signature is invalid');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) fail(401, 'Wrong issuer');
  if (payload.aud !== clientId) fail(401, 'This Google credential is for another app');
  if (!(payload.exp * 1000 > Date.now())) fail(401, 'The Google credential expired, try again');
  if (!payload.email || payload.email_verified === false) fail(401, 'Your Google email is not verified');
  return payload as { sub: string; email: string; name?: string; given_name?: string };
}

function freeCallsign(base: string) {
  const clean = (base.normalize('NFKD').replace(/[^\w]/g, '').replace(/^_+/, '') || 'collector').slice(0, 16);
  let name = clean.length >= 3 ? clean : clean + '_rock';
  for (let i = 0; get('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE', name); i++) name = `${clean.slice(0, 14)}_${Math.floor(Math.random() * 900 + 100)}`;
  return name;
}

export async function googleLogin(_req: IncomingMessage, res: ServerResponse, body: any) {
  const clientId = getRules().google_client_id;
  if (!clientId) fail(503, 'Google sign-in is not set up yet (Admin › Rules & settings › Google client ID).');
  const p = await verifyGoogleToken(body?.credential, clientId);
  const email = p.email.toLowerCase();
  const out = tx(() => {
    let u = get<{ address: string; username: string | null }>('SELECT address, username FROM users WHERE google_sub = ?', p.sub);
    if (!u) {
      u = get<{ address: string; username: string | null }>('SELECT address, username FROM users WHERE email = ? COLLATE NOCASE', email);
      if (u) run('UPDATE users SET google_sub = ? WHERE address = ?', p.sub, u.address); // Google verified this email: link it
    }
    let created = false;
    if (!u) {
      const address = b58encode(crypto.randomBytes(32));
      const username = freeCallsign(p.given_name || email.split('@')[0]);
      touchWallet(address, 'account');
      run('INSERT INTO users (address, username, email, google_sub, avatar_seed, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)', address, username, email, p.sub, Math.floor(Math.random() * 100000), now(), now());
      u = { address, username };
      created = true;
    }
    run('UPDATE users SET last_login = ? WHERE address = ?', now(), u.address);
    touchWallet(u.address, 'account');
    return { ...u, created };
  });
  newSession(res, WALLET_COOKIE, out.address, 'wallet', 30 * DAY);
  return out;
}
