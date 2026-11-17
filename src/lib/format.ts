// Display helpers. Formats match the design's page script exactly. Price math lives in shared/rules.ts.
import type { Rules, Specimen, SpecimenStatus } from '../data';
import { buybackOffer, marketPrice as mp } from '../../shared/rules.ts';

/** $1,234.00 */
export const usd = (x: number) => (x < 0 ? '−' : '') + '$' + Math.abs(x).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Market price = vault value x markup, rounded to the cent (design: Math.round(v * 115) / 100). */
export const marketPrice = (vault: number, rules: Rules) => mp(vault, rules);

/** Instant buyback offer = vault value x share. */
export const buyback = (vault: number, rules: Rules) => buybackOffer(vault, rules);

/** 0.41 g, 0.40 g, 112.4 g, 34.0 g */
export const mass = (g: number) => (g < 1 ? g.toFixed(2) : g.toFixed(1)) + ' g';

/** "Morocco · fall 2011", "USA · find", "Papers pending" */
export const originLabel = (s: Pick<Specimen, 'origin' | 'fall'>) =>
  s.origin == null ? 'Papers pending' : s.origin + ' · ' + (s.fall === 'find' ? 'find' : s.fall == null ? 'date unknown' : 'fall ' + s.fall);

/** Where the specimen is, as the vault register shows it. */
export function whereLabel(s: Specimen, rules: Rules) {
  switch (s.status.kind) {
    case 'on_market': return 'Market' + (s.vault_value_usd != null ? ' · ' + usd(marketPrice(s.vault_value_usd, rules)) : '');
    case 'in_series': return 'Series ' + s.status.series_id;
    case 'in_vault': return s.status.sold_back ? 'Vault · next series' : 'Vault';
    case 'locked': return 'Launch drop';
    case 'held': return s.owner ? 'Collector · ' + s.owner : 'Collector';
    case 'redeeming': return 'Being shipped';
    case 'redeemed': return 'Shipped';
    case 'not_listed': return 'Not listed';
  }
}

/** [css class, label] for the status pill. */
export function statusPill(st: SpecimenStatus): [string, string] {
  switch (st.kind) {
    case 'on_market': return ['pool', 'On the market'];
    case 'in_series': return ['ser', st.sold_back ? 'Sold back, next series' : 'Sealed in a series'];
    case 'in_vault': return st.sold_back ? ['ser', 'Sold back, next series'] : ['pend', 'In the vault'];
    case 'locked': return ['ser', 'Locked in a drop'];
    case 'held': return ['held', 'Held'];
    case 'redeeming': return ['red', 'Shipping'];
    case 'redeemed': return ['red', 'Redeemed'];
    case 'not_listed': return ['pend', 'File incomplete'];
  }
}

/** 2.5 -> "2.5", 3 -> "3" */
export const multiple = (vault: number, pack: number) => String(+(vault / pack).toFixed(2));

export const pct = (x: number) => Math.round(x * 100);

export const sol = (usdValue: number, rules: Rules) => (usdValue / rules.sol_usd).toFixed(3) + ' SOL';
