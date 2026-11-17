import type { Specimen } from '../data';
import { useApp } from '../lib/store';
import { useStill } from '../lib/stills';
import { marketPrice, mass, originLabel, usd } from '../lib/format';

function Lot({ p, i }: { p: Specimen; i: number }) {
  const { data, withWallet } = useApp();
  const img = useStill(p.render, { w: 420, h: 311, rot: -2.2 + i * .17, scale: 1.25 }, p.photo);
  return (
    <article className="lot">
      <img alt={`${p.name}, ${p.class}`} width={420} height={311} src={img} />
      <div className="top mono"><span>{p.id}</span><span>{originLabel(p)}</span></div>
      <h3>{p.name}</h3>
      <div className="cl">{p.class} · {mass(p.mass_g)}</div>
      {p.vault_value_usd != null && (
        <div className="px"><b>{usd(marketPrice(p.vault_value_usd, data.rules))}</b><small className="mono">Vault value {usd(p.vault_value_usd)}</small></div>
      )}
      <button type="button" className="buy" onClick={() => withWallet({ kind: 'buy', specimen: p })}>Buy {p.name}</button>
    </article>
  );
}

/** §01 The market: one card per listed specimen, fixed price. */
export function Market() {
  const { data } = useApp();
  return (
    <section className="s wrap" id="market" aria-labelledby="h-market">
      <div className="intro rv">
        <div><div className="sec mono"><span>§01</span><span>The market</span></div><h2 id="h-market">Pick the rock. Pay the price.</h2></div>
        <p>Every specimen in the vault is listed on its own, at one fixed price set from its documented purchase price. No draw, no luck: you see the exact rock you buy, with its whole file.</p>
      </div>
      {data.market.length ? (
        <div className="mkt rv" id="mkt">
          {data.market.map((p, i) => <Lot key={p.id} p={p} i={i} />)}
        </div>
      ) : (
        <p className="mkt-empty rv">Everything listed has found a home. New specimens are being filed; the next listings appear here first.</p>
      )}
      <div className="rule mono rv"><span>Fixed price per specimen</span><span>Full file on every listing</span><span>Minted to your wallet when you buy</span></div>
    </section>
  );
}
