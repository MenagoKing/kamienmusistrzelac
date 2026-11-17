// End-to-end check of the API against a throwaway database: node server/smoke-test.ts
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-test-'));
process.env.ADMIN_PASSWORD = 'test-password';
const { handle } = await import('./app.ts');
const { verifySeries } = await import('../shared/fair.ts');

const server = http.createServer(async (req, res) => { if (!(await handle(req, res))) { res.writeHead(404); res.end(); } });
await new Promise<void>(r => server.listen(0, r));
const base = `http://localhost:${(server.address() as any).port}`;

const jar: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who = 'user') {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: jar[who] ?? '' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = r.headers.getSetCookie();
  if (set.length) jar[who] = set.map(c => c.split(';')[0]).join('; ');
  const data = await r.json();
  return { status: r.status, data };
}
const ok = async (method: string, url: string, body?: unknown, who = 'user') => {
  const r = await call(method, url, body, who);
  assert.equal(r.status, 200, `${method} ${url}: ${JSON.stringify(r.data)}`);
  return r.data;
};

try {
  const page = await ok('GET', '/api/page');
  assert.equal(page.market.length, 6);
  assert.equal(page.series.id, '001');
  assert.equal(page.series.opened.length, 35);
  assert.equal(page.drop.locked.length, 3);
  console.log('page ok', page.series.remaining, page.drop.status);

  assert.equal((await call('POST', '/api/market/SR-00007/buy', {})).status, 401);
  const me0 = await ok('POST', '/api/auth/demo', {});
  const buy = await ok('POST', '/api/market/SR-00007/buy', { currency: 'SOL' });
  assert.equal(buy.payment.currency, 'SOL');
  const pack = await ok('POST', '/api/series/001/open', { currency: 'USDC', client_seed: 'hello-world' });
  console.log('pulled', pack.reveal.specimen.name, pack.reveal.band);
  const me = await ok('GET', '/api/me');
  assert.equal(me.address, me0.address);
  assert.equal(me.holdings.length, 2);
  const sb = await ok('POST', `/api/specimens/${pack.reveal.specimen.id}/sell-back`, {});
  assert.ok(sb.usd > 0);
  const red = await ok('POST', '/api/specimens/SR-00007/redeem', { name: 'Test', line1: '1 Main St', city: 'Austin', postal: '78701', country: 'US', email: 't@example.com' });
  assert.equal(red.redemption.status, 'requested');
  assert.equal((await call('POST', '/api/specimens/SR-00007/redeem', { name: 'x', line1: 'x', city: 'x', postal: 'x', country: 'US', email: 't@example.com' })).status, 403);

  // admin
  assert.equal((await call('GET', '/api/admin/overview', undefined, 'admin')).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'nope' }, 'admin')).status, 401);
  await ok('POST', '/api/admin/login', { password: 'test-password' }, 'admin');
  const ov = await ok('GET', '/api/admin/overview', undefined, 'admin');
  console.log('overview revenue', ov.revenue, 'reserves', ov.reserves);
  await ok('PUT', `/api/admin/redemptions/${red.redemption.id}`, { status: 'shipped', tracking: '1Z999' }, 'admin');

  const sp = await ok('POST', '/api/admin/specimens', { name: 'Seymchan', class: 'Pallasite, main group', category: 'pallasite', mass_g: 5, origin: 'Russia', fall: 'find', vault_value_usd: 90 }, 'admin');
  assert.equal(sp.state, 'draft');
  const full = { ...sp, file: { bulletin: 'x', weigh_video: 'x', photos: ['x'], coa: 'x', provenance: 'x', invoice: 'x', capsule_tag: 'x' } };
  const sp2 = await ok('PUT', `/api/admin/specimens/${sp.id}`, full, 'admin');
  assert.equal(sp2.state, 'vault');
  await ok('POST', `/api/admin/specimens/${sp.id}/list`, {}, 'admin');

  const s = await ok('POST', '/api/admin/series', { name: 'Test series', tier: 'earth', size: 10, pack_price_usd: 96 }, 'admin');
  const filled = await ok('POST', `/api/admin/series/${s.series.id}/autofill`, {}, 'admin');
  console.log('autofill', filled.slots.length, filled.check);

  // Drop: open it (move T-0 into the next 24 h), open packs, booster catch, ship catch.
  await ok('PUT', '/api/admin/drops/drop-01', { t0: new Date(Date.now() + 3600e3).toISOString() }, 'admin');
  for (let i = 0; i < 3; i++) await ok('POST', '/api/series/L01/open', { currency: 'USDC' });
  const bc = await ok('POST', '/api/admin/drops/drop-01/events', { kind: 'booster_catch', source_url: 'https://example.com/flight' }, 'admin');
  assert.equal((bc.result.unlocked as string[]).length, 2);
  const sc = await ok('POST', '/api/admin/drops/drop-01/events', { kind: 'ship_catch', source_url: 'https://example.com/flight' }, 'admin');
  assert.equal((sc.result.raffled as unknown[]).length, 1);
  assert.equal(sc.drop.status, 'closed');
  const proof = await ok('GET', '/api/series/L01/proof');
  const v = await verifySeries(proof);
  assert.ok(v.ok, v.problems.join('; '));
  console.log('drop proof verified', v.checked, 'pulls');

  // accounts: register, duplicate, wrong password, login, profile
  const reg = await ok('POST', '/api/auth/register', { username: 'stargazer_1', email: 'a@example.com', password: 'longpassword' }, 'p1');
  assert.ok(reg.address);
  assert.equal((await call('POST', '/api/auth/register', { username: 'Stargazer_1', email: 'b@example.com', password: 'longpassword' }, 'p2')).status, 409);
  assert.equal((await call('POST', '/api/auth/register', { username: 'ab', email: 'b@example.com', password: 'longpassword' }, 'p2')).status, 400);
  assert.equal((await call('POST', '/api/auth/login', { login: 'a@example.com', password: 'wrong-one' }, 'p3')).status, 401);
  await ok('POST', '/api/auth/register', { username: 'buyer_2', email: 'b@example.com', password: 'longpassword' }, 'p2');
  await ok('POST', '/api/auth/logout', {}, 'p1');
  assert.equal(await ok('GET', '/api/me', undefined, 'p1'), null);
  await ok('POST', '/api/auth/login', { login: 'STARGAZER_1', password: 'longpassword' }, 'p1');
  let p1me = await ok('GET', '/api/me', undefined, 'p1');
  assert.equal(p1me.profile.username, 'stargazer_1');
  assert.equal(p1me.profile.level, 1);

  // p1 opens packs, lists one, p2 buys it; royalty and payout land in the ledger
  for (let i = 0; i < 3; i++) await ok('POST', '/api/series/001/open', { currency: 'USDC' }, 'p1');
  p1me = await ok('GET', '/api/me', undefined, 'p1');
  assert.equal(p1me.holdings.length, 3);
  assert.ok(p1me.profile.xp >= 30 && p1me.profile.achievements.find((a: any) => a.id === 'first_light').done);
  const sell = p1me.holdings[0];
  const listing = await ok('POST', `/api/specimens/${sell.id}/list`, { price_usd: 150 }, 'p1');
  assert.equal((await call('POST', `/api/specimens/${sell.id}/sell-back`, {}, 'p1')).status, 409);
  assert.equal((await call('POST', `/api/listings/${listing.id}/buy`, {}, 'p1')).status, 409);
  const pub = await ok('GET', '/api/page');
  assert.ok(pub.listings.some((l: any) => l.id === listing.id && l.seller === 'stargazer_1'));
  const bought = await ok('POST', `/api/listings/${listing.id}/buy`, { currency: 'SOL' }, 'p2');
  assert.equal(bought.reveal.specimen.id, sell.id);
  assert.equal((await call('POST', `/api/listings/${listing.id}/buy`, {}, 'p2')).status, 409);
  const p2me = await ok('GET', '/api/me', undefined, 'p2');
  assert.ok(p2me.holdings.some((h: any) => h.id === sell.id && h.acquired_via === 'secondary'));
  p1me = await ok('GET', '/api/me', undefined, 'p1');
  assert.equal(p1me.profile.stats.sold, 1);
  assert.equal(p1me.profile.stats.earned, 145.5);
  const ov2 = await ok('GET', '/api/admin/overview', undefined, 'admin');
  assert.equal(ov2.revenue.royalties, 4.5);
  // listing then cancel; profile edits; password change
  const l2 = await ok('POST', `/api/specimens/${p1me.holdings[0].id}/list`, { price_usd: 99 }, 'p1');
  await ok('POST', `/api/listings/${l2.id}/cancel`, {}, 'p1');
  assert.equal((await call('PUT', '/api/me/profile', { username: 'buyer_2' }, 'p1')).status, 409);
  await ok('PUT', '/api/me/profile', { username: 'meteor_mike', avatar_seed: 42 }, 'p1');
  assert.equal((await call('PUT', '/api/me/password', { current: 'nope', next: 'evenlongerpass' }, 'p1')).status, 401);
  await ok('PUT', '/api/me/password', { current: 'longpassword', next: 'evenlongerpass' }, 'p1');
  await ok('POST', '/api/auth/login', { login: 'meteor_mike', password: 'evenlongerpass' }, 'p4');
  const wl = await ok('GET', '/api/admin/wallets', undefined, 'admin');
  assert.ok(wl.some((w: any) => w.username === 'meteor_mike'));
  console.log('accounts + collector market ok');

  const p1 = await ok('GET', '/api/series/001/proof');
  assert.equal(p1.server_seed, null);
  await ok('PUT', '/api/admin/settings', { ...(await ok('GET', '/api/admin/settings', undefined, 'admin')), sol_usd: 175 }, 'admin');
  assert.equal((await call('PUT', '/api/admin/settings', { ev_target: 0.5 }, 'admin')).status, 400);
  console.log('ALL OK');
} finally {
  server.close();
}
process.exit(0);
