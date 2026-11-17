import { useEffect, useRef, useState, type FormEvent } from 'react';
import { redeemSpecimen, type Holding, type PackReveal } from '../data';
import { useApp } from '../lib/store';
import { still, useStill } from '../lib/stills';
import { buyback, mass, usd } from '../lib/format';
import { BAND_NAME, CATEGORY_NAME, shortAddr } from '../../shared/rules.ts';
import { Overlay, Spinner, TxLine } from './Overlay';
import { disconnect } from './WalletDialog';

const holdingReveal = (h: Holding): PackReveal => ({
  pull_id: null, series_id: null, band: h.band ?? 'par', pack_price_usd: h.paid_usd ?? h.vault_value_usd ?? 0, vault_value_usd: h.vault_value_usd ?? 0,
  specimen: { id: h.id, name: h.name, class: h.class.replace(', ', ' '), mass_g: h.mass_g, render: h.render, photo: h.photo },
});

function HoldingCard({ h }: { h: Holding }) {
  const { data, open } = useApp();
  const img = useStill(h.render, { w: 200, h: 150, rot: -1.6, scale: 1.3 }, h.photo);
  const shipping = h.status.kind === 'redeeming';
  return (
    <li className="hold">
      <img src={img} alt="" width={100} height={75} />
      <div>
        <b>{h.name}</b>
        <small className="mono">{h.class} · {mass(h.mass_g)} · {h.id}</small>
        <small className="mono">{h.acquired_via === 'market' ? 'Bought on the market' : h.acquired_via === 'raffle' ? 'Launch drop raffle' : `Pack · ${BAND_NAME[h.band ?? 'floor']}`}{h.vault_value_usd != null && ` · vault ${usd(h.vault_value_usd)}`}</small>
        {shipping ? <span className="st red">Shipping</span> : (
          <div className="hacts">
            <button type="button" className="lnk" onClick={() => open({ kind: 'reveal', reveal: holdingReveal(h), via: 'holding' })}>Sell back{h.vault_value_usd != null && ` · ${usd(buyback(h.vault_value_usd, data.rules))}`}</button>
            <button type="button" className="lnk" onClick={() => open({ kind: 'redeem', specimen: h })}>Redeem</button>
            <button type="button" className="lnk" onClick={() => open({ kind: 'share', reveal: holdingReveal(h) })}>Share</button>
          </div>
        )}
      </div>
    </li>
  );
}

export function AccountDrawer({ tab: initial = 'holdings' }: { tab?: 'holdings' | 'pulls' | 'redemptions' }) {
  const { me, refresh, close, toast } = useApp();
  const [tab, setTab] = useState(initial);
  useEffect(() => { refresh(); }, [refresh]);
  if (!me) return null;
  const value = me.holdings.reduce((a, h) => a + (h.status.kind === 'held' ? h.vault_value_usd ?? 0 : 0), 0);
  return (
    <Overlay side label="Your vault" title={<><div className="sec mono"><span>Your vault</span><span>{me.kind === 'demo' ? 'Demo wallet' : me.kind}</span></div><h3 className="addr mono" title={me.address}>{shortAddr(me.address)}</h3></>}>
      <div className="sum">
        <div><b>{me.holdings.length}</b><span className="mono">Specimens</span></div>
        <div><b>{usd(value)}</b><span className="mono">Vault value</span></div>
        <div><b>{me.pulls.filter(p => !p.bonus).length}</b><span className="mono">Packs opened</span></div>
      </div>
      <div className="tabs" role="tablist">
        {(['holdings', 'pulls', 'redemptions'] as const).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} type="button" onClick={() => setTab(t)}>{t === 'holdings' ? 'Holdings' : t === 'pulls' ? 'Pulls' : 'Shipments'}</button>
        ))}
      </div>
      {tab === 'holdings' && (me.holdings.length ? <ul className="holds">{me.holdings.map(h => <HoldingCard key={h.id} h={h} />)}</ul> : <p className="empty">Nothing here yet. <a href="#market" onClick={close}>Pick a rock</a> or <a href="#packs" onClick={close}>open a pack</a>.</p>)}
      {tab === 'pulls' && (me.pulls.length ? (
        <ul className="plist">{me.pulls.map((p, i) => (
          <li key={p.pull_id ?? i}><i className={'c-' + p.band} /><span><b>{p.specimen.name}</b><small className="mono">{p.bonus ? 'Bonus pull · launch drop' : `Series ${p.series_id}`} · {CATEGORY_NAME[p.specimen.render.type]}</small></span><em className="mono">{BAND_NAME[p.band]} · {usd(p.vault_value_usd)}</em></li>
        ))}</ul>
      ) : <p className="empty">No packs opened yet.</p>)}
      {tab === 'redemptions' && (me.redemptions.length ? (
        <ul className="plist">{me.redemptions.map(r => (
          <li key={r.id}><span><b>{r.specimen_name}</b><small className="mono">{r.address.city}, {r.address.country}{r.tracking && ` · ${r.tracking}`}</small></span><em className={'st ' + (r.status === 'cancelled' ? 'pend' : r.status === 'delivered' || r.status === 'shipped' ? 'pool' : 'held')}>{r.status}</em></li>
        ))}</ul>
      ) : <p className="empty">No shipments. Redeem a specimen to get the rock itself.</p>)}
      <div className="dfoot">
        <button type="button" className="btn line sm" onClick={async () => { await disconnect(refresh); toast('Disconnected'); close(); }}>Disconnect</button>
      </div>
    </Overlay>
  );
}

/* ---------- redeem ---------- */

const regionName = (() => {
  try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => d.of(c) ?? c; } catch { return (c: string) => c; }
})();

export function RedeemDialog({ specimen }: { specimen: Holding | PackReveal['specimen'] }) {
  const { data, refresh, toast, open } = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ tx: string; simulated: boolean } | null>(null);
  const fee = data.rules.handling_fee_usd + data.rules.shipping_usd;
  const countries = [...data.rules.shipping_countries].sort((a, b) => regionName(a).localeCompare(regionName(b)));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    setBusy(true); setErr('');
    try { const r = await redeemSpecimen(specimen.id, f); setDone(r.payment); await refresh(); toast('Redemption requested'); } catch (er: any) { setErr(er.message); } finally { setBusy(false); }
  };

  return (
    <Overlay label={`Redeem ${specimen.name}`} title={<div className="sec mono"><span>Redeem</span><span>{specimen.id}</span></div>}>
      {done ? (
        <>
          <h3 className="dlg-h">The capsule is coming home.</h3>
          <p className="dlg-p">We burned the NFT and opened a shipment for {specimen.name}. You’ll get the tracking number by email, and it shows in your vault under Shipments.</p>
          <TxLine tx={done.tx} simulated={done.simulated} label="Fee paid" />
          <div className="acts"><button className="btn" type="button" onClick={() => open({ kind: 'account', tab: 'redemptions' })}>See shipments</button></div>
        </>
      ) : (
        <form className="fm" onSubmit={submit}>
          <h3 className="dlg-h">Ship {specimen.name} to you.</h3>
          <p className="dlg-p">The NFT is burned and the sealed capsule ships insured. Shipping at cost plus a handling fee.</p>
          <label>Full name<input name="name" required autoComplete="name" /></label>
          <label>Email<input name="email" type="email" required autoComplete="email" /></label>
          <label>Address<input name="line1" required autoComplete="address-line1" /></label>
          <label>Apartment, suite <span className="opt">optional</span><input name="line2" autoComplete="address-line2" /></label>
          <div className="two">
            <label>City<input name="city" required autoComplete="address-level2" /></label>
            <label>Postal code<input name="postal" required autoComplete="postal-code" /></label>
          </div>
          <div className="two">
            <label>Country<select name="country" required defaultValue="">
              <option value="" disabled>Choose</option>
              {countries.map(c => <option key={c} value={c}>{regionName(c)}</option>)}
            </select></label>
            <label>Phone <span className="opt">optional</span><input name="phone" autoComplete="tel" /></label>
          </div>
          <dl className="kv"><dt>Handling</dt><dd>{usd(data.rules.handling_fee_usd)}</dd><dt>Insured shipping</dt><dd>{usd(data.rules.shipping_usd)}</dd><dt>Total</dt><dd className="hot">{usd(fee)}</dd></dl>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn wide" type="submit" disabled={busy}>{busy ? <><Spinner label="Sending" />Sending…</> : `Burn and ship for ${usd(fee)}`}</button>
          <p className="fine">Only countries we can ship to are listed (customs and sanctions screening).</p>
        </form>
      )}
    </Overlay>
  );
}

/* ---------- share ---------- */

const PIECE: Record<string, string> = { martian: 'I pulled a piece of Mars', lunar: 'I pulled a piece of the Moon', pallasite: 'I pulled a piece of a planet’s core', iron: 'I pulled a piece of an asteroid’s core', stone: 'I pulled a piece of another world' };

export function ShareDialog({ reveal }: { reveal: PackReveal }) {
  const sp = reveal.specimen;
  const cv = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState('');
  const line = PIECE[sp.render.type];

  useEffect(() => {
    let alive = true;
    (async () => {
      await document.fonts?.ready;
      const img = new Image();
      img.src = sp.photo ?? (await still(sp.render, { w: 640, h: 560, rot: -1.25, scale: 1.45 }));
      await img.decode().catch(() => undefined);
      const c = cv.current;
      if (!c || !alive) return;
      const x = c.getContext('2d')!;
      const W = 1200, H = 630;
      c.width = W; c.height = H;
      const g = x.createRadialGradient(W * .72, H * 1.1, 20, W * .72, H * 1.1, W * .8);
      g.addColorStop(0, '#5c2a12'); g.addColorStop(.6, '#120d0b'); g.addColorStop(1, '#0E0A08');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.drawImage(img, W - 640, 40, 600, 525);
      x.fillStyle = '#F08A5D'; x.font = '500 20px "IBM Plex Mono", monospace';
      x.fillText((reveal.band === 'hit' ? 'HIT · ' : '') + sp.id + ' · SPACE ROCKS', 70, 100);
      x.fillStyle = '#EFE6DA'; x.font = '400 96px "Instrument Serif", serif';
      x.fillText(sp.name, 66, 250, 560);
      x.fillStyle = '#A39484'; x.font = '400 22px "IBM Plex Mono", monospace';
      x.fillText(`${sp.class.toUpperCase()} · ${mass(sp.mass_g).toUpperCase()}`, 70, 300, 560);
      x.fillStyle = '#EFE6DA'; x.font = 'italic 400 52px "Instrument Serif", serif';
      x.fillText(line + '.', 66, 520, 620);
      x.fillStyle = '#A39484'; x.font = '400 18px "IBM Plex Mono", monospace';
      x.fillText('CERTIFIED · VAULTED · MINTED ON SOLANA', 70, 572);
      setUrl(c.toDataURL('image/png'));
    })();
    return () => { alive = false; };
  }, [sp, reveal.band, line]);

  const text = `${line}: ${sp.name}, ${sp.class}, ${mass(sp.mass_g)}. Real, certified, vaulted.`;
  const site = typeof location !== 'undefined' ? location.origin : '';
  return (
    <Overlay label="Share your pull" wide title={<div className="sec mono"><span>Share</span><span>{sp.id}</span></div>}>
      <canvas ref={cv} className="sharecv" aria-label={`Share card: ${text}`} />
      <div className="acts">
        <a className="btn" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(site)}`} target="_blank" rel="noreferrer">Post on X</a>
        <a className={'btn line' + (url ? '' : ' dis')} href={url || undefined} download={`space-rocks-${sp.id}.png`}>Download card</a>
      </div>
      <p className="fine">Download the card and attach it to your post.</p>
    </Overlay>
  );
}
