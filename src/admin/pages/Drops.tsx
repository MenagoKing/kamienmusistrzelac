import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { CATEGORY_NAME } from '../../../shared/rules.ts';
import type { DropEventKind, LaunchDrop, Rules, Series } from '../../../shared/types.ts';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, go, money, short, useAction, useFetch, when } from '../ui';
import { Picker } from './Series';

type DropRowT = LaunchDrop & { series: Series | null };

const toLocal = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function Countdown({ to }: { to: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  const s = (Date.parse(to) - Date.now()) / 1000;
  if (s <= 0) return <span>passed</span>;
  return <span>{Math.floor(s / 86400)}d {Math.floor(s / 3600) % 24}h {Math.floor(s / 60) % 60}m</span>;
}

export function DropsList() {
  const list = useFetch<DropRowT[]>('/api/admin/drops');
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHead kicker="Launch drops" title="Drops">
        <button className="ab primary" onClick={() => setCreating(true)}>+ Schedule a drop</button>
      </PageHead>
      <p className="lede">Each launch opens a limited pool 24 hours before T-0. Lock rare specimens in Batch A (unlocks into the pool on booster catch) and Batch B (raffled to everyone who opened a pack, on ship catch). A scrub or miss rolls them over to the next drop.</p>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>No drops scheduled.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl hover">
            <thead><tr><th>Drop</th><th>Status</th><th>T-0</th><th>Opens</th><th>Pool</th><th>Locked</th><th>Events</th></tr></thead>
            <tbody>{list.data.map(d => (
              <tr key={d.id} onClick={() => go('#/drops/' + d.id)}>
                <td><b>{d.name}</b> <span className="mono dim">{d.id}</span></td>
                <td><Badge v={d.status} /></td>
                <td>{when(d.t0)}</td>
                <td className="dim">{d.status === 'scheduled' ? <Countdown to={d.opens_at} /> : when(d.opens_at)}</td>
                <td className="mono">{d.series ? `${d.series.opened.length}/${d.series.size} · ${money(d.series.pack_price_usd)}` : '—'}</td>
                <td className="mono">{d.locked.filter(l => l.state === 'locked').length} locked</td>
                <td>{d.events.map(e => <Badge key={e.id} v={e.kind === 'scrub' || e.kind === 'fail' ? 'rolled' : 'unlocked'}>{e.kind.replace('_', ' ')}</Badge>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {creating && <DropForm onClose={() => setCreating(false)} />}
    </>
  );
}

function DropForm({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: '', t0: toLocal(new Date(Date.now() + 3 * 86400000).toISOString()), pack_price_usd: 120, size: 20 });
  const { busy, run } = useAction();
  const save = async () => {
    const r = await run(() => api<{ drop: LaunchDrop }>('POST', '/api/admin/drops', { ...f, t0: new Date(f.t0).toISOString() }), 'Drop scheduled');
    if (r) go('#/drops/' + r.drop.id);
  };
  return (
    <Modal title="Schedule a launch drop" onClose={onClose} footer={<><button className="ab ghost" onClick={onClose}>Cancel</button><button className="ab primary" disabled={busy} onClick={save}>Schedule</button></>}>
      <div className="form-grid">
        <Field label="Name" span={3}><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Launch drop 02" autoFocus /></Field>
        <Field label="T-0, your local time" span={3} hint="The drop opens 24 h before. Launch dates move: you can change it later."><input type="datetime-local" value={f.t0} onChange={e => setF({ ...f, t0: e.target.value })} /></Field>
        <Field label="Pool pack price, USD"><input type="number" value={f.pack_price_usd} onChange={e => setF({ ...f, pack_price_usd: Number(e.target.value) })} /></Field>
        <Field label="Pool packs"><input type="number" value={f.size} onChange={e => setF({ ...f, size: Number(e.target.value) })} /></Field>
      </div>
      <p className="dim small">Specimens rolled over from a scrubbed or missed drop join this one automatically.</p>
    </Modal>
  );
}

interface DropDetail {
  drop: LaunchDrop & { server_seed: string | null; commit_hash: string };
  series: { series: Series; slots: unknown[]; check: { errors: string[] } } | null;
  participants: { wallet: string; n: number }[];
  bonus: any[];
  result?: Record<string, unknown>;
}

const EVENTS: { kind: DropEventKind; label: string; effect: string; tone: string }[] = [
  { kind: 'liftoff', label: 'Liftoff', effect: 'Logged in the public record. Packs keep opening through the flight.', tone: 'ghost' },
  { kind: 'booster_catch', label: 'Booster catch', effect: 'Batch A unlocks: its specimens join the drop pool as new sealed packs.', tone: 'ghost' },
  { kind: 'ship_catch', label: 'Ship catch', effect: 'Batch B is raffled as bonus pulls to everyone who opened a pack in this drop. The drop closes.', tone: 'primary' },
  { kind: 'scrub', label: 'Scrub', effect: 'Every locked specimen rolls over to the next drop. The drop closes and its pool returns to the vault.', tone: 'danger ghost' },
  { kind: 'fail', label: 'Catch failed', effect: 'Every locked specimen rolls over to the next drop. The drop closes and its pool returns to the vault.', tone: 'danger ghost' },
];

export function DropPage({ id }: { id: string }) {
  const d = useFetch<DropDetail>('/api/admin/drops/' + id);
  const rules = useFetch<Rules>('/api/admin/settings');
  const { busy, run } = useAction();
  const [lockBatch, setLockBatch] = useState<'A' | 'B' | null>(null);
  const [ev, setEv] = useState<typeof EVENTS[number] | null>(null);
  const [t0, setT0] = useState<string | null>(null);
  const [pool, setPool] = useState(false);

  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data || !rules.data) return <Loading />;
  const { drop, series } = d.data;
  const done = new Set(drop.events.map(e => e.kind));
  const closed = drop.status === 'closed';

  return (
    <>
      <PageHead kicker={<a href="#/drops">← Drops</a>} title={<>{drop.name} <Badge v={drop.status} /></>}>
        {!closed && <button className="ab ghost" onClick={() => setT0(toLocal(drop.t0))}>Move T-0</button>}
      </PageHead>

      <div className="stats4">
        <div className="stat"><span className="mono">T-0</span><b className="small">{when(drop.t0)}</b><small>{closed ? 'Resolved' : <>in <Countdown to={drop.t0} /></>}</small></div>
        <div className="stat"><span className="mono">Opens (T-24h)</span><b className="small">{when(drop.opens_at)}</b><small>{drop.status === 'scheduled' ? <>in <Countdown to={drop.opens_at} /></> : drop.status}</small></div>
        <div className="stat"><span className="mono">Pool</span><b>{series ? `${series.series.opened.length}/${series.series.size}` : '—'}</b><small>{series ? `${money(series.series.pack_price_usd)} a pack · ${series.series.status}` : 'No pool yet'}</small></div>
        <div className="stat"><span className="mono">Participants</span><b>{d.data.participants.length}</b><small>eligible for the Batch B raffle</small></div>
      </div>

      <div className="grid2">
        <Card title="Locked batches" actions={!closed && <><button className="ab ghost sm" onClick={() => setLockBatch('A')}>+ Batch A</button><button className="ab ghost sm" onClick={() => setLockBatch('B')}>+ Batch B</button></>}>
          {drop.locked.length === 0 ? <p className="dim">Nothing locked yet. Rare lunar and Martian specimens make the drop.</p> : (
            <table className="tbl compact">
              <tbody>{drop.locked.map(l => (
                <tr key={l.id}>
                  <td><Badge v={l.batch === 'A' ? 'series' : 'locked'}>Batch {l.batch}</Badge></td>
                  <td><b>{l.name}</b> <span className="mono dim">{l.id}</span><br /><small className="dim">{CATEGORY_NAME[l.render.type]} · {l.class}</small></td>
                  <td><Badge v={l.state} /></td>
                  <td className="r">{l.state === 'locked' && !closed && <button className="ab ghost sm" onClick={async () => { const r = await run(() => api<DropDetail>('DELETE', `/api/admin/drops/${id}/locks/${l.id}`), 'Back in the vault'); if (r) d.setData(r); }}>Unlock</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {drop.rolled_over_from && <p className="dim small">Includes specimens rolled over from {drop.rolled_over_from}.</p>}
        </Card>

        <Card title="Drop pool" actions={series ? <a className="ab ghost sm" href={'#/series/' + series.series.id}>Manage pool →</a> : !closed && <button className="ab ghost sm" onClick={() => setPool(true)}>Create pool</button>}>
          {series ? (
            <>
              <p><Badge v={series.series.status} /> <span className="mono dim">{series.series.id} · {series.slots.length} specimens</span></p>
              {series.series.status === 'draft' && <p className="dim">Fill the pool and open sale before T-24h so the drop can open on time.{series.check.errors.length ? ' ' + series.check.errors[0] : ''}</p>}
              {series.series.status === 'open' && <p className="dim">Collectors can open drop packs while the drop is open (from T-24h until it resolves).</p>}
            </>
          ) : <p className="dim">A drop needs its own pool of packs.</p>}
          <p className="mono dim small">Raffle commitment {short(drop.commit_hash)}{drop.server_seed ? ` · seed ${short(drop.server_seed)}` : ''}</p>
        </Card>
      </div>

      <Card title="Resolve the flight" actions={<span className="mono dim">multisig · every event needs the official source</span>}>
        <div className="evbtns">
          {EVENTS.map(e => (
            <button key={e.kind} className={'ab ' + e.tone} disabled={closed || done.has(e.kind) || busy} onClick={() => setEv(e)}>{done.has(e.kind) ? '✓ ' : ''}{e.label}</button>
          ))}
        </div>
        {drop.events.length > 0 ? (
          <table className="tbl compact">
            <thead><tr><th>Event</th><th>Source</th><th>Note</th><th>By</th><th className="r">When</th></tr></thead>
            <tbody>{drop.events.map(e => <tr key={e.id}><td><Badge v={e.kind === 'scrub' || e.kind === 'fail' ? 'rolled' : 'unlocked'}>{e.kind.replace('_', ' ')}</Badge></td><td><a href={e.source_url} target="_blank" rel="noreferrer">{e.source_url.replace(/^https:\/\//, '').slice(0, 40)}</a></td><td className="dim">{e.note || '—'}</td><td className="mono dim">{e.actor}</td><td className="r dim">{when(e.created_at)}</td></tr>)}</tbody>
          </table>
        ) : <p className="dim">No events recorded. The public log on the site shows each one with its source.</p>}
        {d.data.bonus.length > 0 && <p className="good">Raffled: {d.data.bonus.map(b => `${b.specimen_id} → ${short(b.wallet)}`).join(', ')}</p>}
      </Card>

      {lockBatch && <Picker series={series ? series.series : null} rules={rules.data} filterBand={false} title={`Lock specimens in Batch ${lockBatch}`} onClose={() => setLockBatch(null)} onAdd={async ids => { const r = await run(() => api<DropDetail>('POST', `/api/admin/drops/${id}/locks`, { specimen_ids: ids, batch: lockBatch }), `Locked in Batch ${lockBatch}`); if (r) { d.setData(r); setLockBatch(null); } }} />}
      {ev && <EventModal ev={ev} onClose={() => setEv(null)} onDone={r => { d.setData(r); setEv(null); }} id={id} />}
      {t0 && (
        <Modal title="Move T-0" onClose={() => setT0(null)} footer={<><button className="ab ghost" onClick={() => setT0(null)}>Cancel</button><button className="ab primary" disabled={busy} onClick={async () => { const r = await run(() => api<DropDetail>('PUT', '/api/admin/drops/' + id, { t0: new Date(t0).toISOString() }), 'T-0 moved'); if (r) { d.setData(r); setT0(null); } }}>Save</button></>}>
          <Field label="New T-0, your local time" hint="The drop opens 24 h before; the site clock follows."><input type="datetime-local" value={t0} onChange={e => setT0(e.target.value)} /></Field>
        </Modal>
      )}
      {pool && <PoolModal id={id} onClose={() => setPool(false)} onDone={r => { d.setData(r); setPool(false); }} />}
    </>
  );
}

function EventModal({ ev, id, onClose, onDone }: { ev: typeof EVENTS[number]; id: string; onClose: () => void; onDone: (r: DropDetail) => void }) {
  const [src, setSrc] = useState('');
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  const go2 = async () => { const r = await run(() => api<DropDetail>('POST', `/api/admin/drops/${id}/events`, { kind: ev.kind, source_url: src, note }), `${ev.label} recorded`); if (r) onDone(r); };
  return (
    <Modal title={`Record: ${ev.label}`} onClose={onClose} footer={<><button className="ab ghost" onClick={onClose}>Cancel</button><button className={'ab ' + (ev.tone.includes('danger') ? 'danger' : 'primary')} disabled={busy || !/^https:\/\//.test(src)} onClick={go2}>{busy ? 'Recording…' : 'Record event'}</button></>}>
      <p className="a-copy">{ev.effect}</p>
      <div className="form-grid">
        <Field label="Official source link" span={3} hint="Required, https. Shown in the public log on the site."><input value={src} onChange={e => setSrc(e.target.value)} placeholder="https://…" autoFocus /></Field>
        <Field label="Note" span={3}><input value={note} onChange={e => setNote(e.target.value)} placeholder="Optional" /></Field>
      </div>
      <p className="dim small">This cannot be undone.</p>
    </Modal>
  );
}

function PoolModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: (r: DropDetail) => void }) {
  const [f, setF] = useState({ pack_price_usd: 120, size: 20 });
  const { busy, run } = useAction();
  return (
    <Modal title="Create the drop pool" onClose={onClose} footer={<><button className="ab ghost" onClick={onClose}>Cancel</button><button className="ab primary" disabled={busy} onClick={async () => { const r = await run(() => api<DropDetail>('POST', `/api/admin/drops/${id}/series`, f), 'Pool created'); if (r) onDone(r); }}>Create</button></>}>
      <div className="form-grid">
        <Field label="Pack price, USD"><input type="number" value={f.pack_price_usd} onChange={e => setF({ ...f, pack_price_usd: Number(e.target.value) })} /></Field>
        <Field label="Packs"><input type="number" value={f.size} onChange={e => setF({ ...f, size: Number(e.target.value) })} /></Field>
      </div>
    </Modal>
  );
}
