import { useApp } from '../lib/store';
import { useStill } from '../lib/stills';
import { buyback, mass, multiple, pct, usd } from '../lib/format';

/** §05 After you buy: hold, sell back, redeem, share; the reveal card with the instant offer. */
export function After() {
  const { data, withWallet } = useApp();
  const { reveal, rules } = data;
  const sp = reveal.specimen;
  const image = useStill(sp.render, { w: 520, h: 346, rot: -1.25, scale: 1.35 }, sp.photo);
  const offer = usd(buyback(reveal.vault_value_usd, rules));
  const series = data.series && data.series.status === 'open' ? data.series : null;
  return (
    <section className="s wrap" id="after" aria-labelledby="h-after">
      <div className="intro rv">
        <div><div className="sec mono"><span>§05</span><span>After you buy</span></div><h2 id="h-after">It’s yours. Keep it, sell it, or ship it home.</h2></div>
        <p>Whether you bought it on the market or pulled it from a pack, it’s the rock itself, in a vault, with your name on its file until you decide what happens next.</p>
      </div>
      <ul className="opts rv">
        <li><b className="mono">01</b><h3>Hold</h3><p>The NFT carries the specimen’s full file. Keep it in your wallet or list it.</p></li>
        <li><b className="mono">02</b><h3>Sell it back</h3><p>Take an instant offer in USDC: {pct(rules.buyback_share)}% of its documented vault value. It goes into the next unopened series.</p></li>
        <li><b className="mono">03</b><h3>Redeem</h3><p>Burn the NFT and we ship the sealed capsule to you, insured. Shipping at cost plus a handling fee.</p></li>
        <li><b className="mono">04</b><h3>Share</h3><p>Every pull makes a card with the specimen, its band, class and weight, ready to post.</p></li>
      </ul>
      <div className="rvl rv">
        <div>
          <div className="sec mono"><span>The reveal</span>{reveal.pull_id && <span>Latest hit · Series {reveal.series_id}</span>}</div>
          <h2 style={{ fontSize: 'clamp(36px,3.6vw,56px)' }}>You see the offer before you decide.</h2>
          <p style={{ color: 'var(--soft)', fontSize: 17, maxWidth: '30em', margin: '18px 0 0' }}>The reveal shows the specimen, the band it landed in, its vault value against what you paid, and the instant buyback offer, side by side.</p>
        </div>
        <div className="reveal" aria-label={reveal.pull_id ? 'Latest hit' : 'Pack reveal, sample'}>
          <div className="ph"><img id="revimg" alt={`${sp.name}, ${sp.class}, ${mass(sp.mass_g)}`} src={image} /><span className="chip">{reveal.band.toUpperCase()} · {multiple(reveal.vault_value_usd, reveal.pack_price_usd)}×</span></div>
          <div className="bd">
            <h3>{sp.name}</h3>
            <div className="cl mono">{sp.class} · {mass(sp.mass_g)} · {sp.id}</div>
            <dl className="kv"><dt>Pack price</dt><dd>{usd(reveal.pack_price_usd)}</dd><dt>Vault value</dt><dd>{usd(reveal.vault_value_usd)}</dd><dt>Instant offer, {pct(rules.buyback_share)}%</dt><dd className="hot">{offer}</dd></dl>
            <div className="acts">
              {series ? <button className="btn" type="button" onClick={() => withWallet({ kind: 'pack', series })}>Open a pack · {usd(series.pack_price_usd ?? 0)}</button> : <a className="btn" href="#packs">See the packs</a>}
              <a className="btn line" href="#market">Or pick a rock</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
