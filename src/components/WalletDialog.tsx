import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { callsign, useApp, type Dialog } from '../lib/store';
import { signOut } from '../lib/wallet';
import { AvatarStill, AvatarTurn, ROCK_LABEL, avatarRock } from './Avatar';
import { Spinner } from './Overlay';
import { payNote } from './Funds';

const rnd = () => Math.floor(Math.random() * 100000);

/** The sign-in / registration screen: a full-screen "enter the vault" in the site's dusk style. */
export function AuthDialog({ mode: initial = 'register', then }: { mode?: 'login' | 'register'; then?: Dialog }) {
  const { data, refresh, open, close, toast } = useApp();
  const [mode, setMode] = useState(initial);
  const [seed, setSeed] = useState(rnd);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const rock = avatarRock(seed);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', k);
    document.documentElement.classList.add('locked');
    return () => { removeEventListener('keydown', k); document.documentElement.classList.remove('locked'); };
  }, [close]);

  const done = async (msg: string) => {
    await refresh();
    toast(msg);
    if (then) open(then); else close();
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    setBusy('form'); setErr('');
    try {
      if (mode === 'register') {
        if (f.password !== f.password2) throw new Error('The two passwords do not match');
        await api('POST', '/api/auth/register', { username: f.username, email: f.email, password: f.password, avatar_seed: seed });
        await done(`Welcome to the vault, ${f.username}`);
      } else {
        const r = await api<{ username: string | null }>('POST', '/api/auth/login', { login: f.login, password: f.password });
        await done(`Welcome back${r.username ? ', ' + r.username : ''}`);
      }
    } catch (er: any) { setErr(er.message); } finally { setBusy(null); }
  };
  const google = async (credential: string) => {
    setBusy('google'); setErr('');
    try {
      const r = await api<{ username: string | null; created: boolean }>('POST', '/api/auth/google', { credential });
      await done(r.created ? `Welcome to the vault, ${r.username}` : `Welcome back${r.username ? ', ' + r.username : ''}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="auth" role="dialog" aria-modal="true" aria-label={mode === 'register' ? 'Create your collector account' : 'Sign in'}>
      <div className="auth-sky" aria-hidden="true" />
      <button className="x auth-x" type="button" onClick={close} aria-label="Close"><i aria-hidden="true" /></button>
      <div className="auth-in">
        <div className="auth-hero">
          <div className="sec mono"><span>{mode === 'register' ? 'New collector' : 'Returning collector'}</span><span>Space Rocks</span></div>
          <h2>{mode === 'register' ? <>Claim your<br /><i>piece of the sky.</i></> : <>Back to<br /><i>the vault.</i></>}</h2>
          {mode === 'register' ? (
            <div className="auth-av">
              <AvatarTurn seed={seed} size={240} />
              <button type="button" className="auth-roll" onClick={() => setSeed(rnd())} aria-label="Roll another rock">↻</button>
              <div className="auth-card">
                <span className="mono">Your collector rock</span>
                <b>{name.trim() || 'Your callsign'}</b>
                <span className="mono dim">Level 1 · Stargazer · {ROCK_LABEL[rock.type]}</span>
                <button type="button" className="btn line sm" onClick={() => setSeed(rnd())}>Roll another rock ↻</button>
              </div>
            </div>
          ) : (
            <p className="auth-lead">Your collection is where you left it: every specimen in its capsule, every pull on record.</p>
          )}
        </div>

        <div className="auth-form">
          <div className="tabs" role="tablist">
            <button role="tab" type="button" aria-selected={mode === 'register'} className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setErr(''); }}>Create account</button>
            <button role="tab" type="button" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setErr(''); }}>Sign in</button>
          </div>
          <form className="fm" onSubmit={submit} key={mode}>
            {mode === 'register' ? (
              <>
                <label>Callsign<input name="username" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" title="3 to 20 letters, numbers or _" autoComplete="username" value={name} onChange={e => setName(e.target.value)} placeholder="meteor_hunter" data-autofocus /></label>
                <label>Email<input name="email" type="email" required autoComplete="email" placeholder="you@email.com" /></label>
                <div className="two auth-pw">
                  <label>Password<input name="password" type="password" required minLength={8} title="At least 8 characters" autoComplete="new-password" placeholder="8+ characters" /></label>
                  <label>Repeat it<input name="password2" type="password" required minLength={8} autoComplete="new-password" placeholder="once more" /></label>
                </div>
                <p className="fine auth-help">3 to 20 letters, numbers or _. Password at least 8 characters.</p>
              </>
            ) : (
              <>
                <label>Callsign or email<input name="login" required autoComplete="username" data-autofocus /></label>
                <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
              </>
            )}
            {err && <p className="err" role="alert">{err}</p>}
            <button className="btn wide" type="submit" disabled={!!busy}>{busy === 'form' ? <><Spinner label="Working" />One moment…</> : mode === 'register' ? 'Create my collector account' : 'Enter the vault'}</button>
          </form>

          <div className="or mono"><span>or</span></div>
          <GoogleButton clientId={data.rules.google_client_id} onCredential={google} busy={busy === 'google'} onError={setErr} />
          <p className="fine auth-fine">Every account gets its own Solana wallet; every specimen you get is minted to it as an NFT. {payNote(data)}</p>
        </div>
      </div>
    </div>
  );
}

/** Header chip: "Sign in", or your avatar, callsign and level, linking to your account. */
export function WalletButton({ small }: { small?: boolean }) {
  const { me, meLoaded, open } = useApp();
  if (!meLoaded || !me) {
    return <button type="button" className={'btn wbtn' + (small ? ' sm' : '')} onClick={() => open({ kind: 'auth' })}>Sign in</button>;
  }
  return (
    <a className={'btn line wbtn on' + (small ? ' sm' : '')} href="/account" aria-label={`Your account, ${me.holdings.length} specimens`}>
      <AvatarStill seed={me.profile.avatar_seed} size={small ? 24 : 28} />
      <span className="wname">{callsign(me)}</span>
      <small className="mono">Lv {me.profile.level}</small>
    </a>
  );
}

export async function disconnect(refresh: () => Promise<void>) {
  await signOut();
  await refresh();
}

/* ---------- Google ---------- */

declare global { interface Window { google?: any } }
let gsi: Promise<void> | null = null;
const loadGsi = () => gsi ??= new Promise<void>((res, rej) => {
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = () => res(); s.onerror = () => { gsi = null; rej(new Error('Could not load Google sign-in')); };
  document.head.appendChild(s);
});

const GLogo = () => (
  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
);

/** Google's own button when a client ID is set (Admin › Settings); a clear placeholder otherwise. */
function GoogleButton({ clientId, onCredential, busy, onError }: { clientId: string; onCredential: (c: string) => void; busy: boolean; onError: (m: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const cb = useRef(onCredential); cb.current = onCredential;
  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    loadGsi().then(() => {
      if (!alive || !box.current || !window.google) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r: { credential: string }) => cb.current(r.credential), ux_mode: 'popup', auto_select: false });
      window.google.accounts.id.renderButton(box.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center', width: Math.min(400, box.current.clientWidth || 360) });
      setReady(true);
    }).catch(e => onError(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  if (!clientId) {
    return (
      <button type="button" className="gbtn" onClick={() => onError('Google sign-in is not switched on yet. The site owner adds the Google client ID in Admin › Rules & settings.')}>
        <GLogo /><span>Continue with Google</span>
      </button>
    );
  }
  return (
    <div className="gwrap">
      {busy && <div className="gbusy"><Spinner label="Signing in" /> Signing in with Google…</div>}
      <div ref={box} className={'gbox' + (ready ? ' on' : '')} />
      {!ready && <button type="button" className="gbtn" disabled><GLogo /><span>Loading Google…</span></button>}
    </div>
  );
}
