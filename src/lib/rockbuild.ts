// Rock meshes built in a Web Worker and cached by shape. Every place that shows a rock goes through
// buildRock(), so a page full of specimens never freezes while their geometry is computed.
import threeUrl from 'three/build/three.min.js?url';
import rocksUrl from '../../space-rocks-site/src/rocks.js?url';
import { scene } from './scene';

export interface RockOpts {
  type: string; seed: number; level: number;
  stretch?: number[]; chips?: number; dents?: number; cut?: number[]; cutD?: number; bump?: number; rough?: number; smooth?: number;
}

interface Built { pos: Float32Array; nor: Float32Array; chip: Float32Array; edge: Float32Array; idx: Uint32Array; cutD: number }

const cache = new Map<string, Promise<{ geometry: any; cutD: number }>>();
let worker: Worker | null = null, failed = false, seq = 0;
const waiting = new Map<number, (r: Built | { error: string }) => void>();

function getWorker() {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL('./rock-worker.js', import.meta.url));
    worker.onmessage = e => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data); };
    worker.onerror = () => { failed = true; worker = null; waiting.forEach(f => f({ error: 'worker failed' })); waiting.clear(); };
  } catch { failed = true; }
  return worker;
}

const abs = (u: string) => new URL(u, location.href).href;
const keyOf = (o: RockOpts) => JSON.stringify([o.type, o.seed, o.level, o.stretch, o.chips, o.dents, o.cut, o.cutD, o.bump, o.rough, o.smooth]);

async function geometryFor(o: RockOpts): Promise<{ geometry: any; cutD: number }> {
  const { THREE, RK } = await scene();
  const w = getWorker();
  if (w) {
    const r = await new Promise<Built | { error: string }>(res => {
      const id = ++seq;
      waiting.set(id, res);
      w.postMessage({ id, opts: o, urls: { three: abs(threeUrl), rocks: abs(rocksUrl) } });
    });
    if (!('error' in r)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
      g.setAttribute('aChip', new THREE.BufferAttribute(r.chip, 1));
      g.setAttribute('aEdge', new THREE.BufferAttribute(r.edge, 1));
      g.setIndex(new THREE.BufferAttribute(r.idx, 1));
      g.computeBoundingSphere();
      return { geometry: g, cutD: r.cutD };
    }
  }
  // Fallback: build on the page (older browsers without workers).
  const m = RK.rock(o);
  const sh: any = { uniforms: {}, vertexShader: '', fragmentShader: '' };
  m.material.onBeforeCompile(sh);
  m.material.dispose();
  return { geometry: m.geometry, cutD: sh.uniforms.uCutD.value };
}

/** A rock mesh with the design's material. Geometry is shared between meshes of the same shape: don't dispose it. */
export async function buildRock(o: RockOpts): Promise<any> {
  const { RK } = await scene();
  const key = keyOf(o);
  if (!cache.has(key)) cache.set(key, geometryFor(o));
  const { geometry, cutD } = await cache.get(key)!;
  // The material comes from a tiny build of the same rock (type, seed, cut, bump); the cut distance is
  // corrected to the detailed mesh's value.
  const shell = RK.rock({ ...o, level: 1 });
  shell.geometry.dispose();
  const orig = shell.material.onBeforeCompile;
  shell.material.onBeforeCompile = (sh: any, r: any) => { orig.call(shell.material, sh, r); sh.uniforms.uCutD.value = cutD; };
  shell.geometry = geometry;
  return shell;
}

/** Starts building without waiting (e.g. as soon as a result is known). */
export const prewarm = (o: RockOpts) => { void buildRock(o).catch(() => undefined); };
