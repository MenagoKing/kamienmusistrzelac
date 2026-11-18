// Admin › Network: which Solana network the site runs on, and everything needed to run it.
//
// devnet       testing. Sample data, free test SOL/USDC, payments simulated unless switched to real
//              devnet transfers here.
// mainnet-beta real. Starts empty (no sample data), payments are always real, NFTs are real.
//
// Each network has its own database, keys and wallets (server/db.ts), so switching never mixes test
// and real orders. Collectors are signed out by a switch (their accounts belong to one network); the
// admin stays signed in. Switching to mainnet needs the admin password and typing MAINNET.
import { connFor, ctlGet, ctlSet, onNetwork, setActiveNetwork, siteNetwork, type Network } from './db.ts';
import { verifyAdminPassword } from './auth.ts';
import { SYS, kickPayouts, paymentsLive } from './chain.ts';
import { ensureWallet } from './custody.ts';
import { drain } from './nft.ts';
import { audit } from './ops.ts';
import { ensureSeeded } from './seed.ts';
import { fail } from './util.ts';

const SIMULATED = process.env.CHAIN === 'simulated';
export const LABEL: Record<Network, string> = { devnet: 'Devnet', 'mainnet-beta': 'Mainnet' };

const withTimeout = <T>(p: Promise<T>, ms = 8000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('No answer from the RPC')), ms))]);
const mask = (url: string) => url.replace(/([?&](api[-_]?key|token)=)[^&]+/i, '$1…').replace(/(\/\/[^/]*\/)[A-Za-z0-9_-]{20,}/, '$1…');

/** Gets the active network ready: data, treasury and escrow wallets, workers. */
export function prepareNetwork() {
  ensureSeeded();
  ensureWallet(SYS.treasury);
  ensureWallet(SYS.escrow);
  void drain();
  kickPayouts();
}

async function balances(n: Network, address: string | null) {
  if (!address || SIMULATED) return { address, sol: null as number | null, usdc: null as number | null, error: null as string | null };
  try {
    const sol = await import('./solana.ts');
    const [s, u] = await Promise.all([withTimeout(sol.balanceOf(address, n)), withTimeout(sol.tokenBalance(address, sol.USDC_MINT[n], n))]);
    return { address, sol: s, usdc: u, error: null };
  } catch (e: any) {
    return { address, sol: null, usdc: null, error: String(e?.message ?? e).slice(0, 160) };
  }
}

async function statusOf(n: Network) {
  const c = connFor(n);
  const one = <T>(sql: string, ...p: any[]) => c.prepare(sql).get(...p) as T | undefined;
  const custody = (owner: string) => one<{ pubkey: string }>('SELECT pubkey FROM custody WHERE owner = ?', owner)?.pubkey ?? null;
  const sol = SIMULATED ? null : await import('./solana.ts');
  const authority = sol ? sol.authority(n) : null;
  const [vault, treasury, escrow] = await Promise.all([balances(n, authority), balances(n, custody(SYS.treasury)), balances(n, custody(SYS.escrow))]);
  const counts = {
    specimens: one<{ n: number }>('SELECT COUNT(*) n FROM specimens')!.n,
    on_market: one<{ n: number }>("SELECT COUNT(*) n FROM specimens WHERE state = 'market'")!.n,
    accounts: one<{ n: number }>("SELECT COUNT(*) n FROM wallets WHERE kind IN ('account', 'wallet', 'phantom', 'solflare', 'backpack')")!.n,
    payouts_waiting: one<{ n: number }>("SELECT COUNT(*) n FROM payouts WHERE status IN ('pending', 'sending', 'failed')")!.n,
    nfts_waiting: one<{ n: number }>("SELECT COUNT(*) n FROM nft_jobs WHERE status IN ('pending', 'failed')")!.n,
  };
  const rpcEnv = n === 'mainnet-beta' ? !!process.env.SOLANA_RPC_MAINNET : !!process.env.SOLANA_RPC;
  const rpcCustom = rpcEnv || !!ctlGet('rpc:' + n);
  const payments = n === 'mainnet-beta' ? 'live' : ctlGet('payments:devnet') === 'live' ? 'live' : 'simulated';
  const publicUrl = process.env.PUBLIC_URL || '';
  const checks: { ok: boolean; label: string; hint: string; required?: boolean }[] = n === 'mainnet-beta' ? [
    { ok: (vault.sol ?? 0) >= 0.1, required: true, label: 'The vault has SOL for network fees and NFTs', hint: `Send SOL to ${authority ?? 'the vault'}. Each NFT costs about 0.005 SOL (mostly rent, returned when it is burned); every payment and payout fee is a fraction of a cent.` },
    { ok: rpcCustom, label: 'A dedicated RPC', hint: 'The public mainnet RPC is rate-limited. Paste a Helius, Triton or QuickNode URL below.' },
    { ok: (treasury.usdc ?? 0) >= 25, label: 'The treasury holds USDC for refunds and buybacks', hint: `Payouts wait until the treasury (${treasury.address ?? 'created on first use'}) can pay them.` },
    { ok: /^https:\/\//.test(publicUrl), label: 'The site runs on its https domain', hint: 'NFT metadata links use PUBLIC_URL. Set it to your https domain in .env before minting real NFTs.' },
    { ok: !!process.env.CUSTODY_KEY_MAINNET, label: 'The wallet encryption key is kept outside the data folder', hint: 'Set CUSTODY_KEY_MAINNET (64 hex characters) in .env and keep a copy offline. Without it collectors’ wallets cannot be used.' },
    { ok: counts.on_market > 0, label: 'Specimens on the market', hint: 'Mainnet starts empty: add real specimens in Inventory.' },
  ] : [
    { ok: (vault.sol ?? 0) >= 0.05, required: true, label: 'The vault has devnet SOL', hint: `Paste ${authority ?? 'the vault address'} at faucet.solana.com. Needed to mint NFTs, send test SOL and pay fees.` },
    { ok: payments === 'live', label: 'Real devnet payments', hint: 'Off: purchases are simulated. On: collectors pay with devnet USDC (faucet.circle.com) or devnet SOL from their wallet, exactly like on mainnet.' },
  ];
  return {
    id: n, label: LABEL[n], active: siteNetwork() === n, payments,
    rpc: mask(sol ? sol.rpcUrl(n) : ''), rpc_custom: rpcCustom, rpc_from_env: rpcEnv, priority_fee: sol ? sol.priorityFee(n) : 0,
    usdc_mint: sol ? sol.USDC_MINT[n] : null,
    vault, treasury, escrow, counts, checks,
    ready: checks.filter(x => x.required).every(x => x.ok),
  };
}

export async function networkStatus() {
  return {
    active: siteNetwork(),
    simulated_chain: SIMULATED,
    payments_live: onNetwork(siteNetwork(), () => paymentsLive()),
    networks: await Promise.all((['devnet', 'mainnet-beta'] as Network[]).map(statusOf)),
  };
}

export async function switchNetwork(actor: string, b: any) {
  const to: Network = b?.network === 'mainnet-beta' ? 'mainnet-beta' : b?.network === 'devnet' ? 'devnet' : fail(400, 'Pick a network');
  if (to === siteNetwork()) return networkStatus();
  if (!verifyAdminPassword(String(b?.password ?? ''))) fail(401, 'Wrong admin password');
  if (to === 'mainnet-beta' && b?.confirm !== 'MAINNET') fail(400, 'Type MAINNET to confirm');
  const from = siteNetwork();
  audit(actor, 'network.switch', to, { from });
  setActiveNetwork(to);
  onNetwork(to, () => { prepareNetwork(); audit(actor, 'network.switch', to, { from }); });
  return networkStatus();
}

/** RPC URL, priority fee, and (devnet) real or simulated payments. */
export async function configureNetwork(actor: string, id: string, b: any) {
  const n: Network = id === 'mainnet-beta' ? 'mainnet-beta' : id === 'devnet' ? 'devnet' : fail(404, 'Unknown network');
  if (b?.rpc_url !== undefined) {
    const url = String(b.rpc_url ?? '').trim();
    if (url && !/^https:\/\/[^\s]+$/.test(url)) fail(400, 'The RPC URL must start with https://');
    ctlSet('rpc:' + n, url || null);
  }
  if (b?.priority_fee !== undefined) {
    const f = Math.round(Number(b.priority_fee));
    if (!Number.isFinite(f) || f < 0 || f > 5_000_000) fail(400, 'Priority fee: 0 to 5 000 000 micro-lamports');
    ctlSet('priority:' + n, String(f));
  }
  if (b?.payments_live !== undefined) {
    if (n !== 'devnet') fail(400, 'Payments on mainnet are always real');
    ctlSet('payments:devnet', b.payments_live ? 'live' : null);
    if (siteNetwork() === 'devnet') onNetwork('devnet', kickPayouts);
  }
  audit(actor, 'network.configure', n, { rpc: b?.rpc_url !== undefined, priority_fee: b?.priority_fee, payments_live: b?.payments_live });
  return networkStatus();
}
