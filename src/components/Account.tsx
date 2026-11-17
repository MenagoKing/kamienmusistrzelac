import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { redeemSpecimen, type Holding, type PackReveal } from '../data';
import { useApp } from '../lib/store';
import { still } from '../lib/stills';
import { buyback, marketPrice, mass, originLabel, pct, usd } from '../lib/format';
import { BAND_NAME } from '../../shared/rules.ts';
import { FILE_ITEMS } from '../../shared/types.ts';
import { Overlay, Spinner, TxLine } from './Overlay';
import { Media } from './Media';
import { NftLine } from './Checkout';

export const holdingReveal = (h: Holding): PackReveal => ({
  pull_id: null, series_id: null, band: h.band ?? 'par', pack_price_usd: h.paid_usd ?? h.vault_value_usd ?? 0, vault_value_usd: h.vault_value_usd ?? 0,
  specimen: { id: h.id, name: h.name, class: h.class.replace(', ', ' '), mass_g: h.mass_g, render: h.render, photo: h.photo },
});

/* ---------- redeem ---------- */

const regionName = (() => {
  try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => d.of(c) ?? c; } catch { return (c: string) => c; }
})();

export function RedeemDialog({ specimen }: { specimen: Holding | PackReveal['specimen'] }) {
  const { data, refresh, toast } = useApp();
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
          <div className="acts"><a className="btn" href="/account#shipments">See shipments</a></div>
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
  const { me, toast } = useApp();
  const [url, setUrl] = useState('');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [note, setNote] = useState('');
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
      const data = c.toDataURL('image/png');
      setUrl(data);
      c.toBlob(b => alive && setBlob(b), 'image/png');
      // Store the card so the share link shows this picture on X (link preview).
      if (me) api('POST', '/api/share-image', { specimen_id: sp.id, data }).catch(() => undefined);
    })();
    return () => { alive = false; };
  }, [sp, reveal.band, line, me]);

  const text = `${line}: ${sp.name}, ${sp.class}, ${mass(sp.mass_g)}. Real, certified, vaulted.`;
  const shareUrl = typeof location !== 'undefined' ? `${location.origin}/s/${sp.id}` : '';
  const fileName = `space-rocks-${sp.id}.png`;
  const file = () => (blob ? new File([blob], fileName, { type: 'image/png' }) : null);

  const copyImage = async () => {
    if (!blob || !('ClipboardItem' in window) || !navigator.clipboard?.write) return false;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return true; } catch { return false; }
  };

  /** X's post link only takes text, so the picture travels by the share sheet (phones) or the clipboard (computers). */
  const post = async () => {
    const f = file();
    if (f && matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [f] })) {
      try { await navigator.share({ files: [f], text: `${text} ${shareUrl}` }); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
    }
    const copied = await copyImage();
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`, '_blank', 'noopener');
    const msg = copied ? 'The picture is copied. In the X post press Ctrl+V (⌘V on a Mac) to attach it.' : 'Download the card and attach it to your post.';
    setNote(msg);
    if (copied) toast('Picture copied: paste it into the post');
  };

  return (
    <Overlay label="Share your pull" wide title={<div className="sec mono"><span>Share</span><span>{sp.id}</span></div>}>
      <canvas ref={cv} className="sharecv" aria-label={`Share card: ${text}`} />
      <div className="acts">
        <button type="button" className="btn" onClick={post} disabled={!blob}>Post on X with the picture</button>
        <button type="button" className="btn line" disabled={!blob} onClick={async () => { const ok = await copyImage(); toast(ok ? 'Picture copied' : 'Your browser cannot copy images: use Download', ok ? 'ok' : 'err'); }}>Copy picture</button>
        <a className={'btn line' + (url ? '' : ' dis')} href={url || undefined} download={fileName}>Download card</a>
      </div>
      <p className={note ? 'ok' : 'fine'} role="status">{note || 'On a phone the picture is attached for you. On a computer it is copied: paste it into the post with Ctrl+V. The link in the post also shows the card once the site is online.'}</p>
    </Overlay>
  );
}

/* ---------- a specimen in your collection ---------- */

const VIA: Record<Holding['acquired_via'], string> = { market: 'Bought on the market', pack: 'Pulled from a pack', raffle: 'Won in a launch drop raffle', secondary: 'Bought from a collector' };

export function ItemDialog({ holding: h }: { holding: Holding }) {
  const { data, me, open, refresh, toast, close } = useApp();
  const [busy, setBusy] = useState(false);
  const done = h.file_done ?? [];
  const linked = me?.profile.linked_wallet;
  const withdraw = async () => {
    setBusy(true);
    try { await api('POST', `/api/specimens/${h.id}/withdraw`, {}); await refresh(); toast('Sending the NFT to your wallet'); } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const vault = h.vault_value_usd ?? 0;
  const shipping = h.status.kind === 'redeeming';
  const unlist = async () => {
    if (!h.listing) return;
    setBusy(true);
    try { await api('POST', `/api/listings/${h.listing.id}/cancel`, {}); await refresh(); toast('Taken off sale'); close(); } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Overlay wide label={h.name} title={<div className="sec mono"><span>Your collection</span><span>{h.id}</span></div>}>
      <div className="co">
        <div className="co-media"><Media hint={h.render} photos={h.photos} label={h.name} className="co-ph" />{h.band && <span className={'chip' + (h.band !== 'hit' ? ' ' + h.band : '')}>{BAND_NAME[h.band].toUpperCase()}</span>}</div>
        <div className="co-bd">
          <h3>{h.name}</h3>
          <div className="cl mono">{h.class} · {mass(h.mass_g)} · {originLabel(h)}</div>
          <dl className="kv">
            <dt>{VIA[h.acquired_via]}</dt><dd>{new Date(h.acquired_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
            {h.paid_usd != null && <><dt>You paid</dt><dd>{h.paid_usd ? usd(h.paid_usd) : 'Free'}</dd></>}
            <dt>Vault value</dt><dd>{usd(vault)}</dd>
            <dt>Instant offer, {pct(data.rules.buyback_share)}%</dt><dd className="hot">{usd(buyback(vault, data.rules))}</dd>
            {h.listing && <><dt>Listed for collectors</dt><dd>{usd(h.listing.price_usd)}</dd></>}
          </dl>
          <ul className="chk cols">
            {FILE_ITEMS.map((f, i) => <li key={f.key} className={done[i] ? 'y' : ''}>{f.label}</li>)}
          </ul>
          <NftLine specimenId={h.id} />
          {!shipping && linked && h.mint_status === 'minted' && h.nft_owner !== linked && <button type="button" className="lnk" disabled={busy} onClick={withdraw}>Send the NFT to my wallet {linked.slice(0, 4)}…{linked.slice(-4)}</button>}
          {shipping ? <p className="ok">On its way to you. Tracking is under Shipments.</p> : h.listing ? (
            <div className="acts">
              <button className="btn line" type="button" disabled={busy} onClick={unlist}>{busy ? <><Spinner label="Working" />Working…</> : 'Take off sale'}</button>
              <button className="btn line" type="button" onClick={() => open({ kind: 'share', reveal: holdingReveal(h) })}>Share</button>
            </div>
          ) : (
            <div className="acts">
              <button className="btn" type="button" onClick={() => open({ kind: 'list', holding: h })}>Sell to collectors</button>
              <button className="btn line" type="button" onClick={() => open({ kind: 'reveal', reveal: holdingReveal(h), via: 'holding' })}>Sell back · {usd(buyback(vault, data.rules))}</button>
              <button className="btn line" type="button" onClick={() => open({ kind: 'redeem', specimen: h })}>Redeem</button>
              <button className="btn line" type="button" onClick={() => open({ kind: 'share', reveal: holdingReveal(h) })}>Share</button>
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}

/* ---------- list for sale ---------- */

export function ListDialog({ holding: h }: { holding: Holding }) {
  const { data, refresh, toast, close } = useApp();
  const vault = h.vault_value_usd ?? 0;
  const ref = vault ? marketPrice(vault, data.rules) : 0;
  const [price, setPrice] = useState(ref ? String(ref) : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const p = Number(price) || 0;
  const fee = Math.round(p * data.rules.royalty * 100) / 100;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await api('POST', `/api/specimens/${h.id}/list`, { price_usd: p }); await refresh(); toast(`${h.name} is on sale for ${usd(p)}`); close(); } catch (er: any) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <Overlay label={`Sell ${h.name}`} title={<div className="sec mono"><span>Sell to collectors</span><span>{h.id}</span></div>}>
      <form className="fm" onSubmit={submit}>
        <h3 className="dlg-h">Set your price for {h.name}.</h3>
        <p className="dlg-p">It shows on the market under “From collectors”. Whoever buys it gets the NFT and the rock’s place in the vault. You can take it off sale any time before that.</p>
        <label>Your price, USD<input type="number" min={1} step="0.01" value={price} onChange={e => setPrice(e.target.value)} required data-autofocus /></label>
        <div className="refs">
          <button type="button" onClick={() => setPrice(String(ref))}>Market price <b>{usd(ref)}</b></button>
          <button type="button" onClick={() => setPrice(String(vault))}>Vault value <b>{usd(vault)}</b></button>
        </div>
        <dl className="kv"><dt>Royalty to the vault, {pct(data.rules.royalty)}%</dt><dd>{usd(fee)}</dd><dt>You receive, in USDC</dt><dd className="hot">{usd(Math.max(0, p - fee))}</dd><dt>Or sell back now for</dt><dd>{usd(buyback(vault, data.rules))}</dd></dl>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn wide" type="submit" disabled={busy || p < 1}>{busy ? <><Spinner label="Listing" />Listing…</> : `List for ${usd(p)}`}</button>
      </form>
    </Overlay>
  );
}
