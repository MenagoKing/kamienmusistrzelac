import { useEffect, useState } from 'react';
import type { PageData, RenderHint } from './data';
import { isStill, light, scene } from './lib/scene';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { Market } from './components/Market';
import { Packs } from './components/Packs';
import { Drops } from './components/Drops';
import { Vault } from './components/Vault';
import { After } from './components/After';
import { Faq, Footer, Join, Token } from './components/Closing';

interface Stills { market: string[]; register: string[]; reveal?: string }

/**
 * Still renders for the market, the register and the reveal, made once with one temporary renderer
 * after first paint (as in the design). Replace with real specimen photos once the vault has them.
 */
async function renderStills(data: PageData): Promise<Stills> {
  const { RK, THREE } = await scene();
  const cv = document.createElement('canvas');
  const tr = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
  tr.outputEncoding = THREE.sRGBEncoding; tr.toneMapping = THREE.ACESFilmicToneMapping;
  const tc = new THREE.PerspectiveCamera(24, 1, .1, 50); tc.position.set(0, 0, 7.4);
  const shotOf = (p: RenderHint, w: number, h: number, rot: number, sc: number): string => {
    tr.setSize(w, h, false); tc.aspect = w / h; tc.updateProjectionMatrix();
    const s = new THREE.Scene(); light(s, tr);
    const m = RK.rock({ type: p.type, seed: p.seed, level: 5, stretch: [1.14, .8, .92], chips: 5, dents: .045, cut: [.58, .12, .8], cutD: .42, bump: .011 });
    m.scale.setScalar(sc); m.rotation.set(.32, rot, .08); s.add(m); tr.render(s, tc);
    const u = cv.toDataURL(); m.geometry.dispose(); m.material.dispose(); return u;
  };
  const out: Stills = {
    market: data.market.map((p, i) => shotOf(p.render, 420, 311, -2.2 + i * .17, 1.25)),
    register: data.register.map((p, i) => shotOf(p.render, 128, 128, -2.2 + i * .18, 1.45)),
    reveal: shotOf(data.reveal.specimen.render, 520, 346, -1.25, 1.35),
  };
  tr.dispose(); tr.forceContextLoss();
  return out;
}

export function App({ data }: { data: PageData }) {
  const [stills, setStills] = useState<Stills>({ market: [], register: [] });

  /* reveal on scroll */
  useEffect(() => {
    const shot = isStill();
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
    document.querySelectorAll('.rv,.tl').forEach(el => shot ? el.classList.add('in') : io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    const go = () => renderStills(data).then(s => { if (alive) setStills(s); });
    if (isStill()) go();
    else if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1200 });
    else setTimeout(go, 1200);
    return () => { alive = false; };
  }, [data]);

  return (
    <>
      <div className="grain" aria-hidden="true" />
      <Header />
      <Hero />
      <Market market={data.market} rules={data.rules} thumbs={stills.market} />
      <Packs rules={data.rules} series={data.series} upcoming={data.upcoming} />
      <Drops drop={data.drop} />
      <Vault register={data.register} rules={data.rules} thumbs={stills.register} />
      <After reveal={data.reveal} rules={data.rules} image={stills.reveal} />
      <Token />
      <Faq />
      <Join />
      <Footer />
    </>
  );
}
