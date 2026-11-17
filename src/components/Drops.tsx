import { useEffect, useRef, useState } from 'react';
import type { DropEventKind, LockedSpecimen } from '../data';
import { useApp } from '../lib/store';
import { gpuRatio, light, once, overlayOpen, scene } from '../lib/scene';
import { buildRock } from '../lib/rockbuild';
import { bakeRock } from '../lib/bake';
import { usd } from '../lib/format';

const pad = (n: number) => String(n).padStart(2, '0');

function remaining(at: string) {
  const s = Math.max(0, (Date.parse(at) - Date.now()) / 1000);
  return [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60];
}

const Lock = () => (
  <svg className="lockico" viewBox="0 0 11 13" aria-hidden="true"><rect x=".75" y="5.75" width="9.5" height="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M3 5.5V3.6a2.5 2.5 0 0 1 5 0v1.9" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
);

const STATE: Record<LockedSpecimen['state'], string> = { locked: 'Locked', unlocked: 'In the pool', raffled: 'Raffled', rolled: 'Rolled over', carried: 'Rolled over' };
const EVENT: Record<DropEventKind, string> = { liftoff: 'Liftoff', booster_catch: 'Booster catch', ship_catch: 'Ship catch', scrub: 'Scrubbed', fail: 'Missed' };

/** §03 Launch drops: flight timeline, locked specimens in 3D, countdown, the live pool. */
export function Drops() {
  const { data, withWallet } = useApp();
  const drop = data.drop;
  const target = drop ? (drop.status === 'scheduled' ? drop.opens_at : drop.t0) : null;
  const [clock, setClock] = useState(() => (target ? remaining(target) : [0, 0, 0]));
  useEffect(() => {
    if (!target) return;
    const tick = () => setClock(remaining(target));
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [target]);

  const cv = useRef<HTMLCanvasElement>(null);
  const tiles = useRef<HTMLDivElement>(null);
  /* locked specimens: one canvas, three rocks */
  useEffect(() => {
    const c = cv.current;
    if (!once(c) || !tiles.current) return;
    const els = [...tiles.current.querySelectorAll<HTMLElement>('.tile')];
    if (!els.length) return;
    scene().then(async ({ RK, THREE }) => {
      const gr = RK.renderer(c, 1.0); gr.setPixelRatio(gpuRatio()); gr.setScissorTest(true); const gc = new THREE.PerspectiveCamera(24, 1, .1, 50); gc.position.set(0, 0, 7.6);
      // Rocks built in the worker; tile boxes measured once and on resize (not every frame).
      const S = await Promise.all(els.map(async el => { const s = new THREE.Scene(); light(s, gr); const m = await buildRock({ type: el.dataset.rock!, seed: +el.dataset.seed!, level: 5, stretch: [1.14, .8, .92], chips: 5, dents: .045, cut: [.58, .12, .8], cutD: .42, bump: .011 }); m.scale.setScalar(1.05); s.add(m); bakeRock(THREE, gr, m, 256); return { s, m }; }));
      let boxes: { x: number; y: number; w: number; h: number }[] = [];
      const measure = () => {
        const cb = c!.getBoundingClientRect();
        boxes = els.map(el => { const b = el.getBoundingClientRect(); return { x: b.left - cb.left, y: cb.bottom - b.bottom, w: b.width, h: b.height }; });
      };
      measure();
      new ResizeObserver(measure).observe(tiles.current!);
      RK.run(c, gr, gc, (t: number) => {
        if (overlayOpen()) return;
        gr.setClearColor(0, 0); gr.clear();
        boxes.forEach((b, i) => {
          const h = b.h * .78;
          gr.setViewport(b.x, b.y + b.h * .14, b.w, h); gr.setScissor(b.x, b.y, b.w, b.h); gc.aspect = b.w / h; gc.updateProjectionMatrix();
          S[i].m.rotation.set(.3, -2.25 + Math.sin(t * .22 + i * 1.7) * .55 + i * .12, .08); gr.render(S[i].s, gc);
        });
      });
    });
  }, []);

  const pool = drop?.series_id ? data.open_series.find(s => s.id === drop.series_id) : undefined;
  const poolLeft = pool ? pool.remaining.floor + pool.remaining.par + pool.remaining.hit : 0;
  const locked = (drop?.locked ?? []).slice(0, 3);

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
          <div className="hd mono"><span>{drop ? (drop.status === 'closed' ? `${drop.name} · resolved` : `Locked in ${drop.name.toLowerCase()}`) : 'Locked in the next drop'}</span><span>{drop?.locked.length ?? 0} specimens</span></div>
          <div className="tiles" id="tiles" ref={tiles}>
            <canvas className="over" id="tilecv" ref={cv} aria-hidden="true" />
            {locked.map(l => (
              <div className="tile" data-rock={l.render.type} data-seed={l.render.seed} key={l.id}>
                <div className="t mono"><span>Batch {l.batch}</span><b>{l.state === 'locked' && <Lock />}{STATE[l.state]}</b></div>
                <h4>{l.name}<small className="mono">{l.class}</small></h4>
              </div>
            ))}
          </div>
          {drop && drop.status !== 'closed' && (
            <div className="clock">
              <span className="mono" style={{ color: 'var(--mute)' }}>{drop.status === 'scheduled' ? 'Next drop opens in' : clock.every(x => x === 0) ? 'In flight' : 'Liftoff in'}</span>
              <span className="d" id="clock" suppressHydrationWarning>{pad(clock[0])}<i>d</i>{pad(clock[1])}<i>h</i>{pad(clock[2])}<i>m</i></span>
            </div>
          )}
          {drop?.status === 'open' && pool && (
            <div className="droppool">
              <span className="mono">{poolLeft} of {pool.size} drop packs left · {usd(pool.pack_price_usd ?? 0)}</span>
              <button className="btn" type="button" disabled={!poolLeft} onClick={() => withWallet({ kind: 'pack', series: pool })}>{poolLeft ? 'Open a drop pack' : 'Drop sold out'}</button>
            </div>
          )}
          {drop && drop.events.length > 0 && (
            <ul className="elog mono">
              {drop.events.map(e => <li key={e.id}><b>{EVENT[e.kind]}</b><span>{new Date(e.created_at).toUTCString().slice(5, 22)} UTC</span><a href={e.source_url} target="_blank" rel="noreferrer">Source ↗</a></li>)}
            </ul>
          )}
          <p className="note">Every result is resolved on-chain by a multisig and linked to the official launch source in a public log. Launch dates move; the drop moves with them.</p>
        </div>
      </div>
    </section>
  );
}
