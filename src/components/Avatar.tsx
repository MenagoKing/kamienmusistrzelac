// Collector avatar: a procedural meteorite picked by the avatar seed, shown as a turntable of stills.
import type { RenderHint, RockType } from '../data';
import { useStill } from '../lib/stills';
import { RockView } from './RockView';

const TYPES: RockType[] = ['stone', 'iron', 'pallasite', 'lunar', 'martian'];

export const avatarRock = (seed: number): RenderHint => ({ type: TYPES[Math.abs(seed) % 5], seed: (Math.abs(seed) % 997) + 3 });

/** Static avatar (header chip, small places). */
export function AvatarStill({ seed, size = 34 }: { seed: number; size?: number }) {
  const url = useStill(avatarRock(seed), { w: 96, h: 96, rot: -1.7, scale: 1.55 });
  return <span className="av" style={{ width: size, height: size }} aria-hidden="true">{url && <img src={url} alt="" />}</span>;
}

/** Smoothly turning 3D avatar you can drag (sign-in screen, profile). */
export function AvatarTurn({ seed, size = 260 }: { seed: number; size?: number }) {
  return (
    <div className="avturn" style={{ width: size, height: size }}>
      <i className="halo" aria-hidden="true" />
      <RockView key={seed} hint={avatarRock(seed)} mode="live" auto={0.55} scale={1.5} label="Your collector rock in 3D. Drag to turn it." className="av3d" />
    </div>
  );
}

export const ROCK_LABEL: Record<RockType, string> = { stone: 'Chondrite', iron: 'Iron', pallasite: 'Pallasite', lunar: 'Lunar', martian: 'Martian' };
