import { useEffect, useRef } from 'react';
import { Logo, NavList } from './Logo';
import { WalletButton } from './WalletDialog';
import { MobileMenu } from './MobileMenu';
import { gpuRatio, isStill, isTouch, light, once, overlayOpen, scene } from '../lib/scene';
import { buildRock } from '../lib/rockbuild';
import { bakeRock } from '../lib/bake';

export function Hero() {
  const sky = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLCanvasElement>(null);

  /* night sky: 2D canvas stars that twinkle */
  useEffect(() => {
    const cv = sky.current;
    if (!once(cv) || !cv) return;
    const shot = isStill();
    scene().then(({ RK }) => {
      const sx = cv.getContext('2d')!;
      let S: number[][] = [];
      const stars = () => {
        const d = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
        cv.width = w * d; cv.height = h * d;
        const R = RK.mulberry(9); S = [];
        for (let i = 0; i < Math.round(w * h / 2600); i++) { const y = Math.pow(R(), 1.6) * h * .8; S.push([R() * w * d, y * d, (R() < .06 ? 1.3 : .6 + R() * .5) * d, R() * 6.28, .25 + R() * .6]); }
      };
      // Phones: draw the stars once; the twinkle redraws hundreds of dots every frame.
      const still = shot || isTouch();
      stars(); new ResizeObserver(() => { stars(); if (still) paint(0); }).observe(cv);
      let skyOn = true; new IntersectionObserver(e => { skyOn = e[0].isIntersecting; }).observe(cv);
      function paint(t: number) {
        sx.clearRect(0, 0, cv!.width, cv!.height);
        for (const s of S) { const a = s[4] * (.75 + .25 * Math.sin((t || 0) * .0012 + s[3])); sx.fillStyle = `rgba(255,240,225,${a})`; sx.beginPath(); sx.arc(s[0], s[1], s[2], 0, 6.283); sx.fill(); }
      }
      if (still) paint(0);
      else (function tw(t: number) {
        requestAnimationFrame(tw);
        if (!skyOn) return;
        paint(t);
      })(0);
    });
  }, []);

  /* hero: the Tissint end cut, turning and following scroll */
  useEffect(() => {
    const c = stage.current;
    if (!once(c)) return;
    scene().then(({ RK, THREE }) => {
      const r = RK.renderer(c, 1.05); r.setPixelRatio(gpuRatio()); const sc = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(27, 1, .1, 100); cam.position.set(0, 0, 10); light(sc, r);
      // The rock is built in a worker; until it arrives the sky and dust render on their own.
      let rock: any = null;
      buildRock({ type: 'martian', seed: 21, level: 6, stretch: [1.14, .8, .94], chips: 5, dents: .05, cut: [.62, .12, .78], cutD: .4, bump: .008 }).then(m => { rock = m; sc.add(m); bakeRock(THREE, r, m, 512); });
      const n = 360, pp = new Float32Array(n * 3), R = RK.mulberry(5); for (let i = 0; i < n; i++) { pp[i * 3] = (R() - .5) * 9; pp[i * 3 + 1] = (R() - .5) * 6; pp[i * 3 + 2] = (R() - .5) * 5; }
      const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
      const dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: .018, color: 0xffb08a, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending })); sc.add(dust);
      let sy = 0; addEventListener('scroll', () => { sy = scrollY; }, { passive: true });
      RK.run(c, r, cam, (t: number) => {
        if (overlayOpen()) return; // a dialog covers the hero: give the GPU to what is on top
        if (!rock) { r.render(sc, cam); return; }
        const hh = Math.tan(cam.fov * Math.PI / 360) * cam.position.z, half = hh * cam.aspect, wide = cam.aspect > 1.15;
        rock.position.set(wide ? half * .43 : 0, wide ? hh * .06 : hh * .5, 0); rock.scale.setScalar(wide ? Math.min(2.3, half * .37) : Math.min(.8, half * .56));
        rock.rotation.set(.3 + Math.sin(t * .21) * .05 + Math.min(sy, 1500) * .0004, -2.25 + t * .1 + Math.min(sy, 1500) * .0012, .1); rock.position.y += Math.sin(t * .55) * .045;
        dust.rotation.y = t * .012; dust.position.y = (t * .035) % 1 - .5; r.render(sc, cam);
      });
    });
  }, []);

  return (
    <section className="hero" id="top" aria-label="Space Rocks">
      <canvas id="sky" ref={sky} aria-hidden="true" /><div className="fall" aria-hidden="true" /><canvas id="stage" ref={stage} aria-hidden="true" />
      <div className="horizon" aria-hidden="true">
        <svg viewBox="0 0 1440 220" preserveAspectRatio="none">
          <defs><linearGradient id="hz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1a110c" /><stop offset=".25" stopColor="#0E0A08" /></linearGradient></defs>
          <path d="M0 132 C120 120 210 104 300 110 C360 114 400 92 470 96 L520 98 L560 82 L640 84 L668 98 C760 106 860 92 960 100 C1040 106 1100 88 1180 92 L1230 94 L1262 76 L1330 78 L1352 94 C1390 98 1420 96 1440 98 L1440 220 L0 220 Z" fill="url(#hz)" />
          <path d="M0 132 C120 120 210 104 300 110 C360 114 400 92 470 96 L520 98 L560 82 L640 84 L668 98 C760 106 860 92 960 100 C1040 106 1100 88 1180 92 L1230 94 L1262 76 L1330 78 L1352 94 C1390 98 1420 96 1440 98" fill="none" stroke="rgba(240,138,93,.28)" strokeWidth="1" />
        </svg>
      </div>
      <div className="veil" aria-hidden="true" />
      <nav className="hnav wrap" aria-label="Main">
        <a href="#top" aria-label="Space Rocks, home"><Logo height={40} /></a>
        <NavList />
        <WalletButton />
        <MobileMenu />
      </nav>
      <div className="coords mono wrap"><b>29.48° N  7.61° W</b><span>Earth</span><span>Tissint, a Martian fall</span><span>18 July 2011</span></div>
      <div className="lead wrap">
        <h1><span><i>Hold a piece</i></span><span><i>of another</i></span><span><i>world.</i></span></h1>
        <p>Reserve a real meteorite at a fixed price, or open a sealed pack with a guaranteed floor. Sourced from independent certified dealers, purchased and shipped when you redeem. Every specimen is certified and minted to your wallet on Solana.</p>
        <div className="cta"><a className="btn" href="#packs">Open a pack</a><a className="ghost" href="#market">See the market</a></div>
      </div>
      <div className="spec mono"><b>Shergottite · Martian</b>Tissint, end cut</div>
      <div className="stats">
        <div><b>0</b><span>randomness in the market: you pick the rock</span></div>
        <div><b>70%</b><span>floor: no pack is worth less in rock value</span></div>
        <div><b>100</b><span>packs per sealed series, contents published first</span></div>
      </div>
    </section>
  );
}
