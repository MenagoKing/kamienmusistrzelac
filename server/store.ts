// Read side: settings, row mappers and the public queries the site uses.
import type {
  Band, DropEvent, Holding, LaunchDrop, Listing, Reservation, LockedSpecimen, PackReveal, PageData, Redemption, RockType, Rules,
  Series, SeriesProof, Specimen, SpecimenAdmin, SpecimenFile, SpecimenState, SpecimenStatus, Tier, UpcomingSeries,
} from '../shared/types.ts';
import { FILE_ITEMS } from '../shared/types.ts';
import { BANDS, CATEGORY_NAME, DEFAULT_RULES, TIER_NOTE, shortAddr } from '../shared/rules.ts';
import { all, get, run, activeNetwork } from './db.ts';

/* ---------- settings ---------- */

export function getRules(): Rules {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = 'rules'");
  const saved = row ? (JSON.parse(row.value) as Partial<Rules>) : {};
  return {
    ...DEFAULT_RULES,
    ...saved,
    bands: { ...DEFAULT_RULES.bands, ...(saved.bands ?? {}) },
    edge_split: { ...DEFAULT_RULES.edge_split, ...(saved.edge_split ?? {}) },
    google_client_id: saved.google_client_id || process.env.GOOGLE_CLIENT_ID || '',
    // quotes in SOL use the live price when there is one (server/token.ts); the saved value is the fallback
    sol_usd: (globalThis as unknown as { __srsolprice?: () => number | null }).__srsolprice?.() ?? saved.sol_usd ?? DEFAULT_RULES.sol_usd,
  };
}

export function saveRules(r: Rules) {
  run("INSERT INTO settings (key, value) VALUES ('rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(r));
}

/* ---------- specimens ---------- */

export interface SpecimenRow {
  id: string; name: string; class: string; category: RockType; mass_g: number; origin: string | null; fall: string | null;
  vault_value_usd: number | null; state: SpecimenState; series_id: string | null; drop_id: string | null; sold_back: number;
  owner: string | null; mint: string | null; vault_id: string | null; file: string; notes: string; render_seed: number;
  featured: number; mint_status: string; mint_tx: string | null; nft_owner: string | null; acquired_via: string | null;
  dealer_id: string | null; dealer_price_usd: number | null; dealer_sku: string; dealer_url: string; source_status: string; source_verified_at: string | null; acquired_at: string | null; paid_usd: number | null; created_at: string; updated_at: string;
}

export const parseFall = (f: string | null): number | 'find' | null => (f == null || f === '' ? null : f === 'find' ? 'find' : Number(f));

const present = (v: unknown) => (Array.isArray(v) ? v.some(x => typeof x === 'string' && x.trim()) : typeof v === 'string' && v.trim() !== '');

export function fileOf(r: Pick<SpecimenRow, 'file'>): SpecimenFile {
  try { return JSON.parse(r.file) as SpecimenFile; } catch { return {}; }
}

/** Dev note: name + classification, weigh video, photos, COA, provenance + export, origin, invoice, vault ID. */
export function fileComplete(r: Pick<SpecimenRow, 'file' | 'origin' | 'vault_value_usd' | 'vault_id'>) {
  const f = fileOf(r);
  return FILE_ITEMS.every(i => present(f[i.key])) && !!r.origin && !!r.vault_id && r.vault_value_usd != null && r.vault_value_usd > 0;
}

const isImage = (u: string) => /^(\/uploads\/|https?:\/\/)/.test(u) && /\.(png|jpe?g|webp|avif|gif)(\?.*)?$/i.test(u);

export function photoOf(r: SpecimenRow): string | null {
  const p = fileOf(r).photos ?? [];
  return p.find(isImage) ?? null;
}

export function statusOf(r: SpecimenRow): SpecimenStatus {
  switch (r.state) {
    case 'draft': return { kind: 'not_listed', reason: 'file_incomplete' };
    case 'vault': return { kind: 'in_vault', sold_back: !!r.sold_back };
    case 'market': return { kind: 'on_market' };
    case 'series': return { kind: 'in_series', series_id: r.series_id ?? '', sold_back: !!r.sold_back };
    case 'locked': return { kind: 'locked', drop_id: r.drop_id ?? '' };
    case 'held': return { kind: 'held' };
    case 'external': return { kind: 'external', holder: r.nft_owner ?? '' };
    case 'redeeming': return { kind: 'redeeming' };
    case 'redeemed': return { kind: 'redeemed' };
  }
}

/** Callsign if the collector has one, else the short address. */
export function displayName(address: string | null | undefined) {
  if (!address) return null;
  const u = get<{ username: string | null }>('SELECT username FROM users WHERE address = ?', address);
  return u?.username ?? shortAddr(address);
}

export function toPublic(r: SpecimenRow): Specimen {
  const f = fileOf(r);
  const l = r.state === 'held' ? get<{ id: string; price_usd: number }>("SELECT id, price_usd FROM listings WHERE specimen_id = ? AND status = 'active'", r.id) : undefined;
  return {
    id: r.id, name: r.name, class: r.class, mass_g: r.mass_g, origin: r.origin, fall: parseFall(r.fall),
    vault_value_usd: r.vault_value_usd, status: statusOf(r),
    file_done: [...FILE_ITEMS.map(i => present(f[i.key])), !!r.mint],
    photo: photoOf(r), photos: (fileOf(r).photos ?? []).filter(isImage), mint: r.mint, mint_status: r.mint_status, nft_owner: r.nft_owner, owner: displayName(r.owner),
    listing: l ? { id: l.id, price_usd: l.price_usd } : null,
    sourced: !!r.dealer_id,
    source_price_usd: r.dealer_id ? r.dealer_price_usd ?? r.vault_value_usd : null,
    source_available: r.dealer_id ? r.source_status === 'available' : true,
    render: { type: r.category, seed: r.render_seed },
  };
}

/** The open reservation on a specimen, with its escrow (holder view). */
export function reservationView(specimenId: string): Reservation | null {
  const r = get<any>(`SELECT r.*, e.amount_usd escrow_usd, e.status escrow_status FROM reservations r LEFT JOIN escrows e ON e.reservation_id = r.id
    WHERE r.specimen_id = ? AND r.status IN ('active', 'sold_at_source', 'redeeming') ORDER BY r.created_at DESC LIMIT 1`, specimenId);
  if (!r) return null;
  return { id: r.id, status: r.status, reserved_price_usd: r.reserved_price_usd, commission_usd: r.commission_usd, paid_usd: r.paid_usd, currency: r.currency, escrow_usd: r.escrow_usd ?? 0, escrow_status: r.escrow_status ?? 'released', created_at: r.created_at };
}

export function toAdmin(r: SpecimenRow): SpecimenAdmin & { file_complete: boolean; photo: string | null } {
  return {
    id: r.id, name: r.name, class: r.class, category: r.category, mass_g: r.mass_g, origin: r.origin, fall: parseFall(r.fall),
    vault_value_usd: r.vault_value_usd, state: r.state, series_id: r.series_id, drop_id: r.drop_id, sold_back: !!r.sold_back,
    owner: r.owner, mint: r.mint, vault_id: r.vault_id, file: fileOf(r), notes: r.notes, render_seed: r.render_seed,
    created_at: r.created_at, updated_at: r.updated_at, featured: r.featured, file_complete: fileComplete(r), photo: photoOf(r),
    dealer_id: r.dealer_id, dealer_price_usd: r.dealer_price_usd, dealer_sku: r.dealer_sku, dealer_url: r.dealer_url, source_status: r.source_status, source_verified_at: r.source_verified_at,
  };
}

export const specimenRow = (id: string) => get<SpecimenRow>('SELECT * FROM specimens WHERE id = ?', id);

/* ---------- series ---------- */

export interface SeriesRow {
  id: string; name: string; tier: Tier; size: number; pack_price_usd: number | null; status: Series['status']; note: string;
  server_seed: string; commit_hash: string; seed_revealed: number; drop_id: string | null; sort: number;
  composition_published_at: string | null; sold_out_at: string | null; created_at: string;
}

export interface SlotRow { series_id: string; idx: number; specimen_id: string; band: Band; vault_value_usd: number; added_at: number; opened_nonce: number | null }

export const seriesRow = (id: string) => get<SeriesRow>('SELECT * FROM series WHERE id = ?', id);

export function toSeries(s: SeriesRow): Series {
  const slots = all<SlotRow & { category: RockType }>(
    'SELECT sl.*, sp.category FROM slots sl JOIN specimens sp ON sp.id = sl.specimen_id WHERE sl.series_id = ? ORDER BY sl.idx', s.id);
  const counts: Record<Band, number> = { floor: 0, par: 0, hit: 0 };
  const remaining: Record<Band, number> = { floor: 0, par: 0, hit: 0 };
  const byClass = new Map<RockType, number>();
  for (const sl of slots) {
    counts[sl.band]++;
    if (sl.opened_nonce == null && s.status !== 'closed') {
      remaining[sl.band]++;
      byClass.set(sl.category, (byClass.get(sl.category) ?? 0) + 1);
    }
  }
  const opened = slots.filter(x => x.opened_nonce != null).sort((a, b) => a.opened_nonce! - b.opened_nonce!).map(x => x.band);
  const order: RockType[] = ['martian', 'lunar', 'pallasite', 'iron', 'stone'];
  return {
    id: s.id, name: s.name, tier: s.tier, size: Math.max(s.size, slots.length), counts, remaining, opened,
    left_by_class: order.filter(t => byClass.has(t)).map(t => ({ label: CATEGORY_NAME[t], type: t, left: byClass.get(t)! })),
    pack_price_usd: s.pack_price_usd, status: s.status, composition_published_at: s.composition_published_at,
    commit_hash: s.commit_hash, drop_id: s.drop_id, note: s.note || TIER_NOTE[s.tier],
  };
}

export function seriesProof(id: string): SeriesProof {
  const s = seriesRow(id);
  if (!s) return { series_id: id, commit_hash: null, server_seed: null, slots: [], pulls: [] };
  const slots = all<SlotRow>('SELECT * FROM slots WHERE series_id = ? ORDER BY idx', id);
  const pulls = all<any>('SELECT * FROM pulls WHERE series_id = ? AND bonus = 0 ORDER BY nonce', id);
  return {
    series_id: id,
    commit_hash: s.commit_hash,
    server_seed: s.seed_revealed ? s.server_seed : null,
    slots: slots.map(x => ({ idx: x.idx, specimen_id: x.specimen_id, band: x.band, added_at: x.added_at })),
    pulls: pulls.map(p => ({ nonce: p.nonce, client_seed: p.client_seed, wallet: shortAddr(p.wallet), pool: p.pool, pick: p.pick, slot: p.slot, specimen_id: p.specimen_id, band: p.band })),
  };
}

/* ---------- drops ---------- */

export interface DropRow { id: string; name: string; t0: string; series_id: string | null; closed: number; server_seed: string; commit_hash: string; rolled_over_from: string | null; created_at: string }

export const dropRow = (id: string) => get<DropRow>('SELECT * FROM drops WHERE id = ?', id);
export const opensAt = (t0: string) => new Date(Date.parse(t0) - 24 * 3600 * 1000).toISOString();

export function dropStatus(d: DropRow): LaunchDrop['status'] {
  if (d.closed) return 'closed';
  return Date.now() >= Date.parse(opensAt(d.t0)) ? 'open' : 'scheduled';
}

export function toDrop(d: DropRow): LaunchDrop {
  const locks = all<{ specimen_id: string; batch: 'A' | 'B'; state: LockedSpecimen['state']; name: string; class: string; category: RockType; render_seed: number }>(
    `SELECT l.specimen_id, l.batch, l.state, s.name, s.class, s.category, s.render_seed FROM drop_locks l JOIN specimens s ON s.id = l.specimen_id
     WHERE l.drop_id = ? AND l.state != 'carried' ORDER BY l.batch, l.specimen_id`, d.id);
  const events = all<DropEvent>('SELECT id, kind, source_url, note, actor, created_at FROM drop_events WHERE drop_id = ? ORDER BY created_at', d.id);
  return {
    id: d.id, name: d.name, t0: d.t0, opens_at: opensAt(d.t0), status: dropStatus(d), series_id: d.series_id,
    locked: locks.map(l => ({ id: l.specimen_id, batch: l.batch, name: l.name, class: l.class, state: l.state, render: { type: l.category, seed: l.render_seed } })),
    events, rolled_over_from: d.rolled_over_from,
  };
}

/** The drop the site shows: the next one not closed, else the latest closed. */
export function currentDrop(): LaunchDrop | null {
  const d = get<DropRow>('SELECT * FROM drops WHERE closed = 0 ORDER BY t0 LIMIT 1') ?? get<DropRow>('SELECT * FROM drops ORDER BY t0 DESC LIMIT 1');
  return d ? toDrop(d) : null;
}

/* ---------- pulls, holdings ---------- */

export function toReveal(p: any): PackReveal {
  const s = specimenRow(p.specimen_id)!;
  return {
    pull_id: p.id, series_id: p.series_id, band: p.band, pack_price_usd: p.pack_price_usd, vault_value_usd: p.vault_value_usd, bonus: !!p.bonus,
    specimen: { id: s.id, name: s.name, class: s.class.replace(', ', ' '), mass_g: s.mass_g, render: { type: s.category, seed: s.render_seed }, photo: photoOf(s) },
  };
}

/** Design sample reveal card, shown until a real hit is pulled. */
const SAMPLE_REVEAL: PackReveal = {
  pull_id: null, series_id: null, band: 'hit', pack_price_usd: 96, vault_value_usd: 240,
  specimen: { id: 'SR-00011', name: 'Tissint', class: 'Martian shergottite', mass_g: 0.4, render: { type: 'martian', seed: 21 } },
};

export function holdingsOf(wallet: string): Holding[] {
  const rows = all<SpecimenRow>("SELECT * FROM specimens WHERE owner = ? AND state IN ('held', 'redeeming') ORDER BY acquired_at DESC", wallet);
  return rows.map(r => {
    const pull = get<{ band: Band }>('SELECT band FROM pulls WHERE specimen_id = ? AND wallet = ? ORDER BY created_at DESC LIMIT 1', r.id, wallet);
    return { ...toPublic(r), acquired_via: (r.acquired_via ?? 'market') as Holding['acquired_via'], acquired_at: r.acquired_at ?? r.updated_at, paid_usd: r.paid_usd, band: r.acquired_via === 'pack' || r.acquired_via === 'raffle' ? pull?.band ?? null : null, reservation: r.dealer_id ? reservationView(r.id) : null };
  });
}

export function redemptionOf(r: any): Redemption {
  const s = specimenRow(r.specimen_id);
  // The dealer is named to the holder only now, after redemption.
  const dealer = r.dealer_id ? get<{ name: string }>('SELECT name FROM dealers WHERE id = ?', r.dealer_id) : undefined;
  return { ...r, specimen_name: s?.name ?? r.specimen_id, address: JSON.parse(r.address), dealer_name: dealer?.name ?? null };
}


/* ---------- collector listings ---------- */

export interface ListingRow { id: string; specimen_id: string; seller: string; price_usd: number; status: string; buyer: string | null; created_at: string; closed_at: string | null }

export const activeListing = (specimenId: string) => get<ListingRow>("SELECT * FROM listings WHERE specimen_id = ? AND status = 'active'", specimenId);

export function toListing(l: ListingRow, viewer?: string | null): Listing {
  return { id: l.id, price_usd: l.price_usd, seller: displayName(l.seller) ?? '', mine: !!viewer && viewer === l.seller, created_at: l.created_at, specimen: toPublic(specimenRow(l.specimen_id)!) };
}

export function publicListings(viewer?: string | null): Listing[] {
  return all<ListingRow>("SELECT * FROM listings WHERE status = 'active' ORDER BY created_at DESC LIMIT 60").map(l => toListing(l, viewer));
}


/* ---------- the page ---------- */

export function pageData(): PageData {
  const rules = getRules();
  const market = all<SpecimenRow>("SELECT * FROM specimens WHERE state = 'market' ORDER BY featured DESC, vault_value_usd DESC LIMIT 120").map(toPublic);
  const featured = all<SpecimenRow>('SELECT * FROM specimens WHERE featured > 0 ORDER BY featured');
  const extra = featured.length >= 7 ? [] : all<SpecimenRow>("SELECT * FROM specimens WHERE featured = 0 ORDER BY updated_at DESC LIMIT ?", 7 - featured.length);
  const register = [...featured, ...extra].map(toPublic);
  const register_total = get<{ n: number }>('SELECT COUNT(*) n FROM specimens')!.n;
  const open = all<SeriesRow>("SELECT * FROM series WHERE status IN ('open', 'sold_out') AND (drop_id IS NULL) ORDER BY status = 'sold_out', sort, id").map(toSeries);
  const dropSeries = all<SeriesRow>("SELECT se.* FROM series se JOIN drops d ON d.id = se.drop_id WHERE se.status = 'open' AND d.closed = 0").map(toSeries);
  const upcoming: UpcomingSeries[] = all<SeriesRow>("SELECT * FROM series WHERE status = 'upcoming' ORDER BY sort, id").map(s => ({ id: s.id, name: s.name, note: s.note || TIER_NOTE[s.tier] }));
  const hit = get<any>("SELECT * FROM pulls WHERE band = 'hit' AND bonus = 0 ORDER BY created_at DESC LIMIT 1");
  const stats = {
    specimens: register_total,
    held: get<{ n: number }>("SELECT COUNT(*) n FROM specimens WHERE state = 'held'")!.n,
    packs_opened: get<{ n: number }>('SELECT COUNT(*) n FROM pulls WHERE bonus = 0')!.n,
    redeemed: get<{ n: number }>("SELECT COUNT(*) n FROM specimens WHERE state = 'redeemed'")!.n,
  };
  const live = open.find(s => s.status === 'open') ?? open[0] ?? null;
  return { token: tokenView(rules), chain: { cluster: process.env.CHAIN === 'simulated' ? 'simulated' : activeNetwork(), payments: (globalThis as unknown as { __srpaylive?: () => boolean }).__srpaylive?.() ? 'live' : 'simulated' }, listings: publicListings(), rules, market, register, register_total, series: live, open_series: [...open.filter(s => s.status === 'open'), ...dropSeries], upcoming, reveal: hit ? toReveal(hit) : SAMPLE_REVEAL, drop: currentDrop(), stats };
}

/** Token payment info for the page; the live price comes from server/token.ts. */
function tokenView(rules: Rules) {
  const g = globalThis as unknown as { __srtokprice?: () => number | null };
  const price = g.__srtokprice ? g.__srtokprice() : null;
  return { enabled: rules.token_enabled && price != null, symbol: rules.token_symbol, discount: rules.token_discount, price_usd: price };
}

export function vaultRegister(q = '', state = ''): Specimen[] {
  const like = `%${q.toLowerCase()}%`;
  const rows = all<SpecimenRow>(
    `SELECT * FROM specimens WHERE (lower(name) LIKE ? OR lower(class) LIKE ? OR lower(id) LIKE ?) ${state ? 'AND state = ?' : ''} ORDER BY id`,
    ...(state ? [like, like, like, state] : [like, like, like]));
  return rows.map(toPublic);
}

export { BANDS };
