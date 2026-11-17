// Solana wallet sign-in without extra dependencies: talks to the injected providers
// (Phantom, Solflare, Backpack), signs a one-time message and lets the server verify it.
import { api } from './api';

export type WalletId = 'phantom' | 'solflare' | 'backpack';

export interface WalletInfo { id: WalletId; name: string; url: string; detect: () => any }

const w = () => (typeof window === 'undefined' ? ({} as any) : (window as any));

export const WALLETS: WalletInfo[] = [
  { id: 'phantom', name: 'Phantom', url: 'https://phantom.app/download', detect: () => (w().phantom?.solana?.isPhantom ? w().phantom.solana : w().solana?.isPhantom ? w().solana : null) },
  { id: 'solflare', name: 'Solflare', url: 'https://solflare.com/download', detect: () => (w().solflare?.isSolflare ? w().solflare : null) },
  { id: 'backpack', name: 'Backpack', url: 'https://backpack.app/download', detect: () => w().backpack?.solana ?? w().backpack ?? null },
];

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

export async function signIn(id: WalletId): Promise<{ address: string }> {
  const info = WALLETS.find(x => x.id === id)!;
  const p = info.detect();
  if (!p) throw new Error(`${info.name} is not installed in this browser.`);
  const res = await p.connect();
  const pk = (res?.publicKey ?? p.publicKey)?.toString();
  if (!pk) throw new Error('The wallet did not share an address.');
  const { message } = await api<{ message: string }>('POST', '/api/auth/nonce', { address: pk });
  const out = await p.signMessage(new TextEncoder().encode(message), 'utf8');
  const sig: Uint8Array = out instanceof Uint8Array ? out : out?.signature instanceof Uint8Array ? out.signature : new Uint8Array(out?.signature?.data ?? out?.data ?? []);
  return api('POST', '/api/auth/verify', { address: pk, signature: b64(sig), wallet: id });
}

export const signInDemo = () => api<{ address: string }>('POST', '/api/auth/demo', {});

export async function signOut(): Promise<void> {
  await api('POST', '/api/auth/logout', {});
  for (const x of WALLETS) {
    try { await x.detect()?.disconnect?.(); } catch { /* ignore */ }
  }
}

/** A random client seed for the verifiable draw (the buyer's own entropy). */
export function clientSeed() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
