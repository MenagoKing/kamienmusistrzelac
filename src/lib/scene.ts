// Loads the design's 3D library unchanged: three.js r128 (byte-identical to the cdnjs r128 build the
// design pins, served from our own assets) and space-rocks-site/src/rocks.js, which defines the
// global RK. Both are classic scripts, loaded in order, once.

import threeUrl from 'three/build/three.min.js?url';
import rocksUrl from '../../space-rocks-site/src/rocks.js?url';

declare const RK: any;
declare const THREE: any;

let ready: Promise<{ RK: any; THREE: any }> | null = null;

function load(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.body.appendChild(s);
  });
}

/** Resolves with the RK and THREE globals once both scripts have run. */
export function scene() {
  if (!ready) ready = load(threeUrl).then(() => load(rocksUrl)).then(() => ({ RK, THREE }));
  return ready;
}

/** "#still" in the URL: draw everything at a fixed moment, no motion (for previews), as in the design. */
export const isStill = () => typeof location !== 'undefined' && /still/.test(location.hash);

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Lighting shared by every rock (from the design's page script). */
export function light(scene: any, r: any) {
  scene.environment = RK.env(r, { top: '#3b2a22', bottom: '#0b0807', panels: [{ c: '#ff8a50', i: 1.15, pos: [6, 0, -6], w: 0.12 }, { c: '#fff0e0', i: 0.75, pos: [-4, 7, 3], w: 0.1 }, { c: '#8fa8d8', i: 0.18, pos: [-6, -1, 5], w: 0.2 }] });
  const k = new THREE.DirectionalLight(0xfff1e2, 1.6); k.position.set(-2.5, 6.5, 2.5); scene.add(k);
  const b = new THREE.DirectionalLight(0xff6a33, 3.3); b.position.set(6, 1, -5); scene.add(b);
  const f = new THREE.DirectionalLight(0x8fa8d8, 0.35); f.position.set(-6, -1, 5); scene.add(f);
  scene.add(new THREE.AmbientLight(0x3a2418, 0.35));
}

/** RK.run never stops, so each canvas is started once (also under React StrictMode). */
const started = new WeakSet<Element>();
export function once(el: Element | null) {
  if (!el || started.has(el)) return false;
  started.add(el);
  return true;
}
