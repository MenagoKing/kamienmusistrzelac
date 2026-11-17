import { useEffect, useRef, useState } from 'react';
import { subscribeSeries, type Band, type Rules, type Series, type UpcomingSeries } from '../data';
import { isStill, reducedMotion } from '../lib/scene';
import { pct } from '../lib/format';

const COL: Record<Band, string> = { floor: '#7D7166', par: '#D6CABC', hit: '#F08A5D' };
const CLS: Record<Band, string> = { floor: 'c-floor', par: 'c-par', hit: 'c-hit' };
const NAME: Record<Band, string> = { floor: 'Floor', par: 'Par', hit: 'Hit' };
const IDS: Record<Band, [string, string]> = { floor: ['bf', 'nf'], par: ['bp', 'np'], hit: ['bh', 'nh'] };
const BANDS: Band[] = ['floor', 'par', 'hit'];
const NOTE: Record<Band, string> = {
  floor: 'In vault value. Never below 70%.',
  par: 'Around what you paid, often a little more.',
  hit: 'The pulls worth filming.',
};

const range = (b: Band, rules: Rules) => {
  const { min, max } = rules.bands[b];
  return max == null ? `${pct(min)}% of the pack price or more` : `${pct(min)} to ${pct(max)}% of the pack price`;
};

/** §02 The packs: bands, the live board of the open series, upcoming series, the flow. */
export function Packs({ rules, series: initial, upcoming }: { rules: Rules; series: Series; upcoming: UpcomingSeries[] }) {
  const [series, setSeries] = useState(initial);
  const [fresh, setFresh] = useState(-1);
  const prev = useRef(initial.opened.length);

  useEffect(() => {
    if (isStill() || reducedMotion()) return;
    return subscribeSeries(initial, setSeries);
  }, [initial]);

  /* a newly opened pack pops for 0.7 s */
  useEffect(() => {
    const n = series.opened.length;
    if (n > prev.current) {
      setFresh(n - 1);
      const t = setTimeout(() => setFresh(-1), 700);
      prev.current = n;
      return () => clearTimeout(t);
    }
    prev.current = n;
  }, [series.opened.length]);

  const left = series.remaining.floor + series.remaining.par + series.remaining.hit;

  return (
    <section className="s wrap" id="packs" aria-labelledby="h-packs">
      <div className="intro rv">
        <div><div className="sec mono"><span>§02</span><span>The packs</span></div><h2 id="h-packs">Every pack has a floor.</h2></div>
        <p>Packs work like a booster box. Each sealed series holds exactly 100 packs, and its make-up is published before sale opens. Every pack holds one specimen, and its vault value lands in one of three bands.</p>
      </div>
      <div className="pk">
        <ul className="bands rv">
          {BANDS.map(b => (
            <li key={b}>
              <span className="nm mono"><i className={CLS[b]} />{NAME[b]}</span>
              <div><h3>{range(b, rules)}</h3><p>{NOTE[b]}</p></div>
              <span className="ct">{rules.bands[b].count}<small>of {rules.series_size}</small></span>
            </li>
          ))}
        </ul>
        <div className="rv">
          <div className="series" aria-label={`${series.name}, live counts`}>
            <div className="hd mono"><span>{series.name} · <b>{series.status === 'sold_out' ? 'sold out' : series.status}</b></span><span id="sleft">{left} of {series.size} left</span></div>
            <div className="dots" id="dots" aria-hidden="true">
              {Array.from({ length: series.size }, (_, i) => {
                const b = series.opened[i];
                return <i key={i} className={b ? (i === fresh ? 'o new' : 'o') : undefined} style={b ? { background: COL[b] } : undefined} />;
              })}
            </div>
            <div className="left mono" id="left">
              {BANDS.map(b => (
                <div key={b}><span>{NAME[b]}</span><u><b className={CLS[b]} id={IDS[b][0]} style={{ width: (series.remaining[b] / series.counts[b] * 100) + '%' }} /></u><em id={IDS[b][1]}>{series.remaining[b]} / {series.counts[b]}</em></div>
              ))}
            </div>
            <div className="ft mono"><span>Verifiable draw, no replacement</span><span>Composition published before sale</span></div>
          </div>
          <div className="open mono">
            {upcoming.map(u => (
              <div key={u.id}><b>{u.name}</b><span>{u.note}</span></div>
            ))}
          </div>
        </div>
      </div>
      <ol className="flow rv">
        <li><b className="mono">01</b>Pick an open series</li>
        <li><b className="mono">02</b>A verifiable draw picks one of the packs still sealed</li>
        <li><b className="mono">03</b>The reveal: the specimen, its band and an instant offer</li>
        <li><b className="mono">04</b>Hold it, sell it back, or redeem the rock</li>
      </ol>
    </section>
  );
}
