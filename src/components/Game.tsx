// Impact Hunter: Kit, a meteorite hunter on a hover sled, works the desert under a meteor storm.
// Shoot meteors, catch their fragments, keep your shields. The server decides any prize.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { mass, usd } from '../lib/format';
import type { Specimen } from '../data';
import { RockView } from './RockView';
import { Spinner } from './Overlay';

interface Status {
  enabled: boolean; signed_in: boolean; can_play: boolean; reason: string; token_required: boolean; min_token_usd: number; token_usd: number | null; symbol: string;
  min_score: number; win_chance: number; daily_runs: number; runs_left: number; prize_max_usd: number; prizes_left: number;
  best: { name: string; score: number }[]; winners: { name: string; specimen: string; at: string }[];
}
interface Result { score: number; valid: boolean; qualified: boolean; won: Specimen | null; min_score: number; runs_left: number }

/* ---------- the game engine (canvas) ---------- */

type Kind = 'stone' | 'iron' | 'pristine';
interface Meteor { x: number; y: number; vx: number; vy: number; r: number; hp: number; kind: Kind; rot: number; spin: number; shape: number[]; hit: number }
interface Shot { x: number; y: number }
interface Frag { x: number; y: number; vx: number; vy: number; life: number; shield?: boolean }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; c: string }

function rng(seedHex: string) {
  let s = parseInt(seedHex.slice(0, 8), 16) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; };
}

const POINTS: Record<Kind, number> = { stone: 20, iron: 70, pristine: 160 };
const MAX_COMBO = 2;
const WAVE_MS = 20000;

export function runGame(cv: HTMLCanvasElement, seed: string, minScore: number, onEnd: (r: { score: number; waves: number; duration_ms: number }) => void) {
  const ctx = cv.getContext('2d')!;
  const rand = rng(seed);
  let W = 0, H = 0, ground = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight; ground = H * 0.86;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const stars = Array.from({ length: 120 }, () => ({ x: Math.random(), y: Math.random() * 0.8, s: Math.random() * 1.4 + 0.3, t: Math.random() * 6 }));
  const dunes = [0.9, 0.84, 0.88].map((h, i) => Array.from({ length: 9 }, (_, k) => h + Math.sin(k * 1.7 + i * 2) * 0.03));

  const p = { x: 0.5, target: 0.5, shields: 3, inv: 0 };
  const keys = new Set<string>();
  let meteors: Meteor[] = [], shots: Shot[] = [], frags: Frag[] = [], sparks: Spark[] = [];
  let score = 0, combo = 1, wave = 1, shake = 0, flash = 0;
  let elapsed = 0, spawnT = 0, fireT = 0, last = performance.now(), paused = false, over = false, raf = 0;

  const spawn = () => {
    const roll = rand();
    const kind: Kind = roll < 0.06 + wave * 0.002 ? 'pristine' : roll < 0.2 + wave * 0.01 ? 'iron' : 'stone';
    const r = kind === 'iron' ? 26 + rand() * 12 : kind === 'pristine' ? 20 + rand() * 6 : 12 + rand() * 20;
    const speed = (90 + wave * 24 + rand() * 60) * (kind === 'iron' ? 0.7 : kind === 'pristine' ? 1.25 : 1);
    const x = 30 + rand() * (W - 60);
    // more and more meteors come straight for the sled: standing still is not an option
    const aimed = rand() < Math.min(0.75, 0.35 + wave * 0.05);
    const fall = (ground - 26 + r) / speed;
    const vx = aimed ? ((p.x * W - x) / fall) * (0.7 + rand() * 0.5) : (rand() - 0.5) * (40 + wave * 6);
    const tough = Math.floor(wave / 3);
    meteors.push({ x, y: -r, vx, vy: speed, r, hp: (kind === 'iron' ? 6 : kind === 'pristine' ? 4 : r > 24 ? 3 : 2) + tough, kind, rot: rand() * 6, spin: (rand() - 0.5) * 2,
      shape: Array.from({ length: 9 }, () => 0.72 + rand() * 0.38), hit: 0 });
  };
  const burst = (x: number, y: number, n: number, c: string, sp = 220) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = Math.random() * sp; sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5, c }); } };

  const step = (dt: number) => {
    elapsed += dt * 1000;
    wave = 1 + Math.floor(elapsed / WAVE_MS);
    // move
    const dir = (keys.has('ArrowRight') || keys.has('d') || keys.has('D') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') || keys.has('A') ? 1 : 0);
    if (dir) p.target = Math.min(0.97, Math.max(0.03, p.target + dir * dt * 0.95));
    p.x += (p.target - p.x) * Math.min(1, dt * 12);
    p.inv = Math.max(0, p.inv - dt);
    const px = p.x * W, py = ground - 26;
    // fire
    fireT -= dt;
    if (fireT <= 0) { shots.push({ x: px - 7, y: py - 30 }, { x: px + 7, y: py - 30 }); fireT = 0.26; }
    shots.forEach(s => { s.y -= 900 * dt; });
    shots = shots.filter(s => s.y > -20);
    // spawn
    spawnT -= dt * 1000;
    if (spawnT <= 0) { spawn(); if (wave > 4 && rand() < 0.25) spawn(); spawnT = Math.max(230, 950 - wave * 75) * (0.7 + rand() * 0.6); }
    // meteors
    for (const m of meteors) {
      m.x += m.vx * dt; m.y += m.vy * dt; m.rot += m.spin * dt; m.hit = Math.max(0, m.hit - dt);
      if (m.x < m.r || m.x > W - m.r) m.vx *= -1;
      if (Math.random() < 0.6) sparks.push({ x: m.x + (Math.random() - 0.5) * m.r * 0.6, y: m.y - m.r * 0.6, vx: (Math.random() - 0.5) * 20, vy: -30 - Math.random() * 30, life: 0.35, c: m.kind === 'pristine' ? '#9fe3ff' : '#F08A5D' });
      for (const s of shots) {
        if (s.y < 0 || (s.x - m.x) ** 2 + (s.y - m.y) ** 2 > (m.r + 3) ** 2) continue;
        const hy = s.y; s.y = -99; m.hp--; m.hit = 0.08; burst(s.x, hy, 3, '#EFE6DA', 90);
        if (m.hp <= 0) {
          score += Math.round(POINTS[m.kind] * (m.r / 22) * Math.min(combo, MAX_COMBO));
          burst(m.x, m.y, m.kind === 'pristine' ? 30 : 18, m.kind === 'pristine' ? '#9fe3ff' : '#F08A5D', 260);
          const n = m.kind === 'pristine' ? 5 : m.kind === 'iron' ? 3 : 1 + Math.floor(m.r / 16);
          for (let i = 0; i < n; i++) frags.push({ x: m.x, y: m.y, vx: (Math.random() - 0.5) * 160, vy: -80 - Math.random() * 120, life: 6 });
          if (m.kind === 'pristine' && p.shields < 3 && Math.random() < 0.35) frags.push({ x: m.x, y: m.y, vx: 0, vy: -60, life: 7, shield: true });
          m.y = H * 9;
        }
      }
      if (m.y > H * 2) continue;
      // ground impact: combo lost
      if (m.y + m.r >= ground) { burst(m.x, ground, 16, '#c9a27a', 200); shake = Math.max(shake, 6); combo = 1; m.y = H * 9; continue; }
      // the sled
      if (p.inv <= 0 && Math.abs(m.x - px) < m.r + 22 && Math.abs(m.y - py) < m.r + 18) {
        p.shields--; p.inv = 1.6; shake = 14; flash = 0.35; combo = 1; burst(px, py, 30, '#F2A08A', 300); m.y = H * 9;
        if (p.shields <= 0) { over = true; }
      }
    }
    meteors = meteors.filter(m => m.y < H * 2);
    // fragments
    for (const f of frags) {
      f.vy += 420 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.life -= dt;
      if (f.y > ground - 4) { f.y = ground - 4; f.vy *= -0.25; f.vx *= 0.7; }
      if (Math.abs(f.x - px) < 30 && Math.abs(f.y - py) < 30) {
        if (f.shield) { p.shields = Math.min(3, p.shields + 1); burst(f.x, f.y, 20, '#9ED39A', 160); }
        else { score += Math.round(10 * Math.min(combo, MAX_COMBO)); combo = Math.min(combo + 0.1, MAX_COMBO); burst(f.x, f.y, 6, '#E8C27A', 80); }
        f.life = 0;
      }
    }
    frags = frags.filter(f => f.life > 0);
    sparks.forEach(s => { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 200 * dt; s.life -= dt; });
    sparks = sparks.filter(s => s.life > 0).slice(-600);
    shake = Math.max(0, shake - dt * 30); flash = Math.max(0, flash - dt);
  };

  const drawKit = (x: number, y: number, t: number) => {
    const bob = Math.sin(t * 6) * 2.5;
    ctx.save(); ctx.translate(x, y + bob);
    if (p.inv > 0 && Math.floor(t * 12) % 2) ctx.globalAlpha = 0.45;
    // underglow
    const g = ctx.createRadialGradient(0, 22, 2, 0, 22, 46); g.addColorStop(0, 'rgba(240,138,93,.55)'); g.addColorStop(1, 'rgba(240,138,93,0)');
    ctx.fillStyle = g; ctx.fillRect(-50, 0, 100, 50);
    // sled
    ctx.fillStyle = '#2a211c'; ctx.strokeStyle = '#F08A5D'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-30, 8, 60, 12, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#F08A5D'; ctx.fillRect(-22, 19, 10, 3); ctx.fillRect(12, 19, 10, 3);
    // body and backpack
    ctx.fillStyle = '#d8cbbb'; ctx.beginPath(); ctx.roundRect(-10, -14, 20, 24, 7); ctx.fill();
    ctx.fillStyle = '#8e8174'; ctx.fillRect(-14, -10, 5, 16);
    // arms holding the twin laser
    ctx.fillStyle = '#3a2d26'; ctx.fillRect(-9, -24, 4, 12); ctx.fillRect(5, -24, 4, 12);
    ctx.fillStyle = '#F08A5D'; ctx.fillRect(-9, -27, 4, 3); ctx.fillRect(5, -27, 4, 3);
    // helmet
    ctx.fillStyle = '#efe6da'; ctx.beginPath(); ctx.arc(0, -22, 11, 0, 6.29); ctx.fill();
    const v = ctx.createLinearGradient(-8, -28, 8, -16); v.addColorStop(0, '#5fb7ff'); v.addColorStop(1, '#0a1626');
    ctx.fillStyle = v; ctx.beginPath(); ctx.ellipse(1, -22, 7.5, 5.5, 0, 0, 6.29); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(-3, -25, 3, 2);
    ctx.restore();
  };

  const draw = (t: number) => {
    ctx.save();
    if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#07060a'); sky.addColorStop(0.7, '#160f0c'); sky.addColorStop(1, '#2a160c');
    ctx.fillStyle = sky; ctx.fillRect(-20, -20, W + 40, H + 40);
    for (const s of stars) { ctx.globalAlpha = 0.4 + Math.sin(t * 2 + s.t) * 0.3; ctx.fillStyle = '#fff'; ctx.fillRect(s.x * W, s.y * H, s.s, s.s); }
    ctx.globalAlpha = 1;
    dunes.forEach((d, i) => {
      ctx.fillStyle = ['#1a120e', '#22170f', '#2c1d13'][i];
      ctx.beginPath(); ctx.moveTo(0, H);
      d.forEach((h, k) => ctx.lineTo((k / (d.length - 1)) * W, h * H - (2 - i) * 18));
      ctx.lineTo(W, H); ctx.fill();
    });
    ctx.fillStyle = '#3a2618'; ctx.fillRect(0, ground, W, H - ground);
    ctx.strokeStyle = 'rgba(240,138,93,.25)'; ctx.beginPath(); ctx.moveTo(0, ground); ctx.lineTo(W, ground); ctx.stroke();
    // shots
    ctx.fillStyle = '#ffd9b8'; ctx.shadowColor = '#F08A5D'; ctx.shadowBlur = 8;
    for (const s of shots) ctx.fillRect(s.x - 1.5, s.y - 9, 3, 12);
    ctx.shadowBlur = 0;
    // meteors
    for (const m of meteors) {
      ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.rot);
      const glow = m.kind === 'pristine' ? 'rgba(95,183,255,.5)' : 'rgba(240,138,93,.35)';
      const gg = ctx.createRadialGradient(0, 0, m.r * 0.3, 0, 0, m.r * 1.8); gg.addColorStop(0, glow); gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, m.r * 1.8, 0, 6.29); ctx.fill();
      ctx.beginPath();
      m.shape.forEach((k, i) => { const a = (i / m.shape.length) * 6.283; const rr = m.r * k; i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); });
      ctx.closePath();
      const body = ctx.createLinearGradient(-m.r, -m.r, m.r, m.r);
      if (m.kind === 'iron') { body.addColorStop(0, '#b9b2aa'); body.addColorStop(1, '#3d3833'); }
      else if (m.kind === 'pristine') { body.addColorStop(0, '#cdeeff'); body.addColorStop(1, '#2a4560'); }
      else { body.addColorStop(0, '#8a6a52'); body.addColorStop(1, '#2a1c14'); }
      ctx.fillStyle = m.hit > 0 ? '#ffffff' : body; ctx.fill();
      ctx.strokeStyle = m.kind === 'pristine' ? '#9fe3ff' : 'rgba(240,138,93,.7)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    }
    // fragments
    for (const f of frags) {
      ctx.fillStyle = f.shield ? '#9ED39A' : '#E8C27A'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
      ctx.beginPath(); if (f.shield) ctx.arc(f.x, f.y, 6, 0, 6.29); else { ctx.moveTo(f.x, f.y - 5); ctx.lineTo(f.x + 4, f.y); ctx.lineTo(f.x, f.y + 5); ctx.lineTo(f.x - 4, f.y); }
      ctx.fill(); ctx.shadowBlur = 0;
    }
    for (const s of sparks) { ctx.globalAlpha = Math.max(0, s.life * 1.6); ctx.fillStyle = s.c; ctx.fillRect(s.x, s.y, 2, 2); }
    ctx.globalAlpha = 1;
    drawKit(p.x * W, ground - 26, t);
    ctx.restore();
    if (flash) { ctx.fillStyle = `rgba(242,160,138,${flash})`; ctx.fillRect(0, 0, W, H); }
    // HUD
    ctx.fillStyle = '#EFE6DA'; ctx.font = `400 ${Math.max(28, W * 0.04)}px "Instrument Serif", serif`; ctx.textAlign = 'left';
    ctx.fillText(score.toLocaleString('en-US'), 18, 46);
    ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.fillStyle = '#A39484';
    ctx.fillText(`WAVE ${wave}   ×${Math.min(combo, MAX_COMBO).toFixed(1)}`, 20, 66);
    ctx.textAlign = 'right';
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i < p.shields ? '#9ED39A' : 'rgba(239,230,218,.15)'; ctx.beginPath(); ctx.arc(W - 22 - i * 20, 38, 6, 0, 6.29); ctx.fill(); }
    // progress to the qualifying score
    const q = Math.min(1, score / minScore);
    ctx.fillStyle = 'rgba(239,230,218,.12)'; ctx.fillRect(18, 76, Math.min(220, W * 0.4), 3);
    ctx.fillStyle = q >= 1 ? '#9ED39A' : '#F08A5D'; ctx.fillRect(18, 76, Math.min(220, W * 0.4) * q, 3);
    if (paused) { ctx.fillStyle = 'rgba(8,6,5,.6)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#EFE6DA'; ctx.textAlign = 'center'; ctx.font = '400 40px "Instrument Serif", serif'; ctx.fillText('Paused', W / 2, H / 2); ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.fillText('TAP OR PRESS SPACE', W / 2, H / 2 + 26); }
  };

  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!paused && !over) step(dt);
    draw(now / 1000);
    if (over) { cancelAnimationFrame(raf); onEnd({ score, waves: wave, duration_ms: Math.round(elapsed) }); return; }
    raf = requestAnimationFrame(loop);
  };
  const kd = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'p' || e.key === 'Escape') { paused = !paused; e.preventDefault(); return; } keys.add(e.key); if (e.key.startsWith('Arrow')) e.preventDefault(); };
  const ku = (e: KeyboardEvent) => keys.delete(e.key);
  const pm = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); p.target = Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width)); };
  const pd = (e: PointerEvent) => { if (paused) paused = false; pm(e); };
  const vis = () => { if (document.hidden) paused = true; };
  addEventListener('keydown', kd); addEventListener('keyup', ku); addEventListener('resize', resize);
  cv.addEventListener('pointermove', pm); cv.addEventListener('pointerdown', pd); document.addEventListener('visibilitychange', vis);
  raf = requestAnimationFrame(t => { last = t; loop(t); });
  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('resize', resize);
    cv.removeEventListener('pointermove', pm); cv.removeEventListener('pointerdown', pd); document.removeEventListener('visibilitychange', vis);
  };
}

/* ---------- the screen: lobby, run, result ---------- */

export function GameDialog() {
  const { me, close, withWallet, refresh } = useApp();
  const [st, setSt] = useState<Status | null>(null);
  const [phase, setPhase] = useState<'lobby' | 'playing' | 'sending' | 'result'>('lobby');
  const [runId, setRunId] = useState('');
  const [seed, setSeed] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState('');
  const cv = useRef<HTMLCanvasElement>(null);
  const load = () => api<Status>('GET', '/api/game').then(setSt).catch(e => setErr(e.message));
  useEffect(() => { load(); document.documentElement.classList.add('locked'); return () => document.documentElement.classList.remove('locked'); }, [me]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && phase !== 'playing') close(); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [phase, close]);

  useEffect(() => {
    if (phase !== 'playing' || !cv.current) return;
    return runGame(cv.current, seed, st?.min_score ?? 25000, async r => {
      setPhase('sending');
      try { const out = await api<Result>('POST', '/api/game/finish', { run_id: runId, ...r }); setRes(out); if (out.won) refresh(); }
      catch (e: any) { setErr(e.message); }
      setPhase('result'); load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const play = async () => {
    if (!me) return withWallet({ kind: 'game' });
    setErr('');
    try { const r = await api<{ run_id: string; seed: string }>('POST', '/api/game/start', {}); setRunId(r.run_id); setSeed(r.seed); setRes(null); setPhase('playing'); }
    catch (e: any) { setErr(e.message); load(); }
  };

  return (
    <div className="game" role="dialog" aria-modal="true" aria-label="Impact Hunter">
      {phase === 'playing' || phase === 'sending' ? (
        <>
          <canvas ref={cv} className="game-cv" aria-label="Impact Hunter. Move with the arrow keys or your finger; the laser fires on its own." />
          {phase === 'sending' && <div className="game-over"><Spinner label="Checking" /><b>Storm over</b><span className="mono">Checking your run…</span></div>}
        </>
      ) : (
        <div className="game-lobby">
          <button className="x game-x" type="button" onClick={close} aria-label="Close"><i aria-hidden="true" /></button>
          <div className="game-hero">
            <div className="kick mono">Mini-game</div>
            <h2>Impact Hunter</h2>
            <p>A meteor storm is hitting the desert. You are Kit, a meteorite hunter on a hover sled. Shoot the meteors before they land, catch their glowing fragments, and keep your three shields. Every 20 seconds the storm gets worse.</p>
            <ul className="game-rules mono">
              <li><b>Move</b> arrow keys / A D, or drag with your finger. The twin laser fires on its own.</li>
              <li><b>Blue</b> pristine meteors take 3 hits, are worth the most and can drop a shield.</li>
              <li><b>Combo</b> grows with every fragment you catch, up to ×2. A meteor that lands or hits you resets it.</li>
              <li><b>Space</b> pauses.</li>
            </ul>
          </div>

          {phase === 'result' && res && (
            <div className={'game-res' + (res.won ? ' won' : '')}>
              {res.won ? (
                <>
                  <div className="game-prize"><RockView hint={res.won.render} mode="live" auto={0.5} scale={1.3} label={res.won.name} /></div>
                  <div>
                    <div className="kick mono">You recovered a real specimen</div>
                    <h3>{res.won.name}</h3>
                    <p className="mono dim">{res.won.class} · {mass(res.won.mass_g)} · {res.won.id}</p>
                    <p>It is in your collection and its NFT is being minted to your wallet.</p>
                    <button className="btn" type="button" onClick={() => { close(); location.href = '/account'; }}>See it in my collection</button>
                  </div>
                </>
              ) : (
                <div>
                  <div className="kick mono">Storm over</div>
                  <h3>{res.score.toLocaleString('en-US')} points</h3>
                  <p>{!res.valid ? 'This run could not be verified, so it does not count.' : res.qualified ? `You qualified for the core roll, but there was no specimen in this impact. Each qualifying run has a ${Math.round((st?.win_chance ?? 0) * 1000) / 10}% chance.` : `Reach ${res.min_score.toLocaleString('en-US')} points to qualify for a chance at a real specimen.`}</p>
                </div>
              )}
            </div>
          )}

          <div className="game-side">
            {!st ? <p className="mono dim"><Spinner label="Loading" /> Loading…</p> : (
              <>
                <dl className="kv">
                  {st.token_required && <><dt>${st.symbol} needed to play</dt><dd>{usd(st.min_token_usd)}</dd></>}
                  {st.token_required && st.signed_in && <><dt>You hold</dt><dd className={(st.token_usd ?? 0) >= st.min_token_usd ? 'ok-t' : ''}>{st.token_usd == null ? '—' : usd(st.token_usd)}</dd></>}
                  <dt>Score to qualify</dt><dd>{st.min_score.toLocaleString('en-US')}</dd>
                  <dt>Chance per qualifying run</dt><dd>{Math.round(st.win_chance * 1000) / 10}%</dd>
                  <dt>Runs left today</dt><dd>{st.signed_in ? `${st.runs_left} of ${st.daily_runs}` : st.daily_runs}</dd>
                  <dt>Specimens to win</dt><dd>{st.prizes_left} · up to {usd(st.prize_max_usd)}</dd>
                </dl>
                {(st.reason && st.signed_in) && <p className="err">{st.reason}</p>}
                {err && <p className="err" role="alert">{err}</p>}
                <button className="btn wide" type="button" disabled={st.signed_in && !st.can_play} onClick={play}>{!st.signed_in ? 'Sign in to play' : phase === 'result' ? 'Play again' : 'Start the storm'}</button>
                {st.token_required && <p className="fine">Holding at least {usd(st.min_token_usd)} in ${st.symbol} in your Space Rocks wallet (or a linked wallet) unlocks the game. Prizes are decided by the server; runs are checked against the real time played.</p>}
                {st.best.length > 0 && <><h4 className="mono">Best scores</h4><ol className="game-board">{st.best.map(b => <li key={b.name}><span>{b.name}</span><b className="mono">{b.score.toLocaleString('en-US')}</b></li>)}</ol></>}
                {st.winners.length > 0 && <><h4 className="mono">Recovered</h4><ul className="game-board">{st.winners.map(w => <li key={w.at}><span>{w.name}</span><b>{w.specimen}</b></li>)}</ul></>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
