import { useEffect } from 'react';
import type { PageData } from './data';
import { isStill } from './lib/scene';
import { AppProvider, useApp, type Dialog } from './lib/store';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { Market } from './components/Market';
import { Packs } from './components/Packs';
import { Drops } from './components/Drops';
import { Vault } from './components/Vault';
import { After } from './components/After';
import { Faq, Footer, Join, Token } from './components/Closing';
import { Toasts } from './components/Overlay';
import { WalletDialog } from './components/WalletDialog';
import { BuyDialog, PackDialog, RevealDialog } from './components/Checkout';
import { AccountDrawer, RedeemDialog, ShareDialog } from './components/Account';
import { ProofDialog, RegisterDialog } from './components/Explore';

function DialogHost({ d }: { d: Dialog | null }) {
  if (!d) return null;
  switch (d.kind) {
    case 'wallet': return <WalletDialog then={d.then} />;
    case 'buy': return <BuyDialog specimen={d.specimen} />;
    case 'pack': return <PackDialog series={d.series} />;
    case 'reveal': return <RevealDialog key={d.reveal.specimen.id} reveal={d.reveal} payment={d.payment} mint={d.mint} via={d.via} />;
    case 'redeem': return <RedeemDialog specimen={d.specimen} />;
    case 'share': return <ShareDialog reveal={d.reveal} />;
    case 'register': return <RegisterDialog />;
    case 'proof': return <ProofDialog seriesId={d.seriesId} name={d.name} />;
    case 'account': return <AccountDrawer tab={d.tab} />;
  }
}

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
