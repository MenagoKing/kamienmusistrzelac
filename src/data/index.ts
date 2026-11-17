// The one data layer for the site. Components import from here only; everything goes to the API
// (server/app.ts). Prices are never stored: they are computed from vault values with shared/rules.ts.
import { api } from '../lib/api';
import type { Currency, Me, PackReveal, PageData, Redemption, Series, SeriesProof, Specimen, TxResult } from './types';

export type * from './types';

/** Everything the page needs for its first render. Server-rendered pages embed it in #sr-data. */
export function getPageData(): Promise<PageData> {
  return api<PageData>('GET', '/api/page');
}

export function embeddedPageData(): PageData | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById('sr-data');
  return el ? (JSON.parse(el.textContent || 'null') as PageData) : null;
}

export const getSeries = (id: string) => api<Series>('GET', `/api/series/${encodeURIComponent(id)}`);
export const getProof = (id: string) => api<SeriesProof>('GET', `/api/series/${encodeURIComponent(id)}/proof`);
export const getRegister = (q = '', state = '') => api<Specimen[]>('GET', `/api/vault?q=${encodeURIComponent(q)}&state=${encodeURIComponent(state)}`);

/**
 * Live counts for a series. Polls the API and calls onChange with the new state; returns an
 * unsubscribe function. (A websocket can replace the polling without changing callers.)
 */
export function subscribeSeries(start: Series, onChange: (s: Series) => void, everyMs = 5000): () => void {
  let last = start.opened.length + ':' + start.status;
  let stop = false;
  const tick = async () => {
    if (document.hidden) return;
    try {
      const s = await getSeries(start.id);
      const key = s.opened.length + ':' + s.status;
      if (!stop && key !== last) { last = key; onChange(s); }
    } catch { /* offline: keep the last state */ }
  };
  const t = setInterval(tick, everyMs);
  return () => { stop = true; clearInterval(t); };
}

/** Waitlist sign-up. */
export async function joinWaitlist(email: string): Promise<void> {
  await api('POST', '/api/waitlist', { email });
}

/* ---------- collector actions (need a wallet session) ---------- */

export const getMe = () => api<Me | null>('GET', '/api/me');

export interface Purchase { reveal: PackReveal; payment: TxResult; mint: string }

export const buySpecimen = (id: string, currency: Currency) => api<Purchase>('POST', `/api/market/${encodeURIComponent(id)}/buy`, { currency });
export const openPack = (seriesId: string, currency: Currency, client_seed: string) => api<Purchase>('POST', `/api/series/${encodeURIComponent(seriesId)}/open`, { currency, client_seed });
export const sellBack = (id: string) => api<{ payout: TxResult; usd: number }>('POST', `/api/specimens/${encodeURIComponent(id)}/sell-back`, {});
export const redeemSpecimen = (id: string, form: Record<string, string>) => api<{ redemption: Redemption; payment: TxResult }>('POST', `/api/specimens/${encodeURIComponent(id)}/redeem`, form);
