// Still renders of specimens (market cards, register, reveal, share card), made with one shared
// offscreen renderer after first paint, cached by shape and size. Real photos replace them once the
// vault has them (Specimen.photo).
import { useEffect, useState } from 'react';
import type { RenderHint } from '../data';
import { light, scene } from './scene';
import { buildRock } from './rockbuild';

export interface StillOpts { w: number; h: number; rot?: number; scale?: number }

const cache = new Map<string, string>();
const waiting = new Map<string, ((u: string) => void)[]>();
const queue: { key: string; p: RenderHint; o: StillOpts }[] = [];
let tr: any = null, tc: any = null, cv: HTMLCanvasElement | null = null, busy = false;

const keyOf = (p: RenderHint, o: StillOpts) => `${p.type}:${p.seed}:${o.w}x${o.h}:${o.rot ?? -1.6}:${o.scale ?? 1.3}`;

async function pump() {
  if (busy) return;
  busy = true;
  try {
    const { THREE } = await scene();
    if (!tr) {
      cv = document.createElement('canvas');
      tr = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
      tr.outputEncoding = THREE.sRGBEncoding; tr.toneMapping = THREE.ACESFilmicToneMapping;
      tc = new THREE.PerspectiveCamera(24, 1, .1, 50); tc.position.set(0, 0, 7.4);
    }
    while (queue.length) {
      const { key, p, o } = queue.shift()!;
      if (cache.has(key)) { flush(key); continue; }
      tr.setSize(o.w, o.h, false); tc.aspect = o.w / o.h; tc.updateProjectionMatrix();
      const s = new THREE.Scene(); light(s, tr);
      const m = await buildRock({ type: p.type, seed: p.seed, level: o.w < 200 ? 4 : 5, stretch: [1.14, .8, .92], chips: 5, dents: .045, cut: [.58, .12, .8], cutD: .42, bump: .011 });
      tr.setSize(o.w, o.h, false); tc.aspect = o.w / o.h; tc.updateProjectionMatrix();
      m.scale.setScalar(o.scale ?? 1.3); m.rotation.set(.32, o.rot ?? -1.6, .08); s.add(m); tr.render(s, tc);
      cache.set(key, cv!.toDataURL());
      m.material.dispose(); // geometry is cached and shared
      flush(key);
      await new Promise(r => setTimeout(r, 0)); // keep the page responsive between renders
    }
  } catch {
    /* no WebGL: cards keep their gradient background */
  } finally {
    busy = false;
  }
}

function flush(key: string) {
  const u = cache.get(key)!;
  (waiting.get(key) ?? []).forEach(f => f(u));
  waiting.delete(key);
}

export function still(p: RenderHint, o: StillOpts): Promise<string> {
  const key = keyOf(p, o);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise(resolve => {
    waiting.set(key, [...(waiting.get(key) ?? []), resolve]);
    queue.push({ key, p, o });
    if ('requestIdleCallback' in window) requestIdleCallback(() => pump(), { timeout: 800 });
    else setTimeout(pump, 50);
  });
}

/** Image URL for a specimen: its photo if the file has one, else a generated still. */
export function useStill(p: RenderHint | null | undefined, o: StillOpts, photo?: string | null): string | undefined {
  const key = p ? keyOf(p, o) : '';
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (photo || !p) return;
    let alive = true;
    still(p, o).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, photo]);
  return photo ?? url;
}
