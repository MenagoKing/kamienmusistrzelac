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

const NAV: { id: string; label: string; icon: ReactNode; group?: string }[] = [
  { id: 'overview', label: 'Overview', icon: <path d="M3 13h7V3H3zM14 21h7V11h-7zM3 21h7v-5H3zM14 7h7V3h-7z" /> },
  { id: 'specimens', label: 'Specimens', group: 'Inventory', icon: <path d="M7 4l-4 6 3 9h11l4-9-5-6H7zM3 10h18M10 4l-2 6 3 9M14 4l2 6-3 9" /> },
  { id: 'series', label: 'Series & packs', icon: <><circle cx="6" cy="6" r="2" /><circle cx="12" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="18" cy="12" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="12" cy="18" r="2" /></> },
  { id: 'drops', label: 'Launch drops', icon: <path d="M12 2c3 3 4 7 4 11l-4 4-4-4c0-4 1-8 4-11zM8 13l-3 3 1 4 3-2M16 13l3 3-1 4-3-2M12 9v.01" /> },
  { id: 'redemptions', label: 'Redemptions', group: 'Operations', icon: <path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" /> },
  { id: 'orders', label: 'Orders & ledger', icon: <path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3" /> },
  { id: 'listings', label: 'Collector listings', icon: <path d="M20 12l-8 8-9-9V3h8zM7.5 7.5h.01" /> },
  { id: 'wallets', label: 'Collectors', icon: <><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 4a4 4 0 010 8M19 15c2 1 3 3 3 6" /></> },
  { id: 'waitlist', label: 'Waitlist', icon: <path d="M4 5h16v14H4zM4 6l8 7 8-7" /> },
  { id: 'settings', label: 'Rules & settings', group: 'System', icon: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></> },
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
        <div className="kick mono">Vault admin</div>
        <h1>Sign in to manage the vault.</h1>
        <label className="fld"><span className="mono">Password</span><input id="pw" name="pw" type="password" autoComplete="current-password" required autoFocus /></label>
        {err && <div className="a-err">{err}</div>}
        <button className="ab primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="fine">The password is ADMIN_PASSWORD on the server. Without it, one is generated on first start in data/admin-password.txt.</p>
      </form>
    </div>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const hash = useHash();
  const [section, sub] = hash.split('/');
  const [menu, setMenu] = useState(false);
  const counts = useFetch<any>('/api/admin/overview', [section]);
  const badge: Record<string, number> = {
    redemptions: counts.data?.counts.redemptions_open ?? 0,
    specimens: counts.data?.counts.drafts ?? 0,
  };
  useEffect(() => setMenu(false), [hash]);

  let page: ReactNode;
  switch (section) {
    case 'specimens': page = <Specimens openId={sub} />; break;
    case 'series': page = sub ? <SeriesPage id={decodeURIComponent(sub)} /> : <SeriesList />; break;
    case 'drops': page = sub ? <DropPage id={decodeURIComponent(sub)} /> : <DropsList />; break;
    case 'redemptions': page = <Redemptions />; break;
    case 'orders': page = <Orders />; break;
    case 'wallets': page = <Wallets openId={sub} />; break;
    case 'listings': page = <Listings />; break;
    case 'waitlist': page = <Waitlist />; break;
    case 'settings': page = <Settings />; break;
    case 'audit': page = <AuditLog />; break;
    default: page = <Overview />;
  }

  return (
    <div className={'shell' + (menu ? ' menu' : '')}>
      <aside className="side">
        <a href="#/overview" className="brand"><img src={logo} alt="Space Rocks" height={30} /><span className="mono">Admin</span></a>
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
  const check = () => api<{ admin: boolean }>('GET', '/api/admin/me').then(r => setState(r.admin ? 'in' : 'out')).catch(() => setState('out'));
  useEffect(() => { check(); }, []);
  return (
    <ToastHost>
      {state === 'loading' ? <div className="login"><span className="a-spin" /></div> : state === 'out' ? <Login onDone={() => setState('in')} /> : <Shell onLogout={() => setState('out')} />}
    </ToastHost>
  );
}
