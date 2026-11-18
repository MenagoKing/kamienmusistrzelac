// Write side: everything a collector can do, and the shared helpers the admin uses.
import type { Band, Currency, PackReveal, Redemption, TxResult } from '../shared/types.ts';
import { bandOf, buybackOffer, marketPrice, packSplit } from '../shared/rules.ts';
import { chain } from './chain.ts';
import { queueBurn, queueMint } from './nft.ts';
import { all, get, now, run, tx } from './db.ts';
import {
  dropRow, dropStatus, fileComplete, getRules, redemptionOf, seriesRow, specimenRow, toReveal,
  type SeriesRow, type SlotRow,
} from './store.ts';
import { HttpError, cents, drawPickSync, fail, optStr, str, uid } from './util.ts';

export function audit(actor: string, action: string, target = '', detail: unknown = {}) {
  run('INSERT INTO audit (actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)', actor, action, target, JSON.stringify(detail), now());
}

export function ledger(kind: string, p: { wallet?: string | null; specimen_id?: string | null; series_id?: string | null; usd: number; currency: Currency; amount: number; tx?: string | null; split?: unknown }) {
  run('INSERT INTO ledger (id, kind, wallet, specimen_id, series_id, usd, currency, amount, tx, split, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    uid('lg'), kind, p.wallet ?? null, p.specimen_id ?? null, p.series_id ?? null, cents(p.usd), p.currency, p.amount, p.tx ?? null, JSON.stringify(p.split ?? {}), now());
}

const currencyOf = (c: unknown): Currency => (c === 'SOL' ? 'SOL' : 'USDC');

/* ---------- market ---------- */

/** Own-stock market purchase (specimens the project holds itself). Dealer-sourced specimens are reserved instead (sources.ts). */
export function buyMarket(wallet: string, id: string, currency: unknown, expectedPrice?: unknown): { reveal: PackReveal; payment: TxResult; mint: string | null } {
  return tx(() => {
    const s = specimenRow(id) ?? fail(404, 'Specimen not found');
    if (s.state !== 'market' || s.vault_value_usd == null) fail(409, 'This specimen is no longer on the market');
    if (s.dealer_id) fail(409, 'This specimen is reserved through its dealer');
    const rules = getRules();
    const price = marketPrice(s.vault_value_usd!, rules);
    if (expectedPrice != null && Math.abs(Number(expectedPrice) - price) > 0.004) throw new HttpError(409, 'The price changed to $' + price.toFixed(2) + '. Check it and confirm again.', { code: 'changed', price_usd: price });
    const payment = chain.charge({ from: wallet, usd: price, currency: currencyOf(currency), solUsd: rules.sol_usd, memo: `market ${id}` });
    run("UPDATE specimens SET state = 'held', owner = ?, acquired_via = 'market', acquired_at = ?, paid_usd = ?, sold_back = 0, updated_at = ? WHERE id = ?",
      wallet, now(), price, now(), id);
    queueMint(id, wallet);
    ledger('market_buy', { wallet, specimen_id: id, usd: price, currency: payment.currency, amount: payment.amount, tx: payment.tx, split: { vault_value: s.vault_value_usd, margin: cents(price - s.vault_value_usd!) } });
    const reveal: PackReveal = {
      pull_id: null, series_id: null, band: 'par', pack_price_usd: price, vault_value_usd: s.vault_value_usd!,
      specimen: { id: s.id, name: s.name, class: s.class.replace(', ', ' '), mass_g: s.mass_g, render: { type: s.category, seed: s.render_seed } },
    };
    return { reveal, payment, mint: null };
  });
}

/* ---------- packs ---------- */

export function sealedSlots(seriesId: string) {
  return all<SlotRow>('SELECT * FROM slots WHERE series_id = ? AND opened_nonce IS NULL ORDER BY idx', seriesId);
}

export const pullCount = (seriesId: string) => get<{ n: number }>('SELECT COUNT(*) n FROM pulls WHERE series_id = ? AND bonus = 0', seriesId)!.n;

export function revealSeed(s: SeriesRow) {
  run('UPDATE series SET seed_revealed = 1 WHERE id = ?', s.id);
}

export function openPack(wallet: string, seriesId: string, currency: unknown, clientSeedIn: unknown, opts: { nft?: boolean } = {}): { reveal: PackReveal; payment: TxResult; mint: string | null } {
  const clientSeed = typeof clientSeedIn === 'string' && /^[\w-]{4,64}$/.test(clientSeedIn) ? clientSeedIn : uid('cs');
  return tx(() => {
    const s = seriesRow(seriesId) ?? fail(404, 'Series not found');
    if (s.status !== 'open') fail(409, s.status === 'sold_out' ? 'This series is sold out' : 'This series is not open');
    const ends = (s as SeriesRow & { ends_at?: string | null }).ends_at;
    if (ends && Date.now() > Date.parse(ends)) fail(409, 'This series has ended');
    if (s.drop_id) {
      const d = dropRow(s.drop_id);
      if (!d || dropStatus(d) !== 'open') fail(409, 'This launch drop is not open');
    }
    if (!(s.pack_price_usd! > 0)) fail(409, 'This series has no pack price');
    const sealed = sealedSlots(s.id);
    if (!sealed.length) fail(409, 'This series is sold out');
    const rules = getRules();
    const nonce = pullCount(s.id);
    const pick = drawPickSync(s.server_seed, s.id, nonce, clientSeed, sealed.length);
    const slot = sealed[pick];
    const payment = chain.charge({ from: wallet, usd: s.pack_price_usd!, currency: currencyOf(currency), solUsd: rules.sol_usd, memo: `pack ${s.id}` });
    const sp = specimenRow(slot.specimen_id)!;
    run('UPDATE slots SET opened_nonce = ? WHERE series_id = ? AND idx = ?', nonce, s.id, slot.idx);
    run("UPDATE specimens SET state = 'held', owner = ?, series_id = NULL, acquired_via = 'pack', acquired_at = ?, paid_usd = ?, sold_back = 0, updated_at = ? WHERE id = ?",
      wallet, now(), s.pack_price_usd, now(), sp.id);
    if (opts.nft !== false) queueMint(sp.id, wallet);
    const id = uid('pl');
    run(`INSERT INTO pulls (id, series_id, drop_id, specimen_id, wallet, band, pack_price_usd, vault_value_usd, nonce, client_seed, pool, pick, slot, bonus, tx, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id, s.id, s.drop_id, sp.id, wallet, slot.band, s.pack_price_usd, slot.vault_value_usd, nonce, clientSeed, sealed.length, pick, slot.idx, payment.tx, now());
    ledger('pack', { wallet, specimen_id: sp.id, series_id: s.id, usd: s.pack_price_usd!, currency: payment.currency, amount: payment.amount, tx: payment.tx, split: packSplit(s.pack_price_usd!, rules) });
    if (sealed.length === 1) {
      run("UPDATE series SET status = 'sold_out', sold_out_at = ? WHERE id = ?", now(), s.id);
      revealSeed(s);
    }
    return { reveal: toReveal(get('SELECT * FROM pulls WHERE id = ?', id)), payment, mint: null };
  });
}

/* ---------- after you buy ---------- */

function ownedBy(wallet: string, id: string) {
  const s = specimenRow(id) ?? fail(404, 'Specimen not found');
  if (s.owner !== wallet || s.state !== 'held') fail(403, 'You do not hold this specimen');
  if (get("SELECT 1 FROM listings WHERE specimen_id = ? AND status = 'active'", id)) fail(409, 'Take it off sale first: it is listed for other collectors');
  return s;
}

export function sellBack(wallet: string, id: string): { payout: TxResult; usd: number } {
  return tx(() => {
    const s = ownedBy(wallet, id);
    if (s.dealer_id) fail(409, 'Reserved specimens are cancelled, not sold back');
    if (s.vault_value_usd == null) fail(409, 'This specimen has no value on record');
    const usd = buybackOffer(s.vault_value_usd!, getRules());
    const payout = chain.payout({ to: wallet, usd, memo: `buyback ${id}` });
    queueBurn(id);
    // A bought-back specimen goes into the next unopened series, never the current one.
    run("UPDATE specimens SET state = 'vault', owner = NULL, sold_back = 1, acquired_via = NULL, acquired_at = NULL, paid_usd = NULL, updated_at = ? WHERE id = ?", now(), id);
    ledger('buyback', { wallet, specimen_id: id, usd: -usd, currency: 'USDC', amount: -payout.amount, tx: payout.tx, split: { vault_value: s.vault_value_usd } });
    return { payout, usd };
  });
}

export function redeem(wallet: string, id: string, body: any): { redemption: Redemption; payment: TxResult } {
  const rules = getRules();
  const name = str(body?.name, 'Name', 120);
  const address = {
    line1: str(body?.line1, 'Address', 200), line2: optStr(body?.line2, 200), city: str(body?.city, 'City', 120),
    postal: str(body?.postal, 'Postal code', 30), country: str(body?.country, 'Country', 2).toUpperCase(),
    email: str(body?.email, 'Email', 200), phone: optStr(body?.phone, 40),
  };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address.email)) fail(400, 'Enter a valid email');
  if (!rules.shipping_countries.includes(address.country)) fail(400, 'We cannot ship to this country yet');
  return tx(() => {
    const own = ownedBy(wallet, id);
    if (own.dealer_id) fail(409, 'Redeem this reservation from your account: the dealer ships it');
    const fee = cents(rules.handling_fee_usd + rules.shipping_usd);
    const payment = chain.charge({ from: wallet, usd: fee, currency: currencyOf(body?.currency), solUsd: rules.sol_usd, memo: `redeem ${id}` });
    queueBurn(id);
    run("UPDATE specimens SET state = 'redeeming', updated_at = ? WHERE id = ?", now(), id);
    const rid = uid('rd');
    run('INSERT INTO redemptions (id, specimen_id, wallet, name, address, status, fee_usd, tracking, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      rid, id, wallet, name, JSON.stringify(address), 'requested', fee, '', now(), now());
    ledger('redemption_fee', { wallet, specimen_id: id, usd: fee, currency: payment.currency, amount: payment.amount, tx: payment.tx, split: { handling: rules.handling_fee_usd, shipping: rules.shipping_usd } });
    return { redemption: redemptionOf(get('SELECT * FROM redemptions WHERE id = ?', rid)), payment };
  });
}

/* ---------- series helpers (admin) ---------- */

/** Adds specimens to a series as sealed slots. added_at = pulls so far (see shared/fair.ts). */
export function addSlots(s: SeriesRow, ids: string[], opts: { allowLocked?: boolean } = {}) {
  const rules = getRules();
  let idx = (get<{ m: number | null }>('SELECT MAX(idx) m FROM slots WHERE series_id = ?', s.id)!.m ?? -1) + 1;
  const at = pullCount(s.id);
  for (const id of ids) {
    const sp = specimenRow(id) ?? fail(404, `Specimen ${id} not found`);
    const ok = sp.state === 'vault' || (opts.allowLocked && sp.state === 'locked');
    if (!ok) fail(409, `${id} is not free in the vault (${sp.state})`);
    if (!fileComplete(sp)) fail(409, `${id} has an incomplete file`);
    const band: Band = (s.pack_price_usd ? bandOf(sp.vault_value_usd!, s.pack_price_usd, rules) : null) ?? 'floor';
    run('INSERT INTO slots (series_id, idx, specimen_id, band, vault_value_usd, added_at, opened_nonce) VALUES (?, ?, ?, ?, ?, ?, NULL)', s.id, idx++, id, band, sp.vault_value_usd, at);
    run("UPDATE specimens SET state = 'series', series_id = ?, drop_id = NULL, updated_at = ? WHERE id = ?", s.id, now(), id);
  }
}

/** Closes a series: reveals the seed and returns every sealed specimen to the vault. */
export function closeSeries(s: SeriesRow) {
  for (const sl of sealedSlots(s.id)) {
    run("UPDATE specimens SET state = 'vault', series_id = NULL, updated_at = ? WHERE id = ? AND state = 'series'", now(), sl.specimen_id);
  }
  run("UPDATE series SET status = 'closed' WHERE id = ?", s.id);
  revealSeed(s);
}
