import type { Rules, Specimen } from '../data';
import { marketPrice, mass, originLabel, usd } from '../lib/format';

/** §01 The market: one card per listed specimen, fixed price. */
export function Market({ market, rules, thumbs }: { market: Specimen[]; rules: Rules; thumbs: (string | undefined)[] }) {
  return (
    <section className="s wrap" id="market" aria-labelledby="h-market">
      <div className="intro rv">
        <div><div className="sec mono"><span>§01</span><span>The market</span></div><h2 id="h-market">Pick the rock. Pay the price.</h2></div>
        <p>Every specimen in the vault is listed on its own, at one fixed price set from its documented purchase price. No draw, no luck: you see the exact rock you buy, with its whole file.</p>
      </div>
      <div className="mkt rv" id="mkt">
        {market.map((p, i) => (
          <article className="lot" key={p.id}>
            <img alt={`${p.name}, ${p.class}`} width={420} height={311} src={thumbs[i]} />
            <div className="top mono"><span>{p.id}</span><span>{originLabel(p)}</span></div>
            <h3>{p.name}</h3>
            <div className="cl">{p.class} · {mass(p.mass_g)}</div>
            {p.vault_value_usd != null && (
              <div className="px"><b>{usd(marketPrice(p.vault_value_usd, rules))}</b><small className="mono">Vault value {usd(p.vault_value_usd)}</small></div>
            )}
            {/* TODO(api): link to the listing / checkout. Points to the waitlist for now. */}
            <a className="buy" href="#join">Buy {p.name}</a>
          </article>
        ))}
      </div>
      <div className="rule mono rv"><span>Fixed price per specimen</span><span>Full file on every listing</span><span>Minted to your wallet when you buy</span></div>
    </section>
  );
}
