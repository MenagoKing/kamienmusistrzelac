// Admin operations: specimens, series, launch drops, redemptions, settings, overview.
import type { Band, DropEventKind, RockType, Rules, SpecimenFile, Tier } from '../shared/types.ts';
import { FILE_ITEMS } from '../shared/types.ts';
import { BANDS, bandOf, checkSeries } from '../shared/rules.ts';
import { chain } from './chain.ts';
import { queueMint } from './nft.ts';
import { all, get, now, run, tx } from './db.ts';
import { addSlots, audit, closeSeries, ledger, pullCount, sealedSlots } from './ops.ts';
import {
  dropRow, dropStatus, fileComplete, getRules, redemptionOf, saveRules, seriesRow, specimenRow, toAdmin, toDrop, toSeries,
  type DropRow, type SeriesRow, type SlotRow, type SpecimenRow,
} from './store.ts';
import { cents, drawPickSync, fail, num, optStr, randomHex, sha256, str, uid } from './util.ts';

const CATEGORIES: RockType[] = ['stone', 'iron', 'pallasite', 'lunar', 'martian'];
const TIERS: Tier[] = ['earth', 'orbit', 'mars', 'launch'];
const TIER_CATS: Record<Tier, RockType[]> = { earth: ['stone', 'iron'], orbit: ['stone', 'iron', 'pallasite'], mars: CATEGORIES, launch: CATEGORIES };

/* ---------- overview ---------- */

export function overview() {
  const n = (sql: string, ...p: any[]) => get<{ n: number }>(sql, ...p)!.n ?? 0;
  const sum = (sql: string, ...p: any[]) => cents(get<{ s: number | null }>(sql, ...p)!.s ?? 0);
  const byState = Object.fromEntries(all<{ state: string; n: number }>('SELECT state, COUNT(*) n FROM specimens GROUP BY state').map(r => [r.state, r.n]));
  const splits = all<{ split: string }>("SELECT split FROM ledger WHERE kind = 'pack'").map(r => JSON.parse(r.split));
  const reserve = (k: string) => cents(splits.reduce((a, s) => a + (s[k] ?? 0), 0));
  const days: { day: string; packs: number; market: number; buyback: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({
      day: d,
      packs: sum("SELECT SUM(usd) s FROM ledger WHERE kind = 'pack' AND substr(created_at, 1, 10) = ?", d),
      market: sum("SELECT SUM(usd) s FROM ledger WHERE kind IN ('market_buy', 'reservation') AND substr(created_at, 1, 10) = ?", d),
      buyback: -sum("SELECT SUM(usd) s FROM ledger WHERE kind = 'buyback' AND substr(created_at, 1, 10) = ?", d),
    });
  }
  return {
    revenue: {
      packs: sum("SELECT SUM(usd) s FROM ledger WHERE kind = 'pack'"),
      market: sum("SELECT SUM(usd) s FROM ledger WHERE kind IN ('market_buy', 'reservation')"),
      commission: sum("SELECT SUM(json_extract(split, '$.commission')) s FROM ledger WHERE kind = 'reservation'"),
      commission_kept_on_cancel: sum("SELECT SUM(json_extract(split, '$.commission_kept')) s FROM ledger WHERE kind = 'reservation_cancel'"),
      token_burn_reserved: sum("SELECT SUM(json_extract(split, '$.token_burn')) s FROM ledger WHERE kind = 'reservation'"),
      redemption_fees: sum("SELECT SUM(usd) s FROM ledger WHERE kind = 'redemption_fee'"),
      royalties: sum("SELECT SUM(usd) s FROM ledger WHERE kind IN ('secondary_sale', 'seller_payout')"),
      secondary_volume: sum("SELECT SUM(usd) s FROM ledger WHERE kind = 'secondary_sale'"),
      buybacks_paid: -sum("SELECT SUM(usd) s FROM ledger WHERE kind = 'buyback'"),
    },
    reserves: { rocks_buyback: reserve('rocks_buyback'), launch_reserve: reserve('launch_reserve'), ops: reserve('ops'), inventory: reserve('inventory') },
    counts: {
      specimens: n('SELECT COUNT(*) n FROM specimens'), by_state: byState,
      vault_value: sum("SELECT SUM(vault_value_usd) s FROM specimens WHERE state NOT IN ('redeemed')"),
      packs_opened: n('SELECT COUNT(*) n FROM pulls WHERE bonus = 0'), wallets: n('SELECT COUNT(*) n FROM wallets'),
      waitlist: n('SELECT COUNT(*) n FROM waitlist'), redemptions_open: n("SELECT COUNT(*) n FROM redemptions WHERE status IN ('requested', 'ordered', 'packing')"),
      drafts: n("SELECT COUNT(*) n FROM specimens WHERE state = 'draft'"), sold_back_waiting: n("SELECT COUNT(*) n FROM specimens WHERE state = 'vault' AND sold_back = 1"),
      escrow_locked: sum("SELECT SUM(amount_usd) s FROM escrows WHERE status = 'locked'"), reservations_active: n("SELECT COUNT(*) n FROM reservations WHERE status = 'active'"),
      sold_at_source_waiting: n("SELECT COUNT(*) n FROM reservations WHERE status = 'sold_at_source'"),
      dealer_orders_due: n("SELECT COUNT(*) n FROM redemptions WHERE kind = 'dealer' AND status = 'requested'"),
      dealer_orders_overdue: n("SELECT COUNT(*) n FROM redemptions WHERE kind = 'dealer' AND status = 'requested' AND due_at < ?", new Date().toISOString()),
    },
    days,
    series: all<SeriesRow>("SELECT * FROM series WHERE status IN ('open', 'upcoming') ORDER BY sort, id").map(toSeries),
    drop: (() => { const d = get<DropRow>('SELECT * FROM drops WHERE closed = 0 ORDER BY t0 LIMIT 1'); return d ? toDrop(d) : null; })(),
    activity: all<any>('SELECT * FROM ledger ORDER BY created_at DESC LIMIT 12'),
  };
}

/* ---------- specimens ---------- */

export function listSpecimens(q: URLSearchParams) {
  const where: string[] = [], p: any[] = [];
  const s = q.get('q');
  if (s) { where.push('(lower(name) LIKE ? OR lower(class) LIKE ? OR lower(id) LIKE ? OR lower(coalesce(owner, \'\')) LIKE ?)'); const l = `%${s.toLowerCase()}%`; p.push(l, l, l, l); }
  if (q.get('state')) { where.push('state = ?'); p.push(q.get('state')); }
  if (q.get('category')) { where.push('category = ?'); p.push(q.get('category')); }
  if (q.get('sold_back') === '1') where.push('sold_back = 1');
  const rows = all<SpecimenRow>(`SELECT * FROM specimens ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`, ...p);
  return rows.map(toAdmin);
}

function nextSpecimenId() {
  const r = get<{ id: string }>("SELECT id FROM specimens ORDER BY CAST(substr(id, 4) AS INTEGER) DESC LIMIT 1");
  const n = r ? parseInt(r.id.slice(3), 10) + 1 : 1;
  return 'SR-' + String(n).padStart(5, '0');
}

function readFile(v: any): SpecimenFile {
  const f: SpecimenFile = {};
  if (!v || typeof v !== 'object') return f;
  for (const { key } of FILE_ITEMS) {
    if (key === 'photos') f.photos = Array.isArray(v.photos) ? v.photos.map((x: unknown) => optStr(x, 500)).filter(Boolean) : [];
    else f[key] = optStr(v[key], 500);
  }
  return f;
}

function readSpecimen(b: any) {
  const category = b?.category as RockType;
  if (!CATEGORIES.includes(category)) fail(400, 'Pick a category');
  const fall = b?.fall === 'find' ? 'find' : b?.fall == null || b?.fall === '' ? null : String(num(b.fall, 'Fall year', 1400, 2100));
  return {
    name: str(b?.name, 'Name', 120), class: str(b?.class, 'Classification', 120), category,
    mass_g: num(b?.mass_g, 'Mass', 0.001, 1e7), origin: optStr(b?.origin, 80) || null, fall,
    vault_value_usd: b?.vault_value_usd == null || b?.vault_value_usd === '' ? null : num(b.vault_value_usd, 'Vault value', 0.01, 1e8),
    vault_id: optStr(b?.vault_id, 60) || null, notes: optStr(b?.notes, 4000), file: readFile(b?.file),
    render_seed: b?.render_seed == null || b?.render_seed === '' ? Math.floor(Math.random() * 1000) : Math.round(num(b.render_seed, 'Render seed', 0, 1e6)),
    dealer_id: optStr(b?.dealer_id, 60) || null,
    dealer_price_usd: b?.dealer_price_usd == null || b?.dealer_price_usd === '' ? null : num(b.dealer_price_usd, 'Dealer price', 0.01, 1e8),
    dealer_sku: optStr(b?.dealer_sku, 120), dealer_url: optStr(b?.dealer_url, 500),
  };
}

/** A sourced specimen's value follows the dealer's price while it is not reserved or sealed. */
function sourceValue(d: ReturnType<typeof readSpecimen>) {
  if (d.dealer_id && !get('SELECT 1 FROM dealers WHERE id = ?', d.dealer_id)) fail(400, 'Unknown dealer');
  if (d.dealer_id && d.dealer_price_usd == null) fail(400, 'Set the dealer price');
  return d.dealer_id ? d.dealer_price_usd : d.vault_value_usd;
}

export function createSpecimen(actor: string, b: any) {
  const d = readSpecimen(b);
  return tx(() => {
    const id = nextSpecimenId();
    const value = sourceValue(d);
    const complete = fileComplete({ file: JSON.stringify(d.file), origin: d.origin, vault_value_usd: value, vault_id: d.vault_id });
    run(`INSERT INTO specimens (id, name, class, category, mass_g, origin, fall, vault_value_usd, state, vault_id, file, notes, render_seed, dealer_id, dealer_price_usd, dealer_sku, dealer_url, source_status, source_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?)`,
      id, d.name, d.class, d.category, d.mass_g, d.origin, d.fall, value, complete ? 'vault' : 'draft', d.vault_id, JSON.stringify(d.file), d.notes, d.render_seed,
      d.dealer_id, d.dealer_price_usd, d.dealer_sku, d.dealer_url, d.dealer_id ? now() : null, now(), now());
    audit(actor, 'specimen.create', id, { name: d.name });
    return toAdmin(specimenRow(id)!);
  });
}

export function updateSpecimen(actor: string, id: string, b: any) {
  const d = readSpecimen(b);
  return tx(() => {
    const s = specimenRow(id) ?? fail(404, 'Specimen not found');
    const valueLocked = ['series', 'locked', 'held', 'redeeming', 'redeemed'].includes(s.state);
    if ((d.dealer_id ?? null) !== (s.dealer_id ?? null) && ['held', 'redeeming', 'redeemed'].includes(s.state)) fail(409, 'The dealer cannot change while the specimen is reserved or redeemed');
    // A dealer price may change any time (reservations keep their reserved price); a recorded value is fixed once sealed or held.
    const value = d.dealer_id ? (valueLocked ? s.vault_value_usd : sourceValue(d)) : d.vault_value_usd;
    if (!d.dealer_id && valueLocked && d.vault_value_usd !== s.vault_value_usd) fail(409, `The value is fixed while the specimen is ${s.state === 'series' ? 'sealed in a series' : s.state}`);
    const complete = fileComplete({ file: JSON.stringify(d.file), origin: d.origin, vault_value_usd: value, vault_id: d.vault_id });
    let state = s.state;
    if (state === 'draft' && complete) state = 'vault';
    if ((state === 'vault' || state === 'market') && !complete) state = 'draft';
    const priceChanged = d.dealer_id && d.dealer_price_usd !== s.dealer_price_usd;
    run(`UPDATE specimens SET name = ?, class = ?, category = ?, mass_g = ?, origin = ?, fall = ?, vault_value_usd = ?, state = ?, vault_id = ?, file = ?, notes = ?, render_seed = ?,
         dealer_id = ?, dealer_price_usd = ?, dealer_sku = ?, dealer_url = ?, source_verified_at = CASE WHEN ? THEN ? ELSE source_verified_at END, updated_at = ? WHERE id = ?`,
      d.name, d.class, d.category, d.mass_g, d.origin, d.fall, value, state, d.vault_id, JSON.stringify(d.file), d.notes, d.render_seed,
      d.dealer_id, d.dealer_id ? d.dealer_price_usd : null, d.dealer_sku, d.dealer_url, priceChanged ? 1 : 0, now(), now(), id);
    audit(actor, 'specimen.update', id, { state });
    return toAdmin(specimenRow(id)!);
  });
}

export function deleteSpecimen(actor: string, id: string) {
  return tx(() => {
    const s = specimenRow(id) ?? fail(404, 'Specimen not found');
    if (!['draft', 'vault'].includes(s.state)) fail(409, 'Only specimens in the vault or in draft can be deleted');
    if (get('SELECT 1 FROM pulls WHERE specimen_id = ? LIMIT 1', id) || get('SELECT 1 FROM slots WHERE specimen_id = ? LIMIT 1', id)) fail(409, 'This specimen has history; it cannot be deleted');
    run('DELETE FROM specimens WHERE id = ?', id);
    audit(actor, 'specimen.delete', id);
    return { ok: true };
  });
}

export function setListing(actor: string, id: string, list: boolean) {
  return tx(() => {
    const s = specimenRow(id) ?? fail(404, 'Specimen not found');
    if (list) {
      if (s.state !== 'vault') fail(409, s.state === 'draft' ? 'Complete the file before listing' : `Cannot list a specimen that is ${s.state}`);
      run("UPDATE specimens SET state = 'market', sold_back = 0, updated_at = ? WHERE id = ?", now(), id);
    } else {
      if (s.state !== 'market') fail(409, 'Not on the market');
      run("UPDATE specimens SET state = 'vault', updated_at = ? WHERE id = ?", now(), id);
    }
    audit(actor, list ? 'specimen.list' : 'specimen.unlist', id);
    return toAdmin(specimenRow(id)!);
  });
}

export function setFeatured(actor: string, id: string, featured: boolean) {
  const s = specimenRow(id) ?? fail(404, 'Specimen not found');
  const pos = featured ? (get<{ m: number | null }>('SELECT MAX(featured) m FROM specimens')!.m ?? 0) + 1 : 0;
  run('UPDATE specimens SET featured = ?, updated_at = ? WHERE id = ?', pos, now(), s.id);
  audit(actor, featured ? 'specimen.feature' : 'specimen.unfeature', id);
  return toAdmin(specimenRow(id)!);
}

/* ---------- series ---------- */

export function seriesDetail(id: string) {
  const s = seriesRow(id) ?? fail(404, 'Series not found');
  const rules = getRules();
  const slots = all<SlotRow & SpecimenRow>('SELECT sp.*, sl.idx, sl.band, sl.added_at, sl.opened_nonce, sl.vault_value_usd AS slot_value FROM slots sl JOIN specimens sp ON sp.id = sl.specimen_id WHERE sl.series_id = ? ORDER BY sl.idx', id);
  const check = checkSeries(s, slots.filter(x => x.opened_nonce == null || s.status !== 'draft').map(x => ({ vault_value_usd: (x as any).slot_value, file_complete: s.status === 'draft' ? fileComplete(x) : true })), rules);
  const pulls = all<any>('SELECT * FROM pulls WHERE series_id = ? ORDER BY created_at DESC', id);
  const revenue = cents(get<{ s: number | null }>("SELECT SUM(usd) s FROM ledger WHERE kind = 'pack' AND series_id = ?", id)!.s ?? 0);
  return {
    series: { ...toSeries(s), server_seed: s.seed_revealed ? s.server_seed : null, sort: s.sort },
    slots: slots.map(x => ({ idx: x.idx, band: x.band, opened: x.opened_nonce != null, added_at: x.added_at, specimen: toAdmin(x), vault_value_usd: (x as any).slot_value })),
    check, pulls, revenue,
  };
}

function readSeries(b: any, partial = false) {
  const tier = b?.tier as Tier;
  if (!partial && !TIERS.includes(tier)) fail(400, 'Pick a tier');
  return {
    name: str(b?.name, 'Name', 80), tier,
    size: Math.round(num(b?.size, 'Size', 1, 1000)),
    pack_price_usd: b?.pack_price_usd == null || b?.pack_price_usd === '' ? null : num(b.pack_price_usd, 'Pack price', 1, 1e6),
    note: optStr(b?.note, 140), sort: b?.sort == null || b?.sort === '' ? 0 : Math.round(num(b.sort, 'Order', -1000, 1000)),
  };
}

function nextSeriesId() {
  const r = all<{ id: string }>('SELECT id FROM series').map(x => parseInt(x.id, 10)).filter(Number.isFinite);
  return String((r.length ? Math.max(...r) : 0) + 1).padStart(3, '0');
}

export function createSeries(actor: string, b: any, dropId: string | null = null) {
  const d = readSeries(b);
  return tx(() => {
    const id = optStr(b?.id, 40).replace(/[^\w-]/g, '') || nextSeriesId();
    if (seriesRow(id)) fail(409, `Series ${id} already exists`);
    const seed = randomHex(32);
    run(`INSERT INTO series (id, name, tier, size, pack_price_usd, status, note, server_seed, commit_hash, drop_id, sort, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      id, d.name, d.tier, d.size, d.pack_price_usd, d.note, seed, sha256(seed), dropId, d.sort, now());
    audit(actor, 'series.create', id, d);
    return seriesDetail(id);
  });
}

export function updateSeries(actor: string, id: string, b: any) {
  return tx(() => {
    const s = seriesRow(id) ?? fail(404, 'Series not found');
    const d = readSeries({ ...s, ...b }, true);
    const editable = s.status === 'draft' || s.status === 'upcoming';
    if (!editable && (d.size !== s.size || d.pack_price_usd !== s.pack_price_usd || d.tier !== s.tier)) fail(409, 'Size, tier and pack price are fixed once a series is open');
    run('UPDATE series SET name = ?, tier = ?, size = ?, pack_price_usd = ?, note = ?, sort = ? WHERE id = ?', d.name, d.tier, d.size, d.pack_price_usd, d.note, d.sort, id);
    if (editable && d.pack_price_usd) rebanding(id, d.pack_price_usd);
    audit(actor, 'series.update', id, d);
    return seriesDetail(id);
  });
}

function rebanding(id: string, pack: number) {
  const rules = getRules();
  for (const sl of all<SlotRow>('SELECT * FROM slots WHERE series_id = ?', id)) {
    run('UPDATE slots SET band = ? WHERE series_id = ? AND idx = ?', bandOf(sl.vault_value_usd, pack, rules) ?? 'floor', id, sl.idx);
  }
}

export function seriesAddSlots(actor: string, id: string, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length) fail(400, 'Pick at least one specimen');
  return tx(() => {
    const s = seriesRow(id) ?? fail(404, 'Series not found');
    if (s.status !== 'draft' && s.status !== 'upcoming') fail(409, 'Specimens can only be added before a series opens (launch drops add Batch A on booster catch)');
    addSlots(s, ids as string[]);
    audit(actor, 'series.add', id, { ids });
    return seriesDetail(id);
  });
}

export function seriesRemoveSlot(actor: string, id: string, idx: number) {
  return tx(() => {
    const s = seriesRow(id) ?? fail(404, 'Series not found');
    if (s.status !== 'draft' && s.status !== 'upcoming') fail(409, 'The composition is fixed once a series opens');
    const sl = get<SlotRow>('SELECT * FROM slots WHERE series_id = ? AND idx = ?', id, idx) ?? fail(404, 'Slot not found');
    run('DELETE FROM slots WHERE series_id = ? AND idx = ?', id, idx);
    run("UPDATE specimens SET state = 'vault', series_id = NULL, updated_at = ? WHERE id = ?", now(), sl.specimen_id);
    audit(actor, 'series.remove', id, { specimen: sl.specimen_id });
    return seriesDetail(id);
  });
}

export function seriesClear(actor: string, id: string) {
  return tx(() => {
    const s = seriesRow(id) ?? fail(404, 'Series not found');
    if (s.status !== 'draft' && s.status !== 'upcoming') fail(409, 'The composition is fixed once a series opens');
    for (const sl of all<SlotRow>('SELECT * FROM slots WHERE series_id = ?', id)) run("UPDATE specimens SET state = 'vault', series_id = NULL, updated_at = ? WHERE id = ?", now(), sl.specimen_id);
    run('DELETE FROM slots WHERE series_id = ?', id);
    audit(actor, 'series.clear', id);
    return seriesDetail(id);
  });
}

/** Fills the empty slots from the free vault to hit the band counts. Sold-back specimens go first. */
export function seriesAutofill(actor: string, id: string) {
  return tx(() => {
    const s = seriesRow(id) ?? fail(404, 'Series not found');
    if (s.status !== 'draft' && s.status !== 'upcoming') fail(409, 'The composition is fixed once a series opens');
    if (!s.pack_price_usd) fail(409, 'Set a pack price first');
    const rules = getRules();
    const have: Record<Band, number> = { floor: 0, par: 0, hit: 0 };
    for (const sl of all<SlotRow>('SELECT * FROM slots WHERE series_id = ?', id)) have[sl.band]++;
    const cats = TIER_CATS[s.tier];
    const free = all<SpecimenRow>(`SELECT * FROM specimens WHERE state = 'vault' AND category IN (${cats.map(() => '?').join(',')}) ORDER BY sold_back DESC, id`, ...cats).filter(fileComplete);
    const picked: string[] = [];
    const total = all<SlotRow>('SELECT * FROM slots WHERE series_id = ?', id).length;
    for (const b of BANDS) {
      const want = Math.round(rules.bands[b].count * s.size / rules.series_size) - have[b];
      if (want <= 0) continue;
      const cand = free.filter(x => !picked.includes(x.id) && bandOf(x.vault_value_usd!, s.pack_price_usd!, rules) === b);
      picked.push(...cand.slice(0, want).map(x => x.id));
    }
    const room = s.size - total;
    const ids = picked.slice(0, Math.max(0, room));
    if (!ids.length) fail(409, 'No free specimens in the vault fit the missing bands at this pack price');
    addSlots(s, ids);
    audit(actor, 'series.autofill', id, { added: ids.length });
    return seriesDetail(id);
  });
}

export function seriesStatus(actor: string, id: string, action: string) {
  return tx(() => {
    const s = seriesRow(id) ?? fail(404, 'Series not found');
    const rules = getRules();
    if (action === 'announce' || action === 'open') {
      if (s.status !== 'draft' && s.status !== 'upcoming') fail(409, 'Already open or finished');
      if (action === 'open') {
        const slots = all<SlotRow & SpecimenRow>('SELECT sp.*, sl.band FROM slots sl JOIN specimens sp ON sp.id = sl.specimen_id WHERE sl.series_id = ?', id);
        const check = checkSeries(s, slots.map(x => ({ vault_value_usd: x.vault_value_usd, file_complete: fileComplete(x) })), rules);
        if (check.errors.length) fail(409, 'Fix the composition first: ' + check.errors.join(' '));
        if (s.drop_id) {
          const d = dropRow(s.drop_id);
          if (d?.closed) fail(409, 'This drop is closed');
        }
        run("UPDATE series SET status = 'open', composition_published_at = coalesce(composition_published_at, ?) WHERE id = ?", now(), id);
      } else {
        run("UPDATE series SET status = 'upcoming' WHERE id = ?", id);
      }
    } else if (action === 'draft') {
      if (s.status !== 'upcoming') fail(409, 'Only an announced series can go back to draft');
      run("UPDATE series SET status = 'draft' WHERE id = ?", id);
    } else if (action === 'close') {
      if (s.status === 'closed') fail(409, 'Already closed');
      if (s.status === 'draft' || s.status === 'upcoming') {
        if (pullCount(id) === 0) {
          for (const sl of all<SlotRow>('SELECT * FROM slots WHERE series_id = ?', id)) run("UPDATE specimens SET state = 'vault', series_id = NULL, updated_at = ? WHERE id = ?", now(), sl.specimen_id);
          run('DELETE FROM slots WHERE series_id = ?', id);
          run('DELETE FROM series WHERE id = ?', id);
          audit(actor, 'series.delete', id);
          return { deleted: true };
        }
      }
      closeSeries(s);
    } else fail(400, 'Unknown action');
    audit(actor, 'series.' + action, id);
    return seriesDetail(id);
  });
}

/* ---------- launch drops ---------- */

export function dropDetail(id: string) {
  const d = dropRow(id) ?? fail(404, 'Drop not found');
  const participants = d.series_id ? all<{ wallet: string; n: number }>('SELECT wallet, COUNT(*) n FROM pulls WHERE series_id = ? AND bonus = 0 GROUP BY wallet ORDER BY wallet', d.series_id) : [];
  return {
    drop: { ...toDrop(d), server_seed: d.closed ? d.server_seed : null, commit_hash: d.commit_hash },
    series: d.series_id ? seriesDetail(d.series_id) : null,
    participants,
    bonus: all<any>('SELECT * FROM pulls WHERE drop_id = ? AND bonus = 1 ORDER BY created_at', id),
  };
}

export function listDrops() {
  return all<DropRow>('SELECT * FROM drops ORDER BY t0 DESC').map(d => {
    const x = toDrop(d);
    return { ...x, series: d.series_id ? toSeries(seriesRow(d.series_id)!) : null };
  });
}

function readT0(v: unknown) {
  const t = Date.parse(String(v ?? ''));
  if (!Number.isFinite(t)) fail(400, 'Set T-0 as a date and time');
  return new Date(t).toISOString();
}

export function createDrop(actor: string, b: any) {
  const name = str(b?.name, 'Name', 80), t0 = readT0(b?.t0);
  return tx(() => {
    const n = get<{ n: number }>('SELECT COUNT(*) n FROM drops')!.n + 1;
    const id = 'drop-' + String(n).padStart(2, '0');
    const seed = randomHex(32);
    // Specimens rolled over from closed drops join this one.
    const rolled = all<{ drop_id: string; specimen_id: string; batch: string }>("SELECT l.* FROM drop_locks l JOIN drops d ON d.id = l.drop_id WHERE l.state = 'rolled' AND d.closed = 1");
    const from = rolled[0]?.drop_id ?? null;
    run('INSERT INTO drops (id, name, t0, series_id, closed, server_seed, commit_hash, rolled_over_from, created_at) VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?)', id, name, t0, seed, sha256(seed), from, now());
    for (const r of rolled) {
      run("UPDATE drop_locks SET state = 'carried' WHERE drop_id = ? AND specimen_id = ?", r.drop_id, r.specimen_id);
      run("INSERT INTO drop_locks (drop_id, specimen_id, batch, state) VALUES (?, ?, ?, 'locked')", id, r.specimen_id, r.batch);
      run("UPDATE specimens SET state = 'locked', drop_id = ?, updated_at = ? WHERE id = ?", id, now(), r.specimen_id);
    }
    if (b?.pack_price_usd) {
      const sid = 'L' + String(n).padStart(2, '0');
      createSeries(actor, { id: sid, name: `${name} pool`, tier: 'launch', size: b.size || 20, pack_price_usd: b.pack_price_usd, note: 'Opens 24 h before liftoff' }, id);
      run('UPDATE drops SET series_id = ? WHERE id = ?', sid, id);
    }
    audit(actor, 'drop.create', id, { name, t0, rolled: rolled.length });
    return dropDetail(id);
  });
}

export function updateDrop(actor: string, id: string, b: any) {
  return tx(() => {
    const d = dropRow(id) ?? fail(404, 'Drop not found');
    if (d.closed) fail(409, 'This drop is closed');
    const name = str(b?.name ?? d.name, 'Name', 80), t0 = readT0(b?.t0 ?? d.t0);
    run('UPDATE drops SET name = ?, t0 = ? WHERE id = ?', name, t0, id);
    audit(actor, 'drop.update', id, { name, t0 });
    return dropDetail(id);
  });
}

export function dropCreateSeries(actor: string, id: string, b: any) {
  return tx(() => {
    const d = dropRow(id) ?? fail(404, 'Drop not found');
    if (d.series_id) fail(409, 'This drop already has a pool');
    const sid = 'L' + id.replace(/\D/g, '');
    createSeries(actor, { id: sid, name: `${d.name} pool`, tier: 'launch', size: b?.size || 20, pack_price_usd: b?.pack_price_usd, note: 'Opens 24 h before liftoff' }, id);
    run('UPDATE drops SET series_id = ? WHERE id = ?', sid, id);
    return dropDetail(id);
  });
}

export function dropLock(actor: string, id: string, b: any) {
  const batch = b?.batch === 'B' ? 'B' : 'A';
  const ids: string[] = Array.isArray(b?.specimen_ids) ? b.specimen_ids : [str(b?.specimen_id, 'Specimen')];
  return tx(() => {
    const d = dropRow(id) ?? fail(404, 'Drop not found');
    if (d.closed) fail(409, 'This drop is closed');
    for (const sid of ids) {
      const s = specimenRow(sid) ?? fail(404, `Specimen ${sid} not found`);
      if (s.state !== 'vault') fail(409, `${sid} is not free in the vault`);
      if (!fileComplete(s)) fail(409, `${sid} has an incomplete file`);
      run("INSERT INTO drop_locks (drop_id, specimen_id, batch, state) VALUES (?, ?, ?, 'locked') ON CONFLICT(drop_id, specimen_id) DO UPDATE SET batch = excluded.batch, state = 'locked'", id, sid, batch);
      run("UPDATE specimens SET state = 'locked', drop_id = ?, updated_at = ? WHERE id = ?", id, now(), sid);
    }
    audit(actor, 'drop.lock', id, { ids, batch });
    return dropDetail(id);
  });
}

export function dropUnlock(actor: string, id: string, specimenId: string) {
  return tx(() => {
    const l = get<{ state: string }>('SELECT state FROM drop_locks WHERE drop_id = ? AND specimen_id = ?', id, specimenId) ?? fail(404, 'Not locked in this drop');
    if (l.state !== 'locked') fail(409, 'Already resolved');
    run('DELETE FROM drop_locks WHERE drop_id = ? AND specimen_id = ?', id, specimenId);
    run("UPDATE specimens SET state = 'vault', drop_id = NULL, updated_at = ? WHERE id = ?", now(), specimenId);
    audit(actor, 'drop.unlock', id, { specimenId });
    return dropDetail(id);
  });
}

const KINDS: DropEventKind[] = ['liftoff', 'booster_catch', 'ship_catch', 'scrub', 'fail'];

/** Resolves a flight event. Every event needs a link to the official source and is public. */
export function dropEvent(actor: string, id: string, b: any) {
  const kind = b?.kind as DropEventKind;
  if (!KINDS.includes(kind)) fail(400, 'Unknown event');
  const source = str(b?.source_url, 'Official source link', 500);
  if (!/^https:\/\//.test(source)) fail(400, 'The source must be an https link');
  const note = optStr(b?.note, 500);
  return tx(() => {
    const d = dropRow(id) ?? fail(404, 'Drop not found');
    if (d.closed) fail(409, 'This drop is already closed');
    const done = all<{ kind: string }>('SELECT kind FROM drop_events WHERE drop_id = ?', id).map(e => e.kind);
    if (done.includes(kind)) fail(409, 'This event is already recorded');
    const locks = all<{ specimen_id: string; batch: 'A' | 'B'; state: string }>("SELECT * FROM drop_locks WHERE drop_id = ? AND state = 'locked'", id);
    const s = d.series_id ? seriesRow(d.series_id) : undefined;
    const result: Record<string, unknown> = {};

    if (kind === 'booster_catch') {
      if (!s || s.status !== 'open') fail(409, 'Open the drop pool before unlocking Batch A');
      const a = locks.filter(l => l.batch === 'A').map(l => l.specimen_id);
      if (a.length) addSlots(s!, a, { allowLocked: true });
      for (const sid of a) run("UPDATE drop_locks SET state = 'unlocked' WHERE drop_id = ? AND specimen_id = ?", id, sid);
      result.unlocked = a;
    }

    if (kind === 'ship_catch') {
      const wallets = s ? all<{ wallet: string }>('SELECT DISTINCT wallet FROM pulls WHERE series_id = ? AND bonus = 0 ORDER BY wallet', s.id).map(w => w.wallet) : [];
      const bLocks = locks.filter(l => l.batch === 'B');
      const won: { specimen: string; wallet: string }[] = [];
      bLocks.forEach((l, i) => {
        if (!wallets.length) {
          run("UPDATE drop_locks SET state = 'rolled' WHERE drop_id = ? AND specimen_id = ?", id, l.specimen_id);
          return;
        }
        const w = wallets[drawPickSync(d.server_seed, d.id, i, 'raffle', wallets.length)];
        const sp = specimenRow(l.specimen_id)!;
        run("UPDATE specimens SET state = 'held', owner = ?, drop_id = NULL, acquired_via = 'raffle', acquired_at = ?, paid_usd = 0, updated_at = ? WHERE id = ?", w, now(), now(), sp.id);
        queueMint(sp.id, w);
        run("UPDATE drop_locks SET state = 'raffled' WHERE drop_id = ? AND specimen_id = ?", id, l.specimen_id);
        const band = (s?.pack_price_usd ? bandOf(sp.vault_value_usd!, s.pack_price_usd, getRules()) : null) ?? 'hit';
        run(`INSERT INTO pulls (id, series_id, drop_id, specimen_id, wallet, band, pack_price_usd, vault_value_usd, nonce, client_seed, pool, pick, slot, bonus, tx, created_at)
             VALUES (?, NULL, ?, ?, ?, ?, 0, ?, ?, 'raffle', ?, NULL, NULL, 1, ?, ?)`, uid('pl'), id, sp.id, w, band, sp.vault_value_usd, i, wallets.length, null, now());
        ledger('raffle', { wallet: w, specimen_id: sp.id, usd: 0, currency: 'USDC', amount: 0, tx: null, split: { vault_value: sp.vault_value_usd } });
        won.push({ specimen: sp.id, wallet: w });
      });
      // Anything still locked (Batch A never unlocked) rolls over.
      for (const l of locks.filter(l => l.batch === 'A')) run("UPDATE drop_locks SET state = 'rolled' WHERE drop_id = ? AND specimen_id = ?", id, l.specimen_id);
      result.raffled = won;
    }

    if (kind === 'scrub' || kind === 'fail') {
      for (const l of locks) run("UPDATE drop_locks SET state = 'rolled' WHERE drop_id = ? AND specimen_id = ?", id, l.specimen_id);
      result.rolled = locks.map(l => l.specimen_id);
    }

    run('INSERT INTO drop_events (id, drop_id, kind, source_url, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', uid('ev'), id, kind, source, note, actor, now());

    if (kind === 'ship_catch' || kind === 'scrub' || kind === 'fail') {
      run('UPDATE drops SET closed = 1 WHERE id = ?', id);
      if (s && s.status !== 'closed' && s.status !== 'sold_out') closeSeries(s);
      if (s && s.status === 'sold_out') run('UPDATE series SET seed_revealed = 1 WHERE id = ?', s.id);
      // Rolled specimens wait for the next drop: move them now if one is scheduled.
      const next = get<DropRow>('SELECT * FROM drops WHERE closed = 0 AND id != ? ORDER BY t0 LIMIT 1', id);
      const rolled = all<{ specimen_id: string; batch: string }>("SELECT * FROM drop_locks WHERE drop_id = ? AND state = 'rolled'", id);
      if (next && rolled.length) {
        for (const r of rolled) {
          run("UPDATE drop_locks SET state = 'carried' WHERE drop_id = ? AND specimen_id = ?", id, r.specimen_id);
          run("INSERT INTO drop_locks (drop_id, specimen_id, batch, state) VALUES (?, ?, ?, 'locked') ON CONFLICT(drop_id, specimen_id) DO UPDATE SET state = 'locked'", next.id, r.specimen_id, r.batch);
          run("UPDATE specimens SET drop_id = ?, updated_at = ? WHERE id = ?", next.id, now(), r.specimen_id);
        }
        run('UPDATE drops SET rolled_over_from = ? WHERE id = ?', id, next.id);
        result.carried_to = next.id;
      }
    }
    audit(actor, 'drop.' + kind, id, { source, ...result });
    return { ...dropDetail(id), result };
  });
}

/* ---------- redemptions ---------- */

export function listRedemptions(status: string | null) {
  return all<any>(`SELECT * FROM redemptions ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC`, ...(status ? [status] : [])).map(r => {
    const sp = specimenRow(r.specimen_id);
    return { ...redemptionOf(r), dealer_sku: sp?.dealer_sku ?? '', dealer_url: sp?.dealer_url ?? '', dealer_price_usd: sp?.dealer_price_usd ?? null };
  });
}

export function updateRedemption(actor: string, id: string, b: any) {
  const status = b?.status as string;
  if (!['requested', 'ordered', 'packing', 'shipped', 'delivered', 'cancelled'].includes(status)) fail(400, 'Unknown status');
  return tx(() => {
    const r = get<any>('SELECT * FROM redemptions WHERE id = ?', id) ?? fail(404, 'Redemption not found');
    if (r.status === 'cancelled' || r.status === 'delivered') fail(409, 'This redemption is finished');
    const tracking = optStr(b?.tracking ?? r.tracking, 120);
    const ref = optStr(b?.dealer_order_ref ?? r.dealer_order_ref, 120);
    if (status === 'shipped' && !tracking) fail(400, 'Add the tracking number');
    if (status === 'ordered' && !ref) fail(400, 'Add the dealer order number');
    run('UPDATE redemptions SET status = ?, tracking = ?, dealer_order_ref = ?, updated_at = ? WHERE id = ?', status, tracking, ref, now(), id);
    if (status === 'shipped' || status === 'delivered') {
      run("UPDATE specimens SET state = 'redeemed', updated_at = ? WHERE id = ?", now(), r.specimen_id);
      if (r.reservation_id) run("UPDATE reservations SET status = 'redeemed', updated_at = ?, closed_at = coalesce(closed_at, ?) WHERE id = ?", now(), now(), r.reservation_id);
    }
    if (status === 'cancelled' && r.kind === 'dealer') {
      // The escrow was already released after the burn: refund everything from the ops wallet.
      const res = get<any>('SELECT * FROM reservations WHERE id = ?', r.reservation_id);
      const total = cents((res?.paid_usd ?? 0) + (r.price_delta_usd > 0 ? r.price_delta_usd : 0) + r.fee_usd);
      const p = chain.payout({ to: r.wallet, usd: total, memo: 'dealer order cancelled' });
      if (res) run("UPDATE reservations SET status = 'refunded', updated_at = ?, closed_at = ? WHERE id = ?", now(), now(), res.id);
      const sp = specimenRow(r.specimen_id)!;
      run("UPDATE specimens SET state = CASE WHEN source_status = 'available' THEN 'market' ELSE 'vault' END, owner = NULL, acquired_via = NULL, acquired_at = NULL, paid_usd = NULL, updated_at = ? WHERE id = ?", now(), sp.id);
      ledger('redemption_refund', { wallet: r.wallet, specimen_id: sp.id, usd: -total, currency: 'USDC', amount: -total, tx: p.tx, split: { reason: 'dealer order cancelled' } });
    } else if (status === 'cancelled') {
      // Re-mint to the collector and refund the fee.
      const sp = specimenRow(r.specimen_id)!;
      run("UPDATE specimens SET state = 'held', updated_at = ? WHERE id = ?", now(), sp.id);
      queueMint(sp.id, r.wallet);
      const p = chain.payout({ to: r.wallet, usd: r.fee_usd, memo: 'redemption refund' });
      ledger('redemption_refund', { wallet: r.wallet, specimen_id: sp.id, usd: -r.fee_usd, currency: 'USDC', amount: -r.fee_usd, tx: p.tx });
    }
    audit(actor, 'redemption.' + status, id, { tracking });
    return redemptionOf(get('SELECT * FROM redemptions WHERE id = ?', id));
  });
}

/* ---------- wallets, ledger, waitlist, audit ---------- */

export function listWallets() {
  return all<any>(`SELECT w.*, u.username, u.email, (SELECT pubkey FROM custody c WHERE c.owner = w.address) sol_wallet, (SELECT COUNT(*) FROM specimens s WHERE s.owner = w.address AND s.state = 'held') holdings,
    (SELECT COUNT(*) FROM pulls p WHERE p.wallet = w.address AND p.bonus = 0) pulls,
    (SELECT coalesce(SUM(usd), 0) FROM ledger l WHERE l.wallet = w.address AND l.usd > 0) spent
    FROM wallets w LEFT JOIN users u ON u.address = w.address ORDER BY w.last_seen DESC`);
}

export function walletDetail(address: string) {
  return {
    wallet: get<any>('SELECT w.*, u.username, u.email, u.linked_wallet, u.last_login, (SELECT pubkey FROM custody c WHERE c.owner = w.address) sol_wallet, (SELECT exported_at FROM custody c WHERE c.owner = w.address) key_exported_at FROM wallets w LEFT JOIN users u ON u.address = w.address WHERE w.address = ?', address) ?? fail(404, 'Wallet not found'),
    holdings: all<SpecimenRow>('SELECT * FROM specimens WHERE owner = ? ORDER BY acquired_at DESC', address).map(toAdmin),
    ledger: all<any>('SELECT * FROM ledger WHERE wallet = ? ORDER BY created_at DESC', address),
  };
}

export function listLedger(q: URLSearchParams) {
  const kind = q.get('kind');
  const limit = Math.min(1000, Number(q.get('limit')) || 300);
  return all<any>(`SELECT * FROM ledger ${kind ? 'WHERE kind = ?' : ''} ORDER BY created_at DESC LIMIT ?`, ...(kind ? [kind, limit] : [limit]));
}

export const listWaitlist = () => all<{ email: string; created_at: string }>('SELECT * FROM waitlist ORDER BY created_at DESC');
export const listAudit = () => all<any>('SELECT * FROM audit ORDER BY id DESC LIMIT 500');

/* ---------- settings ---------- */

export function updateRules(actor: string, b: any): Rules {
  const cur = getRules();
  const share = (v: unknown, name: string, d: number) => (v == null ? d : num(v, name, 0, 1));
  const band = (k: Band) => ({
    min: num(b?.bands?.[k]?.min ?? cur.bands[k].min, `${k} min`, 0, 100),
    max: b?.bands?.[k]?.max === null || b?.bands?.[k]?.max === '' ? null : num(b?.bands?.[k]?.max ?? cur.bands[k].max, `${k} max`, 0, 100),
    count: Math.round(num(b?.bands?.[k]?.count ?? cur.bands[k].count, `${k} count`, 0, 1000)),
  });
  const r: Rules = {
    market_markup: num(b?.market_markup ?? cur.market_markup, 'Market markup', 1, 5),
    buyback_share: share(b?.buyback_share, 'Buyback share', cur.buyback_share),
    series_size: Math.round(num(b?.series_size ?? cur.series_size, 'Series size', 1, 1000)),
    bands: { floor: band('floor'), par: band('par'), hit: band('hit') },
    ev_target: share(b?.ev_target, 'EV target', cur.ev_target),
    edge_split: {
      rocks_buyback: share(b?.edge_split?.rocks_buyback, 'Buyback and burn', cur.edge_split.rocks_buyback),
      launch_reserve: share(b?.edge_split?.launch_reserve, 'Launch reserve', cur.edge_split.launch_reserve),
      ops: share(b?.edge_split?.ops, 'Ops', cur.edge_split.ops),
    },
    royalty: share(b?.royalty, 'Royalty', cur.royalty),
    handling_fee_usd: num(b?.handling_fee_usd ?? cur.handling_fee_usd, 'Handling fee', 0, 10000),
    shipping_usd: num(b?.shipping_usd ?? cur.shipping_usd, 'Shipping', 0, 10000),
    shipping_countries: Array.isArray(b?.shipping_countries) ? [...new Set<string>(b.shipping_countries.map((c: unknown) => String(c).trim().toUpperCase()).filter((c: string) => /^[A-Z]{2}$/.test(c)))] : cur.shipping_countries,
    sol_usd: num(b?.sol_usd ?? cur.sol_usd, 'SOL price', 0.01, 1e6),
    demo_wallet: typeof b?.demo_wallet === 'boolean' ? b.demo_wallet : cur.demo_wallet,
    sample_notice: typeof b?.sample_notice === 'boolean' ? b.sample_notice : cur.sample_notice,
    market_funds_buyback: typeof b?.market_funds_buyback === 'boolean' ? b.market_funds_buyback : cur.market_funds_buyback,
    google_client_id: typeof b?.google_client_id === 'string' ? b.google_client_id.trim().slice(0, 200) : cur.google_client_id,
    source_max_age_hours: b?.source_max_age_hours == null ? cur.source_max_age_hours : Math.round(num(b.source_max_age_hours, 'Source price age', 0, 24 * 90)),
    token_enabled: typeof b?.token_enabled === 'boolean' ? b.token_enabled : cur.token_enabled,
    token_symbol: typeof b?.token_symbol === 'string' ? (b.token_symbol.trim().replace(/^\$/, '').toUpperCase().slice(0, 10) || 'ROCKS') : cur.token_symbol,
    token_mint: typeof b?.token_mint === 'string' ? b.token_mint.trim().slice(0, 60) : cur.token_mint,
    token_decimals: b?.token_decimals == null ? cur.token_decimals : Math.round(num(b.token_decimals, 'Token decimals', 0, 12)),
    token_discount: share(b?.token_discount, 'Token discount', cur.token_discount),
    token_burn_share: share(b?.token_burn_share, 'Burn share', cur.token_burn_share),
    token_price_source: b?.token_price_source === 'jupiter' ? 'jupiter' : b?.token_price_source === 'manual' ? 'manual' : cur.token_price_source,
    token_manual_price_usd: b?.token_manual_price_usd == null || b?.token_manual_price_usd === '' ? cur.token_manual_price_usd : num(b.token_manual_price_usd, 'Token price', 0, 1e9),
  };
  if (r.token_mint && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.token_mint)) fail(400, 'The token mint must be a Solana address');
  if (r.token_enabled && r.token_price_source === 'jupiter' && !r.token_mint) fail(400, 'Set the token mint to read its price from Jupiter');
  if (r.token_enabled && r.token_price_source === 'manual' && !(r.token_manual_price_usd > 0)) fail(400, 'Set a token price, or switch the price source to Jupiter');
  if (r.token_discount >= 0.5) fail(400, 'The token discount must stay below 50%');
  if (r.google_client_id && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(r.google_client_id)) fail(400, 'The Google client ID looks like 1234-abc.apps.googleusercontent.com');
  if (r.buyback_share >= 1) fail(400, 'The buyback share must stay below 100% of vault value');
  const edge = r.edge_split.rocks_buyback + r.edge_split.launch_reserve + r.edge_split.ops;
  if (Math.abs(edge - (1 - r.ev_target)) > 0.0001) fail(400, `The edge split adds up to ${Math.round(edge * 1000) / 10}%, but 100% − EV target is ${Math.round((1 - r.ev_target) * 1000) / 10}%`);
  saveRules(r);
  audit(actor, 'settings.update', 'rules', r);
  return r;
}

export function dropsDue() {
  // Keeps drop status honest for the overview: nothing to do server-side, status is computed from T-0.
  return all<DropRow>('SELECT * FROM drops WHERE closed = 0').map(d => ({ id: d.id, status: dropStatus(d) }));
}

export { sealedSlots };
