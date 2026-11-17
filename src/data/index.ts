// The one data layer for the page. Components import from here only.
// Today every function returns the design's sample data (./sample.ts). To go live, replace the
// bodies below with API calls and keep the return types; nothing else in the app has to change.

import { MARKET, REGISTER, REVEAL, RULES, UPCOMING, sampleDrop, sampleSeries } from './sample';
import type { Band, PageData, Series } from './types';

export type * from './types';

/** Everything the page needs for its first render. */
export async function getPageData(): Promise<PageData> {
  // TODO(api): GET market listings, register, rules, open series, upcoming series, sample reveal, next drop.
  return {
    rules: RULES,
    market: MARKET,
    register: REGISTER,
    series: sampleSeries(),
    upcoming: UPCOMING,
    reveal: REVEAL,
    drop: sampleDrop(),
  };
}

/**
 * Live counts for a series. Calls onChange with the new state on every opened pack and returns an
 * unsubscribe function.
 * Sample: replays the design's demo (one pack every 3.4 s, a verifiable-looking draw without
 * replacement, reset to the sample state at 60 opened). The page only subscribes when motion is on.
 */
export function subscribeSeries(start: Series, onChange: (s: Series) => void): () => void {
  // TODO(api): replace with a websocket or polling of GET /series/:id.
  const rand = mulberry(1);
  let s = start;
  const draw = (): Band => {
    const n = s.remaining.floor + s.remaining.par + s.remaining.hit;
    const r = rand() * n;
    return r < s.remaining.floor ? 'floor' : r < s.remaining.floor + s.remaining.par ? 'par' : 'hit';
  };
  const timer = setInterval(() => {
    if (s.opened.length >= 60) {
      s = sampleSeries();
    } else {
      const b = draw();
      s = { ...s, remaining: { ...s.remaining, [b]: s.remaining[b] - 1 }, opened: [...s.opened, b] };
    }
    onChange(s);
  }, 3400);
  return () => clearInterval(timer);
}

/** Waitlist sign-up. Sample: no network, resolves at once. */
export async function joinWaitlist(_email: string): Promise<void> {
  // TODO(api): POST the email to the waitlist service.
}

// Same generator as RK.mulberry in space-rocks-site/src/rocks.js (sample draw only).
function mulberry(a: number) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
