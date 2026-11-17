import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { callsign, useApp } from '../lib/store';
import { NAV } from './Logo';
import { AvatarStill } from './Avatar';

/** Phone navigation: a menu button that opens a full-screen sheet with the sections and your account. */
export function MobileMenu({ base = '' }: { base?: string }) {
  const { me, open } = useApp();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    document.documentElement.classList.add('locked');
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOn(false); };
    addEventListener('keydown', k);
    return () => { document.documentElement.classList.remove('locked'); removeEventListener('keydown', k); };
  }, [on]);
  return (
    <>
      <button type="button" className={'mnav-btn' + (on ? ' on' : '')} aria-label={on ? 'Close menu' : 'Open menu'} aria-expanded={on} onClick={() => setOn(!on)}>
        <i /><i />
      </button>
      {on && createPortal(
        <div className="mnav" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="mnav-btn on mnav-close" aria-label="Close menu" onClick={() => setOn(false)}><i /><i /></button>
          <nav>
            {NAV.map(([href, label], i) => (
              <a key={href} href={base + href} onClick={() => setOn(false)} style={{ animationDelay: `${60 + i * 40}ms` }}>
                <span className="mono">0{i + 1}</span>{label}
              </a>
            ))}
          </nav>
          <div className="mnav-ft">
            {me ? (
              <a className="mnav-acc" href="/account" onClick={() => setOn(false)}>
                <AvatarStill seed={me.profile.avatar_seed} size={44} />
                <span><b>{callsign(me)}</b><small className="mono">Level {me.profile.level} · {me.holdings.length} specimens</small></span>
                <em aria-hidden="true">→</em>
              </a>
            ) : (
              <div className="mnav-auth">
                <button type="button" className="btn" onClick={() => { setOn(false); open({ kind: 'auth', mode: 'register' }); }}>Create an account</button>
                <button type="button" className="btn line" onClick={() => { setOn(false); open({ kind: 'auth', mode: 'login' }); }}>Sign in</button>
              </div>
            )}
            <a className="btn line mnav-pack" href={base + '#packs'} onClick={() => setOn(false)}>Open a pack</a>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
