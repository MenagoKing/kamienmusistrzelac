// Collector avatar: a procedural meteorite picked by the avatar seed, shown as a turntable of stills.
import { useEffect, useState } from 'react';
import type { RenderHint, RockType } from '../data';
import { still, useStill } from '../lib/stills';

const TYPES: RockType[] = ['stone', 'iron', 'pallasite', 'lunar', 'martian'];

export const avatarRock = (seed: number): RenderHint => ({ type: TYPES[Math.abs(seed) % 5], seed: (Math.abs(seed) % 997) + 3 });

/** Static avatar (header chip, small places). */
export function AvatarStill({ seed, size = 34 }: { seed: number; size?: number }) {
  const url = useStill(avatarRock(seed), { w: 96, h: 96, rot: -1.7, scale: 1.55 });
  return <span className="av" style={{ width: size, height: size }} aria-hidden="true">{url && <img src={url} alt="" />}</span>;
}

const FRAMES = 18;

/** Slowly turning avatar (sign-in screen, profile). Frames render lazily; the first shows at once. */
export function AvatarTurn({ seed, size = 260 }: { seed: number; size?: number }) {
  const rock = avatarRock(seed);
  const [frames, setFrames] = useState<string[]>([]);
  const [i, setI] = useState(0);
  useEffect(() => {
    let alive = true;
    setFrames([]);
    (async () => {
      const out: string[] = [];
      for (let k = 0; k < FRAMES; k++) {
        const u = await still(rock, { w: 320, h: 320, rot: -2.2 + (k / FRAMES) * Math.PI * 2, scale: 1.5 });
        if (!alive) return;
        out.push(u);
        setFrames([...out]);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);
  useEffect(() => {
    if (frames.length < FRAMES || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI(x => (x + 1) % FRAMES), 140);
    return () => clearInterval(t);
  }, [frames.length]);
  const src = frames[frames.length < FRAMES ? 0 : i];
  return (
    <div className="avturn" style={{ width: size, height: size }} aria-hidden="true">
      <i className="halo" />
      {src ? <img src={src} alt="" /> : <span className="spin" />}
    </div>
  );
}

export const ROCK_LABEL: Record<RockType, string> = { stone: 'Chondrite', iron: 'Iron', pallasite: 'Pallasite', lunar: 'Lunar', martian: 'Martian' };
