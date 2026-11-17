import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { callsign, useApp, type Dialog } from '../lib/store';
import { WALLETS, signIn, signInDemo, signOut, type WalletId } from '../lib/wallet';
import { AvatarStill, AvatarTurn, ROCK_LABEL, avatarRock } from './Avatar';
import { Spinner } from './Overlay';

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
  const wallet = async (id: WalletId) => {
    setBusy(id); setErr('');
    try { await signIn(id); await done('Wallet connected'); } catch (e: any) { setErr(e?.message?.includes('User rejected') ? 'You declined the request in the wallet.' : e?.message || 'Could not connect.'); } finally { setBusy(null); }
  };
  const demo = async () => {
    setBusy('demo'); setErr('');
    try { await signInDemo(); await done('Demo wallet ready'); } catch (e: any) { setErr(e?.message || 'Could not start the demo wallet.'); } finally { setBusy(null); }
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
                <label>Callsign<input name="username" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" autoComplete="username" value={name} onChange={e => setName(e.target.value)} placeholder="meteor_hunter" data-autofocus /></label>
                <label>Email<input name="email" type="email" required autoComplete="email" placeholder="you@email.com" /></label>
                <div className="two">
                  <label>Password<input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
                  <label>Repeat it<input name="password2" type="password" required minLength={8} autoComplete="new-password" /></label>
                </div>
                <p className="fine">3 to 20 letters, numbers or _. Password at least 8 characters.</p>
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

          <div className="or mono"><span>or use a Solana wallet</span></div>
          <div className="wl tight">
            {WALLETS.map(w => {
              const has = typeof window !== 'undefined' && !!w.detect();
              return has ? (
                <button key={w.id} className="wrow" type="button" onClick={() => wallet(w.id)} disabled={!!busy}><b>{w.name}</b><span className="mono">{busy === w.id ? <Spinner label="Connecting" /> : 'Detected'}</span></button>
              ) : (
                <a key={w.id} className="wrow off" href={w.url} target="_blank" rel="noreferrer"><b>{w.name}</b><span className="mono">Install ↗</span></a>
              );
            })}
            {data.rules.demo_wallet && <button className="wrow demo" type="button" onClick={demo} disabled={!!busy}><b>Demo wallet</b><span className="mono">{busy === 'demo' ? <Spinner label="Starting" /> : 'Try without signing up'}</span></button>}
          </div>
          <p className="fine">Payments on this preview run on a simulated chain: nothing is charged and no real NFT is minted.</p>
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
