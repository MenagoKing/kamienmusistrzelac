import { useEffect, useState } from 'react';
import { Logo, NavList } from './Logo';

/** Fixed header that slides in once the hero is scrolled past. */
export function Header() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const top = document.getElementById('top');
    if (!top) return;
    const io = new IntersectionObserver(e => setOn(!e[0].isIntersecting), { rootMargin: '-80px 0px 0px 0px' });
    io.observe(top);
    return () => io.disconnect();
  }, []);
  return (
    <header className={on ? 'hdr on' : 'hdr'} id="hdr">
      <div className="in wrap">
        <a href="#top" aria-label="Space Rocks, home"><Logo height={32} /></a>
        <NavList />
        <a className="btn sm" href="#join">Join the waitlist</a>
      </div>
    </header>
  );
}
