// Paying with the project token. Off until Admin › Settings switches it on (the token is not live yet).
// The token amount for a price comes from a 5-minute average of the token's USD price:
//   manual  — the price set in settings (testing, or before a market exists)
//   jupiter — sampled every 30 s from Jupiter's public price API for the configured mint
import { getRules } from './store.ts';
import { fail } from './util.ts';

const WINDOW_MS = 5 * 60 * 1000;
const g = globalThis as unknown as { __srtok?: { samples: { t: number; p: number }[]; timer?: NodeJS.Timeout; mint?: string; err?: string } };
const state = (g.__srtok ??= { samples: [] });

async function sample() {
  const r = getRules();
  if (!r.token_enabled || r.token_price_source !== 'jupiter' || !r.token_mint) return;
  if (state.mint !== r.token_mint) { state.samples = []; state.mint = r.token_mint; }
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(r.token_mint)}`, { signal: AbortSignal.timeout(8000) });
    const j: any = await res.json();
    const p = Number(j?.[r.token_mint]?.usdPrice ?? j?.data?.[r.token_mint]?.price);
    if (Number.isFinite(p) && p > 0) { state.samples.push({ t: Date.now(), p }); state.err = undefined; }
    else state.err = 'No price for this mint yet';
  } catch (e: any) { state.err = String(e?.message ?? e).slice(0, 160); }
  const cut = Date.now() - WINDOW_MS;
  state.samples = state.samples.filter(s => s.t >= cut);
}

// store.ts reads the price through this hook (no import cycle).
(globalThis as unknown as { __srtokprice?: () => number | null }).__srtokprice = () => tokenPriceUsd();

export function startTokenSampler() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(sample, 30_000);
  sample();
}

/** The token's USD price used for quotes (5-minute average), or null if unavailable. */
export function tokenPriceUsd(): number | null {
  const r = getRules();
  if (!r.token_enabled) return null;
  if (r.token_price_source === 'manual') return r.token_manual_price_usd > 0 ? r.token_manual_price_usd : null;
  const cut = Date.now() - WINDOW_MS;
  const s = state.samples.filter(x => x.t >= cut);
  if (!s.length) return null;
  return s.reduce((a, x) => a + x.p, 0) / s.length;
}

export function tokenStatus() {
  const r = getRules();
  return { enabled: r.token_enabled, source: r.token_price_source, price_usd: tokenPriceUsd(), samples: state.samples.length, error: state.err ?? null };
}

/** Token amount for a USD price (after the token discount). Throws if the token cannot be used right now. */
export function tokenAmountFor(usd: number) {
  const p = tokenPriceUsd();
  if (p == null) fail(409, `Paying with $${getRules().token_symbol} is not available right now`);
  return Math.round((usd / p!) * 10 ** 6) / 10 ** 6;
}

/* ---------- SOL price for quotes ---------- */
// SOL prices come from a 5-minute average of Jupiter's price (sampled every 60 s). If it is
// unavailable, Rules › SOL price is used. Not sampled in tests (CHAIN=simulated).
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const gs = globalThis as unknown as { __srsol?: { samples: { t: number; p: number }[]; timer?: NodeJS.Timeout; err?: string }; __srsolprice?: () => number | null };
const solState = (gs.__srsol ??= { samples: [] });

async function sampleSol() {
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`, { signal: AbortSignal.timeout(8000) });
    const j: any = await res.json();
    const p = Number(j?.[SOL_MINT]?.usdPrice ?? j?.data?.[SOL_MINT]?.price);
    if (Number.isFinite(p) && p > 1) { solState.samples.push({ t: Date.now(), p }); solState.err = undefined; } else solState.err = 'No SOL price';
  } catch (e: any) { solState.err = String(e?.message ?? e).slice(0, 160); }
  const cut = Date.now() - WINDOW_MS;
  solState.samples = solState.samples.filter(s => s.t >= cut);
}

/** Live SOL/USD (5-minute average) or null. */
export function solPriceUsd(): number | null {
  const cut = Date.now() - WINDOW_MS;
  const s = solState.samples.filter(x => x.t >= cut);
  return s.length ? Math.round((s.reduce((a, x) => a + x.p, 0) / s.length) * 100) / 100 : null;
}
gs.__srsolprice = solPriceUsd;

export function startSolPrice() {
  if (process.env.CHAIN === 'simulated') return;
  if (solState.timer) clearInterval(solState.timer);
  solState.timer = setInterval(sampleSol, 60_000);
  sampleSol();
}
