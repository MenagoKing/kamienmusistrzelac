// SAMPLE DATA, copied as-is from the design (space-rocks-site/index.html page script and markup).
// Nothing here is real. Replace through src/data/index.ts when the API exists; do not edit the
// numbers by hand. Prices are never stored: the market price is computed from vault value x markup.

import type { Band, LaunchDrop, PackReveal, Rules, Series, Specimen, UpcomingSeries } from './types';

export const RULES: Rules = {
  market_markup: 1.15,
  buyback_share: 0.85,
  series_size: 100,
  bands: {
    floor: { min: 0.7, max: 0.85, count: 78 },
    par: { min: 0.9, max: 1.2, count: 19 },
    hit: { min: 1.5, max: null, count: 3 },
  },
};

/** Market listings, in the order the design shows them (SPEC). */
export const MARKET: Specimen[] = [
  { id: 'SR-00007', name: 'Tissint', class: 'Martian, shergottite', mass_g: 0.41, origin: 'Morocco', fall: 2011, vault_value_usd: 240, status: { kind: 'on_market' }, render: { type: 'martian', seed: 21 } },
  { id: 'SR-00418', name: 'Muonionalusta', class: 'Iron, IVA', mass_g: 112.4, origin: 'Sweden', fall: 'find', vault_value_usd: 420, status: { kind: 'on_market' }, render: { type: 'iron', seed: 57 } },
  { id: 'SR-00233', name: 'Brenham', class: 'Pallasite, main group', mass_g: 8.2, origin: 'USA', fall: 'find', vault_value_usd: 150, status: { kind: 'on_market' }, render: { type: 'pallasite', seed: 33 } },
  { id: 'SR-00344', name: 'Gao-Guenie', class: 'Chondrite, H5', mass_g: 12.8, origin: 'Burkina Faso', fall: 1960, vault_value_usd: 56, status: { kind: 'on_market' }, render: { type: 'stone', seed: 47 } },
  { id: 'SR-00121', name: 'Campo del Cielo', class: 'Iron, IAB', mass_g: 21.6, origin: 'Argentina', fall: 'find', vault_value_usd: 36, status: { kind: 'on_market' }, render: { type: 'iron', seed: 45 } },
  { id: 'SR-00562', name: 'Holbrook', class: 'Chondrite, L6', mass_g: 3.1, origin: 'USA', fall: 1912, vault_value_usd: 28, status: { kind: 'on_market' }, render: { type: 'stone', seed: 69 } },
];

const byId = (id: string) => MARKET.find(s => s.id === id)!;

/** Public vault register rows (REG). Vault values the design does not show are left null. */
export const REGISTER: Specimen[] = [
  byId('SR-00007'),
  byId('SR-00233'),
  { id: 'SR-00287', name: 'Odessa', class: 'Iron, IAB', mass_g: 34.0, origin: 'USA', fall: 'find', vault_value_usd: null, status: { kind: 'in_series', series_id: '001' }, render: { type: 'iron', seed: 39 } },
  { id: 'SR-00198', name: 'Campo del Cielo', class: 'Iron, IAB', mass_g: 18.9, origin: 'Argentina', fall: 'find', vault_value_usd: null, status: { kind: 'held' }, render: { type: 'iron', seed: 51 } },
  { id: 'SR-00359', name: 'Gao-Guenie', class: 'Chondrite, H5', mass_g: 9.7, origin: 'Burkina Faso', fall: 1960, vault_value_usd: null, status: { kind: 'in_series', series_id: '002', sold_back: true }, render: { type: 'stone', seed: 63 } },
  { id: 'SR-00571', name: 'Holbrook', class: 'Chondrite, L6', mass_g: 2.4, origin: 'USA', fall: 1912, vault_value_usd: null, status: { kind: 'redeemed' }, render: { type: 'stone', seed: 75 } },
  { id: 'SR-00601', name: 'Lunar breccia', class: 'Lunar, feldspathic', mass_g: 1.2, origin: null, fall: null, vault_value_usd: null, status: { kind: 'not_listed', reason: 'file_incomplete' }, render: { type: 'lunar', seed: 81 } },
];

/** Series 001 sample state: 35 packs already opened (PRE), in draw order. */
const PRE: Band[] = (
  'f f p f f f f f p f f h f f f p f f f f f p f f f f f p f f f f f p f'.split(' ') as ('f' | 'p' | 'h')[]
).map(k => ({ f: 'floor', p: 'par', h: 'hit' } as const)[k]);

export function sampleSeries(): Series {
  const counts = { floor: RULES.bands.floor.count, par: RULES.bands.par.count, hit: RULES.bands.hit.count };
  const remaining = { ...counts };
  PRE.forEach(b => remaining[b]--);
  return {
    id: '001',
    name: 'Series 001',
    size: RULES.series_size,
    counts,
    remaining,
    opened: [...PRE],
    pack_price_usd: null,
    status: 'open',
    composition_published_at: null,
  };
}

export const UPCOMING: UpcomingSeries[] = [
  { id: '002', name: 'Series 002', note: 'Opens when 001 sells out' },
  { id: 'mars-window', name: 'Mars Window', note: 'Hits are Martian and lunar · until 31 Dec' },
];

/** The sample reveal card. */
export const REVEAL: PackReveal = {
  series_id: null,
  band: 'hit',
  pack_price_usd: 96,
  vault_value_usd: 240,
  specimen: { id: 'SR-00011', name: 'Tissint', class: 'Martian shergottite', mass_g: 0.4, render: { type: 'martian', seed: 21 } },
};

/** Sample drop: opens 1d 14h 36m after the page loads, like the design. */
export function sampleDrop(now = Date.now()): LaunchDrop {
  return {
    id: 'sample',
    opens_at: new Date(now + ((24 + 14) * 3600 + 36 * 60) * 1000).toISOString(),
    locked: [
      { batch: 'A', name: 'Lunar', class: 'Feldspathic breccia', render: { type: 'lunar', seed: 71 } },
      { batch: 'A', name: 'Martian', class: 'Shergottite', render: { type: 'martian', seed: 83 } },
      { batch: 'B', name: 'Pallasite', class: 'Main group', render: { type: 'pallasite', seed: 95 } },
    ],
    rolled_over_from: null,
  };
}
