import { useEffect, useRef, useState } from 'react';
import type { LaunchDrop } from '../data';
import { light, once, scene } from '../lib/scene';

const pad = (n: number) => String(n).padStart(2, '0');

function remaining(opensAt: string) {
  const s = Math.max(0, (Date.parse(opensAt) - Date.now()) / 1000);
  return [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60];
}

const Lock = () => (
  <svg className="lockico" viewBox="0 0 11 13" aria-hidden="true"><rect x=".75" y="5.75" width="9.5" height="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M3 5.5V3.6a2.5 2.5 0 0 1 5 0v1.9" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
);

/** §03 Launch drops: flight timeline, locked specimens in 3D, countdown. */
export function Drops({ drop }: { drop: LaunchDrop }) {
  const [clock, setClock] = useState(() => remaining(drop.opens_at));
  useEffect(() => {
    const tick = () => setClock(remaining(drop.opens_at));
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [drop.opens_at]);

  const cv = useRef<HTMLCanvasElement>(null);
  const tiles = useRef<HTMLDivElement>(null);
  /* locked specimens: one canvas, three rocks */
  useEffect(() => {
    const c = cv.current;
    if (!once(c) || !tiles.current) return;
    const els = [...tiles.current.querySelectorAll<HTMLElement>('.tile')];
    scene().then(({ RK, THREE }) => {
      const gr = RK.renderer(c, 1.0); gr.setScissorTest(true); const gc = new THREE.PerspectiveCamera(24, 1, .1, 50); gc.position.set(0, 0, 7.6);
      const S = els.map(el => { const s = new THREE.Scene(); light(s, gr); const m = RK.rock({ type: el.dataset.rock, seed: +el.dataset.seed!, level: 5, stretch: [1.14, .8, .92], chips: 5, dents: .045, cut: [.58, .12, .8], cutD: .42, bump: .011 }); m.scale.setScalar(1.05); s.add(m); return { s, m }; });
      RK.run(c, gr, gc, (t: number) => {
        const cb = c!.getBoundingClientRect(); gr.setClearColor(0, 0); gr.clear();
        els.forEach((el, i) => {
          const b = el.getBoundingClientRect(); const x = b.left - cb.left, y = cb.bottom - b.bottom, w = b.width, h = b.height * .78;
          gr.setViewport(x, y + b.height * .14, w, h); gr.setScissor(x, y, w, b.height); gc.aspect = w / h; gc.updateProjectionMatrix();
          S[i].m.rotation.set(.3, -2.25 + Math.sin(t * .22 + i * 1.7) * .55 + i * .12, .08); gr.render(S[i].s, gc);
        });
      });
    });
  }, []);

  return (
    <section className="s wrap" id="drops" aria-labelledby="h-drops">
      <div className="intro rv">
        <div><div className="sec mono"><span>§03</span><span>Launch drops</span></div><h2 id="h-drops">The sky decides what unlocks.</h2></div>
        <p>Every launch of the world’s largest rocket opens a limited drop, 24 hours before liftoff, as a bonus on top of the regular series. Rare specimens wait locked beside it, in plain view. What happens in flight decides when they open.</p>
      </div>
      <div className="drops">
        <div className="tl rv" id="tl" role="list"><span className="bar" aria-hidden="true" />
          <div className="ev" role="listitem"><b className="mono">T–24h</b><h3>The drop opens</h3><p>Its packs go on sale, with the locked batches on show.</p></div>
          <div className="ev" role="listitem"><b className="mono">T–0</b><h3>Liftoff</h3><p>Packs keep opening through the flight.</p></div>
          <div className="ev" role="listitem"><b className="mono">Booster catch</b><h3>Batch A unlocks</h3><p>The first locked batch joins the drop.</p></div>
          <div className="ev" role="listitem"><b className="mono">Ship catch</b><h3>Batch B is raffled</h3><p>Drawn as bonus pulls for everyone who opened a pack in this drop.</p></div>
          <div className="ev" role="listitem"><b className="mono">Scrub or miss</b><h3>It rolls over</h3><p>Locked specimens carry to the next drop, and it grows.</p></div>
        </div>
        <div className="locked rv">
          <div className="hd mono"><span>Locked in the next drop</span><span>{drop.locked.length} specimens</span></div>
          <div className="tiles" id="tiles" ref={tiles}>
            <canvas className="over" id="tilecv" ref={cv} aria-hidden="true" />
            {drop.locked.map((l, i) => (
              <div className="tile" data-rock={l.render.type} data-seed={l.render.seed} key={i}>
                <div className="t mono"><span>Batch {l.batch}</span><b><Lock />Locked</b></div>
                <h4>{l.name}<small className="mono">{l.class}</small></h4>
              </div>
            ))}
          </div>
          <div className="clock">
            <span className="mono" style={{ color: 'var(--mute)' }}>Next drop opens in</span>
            <span className="d" id="clock" suppressHydrationWarning>{pad(clock[0])}<i>d</i>{pad(clock[1])}<i>h</i>{pad(clock[2])}<i>m</i></span>
          </div>
          <p className="note">Every result is resolved on-chain by a multisig and linked to the official launch source in a public log. Launch dates move; the drop moves with them.</p>
        </div>
      </div>
    </section>
  );
}
