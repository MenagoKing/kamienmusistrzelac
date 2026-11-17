import { useState } from 'react';
import { api } from '../../lib/api';
import type { Redemption } from '../../../shared/types.ts';
import { Badge, Confirm, Drawer, Empty, ErrorBox, Field, Loading, PageHead, Segmented, money, short, useAction, useFetch, when } from '../ui';

type Filter = '' | 'requested' | 'packing' | 'shipped' | 'delivered' | 'cancelled';
const regionName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => d.of(c) ?? c; } catch { return (c: string) => c; } })();

export function Redemptions() {
  const [f, setF] = useState<Filter>('requested');
  const list = useFetch<Redemption[]>('/api/admin/redemptions' + (f ? '?status=' + f : ''));
  const [open, setOpen] = useState<Redemption | null>(null);
  return (
    <>
      <PageHead kicker="Operations" title="Redemptions" />
      <p className="lede">A collector burned the NFT and asked for the rock. Pack the sealed capsule, ship it insured, add the tracking number.</p>
      <div className="seg-row">
        <Segmented<Filter> value={f} onChange={setF} options={[['requested', 'To pack'], ['packing', 'Packing'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['', 'All']]} />
      </div>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>Nothing here.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl hover">
            <thead><tr><th>Specimen</th><th>Ship to</th><th>Collector</th><th className="r">Fee</th><th>Status</th><th>Tracking</th><th className="r">Requested</th></tr></thead>
            <tbody>{list.data.map(r => (
              <tr key={r.id} onClick={() => setOpen(r)}>
                <td><b>{r.specimen_name}</b> <span className="mono dim">{r.specimen_id}</span></td>
                <td>{r.name}<br /><small className="dim">{r.address.city}, {regionName(r.address.country)}</small></td>
                <td className="mono">{short(r.wallet)}</td>
                <td className="r mono">{money(r.fee_usd)}</td>
                <td><Badge v={r.status} /></td>
                <td className="mono dim">{r.tracking || '—'}</td>
                <td className="r dim">{when(r.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {open && <RedemptionDrawer r={open} onClose={() => setOpen(null)} onChanged={() => { list.reload(); setOpen(null); }} />}
    </>
  );
}

function RedemptionDrawer({ r, onClose, onChanged }: { r: Redemption; onClose: () => void; onChanged: () => void }) {
  const [tracking, setTracking] = useState(r.tracking);
  const [cancel, setCancel] = useState(false);
  const { busy, run } = useAction();
  const set = async (status: Redemption['status'], msg: string) => { const x = await run(() => api('PUT', '/api/admin/redemptions/' + r.id, { status, tracking }), msg); if (x) onChanged(); };
  const finished = r.status === 'delivered' || r.status === 'cancelled';
  const a = r.address;
  const label = [r.name, a.line1, a.line2, `${a.postal} ${a.city}`, regionName(a.country)].filter(Boolean).join('\n');
  return (
    <Drawer title={<>Ship {r.specimen_name} <span className="mono dim">{r.specimen_id}</span></>} onClose={onClose} footer={!finished && <>
      <button className="ab danger ghost" onClick={() => setCancel(true)} disabled={busy}>Cancel and refund</button>
      <span className="grow" />
      {r.status === 'requested' && <button className="ab ghost" onClick={() => set('packing', 'Marked as packing')} disabled={busy}>Start packing</button>}
      {(r.status === 'requested' || r.status === 'packing') && <button className="ab primary" onClick={() => set('shipped', 'Marked as shipped')} disabled={busy || !tracking.trim()}>Mark shipped</button>}
      {r.status === 'shipped' && <button className="ab primary" onClick={() => set('delivered', 'Delivered')} disabled={busy}>Mark delivered</button>}
    </>}>
      <div className="ed-status"><Badge v={r.status} /><span className="dim">Requested {when(r.created_at)} · updated {when(r.updated_at)}</span></div>
      <div className="addr-card">
        <pre>{label}</pre>
        <button className="ab ghost sm" onClick={() => navigator.clipboard?.writeText(label)}>Copy label</button>
      </div>
      <dl className="dl">
        <dt>Email</dt><dd><a href={'mailto:' + a.email}>{a.email}</a></dd>
        {a.phone && <><dt>Phone</dt><dd>{a.phone}</dd></>}
        <dt>Collector wallet</dt><dd className="mono">{r.wallet}</dd>
        <dt>Fee paid</dt><dd className="mono">{money(r.fee_usd)}</dd>
      </dl>
      {!finished && <Field label="Tracking number" hint="Required to mark it shipped. The collector sees it in their vault."><input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="1Z…" /></Field>}
      {finished && r.tracking && <p className="mono">Tracking {r.tracking}</p>}
      {cancel && <Confirm danger title="Cancel this redemption?" body={<p>The NFT is minted back to the collector and the {money(r.fee_usd)} fee is refunded in USDC.</p>} cta="Cancel and refund" onClose={() => setCancel(false)} onConfirm={() => set('cancelled', 'Cancelled and refunded')} />}
    </Drawer>
  );
}
