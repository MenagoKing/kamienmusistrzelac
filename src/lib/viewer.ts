// Interactive 3D specimen viewer. One shared WebGL renderer draws every visible viewer into its own 2D
// canvas (so a page full of rocks never runs out of WebGL contexts). Drag to turn a rock, it keeps
// spinning with inertia; viewers off screen are skipped. Uses the design's 3D library (RK) unchanged.
import type { RenderHint } from '../data';
import { gpuRatio, isTouch, light, overlayOpen, scene } from './scene';
import { buildRock } from './rockbuild';
import { bakeRock, disposeBaked } from './bake';
import { bakedPlanet, planetLight, type PlanetKind } from './planet';

export interface ViewOpts {
  /** 'live' keeps turning; 'hover' draws once and turns while hovered or dragged. */
  mode: 'live' | 'hover';
  /** Idle turn speed, radians per second. */
  auto?: number;
  /** Geometry detail: 6 is the hero's level. */
  level?: 5 | 6;
  scale?: number;
  startRot?: number;
  /** Draw a planet instead of a specimen (pack covers). */
  model?: PlanetKind;
}

type Opts = Required<Omit<ViewOpts, 'model'>> & { model?: PlanetKind };

interface View {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  key: string;
  hint: RenderHint;
  o: Opts;
  rotX: number; rotY: number; vx: number; vy: number;
  visible: boolean; hover: boolean; drag: boolean; dirty: boolean;
  w: number; h: number; acc: number; top: boolean;
  ro: ResizeObserver;
  io: IntersectionObserver;
  off: () => void;
}

interface Model { scene: any; mesh: any }

let THREE: any, RK: any, renderer: any, camera: any, glCanvas: HTMLCanvasElement | null = null;
let W = 0, H = 0, raf = 0, last = 0, fn = 0;
const views = new Set<View>();
const models = new Map<string, Model>();
const building = new Set<string>();
const queue: View[] = [];
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = isTouch();

async function boot() {
  if (renderer) return;
  ({ THREE, RK } = await scene());
  glCanvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.setPixelRatio(1);
  renderer.setScissorTest(true);
  camera = new THREE.PerspectiveCamera(24, 1, .1, 50); camera.position.set(0, 0, 7.4);
}

function ensureSize(w: number, h: number) {
  if (w <= W && h <= H) return;
  W = Math.max(W, w, 512); H = Math.max(H, h, 512);
  renderer.setSize(W, H, false);
}

/** Starts building models for visible views; rock geometry is computed in a Web Worker. */
function buildNext() {
  const v = queue.find(x => views.has(x) && x.visible && !models.has(x.key) && !building.has(x.key));
  if (!v) return;
  queue.splice(queue.indexOf(v), 1);
  building.add(v.key);
  const s = new THREE.Scene();
  const done = (m: any) => { s.add(m); models.set(v.key, { scene: s, mesh: m }); building.delete(v.key); views.forEach(x => { if (x.key === v.key) x.dirty = true; }); };
  if (v.o.model) { planetLight(THREE, s); bakedPlanet(THREE, RK, renderer, v.o.model, touch ? 384 : 512).then(done, () => building.delete(v.key)); return; }
  light(s, renderer);
  const size = v.o.mode === 'live' ? (touch ? 384 : 512) : (touch ? 192 : 256);
  buildRock({ type: v.hint.type, seed: v.hint.seed, level: v.o.level, stretch: [1.14, .8, .92], chips: 5, dents: .045, cut: [.58, .12, .8], cutD: .42, bump: v.o.level === 6 ? .009 : .011 })
    .then(m => { done(m); return bakeRock(THREE, renderer, m, size).then(() => views.forEach(x => { if (x.key === v.key) x.dirty = true; })); })
    .catch(() => building.delete(v.key));
  evict();
}

/** Keeps GPU memory in check: frees the least recently drawn rocks that are off screen. */
const lastUse = new Map<string, number>();
function evict() {
  if (models.size <= 18) return;
  const onScreen = new Set([...views].filter(x => x.visible).map(x => x.key));
  const old = [...models.keys()].filter(k => !onScreen.has(k)).sort((a, b) => (lastUse.get(a) ?? 0) - (lastUse.get(b) ?? 0));
  for (const k of old.slice(0, models.size - 18)) { const m = models.get(k)!; if (!k.startsWith('planet:')) disposeBaked(m.mesh); models.delete(k); }
}

function draw(v: View, m: Model) {
  lastUse.set(v.key, performance.now());
  const dpr = gpuRatio();
  const cw = Math.max(1, Math.round(v.w * dpr)), ch = Math.max(1, Math.round(v.h * dpr));
  if (v.canvas.width !== cw || v.canvas.height !== ch) { v.canvas.width = cw; v.canvas.height = ch; }
  ensureSize(cw, ch);
  renderer.setViewport(0, 0, cw, ch); renderer.setScissor(0, 0, cw, ch);
  renderer.setClearColor(0, 0); renderer.clear();
  camera.aspect = cw / ch; camera.updateProjectionMatrix();
  m.mesh.scale.setScalar(v.o.scale);
  if (v.o.model) m.mesh.rotation.set(.16 + v.rotX, v.rotY, .41); // axial tilt
  else m.mesh.rotation.set(.3 + v.rotX, v.rotY, .08);
  renderer.render(m.scene, camera);
  v.ctx.clearRect(0, 0, cw, ch);
  v.ctx.drawImage(glCanvas!, 0, H - ch, cw, ch, 0, 0, cw, ch);
}

function frame(t: number) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(.05, (t - (last || t)) / 1000); last = t;
  buildNext();
  if (fn++ % 30 === 0) views.forEach(v => { // backup for IntersectionObserver
    const r = v.canvas.getBoundingClientRect();
    const vis = r.width > 0 && r.bottom > -120 && r.top < innerHeight + 120;
    if (vis !== v.visible) { v.visible = vis; if (vis) v.dirty = true; }
  });
  const covered = overlayOpen();
  views.forEach(v => {
    if (!v.visible) return;
    if (covered && !v.top) return; // only what is inside the open dialog keeps drawing
    const m = models.get(v.key);
    if (!m) { if (!queue.includes(v)) queue.push(v); return; }
    const spinning = Math.abs(v.vy) > .0004 || Math.abs(v.vx) > .0004;
    const idle = !reduced && (v.o.mode === 'live' || v.hover) ? v.o.auto : 0;
    if (!(v.dirty || v.drag || spinning || idle)) return;
    const step = dt;
    if (!v.drag) {
      v.rotY += v.vy + idle * step; v.rotX += v.vx;
      v.vy *= .93; v.vx *= .9;
      v.rotX += (0 - v.rotX) * (v.o.mode === 'live' ? .02 : .04); // settle back to the design's tilt
    }
    v.dirty = false;
    draw(v, m);
  });
  if (!views.size) { cancelAnimationFrame(raf); raf = 0; last = 0; }
}

export function attach(canvas: HTMLCanvasElement, hint: RenderHint, opts: ViewOpts) {
  const given = Object.fromEntries(Object.entries(opts).filter(([, x]) => x !== undefined)) as ViewOpts; // undefined must not erase defaults
  const o: Opts = { auto: opts.mode === 'live' ? .35 : .9, level: 6, scale: 1.3, startRot: -1.6, ...given };
  // Phones: card rocks use the lighter mesh (still detailed at that size); close-ups keep full detail.
  if (isTouch() && o.mode === 'hover' && !o.model) o.level = 5;
  const v: View = {
    canvas, ctx: canvas.getContext('2d')!, key: o.model ? `planet:${o.model}` : `${hint.type}:${hint.seed}:${o.level}`, hint, o,
    rotX: 0, rotY: o.startRot, vx: 0, vy: 0, visible: false, hover: false, drag: false, dirty: true,
    w: canvas.clientWidth, h: canvas.clientHeight, acc: 0, top: !!canvas.closest('.ov,.opn2,.auth,.mnav'),
    ro: new ResizeObserver(es => { const r = es[es.length - 1].contentRect; v.w = r.width; v.h = r.height; v.dirty = true; }),
    io: new IntersectionObserver(es => { v.visible = es[es.length - 1].isIntersecting; if (v.visible) v.dirty = true; }, { rootMargin: "120px" }),
    off: () => undefined,
  };
  v.io.observe(canvas);
  v.ro.observe(canvas);
  let px = 0, py = 0, moved = 0;
  const down = (e: PointerEvent) => { v.drag = true; moved = 0; px = e.clientX; py = e.clientY; v.vx = v.vy = 0; canvas.setPointerCapture(e.pointerId); canvas.classList.add('grab'); };
  const move = (e: PointerEvent) => {
    if (!v.drag) return;
    const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
    v.vy = dx * .012; v.vx = dy * .006;
    v.rotY += v.vy; v.rotX = Math.max(-.7, Math.min(.9, v.rotX + v.vx));
    v.dirty = true; // drawn once on the next frame, however many move events arrive
  };
  const up = (e: PointerEvent) => { v.drag = false; canvas.classList.remove('grab'); try { canvas.releasePointerCapture(e.pointerId); } catch { /* */ } };
  // A drag is not a click: keep the card under the rock from opening.
  const click = (e: MouseEvent) => { if (moved > 6) { e.stopPropagation(); e.preventDefault(); } };
  const enter = () => { v.hover = true; };
  const leave = () => { v.hover = false; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('click', click, true);
  canvas.addEventListener('pointerenter', enter);
  canvas.addEventListener('pointerleave', leave);
  v.off = () => {
    canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('click', click, true); canvas.removeEventListener('pointerenter', enter); canvas.removeEventListener('pointerleave', leave);
    v.io.disconnect(); v.ro.disconnect();
  };
  views.add(v);
  boot().then(() => { if (!raf && views.size) raf = requestAnimationFrame(frame); }).catch(() => canvas.classList.add('nogl'));
  return {
    detach() { v.off(); views.delete(v); },
    /** Nudge the rock, e.g. when its card is hovered from outside the canvas. */
    hover(on: boolean) { v.hover = on; },
    spin(speed: number) { v.vy = speed; },
  };
}

