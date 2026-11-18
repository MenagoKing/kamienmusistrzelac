// Addendum 1 admin: dealers (who holds the market specimens), their offers imported from CSV, and
// the escrow register. Escrow is read-only here by design: no admin action moves escrow money.
import { useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Card, Drawer, Empty, ErrorBox, Field, Loading, Modal, PageHead, Stat, Toggle, go, money, money0, short, useAction, useFetch, when } from '../ui';

export interface Dealer {
  id: string; name: string; country: string; region: string; ship_domestic_usd: number; ship_region_usd: number; ship_world_usd: number;
  insurance_pct: number; contact: string; notes: string; api_kind: string; active: number; created_at: string; offers?: number; reserved?: number;
}

const regionName = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => d.of(c) ?? c; } catch { return (c: string) => c; } })();

export function Dealers() {
  const list = useFetch<Dealer[]>('/api/admin/dealers');
  const [open, setOpen] = useState<Dealer | 'new' | null>(null);
  const [importing, setImporting] = useState<Dealer | null>(null);
  const rows = list.data ?? [];
  return (
    <>
      <PageHead kicker="Inventory" title="Dealers">
        <button className="ab primary" onClick={() => setOpen('new')}>+ New dealer</button>
      </PageHead>
      <p className="lede">Market specimens stay with these independent dealers. A purchase reserves the specimen and holds its price in escrow; we buy it from the dealer only when the holder redeems, and the dealer ships it directly. Dealers are never named on the site before redemption.</p>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : rows.length === 0 ? <Empty>No dealers yet. Add the first one, then import its offers.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl hover">
            <thead><tr><th>Dealer</th><th>Country</th><th className="r">Shipping home / region / world</th><th className="r">Insurance</th><th className="r">On the market</th><th className="r">Reserved</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map(d => (
              <tr key={d.id} onClick={() => setOpen(d)}>
                <td><b>{d.name}</b><br /><small className="mono dim">{d.id} · {d.api_kind === 'manual' ? 'manual price checks' : d.api_kind}</small></td>
                <td>{regionName(d.country)} <span className="mono dim">{d.region}</span></td>
                <td className="r mono">{money0(d.ship_domestic_usd)} / {money0(d.ship_region_usd)} / {money0(d.ship_world_usd)}</td>
                <td className="r mono">{(d.insurance_pct * 100).toFixed(1)}%</td>
                <td className="r mono">{d.offers ?? 0}</td>
                <td className="r mono">{d.reserved ?? 0}</td>
                <td>{d.active ? <Badge v="active" /> : <Badge v="closed">paused</Badge>}</td>
                <td className="r"><button className="ab ghost sm" onClick={e => { e.stopPropagation(); setImporting(d); }}>Import offers</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Card title="How a dealer order works">
        <ol className="steps-a">
          <li><b>Reserve.</b> A collector pays the list price (dealer price + commission). The dealer price is checked again at checkout; if it changed, the collector sees the new price first.</li>
          <li><b>Hold.</b> The rock price sits in escrow tied to the NFT. Cancel refunds it; the commission is kept.</li>
          <li><b>Sold at source.</b> If the dealer sells it elsewhere, open the specimen and press <i>Sold at source</i>. The holder picks a replacement at the same or lower price, or takes a full refund.</li>
          <li><b>Redeem.</b> The holder sees shipping and any price change, burns the NFT, the escrow is released. The order shows under Redemptions with a 48-hour deadline: order from the dealer, add the order number, then the tracking.</li>
        </ol>
      </Card>
      {open && <DealerDrawer d={open === 'new' ? null : open} onClose={() => setOpen(null)} onSaved={() => { list.reload(); setOpen(null); }} />}
      {importing && <ImportModal d={importing} onClose={() => setImporting(null)} onDone={() => list.reload()} />}
    </>
  );
}

const blank: Partial<Dealer> = { name: '', country: '', ship_domestic_usd: 15, ship_region_usd: 28, ship_world_usd: 45, insurance_pct: 0.015, contact: '', notes: '', active: 1 };

function DealerDrawer({ d, onClose, onSaved }: { d: Dealer | null; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<Partial<Dealer>>(() => d ?? blank);
  const { busy, run } = useAction();
  const set = (k: keyof Dealer, v: unknown) => setS(x => ({ ...x, [k]: v }));
  const save = async () => {
    const body = { ...s, active: !!s.active };
    const r = await run(() => d ? api('PUT', '/api/admin/dealers/' + d.id, body) : api('POST', '/api/admin/dealers', body), d ? 'Dealer saved' : 'Dealer added');
    if (r) onSaved();
  };
  return (
    <Drawer title={d ? <>{d.name} <span className="mono dim">{d.id}</span></> : 'New dealer'} onClose={onClose} footer={<>
      {d && <button className="ab ghost" onClick={() => go('#/specimens')}>See specimens</button>}
      <span className="grow" />
      <button className="ab primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : d ? 'Save changes' : 'Add dealer'}</button>
    </>}>
      <div className="form-grid">
        <Field label="Name" span={2} hint="Internal; collectors see it only after they redeem"><input value={s.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="Atlas Meteorites" /></Field>
        <Field label="Country" hint="Two-letter code; sets the shipping region"><input value={s.country ?? ''} maxLength={2} onChange={e => set('country', e.target.value.toUpperCase())} placeholder="MA" /></Field>
        <Field label="Shipping, same country, USD"><input type="number" step="0.5" value={s.ship_domestic_usd ?? ''} onChange={e => set('ship_domestic_usd', Number(e.target.value))} /></Field>
        <Field label="Shipping, same region, USD"><input type="number" step="0.5" value={s.ship_region_usd ?? ''} onChange={e => set('ship_region_usd', Number(e.target.value))} /></Field>
        <Field label="Shipping, worldwide, USD"><input type="number" step="0.5" value={s.ship_world_usd ?? ''} onChange={e => set('ship_world_usd', Number(e.target.value))} /></Field>
        <Field label="Insurance, % of rock price"><input type="number" step="0.1" value={Math.round((s.insurance_pct ?? 0) * 1000) / 10} onChange={e => set('insurance_pct', Number(e.target.value) / 100)} /></Field>
        <Field label="Contact" span={2} hint="Email, phone or shop link for placing orders"><input value={s.contact ?? ''} onChange={e => set('contact', e.target.value)} placeholder="orders@…" /></Field>
        <Field label="Notes" span={3}><textarea rows={3} value={s.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Terms, lead time, payment method" /></Field>
      </div>
      <div className="tgls"><Toggle checked={!!s.active} onChange={v => set('active', v ? 1 : 0)} label="Active" hint="Paused dealers keep their reservations; new imports are still allowed." /></div>
      <p className="dim small">Price and availability are checked by hand for now (no dealer API). Use “Sold at source” and “Mark verified” on each specimen.</p>
    </Drawer>
  );
}

const SAMPLE = 'name,class,category,mass_g,dealer_price_usd,origin,fall,dealer_sku,dealer_url,metbull,photos\nNWA 869,"Ordinary chondrite, L3-6",stone,12.4,38,Morocco,find,ATL-869-12,https://example.com/p/869,https://www.lpi.usra.edu/meteor/metbull.php?code=17521,';

function ImportModal({ d, onClose, onDone }: { d: Dealer; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [res, setRes] = useState<{ created: string[]; errors: string[] } | null>(null);
  const { busy, run } = useAction();
  const go2 = async () => {
    const r = await run(() => api<{ created: string[]; errors: string[] }>('POST', `/api/admin/dealers/${d.id}/import`, { csv }), 'Import finished');
    if (r) { setRes(r); onDone(); }
  };
  return (
    <Modal wide title={`Import offers from ${d.name}`} onClose={onClose} footer={<>
      <span className="grow" />
      {res ? <button className="ab primary" onClick={() => { onClose(); go('#/specimens'); }}>Open specimens</button> : <button className="ab primary" disabled={busy || !csv.trim()} onClick={go2}>{busy ? 'Importing…' : 'Import'}</button>}
    </>}>
      {res ? (
        <>
          <p><b>{res.created.length}</b> specimens created as drafts{res.created.length ? `: ${res.created.slice(0, 8).join(', ')}${res.created.length > 8 ? '…' : ''}` : ''}.</p>
          <p className="dim small">Complete each file in the specimen editor (certificate, weigh-in video, papers…) and list it on the market.</p>
          {res.errors.length > 0 && <div className="a-err"><b>{res.errors.length} lines skipped</b><ul>{res.errors.slice(0, 12).map(e => <li key={e}>{e}</li>)}</ul></div>}
        </>
      ) : (
        <>
          <p className="dim small">Paste CSV with a header row. Required: <code>name, class, category, mass_g, dealer_price_usd</code>. Optional: <code>origin, fall, dealer_sku, dealer_url, vault_id, metbull, photos</code> (photo links separated by <code>|</code>). Category is one of stone, iron, pallasite, lunar, martian.</p>
          <textarea className="csvbox mono" rows={12} value={csv} onChange={e => setCsv(e.target.value)} placeholder={SAMPLE} />
          <div className="row-a">
            <button className="ab ghost sm" onClick={() => setCsv(SAMPLE)}>Paste an example</button>
            <label className="ab ghost sm">Load a .csv file<input type="file" accept=".csv,text/csv" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); e.target.value = ''; }} /></label>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ---------- escrow (read-only) ---------- */

interface EscrowRow { id: string; reservation_id: string; specimen_id: string; specimen_name: string; holder: string; amount_usd: number; status: 'locked' | 'refunded' | 'released'; status_res: string; created_at: string; closed_at: string | null }

export function Escrow() {
  const d = useFetch<{ locked: number; released: number; refunded: number; count_locked: number; rows: EscrowRow[] }>('/api/admin/escrow');
  const [open, setOpen] = useState<EscrowRow | null>(null);
  const [f, setF] = useState<'' | 'locked' | 'released' | 'refunded'>('locked');
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data) return <Loading />;
  const rows = d.data.rows.filter(r => !f || r.status === f);
  return (
    <>
      <PageHead kicker="Operations" title="Escrow"><button className="ab ghost" onClick={d.reload}>Refresh</button></PageHead>
      <p className="lede">Every market reservation holds the rock’s price here, tied to its NFT. Read-only: money leaves an escrow only by the holder’s own action (cancel, refund, a lower price) or after the holder burns the NFT to redeem, when it is released to the operations wallet to buy the rock.</p>
      <div className="stats4">
        <Stat label="Locked now" value={money0(d.data.locked)} hint={`${d.data.count_locked} reservations`} tone="hot" />
        <Stat label="Released to buy rocks" value={money0(d.data.released)} hint="After the NFT was burned" />
        <Stat label="Refunded to holders" value={money0(d.data.refunded)} hint="Cancels, sold at source, price drops" />
        <Stat label="Custody" value="In app" hint="On-chain escrow program: pending decision" />
      </div>
      <div className="seg-row">
        {(['locked', 'released', 'refunded', ''] as const).map(k => <button key={k} className={'ab sm ' + (f === k ? 'primary' : 'ghost')} onClick={() => setF(k)}>{k || 'All'}</button>)}
      </div>
      {rows.length === 0 ? <Empty>Nothing here.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl hover">
            <thead><tr><th>Specimen</th><th>Holder</th><th className="r">In escrow</th><th>Escrow</th><th>Reservation</th><th className="r">Opened</th><th className="r">Closed</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id} onClick={() => setOpen(r)}>
                <td><b>{r.specimen_name}</b> <span className="mono dim">{r.specimen_id}</span></td>
                <td className="mono">{short(r.holder)}</td>
                <td className="r mono">{money(r.amount_usd)}</td>
                <td><Badge v={'esc_' + r.status}>{r.status}</Badge></td>
                <td><Badge v={r.status_res ?? 'closed'} /></td>
                <td className="r dim">{when(r.created_at)}</td>
                <td className="r dim">{when(r.closed_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {open && <EscrowDrawer r={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function EscrowDrawer({ r, onClose }: { r: EscrowRow; onClose: () => void }) {
  const ev = useFetch<any[]>('/api/admin/escrow/' + r.id + '/events');
  return (
    <Drawer title={<>Escrow · {r.specimen_name} <span className="mono dim">{r.id}</span></>} onClose={onClose}>
      <div className="ed-status"><Badge v={'esc_' + r.status}>{r.status}</Badge><span className="dim">{money(r.amount_usd)} · reservation {r.reservation_id}</span></div>
      <dl className="dl">
        <dt>Holder</dt><dd className="mono">{r.holder}</dd>
        <dt>Specimen</dt><dd><a href={'#/specimens/' + r.specimen_id}>{r.specimen_id}</a></dd>
        <dt>Opened</dt><dd>{when(r.created_at)}</dd>
        {r.closed_at && <><dt>Closed</dt><dd>{when(r.closed_at)}</dd></>}
      </dl>
      <h3 className="ed-h">Events</h3>
      {!ev.data ? <Loading /> : (
        <table className="tbl compact">
          <tbody>{ev.data.map(e => <tr key={e.id}><td><Badge v={'esc_' + e.kind}>{e.kind}</Badge></td><td className="r mono">{money(e.amount_usd)}</td><td className="mono dim">{e.to_party === 'ops' || e.to_party === 'escrow' ? e.to_party : short(e.to_party)}</td><td className="dim small">{e.note}</td><td className="r dim">{when(e.created_at)}</td></tr>)}</tbody>
        </table>
      )}
      <p className="dim small">No admin action can move escrow money.</p>
    </Drawer>
  );
}
