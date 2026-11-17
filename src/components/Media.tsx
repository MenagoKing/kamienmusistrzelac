import { useState } from 'react';
import type { RenderHint } from '../data';
import { RockView } from './RockView';

/** The specimen up close: a 3D model you can turn, plus its photos from the vault when it has any. */
export function Media({ hint, photos = [], label, className = '' }: { hint: RenderHint; photos?: string[]; label: string; className?: string }) {
  const [sel, setSel] = useState(-1); // -1 = 3D
  return (
    <div className={'media ' + hint.type + ' ' + className}>
      <div className="media-main">
        {sel < 0 ? <RockView hint={hint} mode="live" auto={0.3} scale={1.38} label={`${label} in 3D. Drag to turn it.`} /> : <img src={photos[sel]} alt={`${label}, photo ${sel + 1}`} />}
        {sel < 0 && <span className="media-hint mono" aria-hidden="true">Drag to turn</span>}
      </div>
      {photos.length > 0 && (
        <div className="media-strip" role="tablist" aria-label="Views">
          <button type="button" role="tab" aria-selected={sel < 0} className={'mthumb d3' + (sel < 0 ? ' on' : '')} onClick={() => setSel(-1)}>3D</button>
          {photos.map((p, i) => (
            <button key={p} type="button" role="tab" aria-selected={sel === i} className={'mthumb' + (sel === i ? ' on' : '')} onClick={() => setSel(i)}><img src={p} alt="" /></button>
          ))}
        </div>
      )}
    </div>
  );
}
