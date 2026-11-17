// Secondary market: collectors list specimens they hold for other collectors to buy.
// The buyer pays the price, the seller gets price − royalty (rules.royalty, 3%), the royalty goes to
// inventory. The NFT moves to the buyer (Metaplex Core transfer, simulated by the chain adapter).
import type { Currency, Listing, TxResult } from '../shared/types.ts';
import { chain } from './chain.ts';
import { all, get, now, run, tx } from './db.ts';
import { ledger } from './ops.ts';
import { activeListing, displayName, getRules, specimenRow, toListing, type ListingRow, type SpecimenRow } from './store.ts';
import { cents, fail, num, uid } from './util.ts';


export function listingsOf(address: string): Listing[] {
  return all<ListingRow>("SELECT * FROM listings WHERE seller = ? AND status = 'active' ORDER BY created_at DESC", address).map(l => toListing(l, address));
}

export function listForSale(address: string, specimenId: string, b: any): Listing {
  return tx(() => {
    const s = specimenRow(specimenId) ?? fail(404, 'Specimen not found');
    if (s.owner !== address || s.state !== 'held') fail(403, 'You do not hold this specimen');
    if (activeListing(specimenId)) fail(409, 'This specimen is already listed');
    const max = Math.max(1000, (s.vault_value_usd ?? 0) * 100);
    const price = cents(num(b?.price_usd, 'Price', 1, max));
    const id = uid('ls');
    run("INSERT INTO listings (id, specimen_id, seller, price_usd, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)", id, specimenId, address, price, now());
    return toListing(get<ListingRow>('SELECT * FROM listings WHERE id = ?', id)!, address);
  });
}

export function cancelListing(address: string | null, id: string, asAdmin = false) {
  return tx(() => {
    const l = get<ListingRow>('SELECT * FROM listings WHERE id = ?', id) ?? fail(404, 'Listing not found');
    if (l.status !== 'active') fail(409, 'This listing is no longer active');
    if (!asAdmin && l.seller !== address) fail(403, 'Not your listing');
    run("UPDATE listings SET status = 'cancelled', closed_at = ? WHERE id = ?", now(), id);
    return { ok: true };
  });
}

export function buyListing(buyer: string, id: string, currency: unknown): { listing: Listing; payment: TxResult; specimen: SpecimenRow } {
  return tx(() => {
    const l = get<ListingRow>('SELECT * FROM listings WHERE id = ?', id) ?? fail(404, 'Listing not found');
    if (l.status !== 'active') fail(409, 'Someone else just bought this one');
    if (l.seller === buyer) fail(409, 'This is your own listing');
    const s = specimenRow(l.specimen_id)!;
    if (s.owner !== l.seller || s.state !== 'held') fail(409, 'This listing is no longer valid');
    const rules = getRules();
    const royalty = cents(l.price_usd * rules.royalty);
    const payoutUsd = cents(l.price_usd - royalty);
    const cur: Currency = currency === 'SOL' ? 'SOL' : 'USDC';
    const payment = chain.charge({ from: buyer, usd: l.price_usd, currency: cur, solUsd: rules.sol_usd, memo: `secondary ${l.id}` });
    const payout = chain.payout({ to: l.seller, usd: payoutUsd, memo: `sale ${l.id}` });
    run("UPDATE specimens SET owner = ?, acquired_via = 'secondary', acquired_at = ?, paid_usd = ?, updated_at = ? WHERE id = ?", buyer, now(), l.price_usd, now(), s.id);
    run("UPDATE listings SET status = 'sold', buyer = ?, closed_at = ? WHERE id = ?", buyer, now(), id);
    ledger('secondary_sale', { wallet: buyer, specimen_id: s.id, usd: l.price_usd, currency: payment.currency, amount: payment.amount, tx: payment.tx, split: { seller_payout: payoutUsd, royalty, listing: l.id } });
    ledger('seller_payout', { wallet: l.seller, specimen_id: s.id, usd: -payoutUsd, currency: 'USDC', amount: -payout.amount, tx: payout.tx, split: { listing: l.id, royalty } });
    return { listing: toListing({ ...l, status: 'sold' }, buyer), payment, specimen: specimenRow(s.id)! };
  });
}

export function adminListings(status: string | null) {
  return all<ListingRow>(`SELECT * FROM listings ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC LIMIT 300`, ...(status ? [status] : [])).map(l => ({
    ...l, seller_name: displayName(l.seller), buyer_name: displayName(l.buyer), specimen_name: specimenRow(l.specimen_id)?.name ?? l.specimen_id,
  }));
}
