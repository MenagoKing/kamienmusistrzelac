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

  const p1 = await ok('GET', '/api/series/001/proof');
  assert.equal(p1.server_seed, null);
  await ok('PUT', '/api/admin/settings', { ...(await ok('GET', '/api/admin/settings', undefined, 'admin')), sol_usd: 175 }, 'admin');
  assert.equal((await call('PUT', '/api/admin/settings', { ev_target: 0.5 }, 'admin')).status, 400);
  console.log('ALL OK');
} finally {
  server.close();
}
process.exit(0);
