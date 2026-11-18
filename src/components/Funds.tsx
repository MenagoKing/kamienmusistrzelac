// What the collector can pay with, when payments are real (live on mainnet, or real devnet payments).
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { usd } from '../lib/format';
import type { Currency, PageData, WalletInfo } from '../data';

/** One line for the fine print under every payment. */
export function payNote(data: PageData) {
  if (data.chain.payments !== 'live') return 'Payments on this preview are simulated: nothing is charged.';
  return data.chain.cluster === 'devnet' ? 'Paid from your Space Rocks wallet with devnet test funds (no real value).' : 'Paid from your Space Rocks wallet on Solana.';
}

/** The collector's wallet balances (only fetched when payments are real). */
export function useFunds() {
  const { data, me } = useApp();
  const live = data.chain.payments === 'live' && !!me;
  const [w, setW] = useState<WalletInfo | null>(null);
  const load = () => { if (live) api<WalletInfo>('GET', '/api/me/wallet').then(setW).catch(() => undefined); };
  useEffect(load, [live]);
  return { live, wallet: w, reload: load };
}

const fmt = (x: number, c: string) => (c === 'USDC' ? `${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC` : `${x.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${c}`);

/** "Your wallet: 12.50 USDC · 0.2 SOL", and a top-up prompt when it is not enough. */
export function Funds({ need, currency }: { need: number; currency: Currency }) {
  const { data } = useApp();
  const { live, wallet } = useFunds();
  if (!live || !wallet) return null;
  const solNeed = need / data.rules.sol_usd;
  const have = currency === 'SOL' ? wallet.balance_sol : currency === 'USDC' ? wallet.balance_usdc : null;
  const short = have != null && (currency === 'SOL' ? have < solNeed : have < need - 0.004);
  return (
    <div className={'funds' + (short ? ' short' : '')}>
      <span className="mono">Your wallet</span>
      <b>{wallet.balance_usdc != null ? fmt(wallet.balance_usdc, 'USDC') : '—'} · {wallet.balance_sol != null ? fmt(wallet.balance_sol, 'SOL') : '—'}</b>
      {short && <p>Not enough {currency} for this: {currency === 'SOL' ? fmt(solNeed, 'SOL') : usd(need)}. <a href="/account#wallet">Top up your wallet →</a></p>}
    </div>
  );
}

/** Shown when the server refused a payment for lack of funds (nothing was charged). */
export function FundsError({ info }: { info: { address?: string; currency?: string; need?: number; have?: number } | null }) {
  const { data, toast } = useApp();
  if (!info?.address) return null;
  const devnet = data.chain.cluster === 'devnet';
  return (
    <div className="funds short">
      <span className="mono">Top up, then try again</span>
      <p>Send {info.currency === 'SOL' ? 'SOL' : 'USDC'} on Solana{devnet ? ' devnet' : ''} to your Space Rocks wallet:</p>
      <code className="mono">{info.address}</code>
      <div className="acts">
        <button className="btn sm" type="button" onClick={async () => { try { await navigator.clipboard.writeText(info.address!); toast('Wallet address copied'); } catch { toast(info.address!); } }}>Copy address</button>
        <a className="btn sm line" href="/account#wallet">Open my wallet</a>
        {devnet && <a className="btn sm line" href={info.currency === 'SOL' ? 'https://faucet.solana.com' : 'https://faucet.circle.com'} target="_blank" rel="noreferrer">Free devnet {info.currency === 'SOL' ? 'SOL' : 'USDC'} ↗</a>}
      </div>
    </div>
  );
}

/** A small, always-visible label while the site runs on devnet. */
export function NetBadge() {
  const { data } = useApp();
  if (data.chain.cluster !== 'devnet') return null;
  return (
    <a className="netbadge mono" href="/account#wallet" title="This site runs on Solana devnet, the test network">
      <i aria-hidden="true" />Devnet · {data.chain.payments === 'live' ? 'test funds' : 'nothing is charged'}
    </a>
  );
}
