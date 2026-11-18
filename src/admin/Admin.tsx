import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import logo from '../../space-rocks-site/assets/logo/space-rocks-logo-on-dark.svg';
import { ToastHost, useFetch } from './ui';
import { Overview } from './pages/Overview';
import { Specimens } from './pages/Specimens';
import { SeriesList, SeriesPage } from './pages/Series';
import { DropPage, DropsList } from './pages/Drops';
import { Redemptions } from './pages/Redemptions';
import { Listings, Orders, Wallets, Waitlist, AuditLog } from './pages/Records';
import { Settings } from './pages/Settings';
import { Chain } from './pages/Chain';
import { Dealers, Escrow } from './pages/Dealers';
import { NetworkPage, Payouts } from './pages/Network';

const NAV: { id: string; label: string; icon: ReactNode; group?: string }[] = [
  { id: 'overview', label: 'Overview', icon: <path d="M3 13h7V3H3zM14 21h7V11h-7zM3 21h7v-5H3zM14 7h7V3h-7z" /> },
  { id: 'specimens', label: 'Specimens', group: 'Inventory', icon: <path d="M7 4l-4 6 3 9h11l4-9-5-6H7zM3 10h18M10 4l-2 6 3 9M14 4l2 6-3 9" /> },
  { id: 'dealers', label: 'Dealers', icon: <path d="M3 9l2-5h14l2 5M3 9h18v11H3zM3 9c0 2 2 3 3 3s3-1 3-3c0 2 2 3 3 3s3-1 3-3c0 2 2 3 3 3s3-1 3-3M9 20v-5h6v5" /> },
  { id: 'series', label: 'Series & packs', icon: <><circle cx="6" cy="6" r="2" /><circle cx="12" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="18" cy="12" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="12" cy="18" r="2" /></> },
  { id: 'drops', label: 'Launch drops', icon: <path d="M12 2c3 3 4 7 4 11l-4 4-4-4c0-4 1-8 4-11zM8 13l-3 3 1 4 3-2M16 13l3 3-1 4-3-2M12 9v.01" /> },
  { id: 'redemptions', label: 'Redemptions', group: 'Operations', icon: <path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" /> },
  { id: 'escrow', label: 'Escrow', icon: <path d="M5 11V7a7 7 0 0114 0v4M4 11h16v10H4zM12 15v2" /> },
  { id: 'payouts', label: 'Payouts & treasury', icon: <path d="M3 7h18v12H3zM3 11h18M7 15h4M16 3l3 4M8 3L5 7" /> },
  { id: 'orders', label: 'Orders & ledger', icon: <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3" /> },
  { id: 'listings', label: 'Collector listings', icon: <path d="M20 12l-8 8-9-9V3h8zM7.5 7.5h.01" /> },
  { id: 'wallets', label: 'Collectors', icon: <><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 4a4 4 0 010 8M19 15c2 1 3 3 3 6" /></> },
  { id: 'waitlist', label: 'Waitlist', icon: <path d="M4 5h16v14H4zM4 6l8 7 8-7" /> },
  { id: 'network', label: 'Network', group: 'System', icon: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></> },
  { id: 'settings', label: 'Rules & settings', icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></> },
  { id: 'chain', label: 'Solana NFTs', icon: <path d="M5 7h12l2-3H7zM5 13.5h12l2-3H7zM5 20h12l2-3H7z" /> },
  { id: 'audit', label: 'Audit log', icon: <path d="M12 8v4l3 2M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v4h4" /> },
];

function useHash() {
  const [h, setH] = useState(() => location.hash.replace(/^#\/?/, '') || 'overview');
  useEffect(() => {
    const f = () => { setH(location.hash.replace(/^#\/?/, '') || 'overview'); window.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

function Login({ onDone }: { onDone: () => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api('POST', '/api/admin/login', { password: (e.currentTarget.elements.namedItem('pw') as HTMLInputElement).value }); onDone(); } catch (er: any) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form onSubmit={submit} className="login-card">
        <img src={logo} alt="Space Rocks" height={40} />
        <div className="kick mono">Admin</div>
        <h1>Sign in to manage Space Rocks.</h1>
        <label className="fld"><span className="mono">Password</span><input id="pw" name="pw" type="password" autoComplete="current-password" required autoFocus /></label>
        {err && <div className="a-err">{err}</div>}
        <button className="ab primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="fine">The password is ADMIN_PASSWORD on the server. Without it, one is generated on first start in data/admin-password.txt.</p>
      </form>
    </div>
  );
}

function Shell({ onLogout, net }: { onLogout: () => void; net: { network: string; payments: string } }) {
  const hash = useHash();
  const [section, sub] = hash.split('/');
  const [menu, setMenu] = useState(false);
  const counts = useFetch<any>('/api/admin/overview', [section]);
  const badge: Record<string, number> = {
    redemptions: counts.data?.counts.redemptions_open ?? 0,
    escrow: counts.data?.counts.sold_at_source_waiting ?? 0,
    specimens: counts.data?.counts.drafts ?? 0,
  };
  useEffect(() => setMenu(false), [hash]);

  let page: ReactNode;
  switch (section) {
    case 'specimens': page = <Specimens openId={sub} />; break;
    case 'series': page = sub ? <SeriesPage id={decodeURIComponent(sub)} /> : <SeriesList />; break;
    case 'drops': page = sub ? <DropPage id={decodeURIComponent(sub)} /> : <DropsList />; break;
    case 'redemptions': page = <Redemptions />; break;
    case 'dealers': page = <Dealers />; break;
    case 'escrow': page = <Escrow />; break;
    case 'network': page = <NetworkPage />; break;
    case 'payouts': page = <Payouts network={net.network} />; break;
    case 'orders': page = <Orders />; break;
    case 'wallets': page = <Wallets openId={sub} />; break;
    case 'listings': page = <Listings />; break;
    case 'waitlist': page = <Waitlist />; break;
    case 'settings': page = <Settings />; break;
    case 'audit': page = <AuditLog />; break;
    case 'chain': page = <Chain />; break;
    default: page = <Overview />;
  }

  return (
    <div className={'shell' + (menu ? ' menu' : '')}>
      <aside className="side">
        <a href="#/overview" className="brand"><img src={logo} alt="Space Rocks" height={30} /><span className="mono">Admin</span></a>
        <a href="#/network" className={'netpill mono' + (net.network === 'mainnet-beta' ? ' main' : '')} title="Change in System › Network">{net.network === 'mainnet-beta' ? 'Mainnet · live' : `Devnet · ${net.payments === 'live' ? 'real test payments' : 'payments simulated'}`}</a>
        <nav>
          {NAV.map(n => (
            <div key={n.id}>
              {n.group && <div className="grp mono">{n.group}</div>}
              <a href={'#/' + n.id} className={section === n.id || (!section && n.id === 'overview') ? 'on' : ''}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{n.icon}</svg>{n.label}
                {badge[n.id] ? <em>{badge[n.id]}</em> : null}
              </a>
            </div>
          ))}
        </nav>
        <div className="side-ft">
          <a href="/" target="_blank" rel="noreferrer" className="ab ghost sm">View site ↗</a>
          <button className="ab ghost sm" onClick={async () => { await api('POST', '/api/admin/logout', {}); onLogout(); }}>Sign out</button>
        </div>
      </aside>
      <div className="topbar">
        <button className="burger" onClick={() => setMenu(!menu)} aria-label="Menu"><i /><i /><i /></button>
        <img src={logo} alt="Space Rocks" height={26} />
      </div>
      <main className="main">{page}</main>
      <div className="scrim" onClick={() => setMenu(false)} />
    </div>
  );
}

export function Admin() {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  const [net, setNet] = useState({ network: 'devnet', payments: 'simulated' });
  const check = () => api<{ admin: boolean; network: string; payments: string }>('GET', '/api/admin/me').then(r => { setNet({ network: r.network, payments: r.payments }); setState(r.admin ? 'in' : 'out'); }).catch(() => setState('out'));
  useEffect(() => { check(); }, []);
  return (
    <ToastHost>
      {state === 'loading' ? <div className="login"><span className="a-spin" /></div> : state === 'out' ? <Login onDone={() => { check(); }} /> : <Shell net={net} onLogout={() => setState('out')} />}
    </ToastHost>
  );
}
