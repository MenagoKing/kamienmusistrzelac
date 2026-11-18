// Addendum 1: the dealer model. Specimens on the market stay with independent dealers; buying one
// reserves that specific specimen. The rock's price is held in an escrow tied to its NFT, the
// commission is kept. We buy the rock from the dealer only when the holder redeems; the dealer ships
// it directly. The dealer is never named before redemption (nothing public reads dealer fields).
//
// Escrow rules (enforced here, and nowhere else moves escrow money):
//   lock     on purchase (rock price)
//   refund   to the holder: cancel, sold at source, a lower price at redemption
//   topup    from the holder: a higher price at redemption
//   move     to a replacement specimen (sold at source)
//   release  to the ops wallet, only after the holder burned the NFT by redeeming
// There is no admin endpoint that takes escrow money.
//
// Escrow is kept by the app for now (payments are simulated); the on-chain program comes next.
import type { Currency, PackReveal, RedeemQuote, Redemption, Reservation, TxResult } from '../shared/types.ts';
import { marketPrice, tokenPrice } from '../shared/rules.ts';
import { chain } from './chain.ts';
import { all, get, now, run, tx } from './db.ts';
import { audit, ledger } from './ops.ts';
import { queueBurn, queueMint } from './nft.ts';
import { getRules, redemptionOf, specimenRow, type SpecimenRow } from './store.ts';
import { tokenAmountFor } from './token.ts';
import { HttpError, cents, fail, num, optStr, str, uid } from './util.ts';

/* ---------- dealers ---------- */

export interface DealerRow {
  id: string; name: string; country: string; region: string; ship_domestic_usd: number; ship_region_usd: number; ship_world_usd: number;
  insurance_pct: number; contact: string; notes: string; api_kind: string; active: number; created_at: string;
}

export const dealerRow = (id: string | null | undefined) => (id ? get<DealerRow>('SELECT * FROM dealers WHERE id = ?', id) : undefined);

const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
export function regionOf(country: string) {
  const c = country.toUpperCase();
  if (EU.includes(c)) return 'EU';
  if (['GB', 'CH', 'NO', 'IS'].includes(c)) return 'EUROPE';
  if (['US', 'CA', 'MX'].includes(c)) return 'NA';
  if (['AU', 'NZ', 'JP', 'SG', 'KR', 'HK', 'TW'].includes(c)) return 'APAC';
  if (['MA', 'DZ', 'TN', 'EG', 'OM', 'AE', 'SA'].includes(c)) return 'MENA';
  return 'OTHER';
}

function readDealer(b: any) {
  const country = str(b?.country, 'Country', 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) fail(400, 'Country: two-letter code, e.g. MA');
  return {
    name: str(b?.name, 'Name', 120), country, region: regionOf(country),
    ship_domestic_usd: num(b?.ship_domestic_usd ?? 15, 'Domestic shipping', 0, 10000),
    ship_region_usd: num(b?.ship_region_usd ?? 28, 'Regional shipping', 0, 10000),
    ship_world_usd: num(b?.ship_world_usd ?? 45, 'Worldwide shipping', 0, 10000),
    insurance_pct: num(b?.insurance_pct ?? 0.015, 'Insurance', 0, 0.5),
    contact: optStr(b?.contact, 300), notes: optStr(b?.notes, 2000),
    active: b?.active === false ? 0 : 1,
  };
}

export function listDealers() {
  return all<DealerRow & { offers: number; reserved: number }>(`SELECT d.*,
    (SELECT COUNT(*) FROM specimens s WHERE s.dealer_id = d.id AND s.state = 'market') offers,
    (SELECT COUNT(*) FROM specimens s WHERE s.dealer_id = d.id AND s.state IN ('held', 'redeeming')) reserved
    FROM dealers d ORDER BY d.active DESC, d.name`);
}

export function createDealer(actor: string, b: any) {
  const d = readDealer(b);
  const id = uid('dl');
  run(`INSERT INTO dealers (id, name, country, region, ship_domestic_usd, ship_region_usd, ship_world_usd, insurance_pct, contact, notes, api_kind, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`, id, d.name, d.country, d.region, d.ship_domestic_usd, d.ship_region_usd, d.ship_world_usd, d.insurance_pct, d.contact, d.notes, d.active, now());
  audit(actor, 'dealer.create', id, { name: d.name });
  return dealerRow(id);
}

export function updateDealer(actor: string, id: string, b: any) {
  dealerRow(id) ?? fail(404, 'Dealer not found');
  const d = readDealer(b);
  run('UPDATE dealers SET name = ?, country = ?, region = ?, ship_domestic_usd = ?, ship_region_usd = ?, ship_world_usd = ?, insurance_pct = ?, contact = ?, notes = ?, active = ? WHERE id = ?',
    d.name, d.country, d.region, d.ship_domestic_usd, d.ship_region_usd, d.ship_world_usd, d.insurance_pct, d.contact, d.notes, d.active, id);
  audit(actor, 'dealer.update', id, { name: d.name });
  return dealerRow(id);
}

/* ---------- source price and availability ---------- */

export const isSourced = (s: Pick<SpecimenRow, 'dealer_id'>) => !!s.dealer_id;

/** The rock's price before commission: the dealer's price for sourced specimens, else the recorded value. */
export const rockPrice = (s: Pick<SpecimenRow, 'dealer_price_usd' | 'vault_value_usd' | 'dealer_id'>) => (s.dealer_id ? s.dealer_price_usd ?? s.vault_value_usd : s.vault_value_usd);

/** Public list price (rock price × (1 + commission)). */
export function listPrice(s: SpecimenRow) {
  const p = rockPrice(s);
  return p == null ? null : marketPrice(p, getRules());
}

/**
 * Live check of a dealer's price and availability. v1 is manual: the values the team keeps current in
 * the admin (with a verified-at time). A dealer with an API gets an adapter here (dealers.api_kind).
 */
export function checkSource(s: SpecimenRow): { available: boolean; price: number | null; verified_at: string | null } {
  return { available: s.source_status === 'available', price: s.dealer_price_usd, verified_at: s.source_verified_at };
}

/* ---------- shipping ---------- */

export function shippingQuote(dealer: DealerRow | undefined, country: string, rock: number) {
  const r = getRules();
  if (!dealer) return { shipping: cents(r.shipping_usd), insurance: 0 };
  const c = country.toUpperCase();
  const base = c === dealer.country ? dealer.ship_domestic_usd : regionOf(c) === dealer.region ? dealer.ship_region_usd : dealer.ship_world_usd;
  return { shipping: cents(base), insurance: cents(rock * dealer.insurance_pct) };
}

/* ---------- reservations ---------- */

interface ResRow { id: string; specimen_id: string; holder: string; status: Reservation['status']; reserved_price_usd: number; commission_usd: number; paid_usd: number; currency: Currency; token_amount: number | null; replaced_by: string | null; created_at: string; updated_at: string; closed_at: string | null }
interface EscRow { id: string; reservation_id: string; specimen_id: string; holder: string; amount_usd: number; status: 'locked' | 'refunded' | 'released'; created_at: string; closed_at: string | null }

const resRow = (id: string) => get<ResRow>('SELECT * FROM reservations WHERE id = ?', id);
const escrowOf = (resId: string) => get<EscRow>('SELECT * FROM escrows WHERE reservation_id = ?', resId);

function escrowEvent(e: EscRow, kind: string, amount: number, to: string, txSig: string | null, note = '') {
  run('INSERT INTO escrow_events (escrow_id, kind, amount_usd, to_party, tx, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', e.id, kind, cents(amount), to, txSig, note, now());
}

export function toReservation(r: ResRow): Reservation {
  const e = escrowOf(r.id);
  return { id: r.id, status: r.status, reserved_price_usd: r.reserved_price_usd, commission_usd: r.commission_usd, paid_usd: r.paid_usd, currency: r.currency, escrow_usd: e?.amount_usd ?? 0, escrow_status: e?.status ?? 'released', created_at: r.created_at };
}

/** The open reservation on a specimen (one at a time). */
export function openReservation(specimenId: string) {
  return get<ResRow>("SELECT * FROM reservations WHERE specimen_id = ? AND status IN ('active', 'sold_at_source', 'redeeming') ORDER BY created_at DESC LIMIT 1", specimenId);
}

function mine(wallet: string, resId: string, statuses: Reservation['status'][]) {
  const r = resRow(resId) ?? fail(404, 'Reservation not found');
  if (r.holder !== wallet) fail(403, 'This reservation is not yours');
  if (!statuses.includes(r.status)) fail(409, `This reservation is ${r.status.replace(/_/g, ' ')}`);
  if (get("SELECT 1 FROM listings WHERE specimen_id = ? AND status = 'active'", r.specimen_id)) fail(409, 'Take it off sale first: it is listed for other collectors');
  return r;
}

const currencyOf = (c: unknown): Currency => (c === 'SOL' ? 'SOL' : c === 'TOKEN' ? 'TOKEN' : 'USDC');

/** Market purchase of a sourced specimen: live re-check, then reserve, lock the rock's price in escrow, mint. */
export function reserve(wallet: string, id: string, body: any): { reveal: PackReveal; payment: TxResult; reservation: Reservation } {
  return tx(() => {
    const s = specimenRow(id) ?? fail(404, 'Specimen not found');
    if (s.state !== 'market' || !isSourced(s)) fail(409, 'This specimen is no longer on the market');
    const rules = getRules();
    const src = checkSource(s);
    const fresh = () => ({ code: 'changed', price_usd: listPrice(s), source_price_usd: src.price, available: src.available });
    if (!src.available || src.price == null) throw new HttpError(409, 'The dealer no longer has this specimen. The market has been refreshed.', { ...fresh(), available: false });
    if (rules.source_max_age_hours > 0 && (!src.verified_at || Date.now() - Date.parse(src.verified_at) > rules.source_max_age_hours * 3600e3)) {
      throw new HttpError(409, 'We are re-checking this specimen with the dealer. Try again shortly.', { code: 'stale' });
    }
    const list = marketPrice(src.price!, rules);
    const expected = body?.expected_price_usd == null ? null : Number(body.expected_price_usd);
    if (expected != null && Math.abs(expected - list) > 0.004) throw new HttpError(409, `The price changed to $${list.toFixed(2)}. Check it and confirm again.`, fresh());
    const currency = currencyOf(body?.currency);
    const paid = currency === 'TOKEN' ? tokenPrice(list, rules) : list;
    const tokenAmount = currency === 'TOKEN' ? tokenAmountFor(paid) : undefined;
    const rock = cents(src.price!);
    const commission = cents(paid - rock);
    const payment = chain.charge({ from: wallet, usd: paid, currency, solUsd: rules.sol_usd, memo: `reserve ${id}`, tokenAmount });

    run("UPDATE specimens SET state = 'held', owner = ?, acquired_via = 'market', acquired_at = ?, paid_usd = ?, sold_back = 0, updated_at = ? WHERE id = ?", wallet, now(), paid, now(), id);
    const rid = uid('rs');
    run(`INSERT INTO reservations (id, specimen_id, holder, status, reserved_price_usd, commission_usd, paid_usd, currency, token_amount, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`, rid, id, wallet, rock, commission, paid, currency, tokenAmount ?? null, now(), now());
    const eid = uid('es');
    run("INSERT INTO escrows (id, reservation_id, specimen_id, holder, amount_usd, status, created_at) VALUES (?, ?, ?, ?, ?, 'locked', ?)", eid, rid, id, wallet, rock, now());
    escrowEvent(get<EscRow>('SELECT * FROM escrows WHERE id = ?', eid)!, 'lock', rock, 'escrow', payment.tx);
    const burn = currency === 'TOKEN' ? cents(commission * rules.token_burn_share) : 0;
    ledger('reservation', { wallet, specimen_id: id, usd: paid, currency, amount: payment.amount, tx: payment.tx, split: { escrow: rock, commission, token_burn: burn, list_price: list } });
    queueMint(id, wallet);
    const reveal: PackReveal = {
      pull_id: null, series_id: null, band: 'par', pack_price_usd: paid, vault_value_usd: rock,
      specimen: { id: s.id, name: s.name, class: s.class.replace(', ', ' '), mass_g: s.mass_g, render: { type: s.category, seed: s.render_seed } },
    };
    return { reveal, payment, reservation: toReservation(resRow(rid)!) };
  });
}

/** Back to the market (or out of it when the dealer sold it), no owner, NFT burned. */
function release(s: SpecimenRow) {
  const back = s.source_status === 'available' && isSourced(s) ? 'market' : 'vault';
  run(`UPDATE specimens SET state = ?, owner = NULL, acquired_via = NULL, acquired_at = NULL, paid_usd = NULL, updated_at = ? WHERE id = ?`, back, now(), s.id);
  queueBurn(s.id);
}

/** Holder's choice: the rock's price comes back in USDC, the commission is kept. */
export function cancelReservation(wallet: string, resId: string) {
  return tx(() => {
    const r = mine(wallet, resId, ['active']);
    const s = specimenRow(r.specimen_id)!;
    if (s.owner !== wallet || s.state !== 'held') fail(409, 'This specimen is not with you');
    const e = escrowOf(r.id) ?? fail(409, 'No escrow for this reservation');
    const payout = chain.payout({ to: wallet, usd: e.amount_usd, memo: `cancel ${s.id}` });
    escrowEvent(e, 'refund', e.amount_usd, wallet, payout.tx, 'cancel');
    run("UPDATE escrows SET status = 'refunded', closed_at = ? WHERE id = ?", now(), e.id);
    run("UPDATE reservations SET status = 'cancelled', updated_at = ?, closed_at = ? WHERE id = ?", now(), now(), r.id);
    release(s);
    ledger('reservation_cancel', { wallet, specimen_id: s.id, usd: -e.amount_usd, currency: 'USDC', amount: -payout.amount, tx: payout.tx, split: { refunded: e.amount_usd, commission_kept: r.commission_usd } });
    return { refunded_usd: e.amount_usd, payout };
  });
}

/** Admin: the dealer sold it elsewhere. Off the market; a holder gets to choose a replacement or a full refund. */
export function markSoldAtSource(actor: string, specimenId: string) {
  return tx(() => {
    const s = specimenRow(specimenId) ?? fail(404, 'Specimen not found');
    if (!isSourced(s)) fail(409, 'Only dealer-sourced specimens can be sold at source');
    run("UPDATE specimens SET source_status = 'sold', updated_at = ? WHERE id = ?", now(), s.id);
    if (s.state === 'market') run("UPDATE specimens SET state = 'vault', updated_at = ? WHERE id = ?", now(), s.id);
    const r = openReservation(s.id);
    if (r && r.status === 'active') {
      run("UPDATE reservations SET status = 'sold_at_source', updated_at = ? WHERE id = ?", now(), r.id);
      run("UPDATE listings SET status = 'cancelled', closed_at = ? WHERE specimen_id = ? AND status = 'active'", now(), s.id);
    }
    audit(actor, 'specimen.sold_at_source', s.id, { reservation: r?.id ?? null });
    return { ok: true, reservation: r?.id ?? null };
  });
}

export function markSourceAvailable(actor: string, specimenId: string, price?: number) {
  return tx(() => {
    const s = specimenRow(specimenId) ?? fail(404, 'Specimen not found');
    if (!isSourced(s)) fail(409, 'Not dealer-sourced');
    const p = price == null ? s.dealer_price_usd : cents(num(price, 'Dealer price', 0.01, 1e7));
    run("UPDATE specimens SET source_status = 'available', dealer_price_usd = ?, source_verified_at = ?, updated_at = ? WHERE id = ?", p, now(), now(), s.id);
    audit(actor, 'specimen.source_verified', s.id, { price: p });
    return { ok: true };
  });
}

/** Full refund (sold at source, or a higher price at redemption the holder declines): everything paid comes back. */
function refundAll(r: ResRow, wallet: string, reason: string) {
  const s = specimenRow(r.specimen_id)!;
  const e = escrowOf(r.id);
  const escrowPart = e && e.status === 'locked' ? e.amount_usd : 0;
  const fromOps = cents(r.paid_usd - escrowPart);
  const payout = chain.payout({ to: wallet, usd: r.paid_usd, memo: `refund ${s.id}` });
  if (e && e.status === 'locked') {
    escrowEvent(e, 'refund', escrowPart, wallet, payout.tx, reason);
    run("UPDATE escrows SET status = 'refunded', closed_at = ? WHERE id = ?", now(), e.id);
  }
  run("UPDATE reservations SET status = 'refunded', updated_at = ?, closed_at = ? WHERE id = ?", now(), now(), r.id);
  release(s);
  ledger('reservation_refund', { wallet, specimen_id: s.id, usd: -r.paid_usd, currency: 'USDC', amount: -payout.amount, tx: payout.tx, split: { escrow: escrowPart, commission_refunded: fromOps, reason } });
  return { refunded_usd: r.paid_usd, payout };
}

export function refundReservation(wallet: string, resId: string) {
  return tx(() => refundAll(mine(wallet, resId, ['sold_at_source']), wallet, 'sold_at_source'));
}

/** Specimens a holder may take instead (sold at source): on the market, available, same or lower price. */
export function replacementOptions(wallet: string, resId: string) {
  const r = mine(wallet, resId, ['sold_at_source']);
  const rules = getRules();
  return all<SpecimenRow>("SELECT * FROM specimens WHERE state = 'market' AND dealer_id IS NOT NULL AND source_status = 'available'")
    .map(s => ({ s, p: listPrice(s) }))
    .filter(x => x.p != null && (r.currency === 'TOKEN' ? tokenPrice(x.p!, rules) : x.p!) <= r.paid_usd + 0.001)
    .sort((a, b) => b.p! - a.p!)
    .slice(0, 24)
    .map(x => x.s.id);
}

export function replaceReservation(wallet: string, resId: string, newId: string) {
  return tx(() => {
    const r = mine(wallet, resId, ['sold_at_source']);
    const rules = getRules();
    const n = specimenRow(newId) ?? fail(404, 'Specimen not found');
    if (n.state !== 'market' || !isSourced(n) || n.source_status !== 'available') fail(409, 'That specimen is no longer available');
    const list = listPrice(n)!;
    const newPaid = r.currency === 'TOKEN' ? tokenPrice(list, rules) : list;
    if (newPaid > r.paid_usd + 0.001) fail(409, 'Pick a specimen of equal or lower price');
    const e = escrowOf(r.id) ?? fail(409, 'No escrow for this reservation');
    const newRock = cents(n.dealer_price_usd!);
    const refund = cents(r.paid_usd - newPaid);
    const payout = refund > 0 ? chain.payout({ to: wallet, usd: refund, memo: `replacement ${n.id}` }) : null;
    // the old specimen leaves; the new one is reserved with the same escrow
    const old = specimenRow(r.specimen_id)!;
    release(old);
    run("UPDATE specimens SET state = 'held', owner = ?, acquired_via = 'market', acquired_at = ?, paid_usd = ?, updated_at = ? WHERE id = ?", wallet, now(), newPaid, now(), n.id);
    const nid = uid('rs');
    run(`INSERT INTO reservations (id, specimen_id, holder, status, reserved_price_usd, commission_usd, paid_usd, currency, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`, nid, n.id, wallet, newRock, cents(newPaid - newRock), newPaid, r.currency, now(), now());
    run("UPDATE reservations SET status = 'replaced', replaced_by = ?, updated_at = ?, closed_at = ? WHERE id = ?", nid, now(), now(), r.id);
    const escrowRefund = cents(e.amount_usd - newRock);
    if (escrowRefund > 0) escrowEvent(e, 'refund', escrowRefund, wallet, payout?.tx ?? null, 'replacement difference');
    else if (escrowRefund < 0) escrowEvent(e, 'topup', -escrowRefund, 'escrow', null, 'replacement funded from commission');
    escrowEvent(e, 'move', newRock, 'escrow', null, `${old.id} → ${n.id}`);
    run('UPDATE escrows SET reservation_id = ?, specimen_id = ?, amount_usd = ? WHERE id = ?', nid, n.id, newRock, e.id);
    queueMint(n.id, wallet);
    if (refund > 0) ledger('replacement_refund', { wallet, specimen_id: n.id, usd: -refund, currency: 'USDC', amount: -payout!.amount, tx: payout!.tx, split: { from: old.id, to: n.id } });
    return { refunded_usd: refund, reservation: toReservation(resRow(nid)!) };
  });
}

/* ---------- redemption ---------- */

export function redeemQuote(wallet: string, resId: string, countryIn: unknown): RedeemQuote {
  const r = mine(wallet, resId, ['active']);
  const country = str(countryIn, 'Country', 2).toUpperCase();
  if (!getRules().shipping_countries.includes(country)) fail(400, 'We cannot ship to this country yet');
  const s = specimenRow(r.specimen_id)!;
  const src = checkSource(s);
  const current = cents(src.price ?? r.reserved_price_usd);
  const q = shippingQuote(dealerRow(s.dealer_id), country, current);
  return { reservation_id: r.id, country, shipping_usd: q.shipping, insurance_usd: q.insurance, reserved_price_usd: r.reserved_price_usd, current_price_usd: current, delta_usd: cents(current - r.reserved_price_usd), available: src.available };
}

/**
 * Redeem a reservation. The holder has seen the shipping cost and any price change (redeemQuote).
 * price higher: top up (choice 'accept') or take a full refund (choice 'refund'); lower: the difference
 * comes back. Then the NFT is burned, the escrow is released to the ops wallet and a dealer order is
 * opened (due within 48 h, placed by hand in v1).
 */
export function redeemReservation(wallet: string, resId: string, body: any): { redemption?: Redemption; refunded_usd?: number; payment?: TxResult } {
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
    const r = mine(wallet, resId, ['active']);
    const s = specimenRow(r.specimen_id)!;
    if (s.owner !== wallet || s.state !== 'held') fail(409, 'This specimen is not with you');
    const src = checkSource(s);
    if (!src.available) {
      run("UPDATE reservations SET status = 'sold_at_source', updated_at = ? WHERE id = ?", now(), r.id);
      throw new HttpError(409, 'The dealer sold this specimen. Choose a replacement or a full refund.', { code: 'sold_at_source' });
    }
    const current = cents(src.price ?? r.reserved_price_usd);
    const delta = cents(current - r.reserved_price_usd);
    const expectedDelta = body?.expected_delta_usd == null ? null : Number(body.expected_delta_usd);
    if (expectedDelta != null && Math.abs(expectedDelta - delta) > 0.004) throw new HttpError(409, 'The dealer’s price changed again. Check the new amounts.', { code: 'changed', delta_usd: delta });
    if (delta > 0 && body?.price_change === 'refund') return refundAll(r, wallet, 'price_increase_declined');

    const e = escrowOf(r.id) ?? fail(409, 'No escrow for this reservation');
    const q = shippingQuote(dealerRow(s.dealer_id), address.country, current);
    const fee = cents(q.shipping + q.insurance);
    const charge = cents(fee + Math.max(0, delta));
    const payment = chain.charge({ from: wallet, usd: charge, currency: body?.currency === 'SOL' ? 'SOL' : 'USDC', solUsd: rules.sol_usd, memo: `redeem ${s.id}` });
    if (delta > 0) { escrowEvent(e, 'topup', delta, 'escrow', payment.tx, 'higher price at redemption'); run('UPDATE escrows SET amount_usd = amount_usd + ? WHERE id = ?', delta, e.id); }
    let refundTx: TxResult | null = null;
    if (delta < 0) {
      refundTx = chain.payout({ to: wallet, usd: -delta, memo: `price difference ${s.id}` });
      escrowEvent(e, 'refund', -delta, wallet, refundTx.tx, 'lower price at redemption');
      run('UPDATE escrows SET amount_usd = amount_usd - ? WHERE id = ?', -delta, e.id);
      ledger('price_difference_refund', { wallet, specimen_id: s.id, usd: delta, currency: 'USDC', amount: delta, tx: refundTx.tx });
    }
    // the holder burns the NFT by redeeming; only now can the escrow go to the ops wallet
    queueBurn(s.id);
    const released = cents(e.amount_usd + delta);
    escrowEvent(e, 'release', released, 'ops', null, 'released after the holder redeemed (NFT burned)');
    run("UPDATE escrows SET status = 'released', amount_usd = ?, closed_at = ? WHERE id = ?", released, now(), e.id);
    run("UPDATE reservations SET status = 'redeeming', updated_at = ? WHERE id = ?", now(), r.id);
    run("UPDATE specimens SET state = 'redeeming', updated_at = ? WHERE id = ?", now(), s.id);
    const rid = uid('rd');
    run(`INSERT INTO redemptions (id, specimen_id, wallet, name, address, status, fee_usd, tracking, created_at, updated_at, kind, reservation_id, dealer_id, due_at, shipping_usd, price_delta_usd)
         VALUES (?, ?, ?, ?, ?, 'requested', ?, '', ?, ?, 'dealer', ?, ?, ?, ?, ?)`,
      rid, s.id, wallet, name, JSON.stringify(address), fee, now(), now(), r.id, s.dealer_id, new Date(Date.now() + 48 * 3600e3).toISOString(), fee, delta);
    ledger('redemption_fee', { wallet, specimen_id: s.id, usd: fee, currency: payment.currency, amount: payment.amount, tx: payment.tx, split: { shipping: q.shipping, insurance: q.insurance } });
    if (delta > 0) ledger('price_difference_topup', { wallet, specimen_id: s.id, usd: delta, currency: payment.currency, amount: delta, tx: payment.tx });
    ledger('escrow_release', { wallet, specimen_id: s.id, usd: 0, currency: 'USDC', amount: 0, split: { released_to_ops: released, reservation: r.id } });
    return { redemption: redemptionOf(get('SELECT * FROM redemptions WHERE id = ?', rid)), payment };
  });
}

/** Secondary sale: the reservation and its escrow follow the NFT to the buyer. */
export function moveReservation(specimenId: string, to: string) {
  const r = openReservation(specimenId);
  if (!r) return;
  run('UPDATE reservations SET holder = ?, updated_at = ? WHERE id = ?', to, now(), r.id);
  run('UPDATE escrows SET holder = ? WHERE reservation_id = ?', to, r.id);
}

/* ---------- admin views (read-only for escrow) ---------- */

export function escrowOverview() {
  const sum = (status: string) => cents(get<{ s: number | null }>('SELECT SUM(amount_usd) s FROM escrows WHERE status = ?', status)!.s ?? 0);
  const rows = all<EscRow & { status_res: string; specimen_name: string }>(`SELECT e.*, r.status status_res, s.name specimen_name FROM escrows e
    LEFT JOIN reservations r ON r.id = e.reservation_id LEFT JOIN specimens s ON s.id = e.specimen_id ORDER BY e.created_at DESC LIMIT 300`);
  return {
    locked: sum('locked'), released: sum('released'),
    refunded: cents(get<{ s: number | null }>("SELECT SUM(amount_usd) s FROM escrow_events WHERE kind = 'refund'")!.s ?? 0),
    count_locked: get<{ n: number }>("SELECT COUNT(*) n FROM escrows WHERE status = 'locked'")!.n,
    rows,
  };
}

export const escrowEvents = (escrowId: string) => all<any>('SELECT * FROM escrow_events WHERE escrow_id = ? ORDER BY id', escrowId);

/* ---------- one-time migration to the dealer model ---------- */

const SAMPLE_DEALERS: [string, string, number, number, number][] = [
  ['Sample dealer · Atlas (Morocco)', 'MA', 12, 24, 38],
  ['Sample dealer · Nordic Iron (Sweden)', 'SE', 9, 16, 34],
  ['Sample dealer · Desert Finds (USA)', 'US', 10, 30, 42],
];

/** Market specimens become dealer-sourced; held market purchases become reservations with an escrow. */
export function migrateDealerModel() {
  if (get("SELECT 1 FROM settings WHERE key = 'dealer_v1'")) return;
  tx(() => {
    if (!get('SELECT 1 FROM dealers LIMIT 1')) {
      for (const [name, country, d, r, w] of SAMPLE_DEALERS) {
        run(`INSERT INTO dealers (id, name, country, region, ship_domestic_usd, ship_region_usd, ship_world_usd, insurance_pct, contact, notes, api_kind, active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0.015, '', 'Sample data', 'manual', 1, ?)`, uid('dl'), name, country, regionOf(country), d, r, w, now());
      }
    }
    const dealers = all<DealerRow>('SELECT * FROM dealers ORDER BY created_at');
    const pick = (origin: string | null) => {
      const o = (origin ?? '').toLowerCase();
      if (/(morocco|oman|algeria|niger|mali|burkina)/.test(o)) return dealers[0];
      if (/(sweden|russia|finland|norway|poland|czech|germany|namibia)/.test(o)) return dealers[1] ?? dealers[0];
      return dealers[2] ?? dealers[0];
    };
    const rows = all<SpecimenRow>("SELECT * FROM specimens WHERE dealer_id IS NULL AND (state = 'market' OR (state IN ('held', 'redeeming') AND acquired_via IN ('market', 'secondary')))");
    for (const s of rows) {
      const d = pick(s.origin);
      run("UPDATE specimens SET dealer_id = ?, dealer_price_usd = vault_value_usd, dealer_sku = ?, source_status = 'available', source_verified_at = ? WHERE id = ?", d.id, 'SKU-' + s.id.slice(3), now(), s.id);
      if (s.state === 'held' && s.owner && s.vault_value_usd != null) {
        const rock = cents(s.vault_value_usd);
        const paid = cents(s.paid_usd ?? marketPrice(rock, getRules()));
        const rid = uid('rs');
        run(`INSERT INTO reservations (id, specimen_id, holder, status, reserved_price_usd, commission_usd, paid_usd, currency, created_at, updated_at)
             VALUES (?, ?, ?, 'active', ?, ?, ?, 'USDC', ?, ?)`, rid, s.id, s.owner, rock, cents(paid - rock), paid, s.acquired_at ?? now(), now());
        const eid = uid('es');
        run("INSERT INTO escrows (id, reservation_id, specimen_id, holder, amount_usd, status, created_at) VALUES (?, ?, ?, ?, ?, 'locked', ?)", eid, rid, s.id, s.owner, rock, now());
        escrowEvent(get<EscRow>('SELECT * FROM escrows WHERE id = ?', eid)!, 'lock', rock, 'escrow', null, 'migrated to the dealer model');
      }
    }
    run("INSERT INTO settings (key, value) VALUES ('dealer_v1', '1')");
  });
}

/* ---------- importing a dealer's offers (CSV) ---------- */

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';') { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(x => x)) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell.trim()); if (row.some(x => x)) rows.push(row);
  return rows;
}

const CATS = ['stone', 'iron', 'pallasite', 'lunar', 'martian'];

/**
 * Creates draft specimens from a dealer's list. Columns (header row, any order):
 * name, class, category (stone|iron|pallasite|lunar|martian), mass_g, dealer_price_usd,
 * optional origin, fall, dealer_sku, dealer_url, vault_id, metbull, photos (separated by |).
 * Drafts need their file completed in the editor before they can be listed.
 */
export function importOffers(actor: string, dealerId: string, csv: unknown) {
  dealerRow(dealerId) ?? fail(404, 'Dealer not found');
  const rows = parseCsv(String(csv ?? ''));
  if (rows.length < 2) fail(400, 'Paste a header row and at least one specimen');
  const head = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const col = (r: string[], k: string) => { const i = head.indexOf(k); return i < 0 ? '' : r[i] ?? ''; };
  for (const k of ['name', 'class', 'category', 'mass_g', 'dealer_price_usd']) if (!head.includes(k)) fail(400, `Missing column: ${k}`);
  return tx(() => {
    const created: string[] = [];
    const errors: string[] = [];
    let n = (get<{ n: number | null }>('SELECT MAX(CAST(substr(id, 4) AS INTEGER)) n FROM specimens')!.n ?? 0);
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const name = col(r, 'name'), cls = col(r, 'class'), cat = col(r, 'category').toLowerCase();
      const mass = Number(col(r, 'mass_g').replace(',', '.')), price = Number(col(r, 'dealer_price_usd').replace(',', '.'));
      if (!name || !cls) return void errors.push(`Line ${line}: name and class are required`);
      if (!CATS.includes(cat)) return void errors.push(`Line ${line}: category must be one of ${CATS.join(', ')}`);
      if (!(mass > 0) || !(price > 0)) return void errors.push(`Line ${line}: mass and price must be numbers`);
      const id = 'SR-' + String(++n).padStart(5, '0');
      const fall = col(r, 'fall');
      const file = { bulletin: col(r, 'metbull'), photos: col(r, 'photos').split('|').map(x => x.trim()).filter(Boolean) };
      run(`INSERT INTO specimens (id, name, class, category, mass_g, origin, fall, vault_value_usd, state, vault_id, file, notes, render_seed, dealer_id, dealer_price_usd, dealer_sku, dealer_url, source_status, source_verified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, '', ?, ?, ?, ?, ?, 'available', ?, ?, ?)`,
        id, name.slice(0, 120), cls.slice(0, 120), cat, mass, col(r, 'origin') || null, fall ? (fall.toLowerCase() === 'find' ? 'find' : fall) : null, cents(price),
        col(r, 'vault_id') || null, JSON.stringify(file), Math.floor(Math.random() * 900) + 10, dealerId, cents(price), col(r, 'dealer_sku').slice(0, 120), col(r, 'dealer_url').slice(0, 500), now(), now(), now());
      created.push(id);
    });
    audit(actor, 'dealer.import', dealerId, { created: created.length, errors: errors.length });
    return { created, errors };
  });
}
