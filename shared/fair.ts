// Verifiable draw (commit-reveal), used until an on-chain VRF (Switchboard / ORAO) is wired.
// Before a series opens the server publishes sha256(server_seed). Every pull is
//   h = HMAC-SHA256(server_seed, `${series_id}:${nonce}:${client_seed}`)
//   pick = floor(first 52 bits of h / 2^52 * pool)
// where pool is the number of packs still sealed and pick indexes them in slot order. The seed is
// revealed when the series sells out or closes, so anyone can replay every draw.
// Works in the browser and in Node (globalThis.crypto.subtle).
import type { ProofPull, SeriesProof } from './types.ts';

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(s: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export async function hmacHex(key: string, msg: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

/** Index in [0, pool) for one draw. */
export async function drawPick(serverSeed: string, scope: string, nonce: number, clientSeed: string, pool: number) {
  const h = await hmacHex(serverSeed, `${scope}:${nonce}:${clientSeed}`);
  const x = parseInt(h.slice(0, 13), 16) / 2 ** 52;
  return Math.min(pool - 1, Math.floor(x * pool));
}

export interface VerifyResult { ok: boolean; checked: number; problems: string[] }

/** Replays every pull of a series from the revealed seed. */
export async function verifySeries(p: SeriesProof): Promise<VerifyResult> {
  const problems: string[] = [];
  if (!p.server_seed) return { ok: false, checked: 0, problems: ['The seed is revealed when the series sells out or closes.'] };
  if (p.commit_hash && (await sha256Hex(p.server_seed)) !== p.commit_hash) problems.push('The revealed seed does not match the published commitment.');
  // nonce = number of pulls before this one; a slot added after k pulls is drawable from nonce k on.
  const pulls = [...p.pulls].sort((a, b) => a.nonce - b.nonce);
  const slots = [...p.slots].sort((a, b) => a.idx - b.idx);
  const pulled = new Set<number>();
  let checked = 0;
  for (const pull of pulls) {
    const avail = slots.filter(s => s.added_at <= pull.nonce && !pulled.has(s.idx)).map(s => s.idx);
    if (avail.length !== pull.pool) problems.push(`Pull ${pull.nonce}: ${avail.length} packs were sealed, the record says ${pull.pool}.`);
    const pick = await drawPick(p.server_seed, p.series_id, pull.nonce, pull.client_seed, avail.length);
    if (pick !== pull.pick || avail[pick] !== pull.slot) problems.push(`Pull ${pull.nonce}: replay gives pack ${avail[pick]}, the record says ${pull.slot}.`);
    pulled.add(pull.slot);
    checked++;
  }
  return { ok: problems.length === 0, checked, problems };
}

export type { ProofPull };
