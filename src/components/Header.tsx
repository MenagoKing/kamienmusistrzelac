import { useEffect, useState } from 'react';
import { Logo, NavList } from './Logo';
import { WalletButton } from './WalletDialog';

/** Fixed header that slides in once the hero is scrolled past (always shown on other pages). */
export function Header({ always, base = '' }: { always?: boolean; base?: string }) {
  const [on, setOn] = useState(!!always);
  useEffect(() => {
    if (always) return;
    const top = document.getElementById('top');
    if (!top) return;
    const io = new IntersectionObserver(e => setOn(!e[0].isIntersecting), { rootMargin: '-80px 0px 0px 0px' });
    io.observe(top);
    return () => io.disconnect();
  }, [always]);
  return (
    <header className={on ? 'hdr on' : 'hdr'} id="hdr">
      <div className="in wrap">
        <a href={base + '#top'} aria-label="Space Rocks, home"><Logo height={32} /></a>
        <NavList base={base} />
        <WalletButton small />
      </div>
    </header>
  );
}
