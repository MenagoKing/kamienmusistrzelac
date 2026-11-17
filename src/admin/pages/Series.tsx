import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { BAND_NAME, BANDS, CATEGORY_NAME, TIER_NAME, TIER_NOTE, bandOf, type SeriesCheck } from '../../../shared/rules.ts';
import type { Band, Rules, Series, Tier } from '../../../shared/types.ts';
import { Badge, Card, Confirm, Empty, ErrorBox, Field, Loading, Modal, PageHead, go, money, pct1, short, useAction, useFetch, when } from '../ui';
import { Thumb, type SpecRow } from './Specimens';

type SeriesRow = Series & { sort: number };
const TIERS: Tier[] = ['earth', 'orbit', 'mars', 'launch'];

function Progress({ s }: { s: Series }) {
  const opened = s.opened.length;
  return (
    <div className="prog">
      <div className="bar">{BANDS.map(b => <i key={b} className={'b-' + b} style={{ width: (s.size ? (s.counts[b] - s.remaining[b]) / s.size * 100 : 0) + '%' }} />)}</div>
      <span className="mono dim">{opened}/{s.size}</span>
    </div>
  );
}

export function SeriesList() {
  const list = useFetch<SeriesRow[]>('/api/admin/series');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHead kicker="Packs" title="Series">
        <button className="ab primary" onClick={() => setCreating(true)}>+ New series</button>
      </PageHead>
      <p className="lede">A series is a sealed set of packs. Build its composition from the vault, check it against the band rules, then announce it or open sale. Once open, the composition is fixed and every draw is verifiable.</p>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>No series yet.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl hover">
            <thead><tr><th>Series</th><th>Tier</th><th className="r">Pack price</th><th>Status</th><th>Opened</th><th>Left by band</th><th>Published</th></tr></thead>
            <tbody>{list.data.map(s => (
              <tr key={s.id} onClick={() => go('#/series/' + s.id)}>
                <td><b>{s.name}</b> <span className="mono dim">{s.id}</span></td>
                <td>{TIER_NAME[s.tier]}</td>
                <td className="r mono">{money(s.pack_price_usd)}</td>
                <td><Badge v={s.status} /></td>
                <td><Progress s={s} /></td>
                <td className="mono dim">{BANDS.map(b => `${BAND_NAME[b]} ${s.remaining[b]}`).join(' · ')}</td>
                <td className="dim">{when(s.composition_published_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {creating && <SeriesForm onClose={() => setCreating(false)} />}
    </>
  );
}

function SeriesForm({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: '', tier: 'earth' as Tier, size: 100, pack_price_usd: 96, note: '' });
  const { busy, run } = useAction();
  const save = async () => {
    const r = await run(() => api<{ series: Series }>('POST', '/api/admin/series', f), 'Series created');
    if (r) go('#/series/' + r.series.id);
  };
  return (
    <Modal title="New series" onClose={onClose} footer={<><button className="ab ghost" onClick={onClose}>Cancel</button><button className="ab primary" onClick={save} disabled={busy}>Create draft</button></>}>
      <div className="form-grid">
        <Field label="Name" span={2}><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Series 003" autoFocus /></Field>
        <Field label="Tier"><select value={f.tier} onChange={e => setF({ ...f, tier: e.target.value as Tier })}>{TIERS.map(t => <option key={t} value={t}>{TIER_NAME[t]}</option>)}</select></Field>
        <Field label="Packs"><input type="number" value={f.size} onChange={e => setF({ ...f, size: Number(e.target.value) })} /></Field>
        <Field label="Pack price, USD"><input type="number" value={f.pack_price_usd} onChange={e => setF({ ...f, pack_price_usd: Number(e.target.value) })} /></Field>
        <Field label="Note on the site" span={3} hint={TIER_NOTE[f.tier]}><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="Opens when 002 sells out" /></Field>
      </div>
    </Modal>
  );
}

interface Detail {
  series: SeriesRow & { server_seed: string | null };
  slots: { idx: number; band: Band; opened: boolean; added_at: number; specimen: SpecRow; vault_value_usd: number }[];
  check: SeriesCheck;
  pulls: any[];
  revenue: number;
}

export function SeriesPage({ id }: { id: string }) {
  const d = useFetch<Detail>('/api/admin/series/' + id);
  const rules = useFetch<Rules>('/api/admin/settings');
  const { busy, run } = useAction();
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState<null | 'open' | 'close' | 'clear'>(null);
  const [edit, setEdit] = useState<Partial<SeriesRow> | null>(null);
  const [tab, setTab] = useState<'composition' | 'draws'>('composition');

  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data || !rules.data) return <Loading />;
  const { series: s, slots, check } = d.data;
  const editable = s.status === 'draft' || s.status === 'upcoming';
  const post = async (path: string, msg: string, body: unknown = {}) => { const r = await run(() => api<Detail>('POST', `/api/admin/series/${s.id}/${path}`, body), msg); if (r && (r as any).deleted) go('#/series'); else if (r) d.setData(r); };
  const want = (b: Band) => Math.round(rules.data!.bands[b].count * s.size / rules.data!.series_size);
  const left = s.remaining.floor + s.remaining.par + s.remaining.hit;

  return (
    <>
      <PageHead kicker={<a href="#/series">← Series</a>} title={<>{s.name} <Badge v={s.status} /></>}>
        {editable && <button className="ab ghost" onClick={() => setEdit({ name: s.name, tier: s.tier, size: s.size, pack_price_usd: s.pack_price_usd, note: s.note, sort: s.sort })}>Edit details</button>}
        {s.status === 'draft' && <button className="ab ghost" onClick={() => post('announce', 'Announced on the site')} disabled={busy}>Announce</button>}
        {s.status === 'upcoming' && <button className="ab ghost" onClick={() => post('draft', 'Back to draft')} disabled={busy}>Unannounce</button>}
        {editable && <button className="ab primary" onClick={() => setConfirm('open')} disabled={busy || check.errors.length > 0} title={check.errors.join(' ')}>Open sale</button>}
        {(s.status === 'open' || s.status === 'sold_out' || editable) && <button className="ab danger ghost" onClick={() => setConfirm('close')} disabled={busy}>{editable && s.opened.length === 0 ? 'Delete' : 'Close series'}</button>}
      </PageHead>

      <div className="stats4">
        <div className="stat"><span className="mono">Tier · pack price</span><b>{money(s.pack_price_usd)}</b><small>{TIER_NAME[s.tier]} · {s.size} packs</small></div>
        <div className="stat"><span className="mono">Expected value</span><b>{pct1(check.ev)}</b><small>Target {Math.round(rules.data.ev_target * 100)}% · vault total {money(check.total_vault)}</small></div>
        <div className="stat"><span className="mono">Opened</span><b>{s.opened.length}</b><small>{left} sealed · revenue {money(d.data.revenue)}</small></div>
        <div className="stat"><span className="mono">Draw commitment</span><b className="mono small">{short(s.commit_hash)}</b><small>{s.server_seed ? 'Seed revealed' : 'Seed revealed at sell-out'}</small></div>
      </div>

      <div className="grid2">
        <Card title="Composition check">
          <div className="bands-check">
            {BANDS.map(b => (
              <div key={b} className={check.counts[b] === want(b) ? 'ok' : 'off'}>
                <span className="mono"><i className={'b-' + b} />{BAND_NAME[b]}</span>
                <b>{check.counts[b]}<small>/{want(b)}</small></b>
                <small className="dim">{Math.round(rules.data!.bands[b].min * 100)}{rules.data!.bands[b].max ? `–${Math.round(rules.data!.bands[b].max! * 100)}%` : '%+'} of {money(s.pack_price_usd)}</small>
              </div>
            ))}
          </div>
          {editable ? (
            check.errors.length || check.warnings.length ? (
              <ul className="issues">
                {check.errors.map(e => <li key={e} className="e">{e}</li>)}
                {check.warnings.map(w => <li key={w} className="w">{w}</li>)}
              </ul>
            ) : <p className="good">Ready to open. The composition matches the band rules.</p>
          ) : <p className="dim">Composition published {when(s.composition_published_at)} and fixed.</p>}
        </Card>
        <Card title="Live odds" actions={<span className="mono dim">what is still sealed</span>}>
          <div className="odds-a">
            {BANDS.map(b => <div key={b}><span className="mono"><i className={'b-' + b} />{BAND_NAME[b]}</span><b>{s.remaining[b]}</b><small className="mono dim">{left ? pct1(s.remaining[b] / left) : '—'}</small></div>)}
          </div>
          <p className="mono dim">{s.left_by_class.map(c => `${c.left} ${c.label}`).join(' · ') || 'Nothing sealed'}</p>
        </Card>
      </div>

      <div className="seg-row">
        <div className="seg"><button className={tab === 'composition' ? 'on' : ''} onClick={() => setTab('composition')}>Composition · {slots.length}</button><button className={tab === 'draws' ? 'on' : ''} onClick={() => setTab('draws')}>Draws · {d.data.pulls.length}</button></div>
        {tab === 'composition' && editable && (
          <div className="ph-acts">
            <button className="ab ghost" onClick={() => post('autofill', 'Filled from the vault')} disabled={busy}>Autofill from vault</button>
            <button className="ab ghost" onClick={() => setPicker(true)} disabled={busy}>+ Add specimens</button>
            {slots.length > 0 && <button className="ab ghost danger" onClick={() => setConfirm('clear')} disabled={busy}>Clear</button>}
          </div>
        )}
      </div>

      {tab === 'composition' ? (
        slots.length === 0 ? <Empty>No specimens yet. Use “Autofill from vault” to fill the bands, or add specimens by hand.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>#</th><th>Specimen</th><th>Class</th><th className="r">Vault value</th><th className="r">× pack</th><th>Band</th><th>State</th><th /></tr></thead>
              <tbody>{slots.map(x => (
                <tr key={x.idx} className={x.opened ? 'dimrow' : ''}>
                  <td className="mono dim">{x.idx + 1}</td>
                  <td><div className="who"><Thumb s={x.specimen} size={36} /><div><b>{x.specimen.name}</b><small className="mono">{x.specimen.id}</small></div></div></td>
                  <td className="dim">{x.specimen.class}</td>
                  <td className="r mono">{money(x.vault_value_usd)}</td>
                  <td className="r mono">{s.pack_price_usd ? (x.vault_value_usd / s.pack_price_usd).toFixed(2) : '—'}</td>
                  <td><Badge v={x.band} /></td>
                  <td>{x.opened ? <Badge v="held">opened</Badge> : x.added_at > 0 ? <Badge v="unlocked">added at #{x.added_at}</Badge> : <Badge v="series">sealed</Badge>}</td>
                  <td className="r">{editable && <button className="ab ghost sm" onClick={async () => { const r = await run(() => api<Detail>('DELETE', `/api/admin/series/${s.id}/slots/${x.idx}`), 'Removed'); if (r) d.setData(r); }}>Remove</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )
      ) : (
        d.data.pulls.length === 0 ? <Empty>No packs opened yet.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>#</th><th>Collector</th><th>Specimen</th><th>Band</th><th className="r">Sealed / pick</th><th>Client seed</th><th className="r">When</th></tr></thead>
              <tbody>{d.data.pulls.map(p => (
                <tr key={p.id}><td className="mono">{p.bonus ? 'bonus' : p.nonce + 1}</td><td className="mono"><a href={'#/wallets/' + p.wallet}>{short(p.wallet)}</a></td><td className="mono">{p.specimen_id}</td><td><Badge v={p.band} /></td><td className="r mono">{p.pool ?? '—'} / {p.pick ?? '—'}</td><td className="mono dim">{p.client_seed}</td><td className="r dim">{when(p.created_at)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )
      )}

      {picker && <Picker series={s} rules={rules.data} onClose={() => setPicker(false)} onAdd={async ids => { const r = await run(() => api<Detail>('POST', `/api/admin/series/${s.id}/slots`, { specimen_ids: ids }), `${ids.length} added`); if (r) { d.setData(r); setPicker(false); } }} />}
      {confirm === 'open' && <Confirm title={`Open ${s.name}?`} body={<><p>The composition is published and fixed. Collectors can open packs right away{s.drop_id ? ' (while the launch drop is open)' : ''}.</p><p className="mono dim">Commitment {s.commit_hash}</p></>} cta="Open sale" onClose={() => setConfirm(null)} onConfirm={() => post('open', 'Sale is open')} />}
      {confirm === 'close' && <Confirm danger title={editable && s.opened.length === 0 ? `Delete ${s.name}?` : `Close ${s.name}?`} body={editable && s.opened.length === 0 ? <p>The draft is removed and its specimens go back to the vault.</p> : <p>No more packs can be opened. The seed is revealed and every sealed specimen goes back to the vault.</p>} cta={editable && s.opened.length === 0 ? 'Delete' : 'Close series'} onClose={() => setConfirm(null)} onConfirm={() => post('close', 'Done')} />}
      {confirm === 'clear' && <Confirm danger title="Clear the composition?" body={<p>All {slots.length} specimens go back to the vault.</p>} cta="Clear" onClose={() => setConfirm(null)} onConfirm={() => post('clear', 'Cleared')} />}
      {edit && (
        <Modal title="Series details" onClose={() => setEdit(null)} footer={<><button className="ab ghost" onClick={() => setEdit(null)}>Cancel</button><button className="ab primary" disabled={busy} onClick={async () => { const r = await run(() => api<Detail>('PUT', '/api/admin/series/' + s.id, edit), 'Saved'); if (r) { d.setData(r); setEdit(null); } }}>Save</button></>}>
          <div className="form-grid">
            <Field label="Name" span={2}><input value={edit.name ?? ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Tier"><select value={edit.tier} onChange={e => setEdit({ ...edit, tier: e.target.value as Tier })}>{TIERS.map(t => <option key={t} value={t}>{TIER_NAME[t]}</option>)}</select></Field>
            <Field label="Packs"><input type="number" value={edit.size ?? ''} onChange={e => setEdit({ ...edit, size: Number(e.target.value) })} /></Field>
            <Field label="Pack price, USD" hint="Bands are recomputed"><input type="number" value={edit.pack_price_usd ?? ''} onChange={e => setEdit({ ...edit, pack_price_usd: Number(e.target.value) })} /></Field>
            <Field label="Order on the site"><input type="number" value={edit.sort ?? 0} onChange={e => setEdit({ ...edit, sort: Number(e.target.value) })} /></Field>
            <Field label="Note on the site" span={3}><input value={edit.note ?? ''} onChange={e => setEdit({ ...edit, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Pick free vault specimens; shows the band each one would land in at this pack price. */
export function Picker({ series, rules, onClose, onAdd, title = 'Add specimens from the vault', filterBand = true }: { series: { pack_price_usd: number | null; tier?: Tier } | null; rules: Rules; onClose: () => void; onAdd: (ids: string[]) => void; title?: string; filterBand?: boolean }) {
  const list = useFetch<SpecRow[]>('/api/admin/specimens?state=vault');
  const [q, setQ] = useState('');
  const [band, setBand] = useState<'' | Band>('');
  const [sel, setSel] = useState<string[]>([]);
  const rows = useMemo(() => (list.data ?? []).filter(s => s.file_complete && (!q || (s.name + s.id + s.class).toLowerCase().includes(q.toLowerCase()))).map(s => ({ s, b: series?.pack_price_usd && s.vault_value_usd ? bandOf(s.vault_value_usd, series.pack_price_usd, rules) : null })).filter(x => !band || x.b === band), [list.data, q, band, series, rules]);
  const toggle = (id: string) => setSel(x => (x.includes(id) ? x.filter(y => y !== id) : [...x, id]));
  return (
    <Modal wide title={title} onClose={onClose} footer={<><span className="mono dim grow">{sel.length} selected</span><button className="ab ghost" onClick={onClose}>Cancel</button><button className="ab primary" disabled={!sel.length} onClick={() => onAdd(sel)}>Add {sel.length || ''}</button></>}>
      <div className="filters">
        <input className="srch" type="search" placeholder="Search the free vault" value={q} onChange={e => setQ(e.target.value)} autoFocus />
        {filterBand && series?.pack_price_usd && <select value={band} onChange={e => setBand(e.target.value as Band | '')}><option value="">Every band</option>{BANDS.map(b => <option key={b} value={b}>{BAND_NAME[b]}</option>)}</select>}
      </div>
      {!list.data ? <Loading /> : rows.length === 0 ? <Empty>No free specimen with a complete file{band ? ' in this band' : ''}. Add or complete specimens first.</Empty> : (
        <div className="pick">
          {rows.map(({ s, b }) => (
            <label key={s.id} className={'pk-row' + (sel.includes(s.id) ? ' on' : '')}>
              <input type="checkbox" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} />
              <Thumb s={s} size={36} />
              <span className="grow"><b>{s.name}</b><small className="mono dim">{s.id} · {CATEGORY_NAME[s.category]} · {s.class}</small></span>
              {s.sold_back && <Badge v="rolled">sold back</Badge>}
              <span className="mono">{money(s.vault_value_usd)}</span>
              {series?.pack_price_usd ? (b ? <Badge v={b} /> : <Badge v="cancelled">no band</Badge>) : null}
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
