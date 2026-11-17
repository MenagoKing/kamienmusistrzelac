import { useEffect, useRef } from 'react';
import type { RenderHint } from '../data';
import { attach, type ViewOpts } from '../lib/viewer';

/** A specimen in 3D you can turn with the mouse or a finger. */
export function RockView({ hint, mode = 'hover', auto, level = 6, scale, startRot, className = '', label, hoverRef }: {
  hint: RenderHint; mode?: ViewOpts['mode']; auto?: number; level?: 5 | 6; scale?: number; startRot?: number; className?: string; label?: string;
  /** An element whose hover should also turn the rock (e.g. the whole card). */
  hoverRef?: React.RefObject<HTMLElement>;
}) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const h = attach(c, hint, { mode, auto, level, scale, startRot });
    const el = hoverRef?.current;
    const on = () => h.hover(true), off = () => h.hover(false);
    el?.addEventListener('pointerenter', on);
    el?.addEventListener('pointerleave', off);
    return () => { el?.removeEventListener('pointerenter', on); el?.removeEventListener('pointerleave', off); h.detach(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hint.type, hint.seed, mode, level]);
  return <canvas ref={cv} className={'r3d ' + className} role="img" aria-label={label ?? 'Specimen in 3D. Drag to turn it.'} />;
}
