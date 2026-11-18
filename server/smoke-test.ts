// End-to-end check of the API against a throwaway database: node server/smoke-test.ts
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-test-'));
process.env.ADMIN_PASSWORD = 'test-password';
process.env.CHAIN = 'simulated';
const { handle } = await import('./app.ts');
const { verifySeries } = await import('../shared/fair.ts');
const { drain } = await import('./nft.ts');
const settle = async () => { await drain(); await new Promise(r => setTimeout(r, 30)); await drain(); };

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
  assert.ok(page.market.length >= 20, 'market has the extra stock');
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
  await settle();
  const me = await ok('GET', '/api/me');
  assert.equal(me.address, me0.address);
  assert.equal(me.holdings.length, 2);
  for (const h of me.holdings) { assert.equal(h.mint_status, 'minted', 'NFT minted for ' + h.id); assert.ok(h.mint); assert.equal(h.nft_owner, me.address); }
  const meta = await ok('GET', '/api/nft/' + me.holdings[0].id + '.json');
  assert.ok(meta.attributes.some((a: any) => a.trait_type === 'Vault ID'));
  assert.equal((await fetch(base + '/api/nft/' + me.holdings[0].id + '.svg')).headers.get('content-type'), 'image/svg+xml');
  const sb = await ok('POST', `/api/specimens/${pack.reveal.specimen.id}/sell-back`, {});
  assert.ok(sb.usd > 0);
  await settle();
  const burned = await ok('GET', '/api/specimens/' + pack.reveal.specimen.id);
  assert.equal(burned.mint, null);
  assert.equal(burned.mint_status, 'burned');
  // Addendum 1: SR-00007 is dealer-sourced, so the purchase is a reservation with its rock price in escrow
  const pageNow = await ok('GET', '/api/page');
  assert.ok(!JSON.stringify(pageNow).includes('Sample dealer') && !JSON.stringify(pageNow).includes('dealer_id'), 'dealer never public');
  const res7 = me.holdings.find((h: any) => h.id === 'SR-00007').reservation;
  assert.ok(res7 && res7.status === 'active' && res7.escrow_status === 'locked' && res7.escrow_usd === res7.reserved_price_usd, 'reservation + escrow');
  assert.equal((await call('POST', '/api/specimens/SR-00007/sell-back', {})).status, 409, 'no 85% buyback on reservations');
  assert.equal((await call('POST', '/api/specimens/SR-00007/redeem', { name: 'x', line1: 'x', city: 'x', postal: 'x', country: 'US', email: 't@example.com' })).status, 409, 'legacy redeem refused');
  const q7 = await ok('POST', `/api/reservations/${res7.id}/redeem-quote`, { country: 'US' });
  assert.ok(q7.shipping_usd > 0 && q7.delta_usd === 0, 'shipping quote first');
  const red = await ok('POST', `/api/reservations/${res7.id}/redeem`, { name: 'Test', line1: '1 Main St', city: 'Austin', postal: '78701', country: 'US', email: 't@example.com', expected_delta_usd: 0 });
  assert.equal(red.redemption.status, 'requested');
  assert.equal(red.redemption.kind, 'dealer');
  assert.ok(red.redemption.dealer_name && red.redemption.due_at, 'dealer named after redemption, 48h due');
  assert.equal((await call('POST', `/api/reservations/${res7.id}/redeem`, { name: 'x', line1: 'x', city: 'x', postal: 'x', country: 'US', email: 't@example.com' })).status, 409);

  // admin
  assert.equal((await call('GET', '/api/admin/overview', undefined, 'admin')).status, 401);
  assert.equal((await call('POST', '/api/admin/login', { password: 'nope' }, 'admin')).status, 401);
  await ok('POST', '/api/admin/login', { password: 'test-password' }, 'admin');
  const ov = await ok('GET', '/api/admin/overview', undefined, 'admin');
  console.log('overview revenue', ov.revenue, 'reserves', ov.reserves);
  await ok('PUT', `/api/admin/redemptions/${red.redemption.id}`, { status: 'shipped', tracking: '1Z999' }, 'admin');

  const sp = await ok('POST', '/api/admin/specimens', { name: 'Seymchan', class: 'Pallasite, main group', category: 'pallasite', mass_g: 5, origin: 'Russia', fall: 'find', vault_value_usd: 90 }, 'admin');
  assert.equal(sp.state, 'draft');
  const full = { ...sp, vault_id: 'V9-T01', file: { bulletin: 'x', weigh_video: 'x', photos: ['x'], coa: 'x', provenance: 'x', invoice: 'x', capsule_tag: 'x' } };
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
  await settle();
  const p2me = await ok('GET', '/api/me', undefined, 'p2');
  const moved = p2me.holdings.find((h: any) => h.id === sell.id);
  assert.equal(moved.nft_owner, p2me.address, 'NFT transferred to the buyer');
  assert.equal((await call('POST', '/api/auth/google', { credential: 'x.y.z' }, 'p5')).status, 503);
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

  // ---- Addendum 1 rules end to end ----
  const mk = await ok('GET', '/api/page');
  const markup = mk.rules.market_markup;
  const list = (rock: number) => Math.round(rock * Math.round(markup * 100)) / 100;
  const sourced = mk.market.filter((s: any) => s.sourced && s.source_available).sort((a: any, b: any) => b.source_price_usd - a.source_price_usd);
  const [A, B, C, D] = [sourced[0], sourced[1], sourced[sourced.length - 1], sourced[sourced.length - 2]];
  // live re-check: a stale price is refused with the fresh one
  const stale = await call('POST', `/api/market/${A.id}/buy`, { expected_price_usd: 1 }, 'p2');
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'changed'); assert.equal(stale.data.price_usd, list(A.source_price_usd));
  // cancel: the rock's price comes back, the commission is kept
  const rA = await ok('POST', `/api/market/${A.id}/buy`, { expected_price_usd: list(A.source_price_usd) }, 'p2');
  assert.equal(rA.reservation.reserved_price_usd, A.source_price_usd);
  const can = await ok('POST', `/api/reservations/${rA.reservation.id}/cancel`, {}, 'p2');
  assert.equal(can.refunded_usd, A.source_price_usd);
  assert.ok((await ok('GET', '/api/page')).market.some((s: any) => s.id === A.id), 'back on the market');
  // sold at source: replacement of equal or lower price, the difference refunded
  const rA2 = await ok('POST', `/api/market/${A.id}/buy`, {}, 'p2');
  await ok('POST', `/api/admin/specimens/${A.id}/sold-at-source`, {}, 'admin');
  let p2 = await ok('GET', '/api/me', undefined, 'p2');
  assert.equal(p2.holdings.find((h: any) => h.id === A.id).reservation.status, 'sold_at_source');
  assert.ok(!(await ok('GET', '/api/page')).market.some((s: any) => s.id === A.id), 'off the market');
  const opts = await ok('GET', `/api/reservations/${rA2.reservation.id}/replacements`, undefined, 'p2');
  assert.ok(opts.some((s: any) => s.id === C.id) && !opts.some((s: any) => s.id === A.id));
  const rep = await ok('POST', `/api/reservations/${rA2.reservation.id}/replace`, { specimen_id: C.id }, 'p2');
  assert.equal(rep.refunded_usd, Math.round((rA2.reservation.paid_usd - list(C.source_price_usd)) * 100) / 100);
  assert.equal(rep.reservation.escrow_usd, C.source_price_usd);
  // sold at source: full refund instead
  const rB = await ok('POST', `/api/market/${B.id}/buy`, {}, 'p2');
  await ok('POST', `/api/admin/specimens/${B.id}/sold-at-source`, {}, 'admin');
  const fullRefund = await ok('POST', `/api/reservations/${rB.reservation.id}/refund`, {}, 'p2');
  assert.equal(fullRefund.refunded_usd, rB.reservation.paid_usd, '100% refund');
  // redemption with a higher dealer price: top up, or take a full refund
  const rD = await ok('POST', `/api/market/${D.id}/buy`, {}, 'p2');
  await ok('POST', `/api/admin/specimens/${D.id}/source-verified`, { price_usd: D.source_price_usd + 10 }, 'admin');
  const qD = await ok('POST', `/api/reservations/${rD.reservation.id}/redeem-quote`, { country: 'DE' }, 'p2');
  assert.equal(qD.delta_usd, 10);
  const addr = { name: 'Buyer Two', line1: 'Str 1', city: 'Berlin', postal: '10115', country: 'DE', email: 'b2@example.com' };
  assert.equal((await call('POST', `/api/reservations/${rD.reservation.id}/redeem`, { ...addr, expected_delta_usd: 0 }, 'p2')).data.code, 'changed');
  const decline = await ok('POST', `/api/reservations/${rD.reservation.id}/redeem`, { ...addr, expected_delta_usd: 10, price_change: 'refund' }, 'p2');
  assert.equal(decline.refunded_usd, rD.reservation.paid_usd);
  // redemption with a lower price: the difference comes back, escrow released to ops only now
  p2 = await ok('GET', '/api/me', undefined, 'p2');
  const hC = p2.holdings.find((h: any) => h.id === C.id);
  await ok('POST', `/api/admin/specimens/${C.id}/source-verified`, { price_usd: C.source_price_usd - 2 }, 'admin');
  const esc0 = await ok('GET', '/api/admin/escrow', undefined, 'admin');
  const redC = await ok('POST', `/api/reservations/${hC.reservation.id}/redeem`, { ...addr, expected_delta_usd: -2 }, 'p2');
  assert.equal(redC.redemption.price_delta_usd, -2);
  const esc1 = await ok('GET', '/api/admin/escrow', undefined, 'admin');
  assert.ok(esc1.released > esc0.released, 'escrow released after the burn');
  assert.ok([404, 405].includes((await call('POST', '/api/admin/escrow', {}, 'admin')).status), 'no admin route takes escrow');
  // dealer order: ordered (with ref) then shipped; the reservation closes as redeemed
  assert.equal((await call('PUT', `/api/admin/redemptions/${redC.redemption.id}`, { status: 'ordered' }, 'admin')).status, 400);
  await ok('PUT', `/api/admin/redemptions/${redC.redemption.id}`, { status: 'ordered', dealer_order_ref: 'PO-1001' }, 'admin');
  await ok('PUT', `/api/admin/redemptions/${redC.redemption.id}`, { status: 'shipped', tracking: '1Z-TEST' }, 'admin');
  const ov3 = await ok('GET', '/api/admin/overview', undefined, 'admin');
  assert.ok(ov3.counts.escrow_locked >= 0 && ov3.revenue.commission > 0);
  // a resold reservation follows the NFT
  const rE = await ok('POST', `/api/market/${sourced[2].id}/buy`, {}, 'p2');
  const lE = await ok('POST', `/api/specimens/${sourced[2].id}/list`, { price_usd: 999 }, 'p2');
  await ok('POST', `/api/listings/${lE.id}/buy`, {}, 'p1');
  const p1me2 = await ok('GET', '/api/me', undefined, 'p1');
  assert.equal(p1me2.holdings.find((h: any) => h.id === sourced[2].id).reservation.id, rE.reservation.id, 'reservation moved with the NFT');
  // the token stays off until settings switch it on
  assert.equal((await call('POST', `/api/market/${sourced[3].id}/buy`, { currency: 'TOKEN' }, 'p2')).status, 409);
  const st = await ok('GET', '/api/admin/settings', undefined, 'admin');
  await ok('PUT', '/api/admin/settings', { ...st, token_enabled: true, token_price_source: 'manual', token_manual_price_usd: 0.5 }, 'admin');
  const rT = await ok('POST', `/api/market/${sourced[3].id}/buy`, { currency: 'TOKEN' }, 'p2');
  assert.equal(rT.payment.currency, 'TOKEN');
  assert.equal(rT.reservation.paid_usd, Math.round(list(sourced[3].source_price_usd) * (1 - st.token_discount) * 100) / 100, 'token discount');
  await ok('PUT', '/api/admin/settings', { ...st, token_enabled: false }, 'admin');
  console.log('addendum rules ok');

  const p1 = await ok('GET', '/api/series/001/proof');
  assert.equal(p1.server_seed, null);
  await ok('PUT', '/api/admin/settings', { ...(await ok('GET', '/api/admin/settings', undefined, 'admin')), sol_usd: 175 }, 'admin');
  assert.equal((await call('PUT', '/api/admin/settings', { ev_target: 0.5 }, 'admin')).status, 400);
  console.log('ALL OK');
} finally {
  server.close();
}
process.exit(0);
