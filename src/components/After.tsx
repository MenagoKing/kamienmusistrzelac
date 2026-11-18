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
        <div><div className="sec mono"><span>§05</span><span>After you buy</span></div><h2 id="h-after">Reserved for you. Keep it, sell it, or ship it home.</h2></div>
        <p>A specific, documented rock is reserved for you the moment you pay, and its price is held in escrow. It stays reserved for you until you decide what happens next.</p>
      </div>
      <ul className="opts rv">
        <li><b className="mono">01</b><h3>Hold or sell</h3><p>The NFT carries the specimen’s full file. Keep it, or list it for collectors: the reservation and its escrow move with the NFT.</p></li>
        <li><b className="mono">02</b><h3>Cancel</h3><p>Changed your mind? Cancel and the rock’s price comes back in USDC from its escrow; the commission is kept. Pack pulls get an instant {pct(rules.buyback_share)}% offer instead.</p></li>
        <li><b className="mono">03</b><h3>Redeem</h3><p>See the shipping cost first. Burn the NFT, the escrow buys the rock from the dealer and it ships to you insured, ordered within 48 hours.</p></li>
        <li><b className="mono">04</b><h3>Share</h3><p>Every pull makes a card with the specimen, its band, class and weight, ready to post.</p></li>
      </ul>
      <div className="rvl rv">
        <div>
          <div className="sec mono"><span>The reveal</span>{reveal.pull_id && <span>Latest hit · Series {reveal.series_id}</span>}</div>
          <h2 style={{ fontSize: 'clamp(36px,3.6vw,56px)' }}>You see the offer before you decide.</h2>
          <p style={{ color: 'var(--soft)', fontSize: 17, maxWidth: '30em', margin: '18px 0 0' }}>The reveal shows the specimen, the band it landed in, its rock value against what you paid, and the instant buyback offer, side by side.</p>
        </div>
        <div className="reveal" aria-label={reveal.pull_id ? 'Latest hit' : 'Pack reveal, sample'}>
          <div className="ph"><img id="revimg" alt={`${sp.name}, ${sp.class}, ${mass(sp.mass_g)}`} src={image} /><span className="chip">{reveal.band.toUpperCase()} · {multiple(reveal.vault_value_usd, reveal.pack_price_usd)}×</span></div>
          <div className="bd">
            <h3>{sp.name}</h3>
            <div className="cl mono">{sp.class} · {mass(sp.mass_g)} · {sp.id}</div>
            <dl className="kv"><dt>Pack price</dt><dd>{usd(reveal.pack_price_usd)}</dd><dt>Rock value</dt><dd>{usd(reveal.vault_value_usd)}</dd><dt>Instant offer, {pct(rules.buyback_share)}%</dt><dd className="hot">{offer}</dd></dl>
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
