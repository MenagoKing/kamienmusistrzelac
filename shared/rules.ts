// Product math shared by the site, the admin panel and the server. Prices are never stored:
// market price = vault value x markup, buyback = vault value x share.
import type { Band, RockType, Rules, Tier } from './types.ts';

export const DEFAULT_RULES: Rules = {
  market_markup: 1.15,
  buyback_share: 0.85,
  series_size: 100,
  bands: {
    floor: { min: 0.7, max: 0.85, count: 78 },
    par: { min: 0.9, max: 1.2, count: 19 },
    hit: { min: 1.5, max: null, count: 3 },
  },
  ev_target: 0.85,
  edge_split: { rocks_buyback: 0.05, launch_reserve: 0.03, ops: 0.07 },
  royalty: 0.03,
  handling_fee_usd: 25,
  shipping_usd: 35,
  shipping_countries: ['US', 'CA', 'GB', 'IE', 'DE', 'FR', 'NL', 'BE', 'ES', 'IT', 'PL', 'CZ', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'PT', 'AU', 'NZ', 'JP', 'SG'],
  sol_usd: 150,
  demo_wallet: true,
  sample_notice: true,
  market_funds_buyback: false,
  google_client_id: '',
  source_max_age_hours: 0,
  token_enabled: false,
  token_symbol: 'ROCKS',
  token_mint: '',
  token_decimals: 6,
  token_discount: 0.05,
  token_burn_share: 0.5,
  token_price_source: 'manual',
  token_manual_price_usd: 0,
};

/** Rarity shown on listings: class first, then price. */
export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
export function rarityOf(type: RockType, priceUsd: number | null | undefined): Rarity {
  if (type === 'martian' || type === 'lunar') return 'Legendary';
  if (type === 'pallasite') return priceUsd != null && priceUsd >= 400 ? 'Legendary' : 'Epic';
  const p = priceUsd ?? 0;
  return p >= 500 ? 'Epic' : p >= 200 ? 'Rare' : p >= 80 ? 'Uncommon' : 'Common';
}

/** Price when paying with the token (rules.token_discount off). */
export const tokenPrice = (usd: number, rules: Pick<Rules, 'token_discount'>) => Math.round(usd * (1 - rules.token_discount) * 100) / 100;

export const BANDS: Band[] = ['floor', 'par', 'hit'];
export const BAND_NAME: Record<Band, string> = { floor: 'Floor', par: 'Par', hit: 'Hit' };
export const TIER_NAME: Record<Tier, string> = { earth: 'Earth', orbit: 'Orbit', mars: 'Mars', launch: 'Launch drop' };
export const TIER_NOTE: Record<Tier, string> = {
  earth: 'Chondrite and iron fragments',
  orbit: 'Adds pallasites and rare classes',
  mars: 'A chance at lunar and Martian fragments',
  launch: 'Limited pool, opens 24 h before liftoff',
};
export const CATEGORY_NAME: Record<RockType, string> = { stone: 'Chondrite', iron: 'Iron', pallasite: 'Pallasite', lunar: 'Lunar', martian: 'Martian' };

const cents = (x: number) => Math.round(x * 100) / 100;

/** Market price = vault value x markup, rounded to the cent (design: Math.round(v * 115) / 100). */
export const marketPrice = (vault: number, rules: Pick<Rules, 'market_markup'>) => Math.round(vault * Math.round(rules.market_markup * 100)) / 100;

/** Instant buyback offer = vault value x share. */
export const buybackOffer = (vault: number, rules: Pick<Rules, 'buyback_share'>) => Math.round(vault * Math.round(rules.buyback_share * 100)) / 100;

/** The band a specimen lands in for a given pack price, or null when it fits no band. */
export function bandOf(vault: number, pack: number, rules: Pick<Rules, 'bands'>): Band | null {
  if (!(pack > 0)) return null;
  const r = vault / pack;
  const eps = 1e-9;
  for (const b of ['hit', 'par', 'floor'] as Band[]) {
    const { min, max } = rules.bands[b];
    if (r + eps >= min && (max == null || r - eps <= max)) return b;
  }
  return null;
}

/** Split of a pack sale: 85% inventory (EV), the edge split three ways. */
export function packSplit(usd: number, rules: Rules) {
  const e = rules.edge_split;
  const rocks = cents(usd * e.rocks_buyback), reserve = cents(usd * e.launch_reserve), ops = cents(usd * e.ops);
  return { inventory: cents(usd - rocks - reserve - ops), rocks_buyback: rocks, launch_reserve: reserve, ops };
}

export interface SlotLike { vault_value_usd: number | null; file_complete: boolean; band?: Band | null }

export interface SeriesCheck {
  errors: string[];
  warnings: string[];
  counts: Record<Band, number>;
  out_of_band: number;
  ev: number | null; // total vault value / (slots x pack price)
  total_vault: number;
}

/** Checks a series composition against the rules before it can be published. */
export function checkSeries(s: { size: number; pack_price_usd: number | null; tier: Tier }, slots: SlotLike[], rules: Rules): SeriesCheck {
  const errors: string[] = [], warnings: string[] = [];
  const counts: Record<Band, number> = { floor: 0, par: 0, hit: 0 };
  let out = 0, total = 0;
  const pack = s.pack_price_usd ?? 0;
  if (!(pack > 0)) errors.push('Set a pack price.');
  for (const sl of slots) {
    if (sl.vault_value_usd == null) { errors.push('A specimen has no vault value.'); continue; }
    total += sl.vault_value_usd;
    if (!sl.file_complete) errors.push('A specimen has an incomplete file.');
    const b = pack > 0 ? bandOf(sl.vault_value_usd, pack, rules) : null;
    if (b) counts[b]++; else out++;
  }
  if (out) errors.push(`${out} specimen${out > 1 ? 's' : ''} fit no band at this pack price (floor is ${Math.round(rules.bands.floor.min * 100)}%).`);
  if (slots.length !== s.size) errors.push(`The series is set to ${s.size} packs but holds ${slots.length} specimens.`);
  if (s.tier !== 'launch' && s.size === rules.series_size) {
    for (const b of BANDS) if (counts[b] !== rules.bands[b].count) errors.push(`${BAND_NAME[b]}: ${counts[b]} of ${rules.bands[b].count} required.`);
  } else {
    for (const b of BANDS) {
      const want = Math.round(rules.bands[b].count * s.size / rules.series_size);
      if (Math.abs(counts[b] - want) > Math.max(1, s.size * 0.05)) warnings.push(`${BAND_NAME[b]}: ${counts[b]} packs, the standard mix would be about ${want}.`);
    }
  }
  const ev = pack > 0 && slots.length ? total / (slots.length * pack) : null;
  if (ev != null && Math.abs(ev - rules.ev_target) > 0.03) warnings.push(`Expected value is ${Math.round(ev * 1000) / 10}%, target ${Math.round(rules.ev_target * 100)}%.`);
  return { errors: [...new Set(errors)], warnings, counts, out_of_band: out, ev, total_vault: cents(total) };
}

/** "7xKX…9fQ2" */
export const shortAddr = (a: string | null | undefined) => (a ? (a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a) : '');
