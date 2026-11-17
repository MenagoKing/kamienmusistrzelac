import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useStill } from '../../lib/stills';
import { CATEGORY_NAME, marketPrice } from '../../../shared/rules.ts';
import { FILE_ITEMS, type RockType, type Rules, type SpecimenAdmin, type SpecimenFile } from '../../../shared/types.ts';
import { Badge, Confirm, Drawer, Empty, ErrorBox, Field, Loading, PageHead, Toggle, go, money, short, useAction, useFetch, when } from '../ui';

export type SpecRow = SpecimenAdmin & { file_complete: boolean; photo: string | null };

const STATES = ['draft', 'vault', 'market', 'series', 'locked', 'held', 'redeeming', 'redeemed'];
const CATS: RockType[] = ['stone', 'iron', 'pallasite', 'lunar', 'martian'];

export function Thumb({ s, size = 44 }: { s: { category: RockType; render_seed: number; photo?: string | null }; size?: number }) {
  const url = useStill({ type: s.category, seed: s.render_seed }, { w: 96, h: 96, rot: -1.8, scale: 1.45 }, s.photo);
  return <span className="thumb" style={{ width: size, height: size }}>{url && <img src={url} alt="" />}</span>;
}

const fileCount = (f: SpecimenFile) => FILE_ITEMS.filter(i => (i.key === 'photos' ? (f.photos ?? []).length > 0 : !!(f[i.key] as string)?.trim())).length;

export function Specimens({ openId }: { openId?: string }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [cat, setCat] = useState('');
  const [soldBack, setSoldBack] = useState(false);
  const url = `/api/admin/specimens?q=${encodeURIComponent(q)}&state=${state}&category=${cat}${soldBack ? '&sold_back=1' : ''}`;
  const list = useFetch<SpecRow[]>(url);
  const rules = useFetch<Rules>('/api/admin/settings');
  const [editing, setEditing] = useState<SpecRow | 'new' | null>(null);

  useEffect(() => {
    if (!openId) return;
    if (openId === 'new') { setEditing('new'); return; }
    api<{ specimen: SpecRow }>('GET', '/api/admin/specimens/' + openId).then(r => setEditing(r.specimen)).catch(() => undefined);
  }, [openId]);

  const close = () => { setEditing(null); if (openId) go('#/specimens'); };
  const rows = list.data ?? [];
  const totals = useMemo(() => ({ n: rows.length, value: rows.reduce((a, r) => a + (r.vault_value_usd ?? 0), 0) }), [rows]);

  return (
    <>
      <PageHead kicker="Inventory" title="Specimens">
        <button className="ab primary" onClick={() => setEditing('new')}>+ New specimen</button>
      </PageHead>

      <div className="filters">
        <input className="srch" type="search" placeholder="Search name, class, SR number or owner" value={q} onChange={e => setQ(e.target.value)} />
        <select value={state} onChange={e => setState(e.target.value)} aria-label="Status"><option value="">All statuses</option>{STATES.map(s => <option key={s} value={s}>{s}</option>)}</select>
        <select value={cat} onChange={e => setCat(e.target.value)} aria-label="Category"><option value="">All classes</option>{CATS.map(c => <option key={c} value={c}>{CATEGORY_NAME[c]}</option>)}</select>
        <Toggle checked={soldBack} onChange={setSoldBack} label="Sold back" />
        <span className="mono dim fcount">{totals.n} · {money(totals.value)}</span>
      </div>

      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : rows.length === 0 ? <Empty>No specimen matches these filters.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl hover">
            <thead><tr><th>Specimen</th><th>Class</th><th className="r">Mass</th><th className="r">Vault value</th><th className="r">Market price</th><th>File</th><th>Status</th><th>Where / owner</th></tr></thead>
            <tbody>{rows.map(s => (
              <tr key={s.id} onClick={() => setEditing(s)}>
                <td><div className="who"><Thumb s={s} /><div><b>{s.name}</b><small className="mono">{s.id}</small></div></div></td>
                <td>{s.class}</td>
                <td className="r mono">{s.mass_g} g</td>
                <td className="r mono">{money(s.vault_value_usd)}</td>
                <td className="r mono dim">{s.vault_value_usd != null && rules.data ? money(marketPrice(s.vault_value_usd, rules.data)) : '—'}</td>
                <td><span className={'fileq' + (s.file_complete ? ' ok' : '')}>{fileCount(s.file)}/{FILE_ITEMS.length}</span></td>
                <td><Badge v={s.state} />{s.sold_back && <Badge v="rolled">sold back</Badge>}</td>
                <td className="mono dim">{s.state === 'series' ? 'Series ' + s.series_id : s.state === 'locked' ? s.drop_id : s.owner ? short(s.owner) : s.vault_id ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {editing && <Editor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} rules={rules.data} onClose={close} onSaved={() => list.reload()} />}
    </>
  );
}

const blank = (): Partial<SpecRow> => ({ name: '', class: '', category: 'stone', mass_g: 0, origin: '', fall: null, vault_value_usd: null, vault_id: '', notes: '', file: { photos: [] }, render_seed: Math.floor(Math.random() * 900) + 10 });

function Editor({ initial, rules, onClose, onSaved }: { initial: SpecRow | null; rules: Rules | null; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<Partial<SpecRow>>(() => initial ?? blank());
  const [cur, setCur] = useState<SpecRow | null>(initial);
  const [confirmDel, setConfirmDel] = useState(false);
  const { busy, run } = useAction();
  const set = (k: keyof SpecRow, v: unknown) => setS(x => ({ ...x, [k]: v }));
  const setFile = (k: keyof SpecimenFile, v: unknown) => setS(x => ({ ...x, file: { ...(x.file ?? {}), [k]: v } }));
  const history = useFetch<{ history: any[] }>(cur ? '/api/admin/specimens/' + cur.id : null, [cur?.updated_at]);
  const valueLocked = !!cur && ['series', 'locked', 'held', 'redeeming', 'redeemed'].includes(cur.state);

  const save = async () => {
    const body = { ...s, fall: s.fall === null || (s.fall as unknown) === '' ? null : s.fall };
    const r = await run(() => cur ? api<SpecRow>('PUT', '/api/admin/specimens/' + cur.id, body) : api<SpecRow>('POST', '/api/admin/specimens', body), cur ? 'Saved' : 'Specimen created');
    if (r) { setCur(r); setS(r); onSaved(); }
  };
  const act = async (path: string, msg: string, body: unknown = {}) => {
    const r = await run(() => api<SpecRow>('POST', `/api/admin/specimens/${cur!.id}/${path}`, body), msg);
    if (r) { setCur(r); setS(r); onSaved(); }
  };
  /** Photos save straight away on an existing specimen, so they show on the listing at once. */
  const setPhotos = async (photos: string[], msg: string) => {
    const next = { ...s, file: { ...(s.file ?? {}), photos } };
    setS(next);
    if (!cur) return;
    const r = await run(() => api<SpecRow>('PUT', '/api/admin/specimens/' + cur.id, { ...next, fall: next.fall ?? null }), msg);
    if (r) { setCur(r); setS(r); onSaved(); }
  };
  const upload = async (files: FileList | File[]) => {
    const urls: string[] = [];
    for (const f of Array.from(files).filter(f => f.type.startsWith('image/'))) {
      const data = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(f); });
      const r = await run(() => api<{ url: string }>('POST', '/api/admin/upload', { data }));
      if (r) urls.push(r.url);
    }
    if (urls.length) await setPhotos([...(s.file?.photos ?? []), ...urls], urls.length === 1 ? 'Photo added to the listing' : urls.length + ' photos added to the listing');
  };

  const file = s.file ?? {};
  const done = fileCount(file);
  return (
    <Drawer wide onClose={onClose} title={cur ? <>{cur.name} <span className="mono dim">{cur.id}</span></> : 'New specimen'} footer={<>
      {cur && ['draft', 'vault'].includes(cur.state) && <button className="ab danger ghost" onClick={() => setConfirmDel(true)} disabled={busy}>Delete</button>}
      <span className="grow" />
      {cur?.state === 'vault' && <button className="ab ghost" onClick={() => act('list', 'Listed on the market')} disabled={busy}>List on market</button>}
      {cur?.state === 'market' && <button className="ab ghost" onClick={() => act('unlist', 'Taken off the market')} disabled={busy}>Take off market</button>}
      <button className="ab primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : cur ? 'Save changes' : 'Create specimen'}</button>
    </>}>
      {cur && (
        <div className="ed-status">
          <Badge v={cur.state} />{cur.sold_back && <Badge v="rolled">sold back</Badge>}
          <span className="dim">{cur.state === 'draft' ? 'File incomplete: it cannot be listed or sealed until all seven items are on file.' : cur.state === 'vault' ? 'Ready: list it on the market, seal it into a series or lock it in a launch drop.' : cur.state === 'series' ? `Sealed in series ${cur.series_id}.` : cur.state === 'locked' ? `Locked in ${cur.drop_id}.` : cur.owner ? `Owner ${short(cur.owner)}${cur.mint ? ' · mint ' + short(cur.mint) : ''}` : ''}</span>
          <span className="grow" />
          <Toggle checked={(cur.featured ?? 0) > 0} onChange={v => act('feature', v ? 'Shown on the site register' : 'Hidden from the site register', { featured: v })} label="Feature on site" />
        </div>
      )}

      <div className="ed-grid">
        <div className="ed-prev">
          <PreviewStill category={(s.category ?? 'stone') as RockType} seed={Number(s.render_seed) || 1} photo={(file.photos ?? []).find(p => /^(\/uploads\/|https?:).*\.(png|jpe?g|webp|avif|gif)$/i.test(p)) ?? null} />
          <Field label="3D seed" hint="Shape of the generated image until real photos are on file"><input type="number" value={s.render_seed ?? ''} onChange={e => set('render_seed', e.target.value)} /></Field>
        </div>
        <div className="form-grid">
          <Field label="Official name" span={2}><input value={s.name ?? ''} onChange={e => set('name', e.target.value)} placeholder="Tissint" /></Field>
          <Field label="Category"><select value={s.category} onChange={e => set('category', e.target.value)}>{CATS.map(c => <option key={c} value={c}>{CATEGORY_NAME[c]}</option>)}</select></Field>
          <Field label="Classification" span={2} hint="As listed in the Meteoritical Bulletin"><input value={s.class ?? ''} onChange={e => set('class', e.target.value)} placeholder="Martian, shergottite" /></Field>
          <Field label="Mass, g"><input type="number" step="0.01" value={s.mass_g ?? ''} onChange={e => set('mass_g', e.target.value)} /></Field>
          <Field label="Origin country"><input value={s.origin ?? ''} onChange={e => set('origin', e.target.value)} placeholder="Morocco" /></Field>
          <Field label="Fall year or find" hint="Year of an observed fall, or “find”"><input value={s.fall ?? ''} onChange={e => set('fall', e.target.value === '' ? null : e.target.value === 'find' ? 'find' : e.target.value)} placeholder="2011 or find" /></Field>
          <Field label="Vault ID"><input value={s.vault_id ?? ''} onChange={e => set('vault_id', e.target.value)} placeholder="V1-A03" /></Field>
          <Field label="Vault value, USD" hint={valueLocked ? 'Fixed while sealed, locked or held' : rules && s.vault_value_usd ? `Market price ${money(marketPrice(Number(s.vault_value_usd), rules))} · buyback ${money(Number(s.vault_value_usd) * rules.buyback_share)}` : 'The documented purchase price (invoice)'}>
            <input type="number" step="0.01" value={s.vault_value_usd ?? ''} disabled={valueLocked} onChange={e => set('vault_value_usd', e.target.value === '' ? null : e.target.value)} />
          </Field>
        </div>
      </div>

      <h3 className="ed-h">Listing photos <span className="mono dim">{(file.photos ?? []).length} · shown on the market next to the 3D model</span></h3>
      <PhotoManager photos={file.photos ?? []} busy={busy} onUpload={upload} onChange={setPhotos} />

      <h3 className="ed-h">Specimen file <span className={'fileq' + (done === FILE_ITEMS.length ? ' ok' : '')}>{done}/{FILE_ITEMS.length}</span></h3>
      <div className="filelist">
        {FILE_ITEMS.map(f => f.key === 'photos' ? (
          <div key={f.key} className={'fi' + ((file.photos ?? []).length ? ' y' : '')}>
            <span className="mono">{f.label}</span>
            <span className="dim small">{(file.photos ?? []).length ? `${(file.photos ?? []).length} on file · managed under Listing photos above` : 'Add them under Listing photos above'}</span>
          </div>
        ) : (
          <label key={f.key} className={'fi' + ((file[f.key] as string)?.trim() ? ' y' : '')}>
            <span className="mono">{f.label}</span>
            <input value={(file[f.key] as string) ?? ''} onChange={e => setFile(f.key, e.target.value)} placeholder="Link or reference" />
          </label>
        ))}
      </div>

      <Field label="Internal notes"><textarea rows={3} value={s.notes ?? ''} onChange={e => set('notes', e.target.value)} placeholder="Supplier, condition, anything the team should know" /></Field>

      {cur && history.data && history.data.history.length > 0 && (
        <>
          <h3 className="ed-h">History</h3>
          <table className="tbl compact">
            <tbody>{history.data.history.map((h: any) => <tr key={h.id}><td><Badge v={h.kind} /></td><td className="mono">{short(h.wallet)}</td><td className="r mono">{money(h.usd)}</td><td className="r dim">{when(h.created_at)}</td></tr>)}</tbody>
          </table>
        </>
      )}

      {confirmDel && cur && <Confirm danger title={`Delete ${cur.name}?`} body={<p>{cur.id} is removed from the vault records. This cannot be undone.</p>} cta="Delete" onClose={() => setConfirmDel(false)} onConfirm={async () => { const r = await run(() => api('DELETE', '/api/admin/specimens/' + cur.id), 'Deleted'); if (r) { onSaved(); onClose(); } }} />}
    </Drawer>
  );
}

function PreviewStill({ category, seed, photo }: { category: RockType; seed: number; photo: string | null }) {
  const url = useStill({ type: category, seed }, { w: 320, h: 260, rot: -1.4, scale: 1.4 }, photo);
  return <div className="prev">{url ? <img src={url} alt="Preview" /> : <span className="a-spin" />}</div>;
}

const isImg = (p: string) => /^(\/uploads\/|https?:\/\/).*\.(png|jpe?g|webp|avif|gif)(\?.*)?$/i.test(p);

/** Drop or pick photos; the first image is the cover. Reorder, remove, or add a link. */
function PhotoManager({ photos, busy, onUpload, onChange }: { photos: string[]; busy: boolean; onUpload: (f: FileList | File[]) => void; onChange: (p: string[], msg: string) => void }) {
  const [over, setOver] = useState(false);
  const move = (i: number, d: number) => { const p = [...photos]; const j = i + d; if (j < 0 || j >= p.length) return; [p[i], p[j]] = [p[j], p[i]]; onChange(p, 'Order saved'); };
  return (
    <div className={'pmgr' + (over ? ' over' : '')} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) onUpload(e.dataTransfer.files); }}>
      {photos.length > 0 && (
        <div className="pgrid">
          {photos.map((p, i) => (
            <figure key={p + i} className={i === 0 ? 'cover' : ''}>
              {isImg(p) ? <img src={p} alt="" /> : <code>{p}</code>}
              {i === 0 && <span className="mono pcov">Cover</span>}
              <div className="pacts">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move left">←</button>
                {i !== 0 && <button type="button" onClick={() => onChange([p, ...photos.filter((_, j) => j !== i)], 'Cover set')}>Cover</button>}
                <button type="button" onClick={() => move(i, 1)} disabled={i === photos.length - 1} aria-label="Move right">→</button>
                <button type="button" className="del" onClick={() => onChange(photos.filter((_, j) => j !== i), 'Photo removed')} aria-label="Remove">×</button>
              </div>
            </figure>
          ))}
        </div>
      )}
      <div className="pdrop">
        <span>{busy ? 'Uploading…' : 'Drop photos here (PNG, JPEG, WebP, up to 8 MB each)'}</span>
        <label className="ab primary sm up">Choose photos<input type="file" accept="image/*" multiple hidden onChange={e => { if (e.target.files?.length) onUpload(e.target.files); e.target.value = ''; }} /></label>
        <button type="button" className="ab ghost sm" onClick={() => { const u = prompt('Link to a photo (https://…/image.jpg) or a 360° video'); if (u) onChange([...photos, u.trim()], 'Link added'); }}>Add a link</button>
      </div>
    </div>
  );
}
