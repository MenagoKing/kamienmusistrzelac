import { useEffect, useRef, type ReactNode } from 'react';
import { useApp } from '../lib/store';

/** Modal dialog or side drawer, in the design's palette. Escape and the backdrop close it. */
export function Overlay({ title, label, children, side, wide, onClose }: { title?: ReactNode; label: string; children: ReactNode; side?: boolean; wide?: boolean; onClose?: () => void }) {
  const { close } = useApp();
  const done = onClose ?? close;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') done(); };
    addEventListener('keydown', key);
    document.documentElement.classList.add('locked');
    box.current?.querySelector<HTMLElement>('[data-autofocus], button, input, select, a[href]')?.focus();
    return () => { removeEventListener('keydown', key); document.documentElement.classList.remove('locked'); prev?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={side ? 'ov ov-side' : 'ov'} onMouseDown={e => { if (e.target === e.currentTarget) done(); }}>
      <div className={'dlg' + (side ? ' side' : '') + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={label} ref={box}>
        <div className="dlg-hd">
          {title ? <div className="dlg-t">{title}</div> : <span />}
          <button className="x" type="button" onClick={done} aria-label="Close"><i aria-hidden="true" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(t => <div key={t.id} className={'toast ' + t.tone}>{t.text}</div>)}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return <span className="spin" role="status" aria-label={label} />;
}

/** Explorer-style short signature: marked simulated, queued (a payout on its way), or linked to the explorer. */
export function TxLine({ tx, simulated, label = 'Transaction' }: { tx: string; simulated?: boolean; label?: string }) {
  const { data } = useApp();
  if (!tx) return <div className="txl mono"><span>{label}</span><code>queued</code><em>on its way to your wallet</em></div>;
  const net = data.chain.cluster;
  const href = !simulated && net !== 'simulated' ? `https://explorer.solana.com/tx/${tx}${net === 'mainnet-beta' ? '' : `?cluster=${net}`}` : null;
  return (
    <div className="txl mono"><span>{label}</span>{href ? <a href={href} target="_blank" rel="noreferrer" title={tx}>{tx.slice(0, 6)}…{tx.slice(-6)} ↗</a> : <code title={tx}>{tx.slice(0, 6)}…{tx.slice(-6)}</code>}{simulated && <em>simulated</em>}</div>
  );
}
