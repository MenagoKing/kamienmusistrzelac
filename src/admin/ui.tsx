// Small UI kit for the admin panel, in the site's palette.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';

/* ---------- data ---------- */

export function useFetch<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    try { const d = await api<T>('GET', url); if (n === seq.current) { setData(d); setError(''); } } catch (e: any) { if (n === seq.current) setError(e.message); } finally { if (n === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => { reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

/* ---------- toasts ---------- */

interface Toast { id: number; text: string; tone: 'ok' | 'err' }
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'err') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    const id = ++seq.current;
    setList(l => [...l, { id, text, tone }]);
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), tone === 'err' ? 6500 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="a-toasts" role="status" aria-live="polite">{list.map(t => <div key={t.id} className={'a-toast ' + t.tone}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/** Runs an API call with a busy flag and toasts the outcome. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok); return r; } catch (e: any) { toast(e.message, 'err'); return undefined; } finally { setBusy(false); }
  }, [toast]);
  return { busy, run };
}

/* ---------- layout ---------- */

export function PageHead({ kicker, title, children }: { kicker?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="ph-row">
      <div>{kicker && <div className="kick mono">{kicker}</div>}<h1>{title}</h1></div>
      {children && <div className="ph-acts">{children}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={'card ' + className}>
      {(title || actions) && <div className="card-hd"><h2>{title}</h2>{actions && <div className="card-acts">{actions}</div>}</div>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'hot' | 'ok' | 'warn' }) {
  return (
    <div className={'stat' + (tone ? ' ' + tone : '')}>
      <span className="mono">{label}</span>
      <b>{value}</b>
      {hint && <small>{hint}</small>}
    </div>
  );
}

const TONE: Record<string, string> = {
  draft: 'mute', vault: 'blue', market: 'green', series: 'blue', locked: 'violet', held: 'amber', redeeming: 'grey', redeemed: 'grey',
  open: 'green', upcoming: 'amber', sold_out: 'grey', closed: 'grey', scheduled: 'amber',
  requested: 'amber', packing: 'blue', shipped: 'green', delivered: 'grey', cancelled: 'mute',
  pack: 'green', market_buy: 'green', buyback: 'amber', redemption_fee: 'blue', redemption_refund: 'mute', raffle: 'violet',
  floor: 'floor', par: 'par', hit: 'hit', unlocked: 'green', raffled: 'violet', rolled: 'amber', carried: 'mute',
  sample: 'mute', demo: 'mute', phantom: 'violet', solflare: 'amber', backpack: 'blue', wallet: 'grey',
};
const LABEL: Record<string, string> = { sold_out: 'sold out', market_buy: 'market', redemption_fee: 'redeem fee', redemption_refund: 'refund', vault: 'in vault', series: 'in series' };

export function Badge({ v, children }: { v: string; children?: ReactNode }) {
  return <span className={'badge ' + (TONE[v] ?? 'grey')}>{children ?? LABEL[v] ?? v.replace(/_/g, ' ')}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="a-empty">{children}</div>;
}

export function Loading() {
  return <div className="a-empty"><span className="a-spin" /> Loading…</div>;
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="a-err">{error} {retry && <button className="ab ghost sm" onClick={retry}>Retry</button>}</div>;
}

/* ---------- overlays ---------- */

export function Drawer({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="a-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className={'a-drawer' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="a-dhd"><h2>{title}</h2><button className="a-x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="a-dbd">{children}</div>
        {footer && <div className="a-dft">{footer}</div>}
      </aside>
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="a-ov center" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'a-modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="a-dhd"><h2>{title}</h2><button className="a-x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="a-dbd">{children}</div>
        {footer && <div className="a-dft">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation with an optional typed check for destructive actions. */
export function Confirm({ title, body, cta, danger, onConfirm, onClose }: { title: string; body: ReactNode; cta: string; danger?: boolean; onConfirm: () => Promise<unknown> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="ab ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <button className={'ab ' + (danger ? 'danger' : 'primary')} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } onClose(); }}>{busy ? 'Working…' : cta}</button>
    </>}>
      <div className="a-copy">{body}</div>
    </Modal>
  );
}

/* ---------- form bits ---------- */

export function Field({ label, hint, children, span }: { label: string; hint?: ReactNode; children: ReactNode; span?: 2 | 3 }) {
  return (
    <label className={'fld' + (span ? ' s' + span : '')}>
      <span className="mono">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="tgl">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <i aria-hidden="true" />
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, l]) => <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

/* ---------- formatting ---------- */

export const money = (x: number | null | undefined) => (x == null ? '—' : (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const money0 = (x: number | null | undefined) => (x == null ? '—' : '$' + Math.round(x).toLocaleString('en-US'));
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
};
export const short = (a: string | null | undefined) => (a ? (a.length > 12 ? a.slice(0, 4) + '…' + a.slice(-4) : a) : '—');
export const pct1 = (x: number | null | undefined) => (x == null ? '—' : Math.round(x * 1000) / 10 + '%');

export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const go = (hash: string) => { location.hash = hash; };
