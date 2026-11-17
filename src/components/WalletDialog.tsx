import { useState } from 'react';
import { useApp } from '../lib/store';
import { WALLETS, signIn, signInDemo, signOut, type WalletId } from '../lib/wallet';
import { shortAddr } from '../../shared/rules.ts';
import { Overlay, Spinner } from './Overlay';

/** Connect a Solana wallet (Phantom, Solflare, Backpack) or use the demo wallet. */
export function WalletDialog({ then }: { then?: import('../lib/store').Dialog }) {
  const { data, refresh, open, close, toast } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const done = async () => {
    await refresh();
    toast('Wallet connected');
    if (then) open(then); else close();
  };
  const go = async (id: WalletId) => {
    setBusy(id); setErr('');
    try { await signIn(id); await done(); } catch (e: any) { setErr(e?.message?.includes('User rejected') ? 'You declined the request in the wallet.' : e?.message || 'Could not connect.'); } finally { setBusy(null); }
  };
  const demo = async () => {
    setBusy('demo'); setErr('');
    try { await signInDemo(); await done(); } catch (e: any) { setErr(e?.message || 'Could not start the demo wallet.'); } finally { setBusy(null); }
  };

  return (
    <Overlay label="Connect a wallet" title={<><div className="sec mono"><span>Wallet</span></div><h3>Connect to the vault</h3></>}>
      <p className="dlg-p">Your specimens are minted to this wallet. Signing in is a free signature: no transaction, no fees.</p>
      <div className="wl">
        {WALLETS.map(w => {
          const has = typeof window !== 'undefined' && !!w.detect();
          return has ? (
            <button key={w.id} className="wrow" type="button" onClick={() => go(w.id)} disabled={!!busy}>
              <b>{w.name}</b><span className="mono">{busy === w.id ? <Spinner label="Connecting" /> : 'Detected'}</span>
            </button>
          ) : (
            <a key={w.id} className="wrow off" href={w.url} target="_blank" rel="noreferrer">
              <b>{w.name}</b><span className="mono">Install ↗</span>
            </a>
          );
        })}
        {data.rules.demo_wallet && (
          <button className="wrow demo" type="button" onClick={demo} disabled={!!busy}>
            <b>Demo wallet</b><span className="mono">{busy === 'demo' ? <Spinner label="Starting" /> : 'No extension needed'}</span>
          </button>
        )}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <p className="fine">Payments on this preview run on a simulated chain: nothing is charged and no real NFT is minted.</p>
    </Overlay>
  );
}

/** Header button: "Connect wallet" or the short address that opens the account drawer. */
export function WalletButton({ small }: { small?: boolean }) {
  const { me, meLoaded, open } = useApp();
  if (!meLoaded || !me) {
    return <button type="button" className={'btn wbtn' + (small ? ' sm' : '')} onClick={() => open({ kind: 'wallet' })}>Connect wallet</button>;
  }
  const n = me.holdings.length;
  return (
    <button type="button" className={'btn line wbtn on' + (small ? ' sm' : '')} onClick={() => open({ kind: 'account' })} aria-label={`Your vault, ${n} specimens`}>
      <i className="dot" aria-hidden="true" />{shortAddr(me.address)}{n > 0 && <small className="mono">{n}</small>}
    </button>
  );
}

export async function disconnect(refresh: () => Promise<void>) {
  await signOut();
  await refresh();
}
