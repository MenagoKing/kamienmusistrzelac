import { useState } from 'react';
import { api } from '../../lib/api';
import type { Redemption } from '../../../shared/types.ts';
import { Badge, Confirm, Drawer, Empty, ErrorBox, Field, Loading, PageHead, Segmented, money, short, useAction, useFetch, when } from '../ui';

type Filter = '' | 'requested' | 'ordered' | 'packing' | 'shipped' | 'delivered' | 'cancelled';
type Row = Redemption & { dealer_sku?: string; dealer_url?: string; dealer_price_usd?: number | null };
const overdue = (r: Row) => r.kind === 'dealer' && r.status === 'requested' && !!r.due_at && new Date(r.due_at).getTime() < Date.now();
const regionName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => d.of(c) ?? c; } catch { return (c: string) => c; } })();

export function Redemptions() {
  const [f, setF] = useState<Filter>('requested');
  const list = useFetch<Row[]>('/api/admin/redemptions' + (f ? '?status=' + f : ''));
  const [open, setOpen] = useState<Row | null>(null);
  return (
    <>
      <PageHead kicker="Operations" title="Redemptions" />
      <p className="lede">A collector burned the NFT and asked for the rock. Dealer-sourced: order it from the dealer within 48 hours, add the order number, then the tracking. Own stock (pack pulls): pack the sealed capsule, ship it insured, add the tracking.</p>
      <div className="seg-row">
        <Segmented<Filter> value={f} onChange={setF} options={[['requested', 'To order / pack'], ['ordered', 'Ordered'], ['packing', 'Packing'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['', 'All']]} />
      </div>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>Nothing here.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl hover">
            <thead><tr><th>Specimen</th><th>Source</th><th>Ship to</th><th>Collector</th><th className="r">Fee</th><th>Status</th><th>Tracking</th><th className="r">Requested</th></tr></thead>
            <tbody>{list.data.map(r => (
              <tr key={r.id} onClick={() => setOpen(r)}>
                <td><b>{r.specimen_name}</b> <span className="mono dim">{r.specimen_id}</span></td>
                <td>{r.kind === 'dealer' ? <><span className="small">{r.dealer_name ?? 'Dealer'}</span>{r.status === 'requested' && r.due_at && <><br /><small className={overdue(r) ? 'late-t' : 'dim'}>{overdue(r) ? 'Overdue · ' : 'Order by '}{when(r.due_at)}</small></>}</> : <span className="dim small">Own stock</span>}</td>
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

function RedemptionDrawer({ r, onClose, onChanged }: { r: Row; onClose: () => void; onChanged: () => void }) {
  const [tracking, setTracking] = useState(r.tracking);
  const [ref, setRef] = useState(r.dealer_order_ref ?? '');
  const dealer = r.kind === 'dealer';
  const [cancel, setCancel] = useState(false);
  const { busy, run } = useAction();
  const set = async (status: Redemption['status'], msg: string) => { const x = await run(() => api('PUT', '/api/admin/redemptions/' + r.id, { status, tracking, dealer_order_ref: ref }), msg); if (x) onChanged(); };
  const finished = r.status === 'delivered' || r.status === 'cancelled';
  const a = r.address;
  const label = [r.name, a.line1, a.line2, `${a.postal} ${a.city}`, regionName(a.country)].filter(Boolean).join('\n');
  return (
    <Drawer title={<>Ship {r.specimen_name} <span className="mono dim">{r.specimen_id}</span></>} onClose={onClose} footer={!finished && <>
      <button className="ab danger ghost" onClick={() => setCancel(true)} disabled={busy}>Cancel and refund</button>
      <span className="grow" />
      {dealer && r.status === 'requested' && <button className="ab primary" onClick={() => set('ordered', 'Ordered from the dealer')} disabled={busy || !ref.trim()}>Mark ordered</button>}
      {!dealer && r.status === 'requested' && <button className="ab ghost" onClick={() => set('packing', 'Marked as packing')} disabled={busy}>Start packing</button>}
      {(r.status === 'ordered' || r.status === 'packing' || (!dealer && r.status === 'requested')) && <button className="ab primary" onClick={() => set('shipped', 'Marked as shipped')} disabled={busy || !tracking.trim()}>Mark shipped</button>}
      {r.status === 'shipped' && <button className="ab primary" onClick={() => set('delivered', 'Delivered')} disabled={busy}>Mark delivered</button>}
    </>}>
      <div className="ed-status"><Badge v={r.status} /><Badge v={dealer ? 'dealer' : 'own'}>{dealer ? 'dealer order' : 'own stock'}</Badge><span className="dim">Requested {when(r.created_at)} · updated {when(r.updated_at)}</span></div>
      {dealer && (
        <div className={'dealer-card' + (overdue(r) ? ' late' : '')}>
          <div><span className="mono dim">Order from</span><b>{r.dealer_name ?? 'Dealer'}</b></div>
          <dl className="dl">
            {r.dealer_sku && <><dt>Dealer SKU</dt><dd className="mono">{r.dealer_sku}</dd></>}
            {r.dealer_url && <><dt>Listing</dt><dd><a href={r.dealer_url} target="_blank" rel="noreferrer">{r.dealer_url}</a></dd></>}
            <dt>Dealer price now</dt><dd className="mono">{money(r.dealer_price_usd ?? null)}</dd>
            {r.price_delta_usd ? <><dt>Price change at redemption</dt><dd className="mono">{money(r.price_delta_usd)}</dd></> : null}
            <dt>Shipping + insurance charged</dt><dd className="mono">{money(r.shipping_usd ?? r.fee_usd)}</dd>
            {r.due_at && <><dt>Order by</dt><dd className={overdue(r) ? 'late-t' : ''}>{when(r.due_at)}{overdue(r) ? ' · overdue' : ''}</dd></>}
          </dl>
          <p className="dim small">The escrow was released to the operations wallet when the NFT was burned. Pay the dealer from there and have it ship directly to the address below.</p>
        </div>
      )}
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
      {!finished && dealer && <Field label="Dealer order number" hint="Required to mark it ordered"><input value={ref} onChange={e => setRef(e.target.value)} placeholder="Order #…" /></Field>}
      {finished && r.dealer_order_ref && <p className="mono">Dealer order {r.dealer_order_ref}</p>}
      {!finished && <Field label="Tracking number" hint="Required to mark it shipped. The collector sees it in their account."><input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="1Z…" /></Field>}
      {finished && r.tracking && <p className="mono">Tracking {r.tracking}</p>}
      {cancel && <Confirm danger title="Cancel this redemption?" body={dealer ? <p>The dealer could not fulfil it. Everything the collector paid (the reservation, any top-up and the {money(r.fee_usd)} shipping) is refunded in USDC from the operations wallet. The specimen goes back to the market if the dealer still has it.</p> : <p>The NFT is minted back to the collector and the {money(r.fee_usd)} fee is refunded in USDC.</p>} cta="Cancel and refund" onClose={() => setCancel(false)} onConfirm={() => set('cancelled', 'Cancelled and refunded')} />}
    </Drawer>
  );
}
