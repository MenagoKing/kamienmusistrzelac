import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Badge, Drawer, Empty, ErrorBox, Loading, PageHead, Segmented, downloadCsv, go, money, short, useFetch, useToast, when } from '../ui';
import type { SpecRow } from './Specimens';
import { Thumb } from './Specimens';

const KINDS: [string, string][] = [['', 'All'], ['pack', 'Packs'], ['market_buy', 'Market'], ['secondary_sale', 'Collector sales'], ['seller_payout', 'Seller payouts'], ['buyback', 'Buybacks'], ['redemption_fee', 'Redemptions'], ['raffle', 'Raffles'], ['redemption_refund', 'Refunds']];

export function Orders() {
  const [kind, setKind] = useState('');
  const list = useFetch<any[]>('/api/admin/ledger?kind=' + kind);
  const total = (list.data ?? []).reduce((a, r) => a + r.usd, 0);
  return (
    <>
      <PageHead kicker="Operations" title="Orders & ledger">
        <button className="ab ghost" onClick={() => downloadCsv(`ledger-${kind || 'all'}.csv`, list.data ?? [])} disabled={!list.data?.length}>Export CSV</button>
      </PageHead>
      <p className="lede">Every payment in and out, with its transaction. Pack sales carry their split: inventory, $ROCKS buyback reserve, launch reserve, ops.</p>
      <div className="seg-row"><Segmented value={kind} onChange={setKind} options={KINDS} /><span className="mono dim">{list.data?.length ?? 0} rows · net {money(total)}</span></div>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>No entries.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Kind</th><th>Collector</th><th>Specimen</th><th>Series</th><th className="r">USD</th><th className="r">Paid</th><th>Split</th><th>Tx</th></tr></thead>
            <tbody>{list.data.map(r => {
              const sp = JSON.parse(r.split || '{}');
              return (
                <tr key={r.id}>
                  <td className="dim">{when(r.created_at)}</td>
                  <td><Badge v={r.kind} /></td>
                  <td className="mono">{r.wallet ? <a href={'#/wallets/' + r.wallet}>{short(r.wallet)}</a> : '—'}</td>
                  <td className="mono">{r.specimen_id ? <a href={'#/specimens/' + r.specimen_id}>{r.specimen_id}</a> : '—'}</td>
                  <td className="mono">{r.series_id ?? '—'}</td>
                  <td className={'r mono' + (r.usd < 0 ? ' neg' : '')}>{money(r.usd)}</td>
                  <td className="r mono dim">{r.currency === 'SOL' ? r.amount + ' SOL' : money(r.amount)}</td>
                  <td className="mono dim small">{r.kind === 'pack' ? `inv ${money(sp.inventory)} · burn ${money(sp.rocks_buyback)} · res ${money(sp.launch_reserve)} · ops ${money(sp.ops)}` : sp.margin != null ? `margin ${money(sp.margin)}` : sp.royalty != null ? `royalty ${money(sp.royalty)}` : ''}</td>
                  <td className="mono dim" title={r.tx}>{short(r.tx)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function Wallets({ openId }: { openId?: string }) {
  const list = useFetch<any[]>('/api/admin/wallets');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(openId ?? null);
  useEffect(() => { setOpen(openId ?? null); }, [openId]);
  const rows = (list.data ?? []).filter(w => !q || (w.address + ' ' + (w.username ?? '') + ' ' + (w.email ?? '')).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHead kicker="Operations" title="Collectors" />
      <div className="filters"><input className="srch" type="search" placeholder="Search callsign, email or address" value={q} onChange={e => setQ(e.target.value)} /><span className="mono dim fcount">{rows.length} wallets</span></div>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : rows.length === 0 ? <Empty>No collectors yet.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl hover">
            <thead><tr><th>Collector</th><th>Kind</th><th>Solana wallet</th><th className="r">Holdings</th><th className="r">Packs opened</th><th className="r">Spent</th><th className="r">Last seen</th></tr></thead>
            <tbody>{rows.map(w => (
              <tr key={w.address} onClick={() => go('#/wallets/' + w.address)}>
                <td>{w.username ? <><b>{w.username}</b><br /><small className="mono dim">{w.email ?? short(w.address)}</small></> : <span className="mono">{w.address}</span>}</td><td><Badge v={w.kind} /></td><td className="mono dim">{w.sol_wallet ? short(w.sol_wallet) : w.kind === 'sample' ? '—' : short(w.address)}</td><td className="r mono">{w.holdings}</td><td className="r mono">{w.pulls}</td><td className="r mono">{money(w.spent)}</td><td className="r dim">{when(w.last_seen)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {open && <WalletDrawer address={open} onClose={() => go('#/wallets')} />}
    </>
  );
}

function WalletDrawer({ address, onClose }: { address: string; onClose: () => void }) {
  const d = useFetch<{ wallet: any; holdings: SpecRow[]; ledger: any[] }>('/api/admin/wallets/' + address);
  return (
    <Drawer wide title={d.data?.wallet.username ?? <span className="mono">{short(address)}</span>} onClose={onClose}>
      {d.error ? <ErrorBox error={d.error} /> : !d.data ? <Loading /> : (
        <>
          <div className="ed-status"><Badge v={d.data.wallet.kind} /><span className="mono dim">{address}</span>{d.data.wallet.email && <span className="dim">{d.data.wallet.email}</span>}{d.data.wallet.linked_wallet && <span className="mono dim">linked {short(d.data.wallet.linked_wallet)}</span>}</div>
          {d.data.wallet.sol_wallet && <p className="dim small">Solana wallet <a className="mono" href={'https://explorer.solana.com/address/' + d.data.wallet.sol_wallet + '?cluster=devnet'} target="_blank" rel="noreferrer">{d.data.wallet.sol_wallet}</a> · created with the account, key kept encrypted on the server{d.data.wallet.key_exported_at ? ' · key exported ' + when(d.data.wallet.key_exported_at) : ''}</p>}
          <h3 className="ed-h">Holdings · {d.data.holdings.length}</h3>
          {d.data.holdings.length === 0 ? <p className="dim">None.</p> : (
            <table className="tbl compact hover"><tbody>{d.data.holdings.map(s => (
              <tr key={s.id} onClick={() => go('#/specimens/' + s.id)}><td><div className="who"><Thumb s={s} size={32} /><div><b>{s.name}</b><small className="mono">{s.id}</small></div></div></td><td><Badge v={s.state} /></td><td className="r mono">{money(s.vault_value_usd)}</td></tr>
            ))}</tbody></table>
          )}
          <h3 className="ed-h">Ledger · {d.data.ledger.length}</h3>
          <table className="tbl compact"><tbody>{d.data.ledger.map(r => (
            <tr key={r.id}><td><Badge v={r.kind} /></td><td className="mono">{r.specimen_id ?? '—'}</td><td className={'r mono' + (r.usd < 0 ? ' neg' : '')}>{money(r.usd)}</td><td className="r dim">{when(r.created_at)}</td></tr>
          ))}</tbody></table>
        </>
      )}
    </Drawer>
  );
}

export function Waitlist() {
  const list = useFetch<{ email: string; created_at: string }[]>('/api/admin/waitlist');
  const [copied, setCopied] = useState(false);
  return (
    <>
      <PageHead kicker="Audience" title="Waitlist">
        <button className="ab ghost" disabled={!list.data?.length} onClick={() => { navigator.clipboard?.writeText((list.data ?? []).map(x => x.email).join(', ')); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy emails'}</button>
        <button className="ab ghost" disabled={!list.data?.length} onClick={() => downloadCsv('waitlist.csv', list.data ?? [])}>Export CSV</button>
      </PageHead>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>No sign-ups yet. The form at the bottom of the site feeds this list.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Email</th><th className="r">Joined</th></tr></thead><tbody>{list.data.map(w => <tr key={w.email}><td>{w.email}</td><td className="r dim">{when(w.created_at)}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}

export function AuditLog() {
  const list = useFetch<any[]>('/api/admin/audit');
  return (
    <>
      <PageHead kicker="System" title="Audit log" />
      <p className="lede">Every change made in this panel, newest first.</p>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>No changes recorded yet.</Empty> : (
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>When</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>{list.data.map(a => (
          <tr key={a.id}><td className="dim">{when(a.created_at)}</td><td className="mono">{a.action}</td><td className="mono">{a.target}</td><td className="mono dim small trunc">{a.detail === '{}' ? '' : a.detail}</td></tr>
        ))}</tbody></table></div>
      )}
    </>
  );
}

export function Listings() {
  const [status, setStatus] = useState('active');
  const list = useFetch<any[]>('/api/admin/listings?status=' + status);
  const [busy, setBusy] = useState('');
  const toast = useToast();
  const cancel = async (id: string) => {
    if (!confirm('Take this listing down? The collector keeps the specimen.')) return;
    setBusy(id);
    try { await api('POST', `/api/admin/listings/${id}/cancel`, {}); toast('Listing taken down'); list.reload(); } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  return (
    <>
      <PageHead kicker="Operations" title="Collector listings" />
      <p className="lede">Specimens collectors put up for sale to each other. The buyer pays the price, the seller gets it minus the royalty, the royalty goes to inventory. Take down anything that breaks the rules.</p>
      <div className="seg-row"><Segmented value={status} onChange={setStatus} options={[['active', 'Active'], ['sold', 'Sold'], ['cancelled', 'Cancelled'], ['', 'All']]} /><span className="mono dim">{list.data?.length ?? 0} listings</span></div>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>No listings here.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Specimen</th><th>Seller</th><th className="r">Price</th><th>Status</th><th>Buyer</th><th className="r">Listed</th><th /></tr></thead>
            <tbody>{list.data.map(l => (
              <tr key={l.id}>
                <td><b>{l.specimen_name}</b> <a className="mono" href={'#/specimens/' + l.specimen_id}>{l.specimen_id}</a></td>
                <td><a href={'#/wallets/' + l.seller}>{l.seller_name}</a></td>
                <td className="r mono">{money(l.price_usd)}</td>
                <td><Badge v={l.status} /></td>
                <td>{l.buyer ? <a href={'#/wallets/' + l.buyer}>{l.buyer_name}</a> : '—'}</td>
                <td className="r dim">{when(l.created_at)}</td>
                <td className="r">{l.status === 'active' && <button className="ab danger ghost sm" disabled={busy === l.id} onClick={() => cancel(l.id)}>Take down</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
