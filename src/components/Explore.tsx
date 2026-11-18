import { useEffect, useState } from 'react';
import { getProof, getRegister, type SeriesProof, type Specimen } from '../data';
import { useApp } from '../lib/store';
import { useStill } from '../lib/stills';
import { mass, originLabel, statusPill, usd, whereLabel } from '../lib/format';
import { BAND_NAME } from '../../shared/rules.ts';
import { FILE_ITEMS } from '../../shared/types.ts';
import { verifySeries, type VerifyResult } from '../../shared/fair.ts';
import { Overlay, Spinner } from './Overlay';

const FILTERS: [string, string][] = [['', 'All'], ['market', 'Market'], ['series', 'In a series'], ['held', 'Reserved'], ['locked', 'Launch drop'], ['vault', 'Off the market'], ['redeemed', 'Redeemed']];

function Row({ s }: { s: Specimen }) {
  const { data } = useApp();
  const [openRow, setOpen] = useState(false);
  const img = useStill(s.render, { w: 128, h: 128, rot: -2, scale: 1.45 }, s.photo);
  const [cls, label] = statusPill(s.status);
  const done = s.file_done ?? [];
  return (
    <>
      <tr className="clk" onClick={() => setOpen(!openRow)} aria-expanded={openRow}>
        <td><div className="sp"><img alt={s.name} width={64} height={64} src={img} /><div><b>{s.name}</b><small className="mono">{s.id}</small></div></div></td>
        <td className="m c3">{s.class}</td>
        <td className="m c4">{mass(s.mass_g)}</td>
        <td className="m c5">{originLabel(s)}</td>
        <td className="m">{whereLabel(s, data.rules)}</td>
        <td className="c6"><span className={`st ${cls}`}>{label}</span></td>
      </tr>
      {openRow && (
        <tr className="filerow"><td colSpan={6}>
          <ul className="chk cols">
            {FILE_ITEMS.map((f, i) => <li key={f.key} className={done[i] ? 'y' : ''}>{f.label}</li>)}
            <li className={done[7] ? 'y' : ''}>Minted on Solana{s.mint ? ` · ${s.mint.slice(0, 4)}…${s.mint.slice(-4)}` : ''}</li>
          </ul>
          {s.vault_value_usd != null && <p className="mono fine">{s.sourced ? 'Dealer price' : 'Rock value'} {usd(s.sourced ? s.source_price_usd ?? s.vault_value_usd : s.vault_value_usd)} (documented price)</p>}
        </td></tr>
      )}
    </>
  );
}

/** The public register: every specimen and where it is right now. */
export function RegisterDialog() {
  const { data } = useApp();
  const [q, setQ] = useState('');
  const [f, setF] = useState('');
  const [rows, setRows] = useState<Specimen[] | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => getRegister(q, f).then(r => { if (alive) setRows(r); }).catch(() => setRows([])), 180);
    return () => { alive = false; clearTimeout(t); };
  }, [q, f]);
  return (
    <Overlay wide label="The specimen register" title={<><div className="sec mono"><span>§04</span><span>The register</span></div><h3>Every rock, on the record.</h3></>}>
      <div className="rbar">
        <input type="search" placeholder="Search name, class or SR number" value={q} onChange={e => setQ(e.target.value)} aria-label="Search the register" data-autofocus />
        <div className="chips">{FILTERS.map(([k, l]) => <button key={k} type="button" className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
      </div>
      {rows == null ? <p className="empty"><Spinner label="Loading" /></p> : rows.length ? (
        <table className="reg in-dlg">
          <thead><tr><th>Specimen</th><th>Class</th><th>Mass</th><th>Origin</th><th>Where</th><th>Status</th></tr></thead>
          <tbody>{rows.map(s => <Row key={s.id} s={s} />)}</tbody>
        </table>
      ) : <p className="empty">No specimen matches.</p>}
      <p className="fine">{data.register_total} specimens on record. Click a row for its file.</p>
    </Overlay>
  );
}

/** Proof of a series' draws: the commitment, the revealed seed and an in-browser replay. */
export function ProofDialog({ seriesId, name }: { seriesId: string; name: string }) {
  const [p, setP] = useState<SeriesProof | null>(null);
  const [v, setV] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getProof(seriesId).then(setP).catch(() => undefined); }, [seriesId]);
  const run = async () => { if (!p) return; setBusy(true); setV(await verifySeries(p)); setBusy(false); };
  return (
    <Overlay wide label={`Draw proof, ${name}`} title={<><div className="sec mono"><span>Verifiable draw</span><span>{name}</span></div><h3>Check every pack that was opened.</h3></>}>
      <p className="dlg-p">Before sale opens we publish a hash of a secret seed. Each pack is drawn with HMAC-SHA256(seed, series : pull number : your seed) from the packs still sealed. The seed is revealed when the series sells out or closes, so anyone can replay every draw.</p>
      {!p ? <p className="empty"><Spinner label="Loading" /></p> : (
        <>
          <dl className="kv proof">
            <dt>Commitment, SHA-256</dt><dd><code>{p.commit_hash}</code></dd>
            <dt>Seed</dt><dd>{p.server_seed ? <code>{p.server_seed}</code> : 'Revealed at sell-out'}</dd>
            <dt>Packs in the series</dt><dd>{p.slots.length}</dd>
            <dt>Packs opened</dt><dd>{p.pulls.length}</dd>
          </dl>
          {p.server_seed ? (
            <div className="acts"><button className="btn" type="button" onClick={run} disabled={busy}>{busy ? <><Spinner label="Checking" />Replaying…</> : 'Replay every draw in this browser'}</button></div>
          ) : null}
          {v && <p className={v.ok ? 'ok' : 'err'} role="status">{v.ok ? `All ${v.checked} draws match the published commitment.` : v.problems.slice(0, 3).join(' ')}</p>}
          <table className="ptab mono">
            <thead><tr><th>#</th><th>Wallet</th><th>Sealed</th><th>Pick</th><th>Pack</th><th>Band</th></tr></thead>
            <tbody>{[...p.pulls].reverse().slice(0, 40).map(x => (
              <tr key={x.nonce}><td>{x.nonce + 1}</td><td>{x.wallet}</td><td>{x.pool}</td><td>{x.pick}</td><td>{x.slot}</td><td><i className={'c-' + x.band} />{BAND_NAME[x.band]}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
    </Overlay>
  );
}
