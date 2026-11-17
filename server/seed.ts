// Sample data for a fresh database: the design's specimens and register, an open Earth series of
// 100 packs (35 already opened, like the design), two announced series and a scheduled launch drop.
// Everything here is SAMPLE data: the site footer says so until "Sample notice" is turned off.
// Admin > Settings > "Reset demo data" runs reseed().
import type { Band, RockType } from '../shared/types.ts';
import { DEFAULT_RULES, bandOf } from '../shared/rules.ts';
import { all, db, get, now, run, tx } from './db.ts';
import { addSlots, openPack } from './ops.ts';
import { seriesRow } from './store.ts';
import { b58encode, randomHex, sha256 } from './util.ts';
import crypto from 'node:crypto';

type Def = [name: string, cls: string, origin: string, fall: number | 'find'];

const POOL: Record<RockType, Def[]> = {
  stone: [
    ['Gao-Guenie', 'Chondrite, H5', 'Burkina Faso', 1960], ['NWA 869', 'Chondrite, L4-6', 'Morocco', 'find'], ['Holbrook', 'Chondrite, L6', 'USA', 1912],
    ['Allende', 'Carbonaceous, CV3', 'Mexico', 1969], ['Chelyabinsk', 'Chondrite, LL5', 'Russia', 2013], ['Aba Panu', 'Chondrite, L3', 'Nigeria', 2018],
    ['Viñales', 'Chondrite, L6', 'Cuba', 2019], ['Jiddat al Harasis', 'Chondrite, L6', 'Oman', 'find'], ['Ozerki', 'Chondrite, L6', 'Russia', 2018],
  ],
  iron: [
    ['Campo del Cielo', 'Iron, IAB', 'Argentina', 'find'], ['Muonionalusta', 'Iron, IVA', 'Sweden', 'find'], ['Sikhote-Alin', 'Iron, IIAB', 'Russia', 1947],
    ['Canyon Diablo', 'Iron, IAB', 'USA', 'find'], ['Odessa', 'Iron, IAB', 'USA', 'find'], ['Gibeon', 'Iron, IVA', 'Namibia', 'find'], ['Henbury', 'Iron, IIIAB', 'Australia', 'find'],
  ],
  pallasite: [['Brenham', 'Pallasite, main group', 'USA', 'find'], ['Seymchan', 'Pallasite, main group', 'Russia', 'find'], ['Imilac', 'Pallasite, main group', 'Chile', 'find']],
  lunar: [['NWA 11273', 'Lunar, feldspathic breccia', 'Morocco', 'find'], ['Dhofar 1428', 'Lunar, regolith breccia', 'Oman', 'find']],
  martian: [['NWA 6963', 'Martian, shergottite', 'Morocco', 'find'], ['Tissint', 'Martian, shergottite', 'Morocco', 2011]],
};

/** Rough $ per gram, only to give sample masses that look plausible. */
const PER_G: Record<RockType, number> = { stone: 3.2, iron: 1.9, pallasite: 18, lunar: 420, martian: 585 };

function mulberry(a: number) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const sampleFile = (id: string) => JSON.stringify({
  bulletin: 'MetBull entry on file', weigh_video: `vault://${id}/weigh-in.mp4`, photos: [`vault://${id}/macro-01.jpg`, `vault://${id}/turn-360.mp4`],
  coa: `vault://${id}/coa.pdf`, provenance: `vault://${id}/provenance-export.pdf`, invoice: `vault://${id}/invoice.pdf`, capsule_tag: `CAP-${id.slice(3)}`,
});

let seq = 1000;
function insert(p: { id?: string; name: string; cls: string; cat: RockType; mass: number; origin: string | null; fall: number | 'find' | null; value: number | null; state: string; seed: number; featured?: number; soldBack?: boolean; complete?: boolean; owner?: string; via?: string }) {
  const id = p.id ?? 'SR-' + String(++seq).padStart(5, '0');
  const file = p.complete === false ? JSON.stringify({ bulletin: '', photos: [`vault://${id}/macro-01.jpg`] }) : sampleFile(id);
  run(`INSERT INTO specimens (id, name, class, category, mass_g, origin, fall, vault_value_usd, state, sold_back, owner, mint, vault_id, file, notes, render_seed, featured, acquired_via, acquired_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
    id, p.name, p.cls, p.cat, p.mass, p.origin, p.fall == null ? null : String(p.fall), p.value, p.state, p.soldBack ? 1 : 0,
    p.owner ?? null, p.owner ? b58encode(crypto.randomBytes(32)) : null, `V1-${String.fromCharCode(65 + (seq % 6))}${String(seq % 40).padStart(2, '0')}`,
    file, p.seed, p.featured ?? 0, p.via ?? null, p.owner ? now() : null, now(), now());
  return id;
}

function gen(cat: RockType, value: number, r: () => number, state = 'vault') {
  const d = POOL[cat][Math.floor(r() * POOL[cat].length)];
  const mass = Math.max(0.05, value / PER_G[cat] * (0.85 + r() * 0.3));
  return insert({ name: d[0], cls: d[1], cat, mass: mass < 1 ? Math.round(mass * 100) / 100 : Math.round(mass * 10) / 10, origin: d[2], fall: d[3], value, state, seed: Math.floor(r() * 900) + 10 });
}

function series(id: string, name: string, tier: string, size: number, price: number | null, status: string, note: string, sort: number, dropId: string | null = null) {
  const seed = randomHex(32);
  run(`INSERT INTO series (id, name, tier, size, pack_price_usd, status, note, server_seed, commit_hash, drop_id, sort, composition_published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, name, tier, size, price, status, note, seed, sha256(seed), dropId, sort, status === 'open' ? now() : null, now());
}

export function seed() {
  const r = mulberry(2026);
  seq = 1000;
  tx(() => {
    run("INSERT INTO settings (key, value) VALUES ('rules', ?) ON CONFLICT(key) DO NOTHING", JSON.stringify(DEFAULT_RULES));

    // The design's market and register (HANDOFF "Sample data to replace").
    insert({ id: 'SR-00007', name: 'Tissint', cls: 'Martian, shergottite', cat: 'martian', mass: 0.41, origin: 'Morocco', fall: 2011, value: 240, state: 'market', seed: 21, featured: 1 });
    insert({ id: 'SR-00418', name: 'Muonionalusta', cls: 'Iron, IVA', cat: 'iron', mass: 112.4, origin: 'Sweden', fall: 'find', value: 420, state: 'market', seed: 57 });
    insert({ id: 'SR-00233', name: 'Brenham', cls: 'Pallasite, main group', cat: 'pallasite', mass: 8.2, origin: 'USA', fall: 'find', value: 150, state: 'market', seed: 33, featured: 2 });
    insert({ id: 'SR-00344', name: 'Gao-Guenie', cls: 'Chondrite, H5', cat: 'stone', mass: 12.8, origin: 'Burkina Faso', fall: 1960, value: 56, state: 'market', seed: 47 });
    insert({ id: 'SR-00121', name: 'Campo del Cielo', cls: 'Iron, IAB', cat: 'iron', mass: 21.6, origin: 'Argentina', fall: 'find', value: 36, state: 'market', seed: 45 });
    insert({ id: 'SR-00562', name: 'Holbrook', cls: 'Chondrite, L6', cat: 'stone', mass: 3.1, origin: 'USA', fall: 1912, value: 28, state: 'market', seed: 69 });

    const collector = b58encode(crypto.randomBytes(32));
    run("INSERT INTO wallets (address, kind, created_at, last_seen) VALUES (?, 'sample', ?, ?)", collector, now(), now());
    insert({ id: 'SR-00287', name: 'Odessa', cls: 'Iron, IAB', cat: 'iron', mass: 34.0, origin: 'USA', fall: 'find', value: 74, state: 'vault', seed: 39, featured: 3 });
    insert({ id: 'SR-00198', name: 'Campo del Cielo', cls: 'Iron, IAB', cat: 'iron', mass: 18.9, origin: 'Argentina', fall: 'find', value: 32, state: 'held', seed: 51, featured: 4, owner: collector, via: 'market' });
    insert({ id: 'SR-00359', name: 'Gao-Guenie', cls: 'Chondrite, H5', cat: 'stone', mass: 9.7, origin: 'Burkina Faso', fall: 1960, value: 70, state: 'vault', seed: 63, featured: 5, soldBack: true });
    insert({ id: 'SR-00571', name: 'Holbrook', cls: 'Chondrite, L6', cat: 'stone', mass: 2.4, origin: 'USA', fall: 1912, value: 24, state: 'redeemed', seed: 75, featured: 6 });
    insert({ id: 'SR-00601', name: 'Lunar breccia', cls: 'Lunar, feldspathic', cat: 'lunar', mass: 1.2, origin: null, fall: null, value: null, state: 'draft', seed: 81, featured: 7, complete: false });

    // Series 001 · Earth: 100 packs at $96 (78 floor, 19 par, 3 hit; EV about 86%).
    const PRICE = 96;
    const ids001: string[] = ['SR-00287'];
    for (let i = 0; i < 77; i++) ids001.push(gen(r() < 0.55 ? 'stone' : 'iron', Math.round(PRICE * (0.705 + r() * 0.13)), r));
    for (let i = 0; i < 19; i++) ids001.push(gen(r() < 0.5 ? 'stone' : 'iron', Math.round(PRICE * (0.92 + r() * 0.26)), r));
    ids001.push(gen('iron', 180, r), gen('iron', 156, r), gen('stone', 148, r));
    // Shuffle so the board does not follow the build order.
    for (let i = ids001.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids001[i], ids001[j]] = [ids001[j], ids001[i]]; }
    series('001', 'Series 001', 'earth', 100, PRICE, 'draft', 'Chondrite and iron fragments', 1);
    addSlots(seriesRow('001')!, ids001);
    run("UPDATE series SET status = 'open', composition_published_at = ? WHERE id = '001'", now());

    // Series 002 (announced) gets the sold-back Gao-Guenie, like the design's register.
    series('002', 'Series 002', 'earth', 100, PRICE, 'upcoming', 'Opens when 001 sells out', 2);
    addSlots(seriesRow('002')!, ['SR-00359']);
    series('MW', 'Mars Window', 'mars', 100, 140, 'upcoming', 'Hits are Martian and lunar · until 31 Dec', 3);

    // Free vault stock for new series and the Mars Window.
    for (let i = 0; i < 24; i++) gen(r() < 0.5 ? 'stone' : 'iron', Math.round(PRICE * (0.705 + r() * 0.13)), r);
    for (let i = 0; i < 6; i++) gen('pallasite', Math.round(PRICE * (0.95 + r() * 0.2)), r);
    gen('martian', 260, r); gen('lunar', 230, r); gen('martian', 310, r);

    // Launch drop 01: T-0 in 2 days 14 h 36 min, so it opens in 1 d 14 h 36 m (the design's clock).
    const t0 = new Date(Date.now() + ((48 + 14) * 3600 + 36 * 60) * 1000).toISOString();
    const dseed = randomHex(32);
    run('INSERT INTO drops (id, name, t0, series_id, closed, server_seed, commit_hash, rolled_over_from, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, NULL, ?)', 'drop-01', 'Launch drop 01', t0, 'L01', dseed, sha256(dseed), now());
    series('L01', 'Launch drop 01 pool', 'launch', 20, 120, 'draft', 'Opens 24 h before liftoff', 9, 'drop-01');
    const pool: string[] = [];
    for (let i = 0; i < 15; i++) pool.push(gen(r() < 0.5 ? 'stone' : 'iron', Math.round(120 * (0.705 + r() * 0.13)), r));
    for (let i = 0; i < 4; i++) pool.push(gen('pallasite', Math.round(120 * (0.92 + r() * 0.26)), r));
    pool.push(gen('pallasite', 190, r));
    addSlots(seriesRow('L01')!, pool);
    run("UPDATE series SET status = 'open', composition_published_at = ? WHERE id = 'L01'", now());
    const locks: [RockType, string, string, number, 'A' | 'B'][] = [
      ['lunar', 'Lunar', 'Feldspathic breccia', 71, 'A'], ['martian', 'Martian', 'Shergottite', 83, 'A'], ['pallasite', 'Pallasite', 'Main group', 95, 'B'],
    ];
    for (const [cat, name, cls, s, batch] of locks) {
      const id = insert({ name, cls, cat, mass: cat === 'pallasite' ? 14.2 : 0.6, origin: 'Morocco', fall: 'find', value: cat === 'pallasite' ? 260 : cat === 'lunar' ? 280 : 340, state: 'locked', seed: s });
      run('UPDATE specimens SET drop_id = ? WHERE id = ?', 'drop-01', id);
      run("INSERT INTO drop_locks (drop_id, specimen_id, batch, state) VALUES ('drop-01', ?, ?, 'locked')", id, batch);
    }
  });

  // 35 packs already opened in Series 001 by sample collectors (real draws, like the design's board).
  const wallets = Array.from({ length: 9 }, () => b58encode(crypto.randomBytes(32)));
  for (const w of wallets) run("INSERT INTO wallets (address, kind, created_at, last_seen) VALUES (?, 'sample', ?, ?)", w, now(), now());
  for (let i = 0; i < 35; i++) openPack(wallets[i % wallets.length], '001', i % 3 ? 'USDC' : 'SOL', 'seed' + i);
}

export function ensureSeeded() {
  if (!get('SELECT 1 FROM specimens LIMIT 1')) seed();
}

export function reseed() {
  const tables = all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('sessions', 'sqlite_sequence')").map(t => t.name);
  tx(() => { for (const t of tables) db.exec(`DELETE FROM ${t}`); });
  seed();
}

export type { Band };
export { bandOf };
