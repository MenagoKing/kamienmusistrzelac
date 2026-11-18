import { useEffect } from 'react';
import type { PageData } from './data';
import { isStill } from './lib/scene';
import { AppProvider, useApp } from './lib/store';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { Market } from './components/Market';
import { Packs } from './components/Packs';
import { Drops } from './components/Drops';
import { Vault } from './components/Vault';
import { After } from './components/After';
import { Faq, Footer, Join, Token } from './components/Closing';
import { Toasts } from './components/Overlay';
import { NetBadge } from './components/Funds';
import { DialogHost } from './components/Dialogs';

function Page() {
  const { data, dialog } = useApp();

  /* reveal on scroll */
  useEffect(() => {
    const shot = isStill();
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
    document.querySelectorAll('.rv:not(.in),.tl:not(.in)').forEach(el => shot ? el.classList.add('in') : io.observe(el));
    return () => io.disconnect();
  }, [data]);

  return (
    <>
      <div className="grain" aria-hidden="true" />
      <Header />
      <Hero />
      <Market />
      <Packs />
      <Drops />
      <Vault />
      <After />
      <Token />
      <Faq />
      <Join />
      <Footer />
      <DialogHost d={dialog} />
      <Toasts />
      <NetBadge />
    </>
  );
}

export function App({ data }: { data: PageData }) {
  return (
    <AppProvider initial={data}>
      <Page />
    </AppProvider>
  );
}
