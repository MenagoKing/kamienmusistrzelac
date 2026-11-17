// HTTP API. Used by `vite` in development (middleware, see vite.config.ts) and by server/index.ts.
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { UPLOAD_DIR, get, now, run } from './db.ts';
import { HttpError, fail, randomHex, str } from './util.ts';
import { ADMIN_COOKIE, WALLET_COOKIE, adminLogin, adminOf, endSession, requireAdmin, requireWallet, walletDemo, walletNonce, walletOf, walletVerify } from './auth.ts';
import { buyMarket, openPack, redeem, sellBack, audit } from './ops.ts';
import * as A from './admin.ts';
import { getRules, holdingsOf, pageData, redemptionOf, seriesProof, seriesRow, specimenRow, toPublic, toReveal, toSeries, vaultRegister } from './store.ts';
import { all } from './db.ts';
import { ensureSeeded, reseed } from './seed.ts';
import { activityOf, changePassword, linkWallet, login, profileOf, register, unlinkWallet, updateProfile } from './accounts.ts';
import { adminListings, buyListing, cancelListing, listForSale, listingsOf } from './market.ts';
import { publicListings } from './store.ts';
import { chainAirdrop, chainStatus, drain, migrateSimulatedMints, nftOwnerOf, queueTransfer, retryFailed, startWorker } from './nft.ts';
import { googleLogin } from './google.ts';
import { nftJson, nftSvg, saveShareImage, sharePage } from './nftmeta.ts';

ensureSeeded();
migrateSimulatedMints();
startWorker();

type Ctx = { req: IncomingMessage; res: ServerResponse; params: string[]; query: URLSearchParams; body: any };
type Handler = (c: Ctx) => unknown;
const routes: { method: string; re: RegExp; h: Handler }[] = [];
const on = (method: string, pattern: string, h: Handler) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$'), h });

/* ---------- public ---------- */

on('GET', '/api/page', () => pageData());
on('GET', '/api/series/:id', ({ params }) => { const s = seriesRow(params[0]) ?? fail(404, 'Series not found'); return toSeries(s); });
on('GET', '/api/series/:id/proof', ({ params }) => seriesProof(params[0]));
on('GET', '/api/vault', ({ query }) => vaultRegister(query.get('q') ?? '', query.get('state') ?? ''));
on('GET', '/api/specimens/:id', ({ params }) => { const s = specimenRow(params[0]) ?? fail(404, 'Specimen not found'); return toPublic(s); });
on('GET', '/api/drops/current', () => pageData().drop);
on('POST', '/api/waitlist', ({ body }) => {
  const email = str(body?.email, 'Email', 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Enter a valid email');
  run('INSERT INTO waitlist (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING', email, now());
  return { ok: true };
});

/* ---------- wallet ---------- */

on('POST', '/api/auth/nonce', ({ req, body }) => walletNonce(body, String(req.headers.host ?? 'spacerocks')));
on('POST', '/api/auth/verify', ({ res, body }) => walletVerify(res, body));
on('POST', '/api/auth/demo', ({ res }) => walletDemo(res));
on('POST', '/api/auth/logout', ({ req, res }) => { endSession(req, res, WALLET_COOKIE); return { ok: true }; });
on('GET', '/api/me', ({ req }) => {
  const address = walletOf(req);
  if (!address) return null;
  const w = get<{ kind: string }>('SELECT kind FROM wallets WHERE address = ?', address);
  return {
    address, kind: w?.kind ?? 'wallet',
    profile: profileOf(address),
    holdings: holdingsOf(address),
    pulls: all<any>('SELECT * FROM pulls WHERE wallet = ? ORDER BY created_at DESC LIMIT 50', address).map(toReveal),
    redemptions: all<any>('SELECT * FROM redemptions WHERE wallet = ? ORDER BY created_at DESC', address).map(redemptionOf),
    listings: listingsOf(address),
    activity: activityOf(address),
  };
});
on('POST', '/api/market/:id/buy', ({ req, params, body }) => buyMarket(requireWallet(req), params[0], body?.currency));
on('POST', '/api/series/:id/open', ({ req, params, body }) => openPack(requireWallet(req), params[0], body?.currency, body?.client_seed));
on('POST', '/api/specimens/:id/sell-back', ({ req, params }) => sellBack(requireWallet(req), params[0]));
on('POST', '/api/specimens/:id/redeem', ({ req, params, body }) => redeem(requireWallet(req), params[0], body));

/* ---------- accounts ---------- */

on('POST', '/api/auth/register', ({ req, res, body }) => register(req, res, body));
on('POST', '/api/auth/login', ({ req, res, body }) => login(req, res, body));
on('POST', '/api/auth/google', ({ req, res, body }) => googleLogin(req, res, body));
on('GET', '/api/nft/:id', ({ req, params }) => nftJson(req, params[0]));
on('POST', '/api/share-image', ({ req, body }) => { requireWallet(req); return saveShareImage(String(body?.specimen_id ?? ''), body?.data); });
on('POST', '/api/specimens/:id/withdraw', ({ req, params }) => {
  const me = requireWallet(req);
  const s = specimenRow(params[0]) ?? fail(404, 'Specimen not found');
  if (s.owner !== me || s.state !== 'held') fail(403, 'You do not hold this specimen');
  const to = nftOwnerOf(me);
  if (to === me) fail(400, 'Link a Solana wallet in Settings first');
  if (s.nft_owner === to) fail(409, 'It is already in your wallet');
  queueTransfer(s.id, to);
  return { ok: true, to };
});
on('PUT', '/api/me/profile', ({ req, body }) => updateProfile(requireWallet(req), body));
on('PUT', '/api/me/password', ({ req, body }) => changePassword(requireWallet(req), body));
on('POST', '/api/me/link-wallet', ({ req, body }) => linkWallet(requireWallet(req), body));
on('POST', '/api/me/unlink-wallet', ({ req }) => unlinkWallet(requireWallet(req)));

/* ---------- collectors' market ---------- */

on('GET', '/api/listings', ({ req }) => publicListings(walletOf(req)));
on('POST', '/api/specimens/:id/list', ({ req, params, body }) => listForSale(requireWallet(req), params[0], body));
on('POST', '/api/listings/:id/cancel', ({ req, params }) => cancelListing(requireWallet(req), params[0]));
on('POST', '/api/listings/:id/buy', ({ req, params, body }) => {
  const r = buyListing(requireWallet(req), params[0], body?.currency);
  const s = r.specimen;
  return {
    payment: r.payment, mint: s.mint, listing: r.listing,
    reveal: { pull_id: null, series_id: null, band: 'par', pack_price_usd: r.listing.price_usd, vault_value_usd: s.vault_value_usd ?? 0, specimen: { id: s.id, name: s.name, class: s.class.replace(', ', ' '), mass_g: s.mass_g, render: { type: s.category, seed: s.render_seed } } },
  };
});

/* ---------- admin ---------- */

on('POST', '/api/admin/login', ({ req, res, body }) => adminLogin(req, res, body));
on('POST', '/api/admin/logout', ({ req, res }) => { endSession(req, res, ADMIN_COOKIE); return { ok: true }; });
on('GET', '/api/admin/me', ({ req }) => ({ admin: !!adminOf(req) }));

const admin = (method: string, pattern: string, h: (c: Ctx, actor: string) => unknown) =>
  on(method, '/api/admin' + pattern, c => h(c, requireAdmin(c.req)));

admin('GET', '/overview', () => A.overview());
admin('GET', '/specimens', ({ query }) => A.listSpecimens(query));
admin('POST', '/specimens', ({ body }, a) => A.createSpecimen(a, body));
admin('GET', '/specimens/:id', ({ params }) => { const s = specimenRow(params[0]) ?? fail(404, 'Specimen not found'); return { specimen: A.listSpecimens(new URLSearchParams({ q: s.id }))[0], history: all('SELECT * FROM ledger WHERE specimen_id = ? ORDER BY created_at DESC', s.id) }; });
admin('PUT', '/specimens/:id', ({ params, body }, a) => A.updateSpecimen(a, params[0], body));
admin('DELETE', '/specimens/:id', ({ params }, a) => A.deleteSpecimen(a, params[0]));
admin('POST', '/specimens/:id/list', ({ params }, a) => A.setListing(a, params[0], true));
admin('POST', '/specimens/:id/unlist', ({ params }, a) => A.setListing(a, params[0], false));
admin('POST', '/specimens/:id/feature', ({ params, body }, a) => A.setFeatured(a, params[0], !!body?.featured));

admin('GET', '/series', () => all<any>('SELECT * FROM series ORDER BY sort, id').map(s => ({ ...toSeries(s), sort: s.sort })));
admin('POST', '/series', ({ body }, a) => A.createSeries(a, body));
admin('GET', '/series/:id', ({ params }) => A.seriesDetail(params[0]));
admin('PUT', '/series/:id', ({ params, body }, a) => A.updateSeries(a, params[0], body));
admin('POST', '/series/:id/slots', ({ params, body }, a) => A.seriesAddSlots(a, params[0], body?.specimen_ids));
admin('DELETE', '/series/:id/slots/:idx', ({ params }, a) => A.seriesRemoveSlot(a, params[0], Number(params[1])));
admin('POST', '/series/:id/clear', ({ params }, a) => A.seriesClear(a, params[0]));
admin('POST', '/series/:id/autofill', ({ params }, a) => A.seriesAutofill(a, params[0]));
admin('POST', '/series/:id/:action', ({ params }, a) => A.seriesStatus(a, params[0], params[1]));

admin('GET', '/drops', () => A.listDrops());
admin('POST', '/drops', ({ body }, a) => A.createDrop(a, body));
admin('GET', '/drops/:id', ({ params }) => A.dropDetail(params[0]));
admin('PUT', '/drops/:id', ({ params, body }, a) => A.updateDrop(a, params[0], body));
admin('POST', '/drops/:id/series', ({ params, body }, a) => A.dropCreateSeries(a, params[0], body));
admin('POST', '/drops/:id/locks', ({ params, body }, a) => A.dropLock(a, params[0], body));
admin('DELETE', '/drops/:id/locks/:sid', ({ params }, a) => A.dropUnlock(a, params[0], params[1]));
admin('POST', '/drops/:id/events', ({ params, body }, a) => A.dropEvent(a, params[0], body));

admin('GET', '/redemptions', ({ query }) => A.listRedemptions(query.get('status')));
admin('PUT', '/redemptions/:id', ({ params, body }, a) => A.updateRedemption(a, params[0], body));
admin('GET', '/wallets', () => A.listWallets());
admin('GET', '/chain', () => chainStatus());
admin('POST', '/chain/airdrop', async () => ({ balance: await chainAirdrop() }));
admin('POST', '/chain/retry', () => retryFailed());
admin('POST', '/chain/process', async () => { await drain(); return chainStatus(); });
admin('GET', '/listings', ({ query }) => adminListings(query.get('status')));
admin('POST', '/listings/:id/cancel', ({ params }, a) => { const r = cancelListing(null, params[0], true); audit(a, 'listing.cancel', params[0]); return r; });
admin('GET', '/wallets/:address', ({ params }) => A.walletDetail(params[0]));
admin('GET', '/ledger', ({ query }) => A.listLedger(query));
admin('GET', '/waitlist', () => A.listWaitlist());
admin('GET', '/audit', () => A.listAudit());
admin('GET', '/settings', () => getRules());
admin('PUT', '/settings', ({ body }, a) => A.updateRules(a, body));
admin('POST', '/reseed', (_c, a) => { reseed(); audit(a, 'demo.reseed'); return { ok: true }; });
admin('POST', '/upload', ({ body }, a) => {
  const m = /^data:(image\/(png|jpeg|webp|avif|gif));base64,(.+)$/.exec(String(body?.data ?? ''));
  if (!m) fail(400, 'Upload a PNG, JPEG, WebP, AVIF or GIF image');
  const buf = Buffer.from(m![3], 'base64');
  if (buf.length > 8 * 1024 * 1024) fail(413, 'Images up to 8 MB');
  const name = `${Date.now()}-${randomHex(4)}.${m![2] === 'jpeg' ? 'jpg' : m![2]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  audit(a, 'upload', name, { bytes: buf.length });
  return { url: '/uploads/' + name };
});

/* ---------- plumbing ---------- */

function readBody(req: IncomingMessage, limit: number): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data ?? null);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' };

function serveUpload(res: ServerResponse, pathname: string) {
  const name = path.basename(decodeURIComponent(pathname));
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

/** Handles /api/* and /uploads/*. Returns false for anything else. */
export async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://local');
  if (url.pathname.startsWith('/uploads/')) { serveUpload(res, url.pathname); return true; }
  if (/^\/s\/[\w-]+$/.test(url.pathname)) {
    const html = sharePage(req, url.pathname.slice(3));
    res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
    res.end(html ?? 'Not found');
    return true;
  }
  if (/^\/api\/nft\/[\w-]+\.svg$/.test(url.pathname)) {
    try { const svg = nftSvg(url.pathname.split('/').pop()!); res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' }); res.end(svg); } catch { res.writeHead(404); res.end(); }
    return true;
  }
  if (!url.pathname.startsWith('/api/')) return false;
  const method = req.method ?? 'GET';
  try {
    if (method !== 'GET' && method !== 'HEAD') {
      // CSRF: state-changing calls must be JSON from our own pages (cookies are SameSite=Strict too).
      if (!String(req.headers['content-type'] ?? '').includes('application/json')) fail(415, 'Send JSON');
    }
    const body = method === 'GET' ? {} : await readBody(req, url.pathname === '/api/admin/upload' ? 12 * 1024 * 1024 : url.pathname === '/api/share-image' ? 4 * 1024 * 1024 : 256 * 1024);
    let matched = false;
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      matched = true;
      if (r.method !== method) continue;
      const out = await r.h({ req, res, params: m.slice(1).map(decodeURIComponent), query: url.searchParams, body });
      send(res, 200, out);
      return true;
    }
    fail(matched ? 405 : 404, matched ? 'Method not allowed' : 'Not found');
  } catch (e) {
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else { console.error(e); send(res, 500, { error: 'Something went wrong on our side' }); }
  }
  return true;
}
