import type { Rules, Specimen } from '../data';
import { mass, originLabel, statusPill, whereLabel } from '../lib/format';

/** §04 The vault: public register and the eight items of a specimen file. */
export function Vault({ register, rules, thumbs }: { register: Specimen[]; rules: Rules; thumbs: (string | undefined)[] }) {
  return (
    <section className="s wrap" id="vault" aria-labelledby="h-vault">
      <div className="intro rv">
        <div><div className="sec mono"><span>§04</span><span>The vault</span></div><h2 id="h-vault">Every rock, on the record.</h2></div>
        <p>Nothing is listed or sealed into a series without a complete file. The public vault page shows every specimen and where it is right now: on the market, in a series, with a collector, or redeemed and shipped.</p>
      </div>
      <table className="reg rv" id="reg">
        <thead><tr><th>Specimen</th><th>Class</th><th>Mass</th><th>Origin</th><th>Where</th><th>Status</th></tr></thead>
        <tbody>
          {register.map((r, i) => {
            const [cls, label] = statusPill(r.status);
            return (
              <tr key={r.id}>
                <td><div className="sp"><img alt={r.name} width={64} height={64} src={thumbs[i]} /><div><b>{r.name}</b><small className="mono">{r.id}</small></div></div></td>
                <td className="m c3">{r.class}</td>
                <td className="m c4">{mass(r.mass_g)}</td>
                <td className="m c5">{originLabel(r)}</td>
                <td className="m">{whereLabel(r, rules)}</td>
                <td className="c6"><span className={`st ${cls}`}>{label}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ol className="file rv">
        <li><b className="mono">01</b><span>Official name and classification, listed in the Meteoritical Bulletin</span></li>
        <li><b className="mono">02</b><span>Weighed on a calibrated scale, on video</span></li>
        <li><b className="mono">03</b><span>Macro photos and a full 360° turn</span></li>
        <li><b className="mono">04</b><span>Certificate of authenticity</span></li>
        <li><b className="mono">05</b><span>Provenance and export papers, origin checked before purchase</span></li>
        <li><b className="mono">06</b><span>Purchase invoice, which sets the vault value</span></li>
        <li><b className="mono">07</b><span>Sealed in a tamper-evident capsule with a QR and NFC tag</span></li>
        <li><b className="mono">08</b><span>Minted on Solana with the whole file attached</span></li>
      </ol>
      <p className="warn rv">A dealer’s certificate alone isn’t proof: the seller certifies its own product. Every specimen needs its official name and classification before it can be listed or sealed into a series.</p>
    </section>
  );
}
