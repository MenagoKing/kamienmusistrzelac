import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { redeemSpecimen, type Holding, type PackReveal, type Redemption, type RedeemQuote, type Reservation, type Specimen, type TxResult } from '../data';
import { useApp } from '../lib/store';
import { still, useStill } from '../lib/stills';
import { buyback, liveReservation, marketPrice, marketPriceOf, mass, originLabel, pct, usd } from '../lib/format';
import { BAND_NAME } from '../../shared/rules.ts';
import { FILE_ITEMS } from '../../shared/types.ts';
import { Overlay, Spinner, TxLine } from './Overlay';
import { Media } from './Media';
import { NftLine, Rarity } from './Checkout';
import { payNote } from './Funds';

export const holdingReveal = (h: Holding): PackReveal => ({
  pull_id: null, series_id: null, band: h.band ?? 'par', pack_price_usd: h.paid_usd ?? h.vault_value_usd ?? 0, vault_value_usd: h.vault_value_usd ?? 0,
  specimen: { id: h.id, name: h.name, class: h.class.replace(', ', ' '), mass_g: h.mass_g, render: h.render, photo: h.photo },
});

/* ---------- redeem ---------- */

const regionName = (() => {
  try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c: string) => d.of(c) ?? c; } catch { return (c: string) => c; }
})();

export function RedeemDialog({ specimen, reservation }: { specimen: Holding | PackReveal['specimen']; reservation?: Reservation | null }) {
  if (reservation && reservation.status === 'active') return <SourcedRedeem specimen={specimen} reservation={reservation} />;
  return <VaultRedeem specimen={specimen} />;
}

function AddressFields({ countries, country, onCountry }: { countries: string[]; country?: string; onCountry?: (c: string) => void }) {
  return (
    <>
      <label>Full name<input name="name" required autoComplete="name" /></label>
      <label>Email<input name="email" type="email" required autoComplete="email" /></label>
      <label>Address<input name="line1" required autoComplete="address-line1" /></label>
      <label>Apartment, suite <span className="opt">optional</span><input name="line2" autoComplete="address-line2" /></label>
      <div className="two">
        <label>City<input name="city" required autoComplete="address-level2" /></label>
        <label>Postal code<input name="postal" required autoComplete="postal-code" /></label>
      </div>
      <div className="two">
        <label>Country<select name="country" required value={country ?? undefined} defaultValue={country === undefined ? '' : undefined} onChange={e => onCountry?.(e.target.value)}>
          <option value="" disabled>Choose</option>
          {countries.map(c => <option key={c} value={c}>{regionName(c)}</option>)}
        </select></label>
        <label>Phone <span className="opt">optional</span><input name="phone" autoComplete="tel" /></label>
      </div>
    </>
  );
}

/** Own stock (pack pulls): flat handling and shipping, ships from the vault. */
function VaultRedeem({ specimen }: { specimen: Holding | PackReveal['specimen'] }) {
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
          <p className="dlg-p">We burned the NFT and opened a shipment for {specimen.name}. You’ll get the tracking number by email, and it shows in your account under Shipments.</p>
          <TxLine tx={done.tx} simulated={done.simulated} label="Fee paid" />
          <div className="acts"><a className="btn" href="/account#shipments">See shipments</a></div>
        </>
      ) : (
        <form className="fm" onSubmit={submit}>
          <h3 className="dlg-h">Ship {specimen.name} to you.</h3>
          <p className="dlg-p">The NFT is burned and the sealed capsule ships insured. Shipping at cost plus a handling fee.</p>
          <AddressFields countries={countries} />
          <dl className="kv"><dt>Handling</dt><dd>{usd(data.rules.handling_fee_usd)}</dd><dt>Insured shipping</dt><dd>{usd(data.rules.shipping_usd)}</dd><dt>Total</dt><dd className="hot">{usd(fee)}</dd></dl>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn wide" type="submit" disabled={busy}>{busy ? <><Spinner label="Sending" />Sending…</> : `Burn and ship for ${usd(fee)}`}</button>
          <p className="fine">Only countries we can ship to are listed (customs and sanctions screening).</p>
        </form>
      )}
    </Overlay>
  );
}

/**
 * Dealer-sourced (Addendum 1): the shipping quote and any change in the dealer's price are shown
 * before anything is charged. Higher price: pay the difference or take a full refund. Lower: the
 * difference comes back. Then the NFT is burned, the escrow goes to buy the rock and the dealer ships.
 */
function SourcedRedeem({ specimen, reservation }: { specimen: Holding | PackReveal['specimen']; reservation: Reservation }) {
  const { data, refresh, toast } = useApp();
  const countries = [...data.rules.shipping_countries].sort((a, b) => regionName(a).localeCompare(regionName(b)));
  const [country, setCountry] = useState('');
  const [quote, setQuote] = useState<RedeemQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [choice, setChoice] = useState<'accept' | 'refund'>('accept');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [soldOut, setSoldOut] = useState(false);
  const [done, setDone] = useState<{ redemption?: Redemption; refunded_usd?: number; payment?: TxResult } | null>(null);

  const getQuote = async (c: string) => {
    setCountry(c); setErr(''); setQuote(null);
    if (!c) return;
    setQuoting(true);
    try {
      const q = await api<RedeemQuote>('POST', `/api/reservations/${reservation.id}/redeem-quote`, { country: c });
      setQuote(q);
      if (!q.available) setSoldOut(true);
    } catch (e: any) { setErr(e.message); } finally { setQuoting(false); }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!quote) return;
    const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    setBusy(true); setErr('');
    try {
      const r = await api<{ redemption?: Redemption; refunded_usd?: number; payment?: TxResult }>('POST', `/api/reservations/${reservation.id}/redeem`, { ...f, expected_delta_usd: quote.delta_usd, price_change: quote.delta_usd > 0 ? choice : undefined });
      setDone(r); await refresh();
      toast(r.redemption ? 'Redemption confirmed' : `Refunded ${usd(r.refunded_usd ?? 0)}`);
    } catch (er: any) {
      const d = er?.data;
      if (d?.code === 'sold_at_source') { setSoldOut(true); refresh(); }
      else if (d?.code === 'changed') getQuote(country);
      setErr(er.message);
    } finally { setBusy(false); }
  };

  const fee = quote ? quote.shipping_usd + quote.insurance_usd : 0;
  const up = quote ? Math.max(0, quote.delta_usd) : 0;
  const down = quote ? Math.max(0, -quote.delta_usd) : 0;
  const refundAll = quote != null && up > 0 && choice === 'refund';
  const total = fee + up;

  return (
    <Overlay label={`Redeem ${specimen.name}`} title={<div className="sec mono"><span>Redeem</span><span>{specimen.id}</span></div>}>
      {done ? done.redemption ? (
        <>
          <h3 className="dlg-h">Ordered. {specimen.name} is coming to you.</h3>
          <p className="dlg-p">The NFT is burned and the escrow has paid for the rock. {done.redemption.dealer_name ? <>It ships from <b>{done.redemption.dealer_name}</b>, </> : 'The dealer ships it, '}ordered within 48 hours. Tracking arrives by email and shows in your account under Shipments.</p>
          {down > 0 && <p className="ok">The dealer’s price went down: {usd(down)} is on its way back to you in USDC.</p>}
          {done.payment && <TxLine tx={done.payment.tx} simulated={done.payment.simulated} label="Paid" />}
          <div className="acts"><a className="btn" href="/account#shipments">See shipments</a></div>
        </>
      ) : (
        <>
          <h3 className="dlg-h">Refunded in full.</h3>
          <p className="dlg-p">{usd(done.refunded_usd ?? 0)}, everything you paid, is on its way in USDC. The NFT is burned.</p>
          <div className="acts"><a className="btn" href="/account">Back to my account</a></div>
        </>
      ) : soldOut ? (
        <>
          <h3 className="dlg-h">The dealer sold this specimen.</h3>
          <p className="dlg-p">It sold at its source before your redemption. Nothing was charged. Open it from your account to pick a replacement at the same or lower price (the difference comes back) or take a full refund of {usd(reservation.paid_usd)}.</p>
          <div className="acts"><a className="btn" href="/account">Choose in my account</a></div>
        </>
      ) : (
        <form className="fm" onSubmit={submit}>
          <h3 className="dlg-h">Ship {specimen.name} to you.</h3>
          <p className="dlg-p">Choose where it goes first: you’ll see the shipping cost and the dealer’s current price before anything is charged.</p>
          <AddressFields countries={countries} country={country} onCountry={getQuote} />
          {quoting && <p className="fine"><Spinner label="Checking" /> Checking shipping and the dealer’s price…</p>}
          {quote && (
            <>
              <dl className="kv">
                <dt>Insured shipping to {regionName(quote.country)}</dt><dd>{usd(quote.shipping_usd)}</dd>
                <dt>Insurance</dt><dd>{usd(quote.insurance_usd)}</dd>
                <dt>Rock price when you reserved</dt><dd>{usd(quote.reserved_price_usd)}</dd>
                <dt>Dealer’s price now</dt><dd>{usd(quote.current_price_usd)}</dd>
                {down > 0 && <><dt>Comes back to you</dt><dd className="ok-t">{usd(down)}</dd></>}
                {up > 0 && <><dt>Difference to pay</dt><dd>{usd(up)}</dd></>}
                <dt>{refundAll ? 'Refunded to you' : 'You pay now'}</dt><dd className="hot">{refundAll ? usd(reservation.paid_usd) : usd(total)}</dd>
              </dl>
              {up > 0 && (
                <div className="pchoice" role="radiogroup" aria-label="The dealer’s price went up">
                  <p className="fine">The dealer’s price went up by {usd(up)} since you reserved.</p>
                  <label><input type="radio" name="price_change_ui" checked={choice === 'accept'} onChange={() => setChoice('accept')} /> Pay the {usd(up)} difference and ship it</label>
                  <label><input type="radio" name="price_change_ui" checked={choice === 'refund'} onChange={() => setChoice('refund')} /> Cancel and get everything back ({usd(reservation.paid_usd)})</label>
                </div>
              )}
            </>
          )}
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn wide" type="submit" disabled={busy || !quote || quoting}>{busy ? <><Spinner label="Working" />Working…</> : !quote ? 'Choose a country to see the cost' : refundAll ? `Refund ${usd(reservation.paid_usd)}` : `Burn and ship for ${usd(total)}`}</button>
          <p className="fine">The rock is bought from the dealer with the escrow only after the NFT is burned, and ordered within 48 hours. Only countries we can ship to are listed. {payNote(data)}</p>
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
      x.fillText('CERTIFIED · DOCUMENTED · MINTED ON SOLANA', 70, 572);
      const data = c.toDataURL('image/png');
      setUrl(data);
      c.toBlob(b => alive && setBlob(b), 'image/png');
      // Store the card so the share link shows this picture on X (link preview).
      if (me) api('POST', '/api/share-image', { specimen_id: sp.id, data }).catch(() => undefined);
    })();
    return () => { alive = false; };
  }, [sp, reveal.band, line, me]);

  const text = `${line}: ${sp.name}, ${sp.class}, ${mass(sp.mass_g)}. Real, certified, minted on Solana.`;
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

const VIA: Record<Holding['acquired_via'], string> = { market: 'Reserved on the market', pack: 'Pulled from a pack', raffle: 'Won in a launch drop raffle', secondary: 'Bought from a collector' };

function SasThumb({ s }: { s: Specimen }) {
  const img = useStill(s.render, { w: 112, h: 112, rot: -2, scale: 1.45 }, s.photo);
  return <img className="sas-ph" src={img} alt="" width={56} height={56} />;
}

/** Sold at source: pick a replacement at the same or lower price, or take everything back. */
function SoldAtSource({ h, r }: { h: Holding; r: Reservation }) {
  const { data, refresh, toast, close } = useApp();
  const [opts, setOpts] = useState<Specimen[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<Specimen[]>('GET', `/api/reservations/${r.id}/replacements`).then(setOpts).catch(e => { setOpts([]); setErr(e.message); });
  }, [r.id]);
  const replace = async () => {
    setBusy(true); setErr('');
    try {
      const x = await api<{ refunded_usd: number }>('POST', `/api/reservations/${r.id}/replace`, { specimen_id: pick });
      await refresh(); toast(x.refunded_usd > 0 ? `Replacement reserved, ${usd(x.refunded_usd)} back` : 'Replacement reserved'); close();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const refund = async () => {
    setBusy(true); setErr('');
    try { const x = await api<{ refunded_usd: number }>('POST', `/api/reservations/${r.id}/refund`, {}); await refresh(); toast(`Refunded ${usd(x.refunded_usd)}`); close(); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="sas">
      <p className="err">The dealer sold {h.name} at its source. Choose a replacement at the same or lower price (the difference comes back to you), or take a full refund of {usd(r.paid_usd)}.</p>
      {opts == null ? <p className="fine"><Spinner label="Loading" /> Finding replacements…</p> : opts.length ? (
        <div className="sas-list" role="radiogroup" aria-label="Replacements">
          {opts.map(o => {
            const price = marketPriceOf(o, data.rules);
            return (
              <button key={o.id} type="button" role="radio" aria-checked={pick === o.id} className={'sas-o' + (pick === o.id ? ' on' : '')} onClick={() => setPick(o.id)}>
                <SasThumb s={o} />
                <span className="sas-t"><b>{o.name}</b><span className="mono">{o.class} · {mass(o.mass_g)}</span></span>
                <span className="sas-p mono">{usd(price)}{r.paid_usd - price > 0.004 && <em>{usd(r.paid_usd - price)} back</em>}</span>
              </button>
            );
          })}
        </div>
      ) : <p className="fine">No specimen at your price is available right now. You can take the full refund, or come back later.</p>}
      {err && <p className="err" role="alert">{err}</p>}
      <div className="acts">
        {opts && opts.length > 0 && <button className="btn" type="button" disabled={!pick || busy} onClick={replace}>{busy ? <><Spinner label="Working" />Working…</> : 'Take this one instead'}</button>}
        <button className="btn line" type="button" disabled={busy} onClick={refund}>Full refund · {usd(r.paid_usd)}</button>
      </div>
    </div>
  );
}

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Send the specimen's NFT to any address (another Space Rocks account gets it as a gift). */
function SendNft({ h, linked }: { h: Holding; linked: string | null }) {
  const { me, refresh, toast, close } = useApp();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(linked ?? '');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const needsPw = !!me?.profile.has_password;
  if (!open) return <div className="acts"><button className="btn line sm" type="button" onClick={() => setOpen(true)}>Send NFT to an address</button></div>;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api<{ gift: boolean; to: string }>('POST', `/api/specimens/${h.id}/send`, { to: to.trim(), password: pw });
      await refresh();
      toast(r.gift ? `${h.name} is now in that collector’s account` : `Sending the NFT to ${r.to.slice(0, 4)}…${r.to.slice(-4)}`);
      if (r.gift) close(); else setOpen(false);
    } catch (er: any) { setErr(er.message); } finally { setBusy(false); }
  };
  return (
    <form className="fm sendnft" onSubmit={send}>
      <label>Send the NFT to<input value={to} onChange={e => setTo(e.target.value)} placeholder="Solana address" spellCheck={false} autoComplete="off" data-autofocus /></label>
      {linked && to !== linked && <button type="button" className="lnk" onClick={() => setTo(linked)}>Use my linked wallet {linked.slice(0, 4)}…{linked.slice(-4)}</button>}
      {needsPw && <label>Your password<input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></label>}
      <p className="fine">To another Space Rocks collector’s address it becomes theirs, with its reservation. To an outside wallet (Phantom, Solflare) the NFT moves there and the specimen stays in your account.</p>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="acts">
        <button className="btn" type="submit" disabled={busy || !SOL_ADDR.test(to.trim()) || (needsPw && !pw)}>{busy ? <><Spinner label="Sending" />Sending…</> : 'Send NFT'}</button>
        <button className="btn line" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function ItemDialog({ holding: h }: { holding: Holding }) {
  const { data, me, open, refresh, toast, close } = useApp();
  const [busy, setBusy] = useState(false);
  const done = h.file_done ?? [];
  const linked = me?.profile.linked_wallet;
  const r = liveReservation(h.reservation);
  const value = h.reservation ? h.reservation.escrow_usd || h.reservation.reserved_price_usd : h.vault_value_usd ?? 0;
  const shipping = h.status.kind === 'redeeming';
  const unlist = async () => {
    if (!h.listing) return;
    setBusy(true);
    try { await api('POST', `/api/listings/${h.listing.id}/cancel`, {}); await refresh(); toast('Taken off sale'); close(); } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const reveal = holdingReveal(h);
  return (
    <Overlay wide label={h.name} title={<div className="sec mono"><span>Your collection</span><span>{h.id}</span></div>}>
      <div className="co">
        <div className="co-media"><Media hint={h.render} photos={h.photos} label={h.name} className="co-ph" />{r ? <span className={'chip' + (r.status === 'sold_at_source' ? ' floor' : '')}>{r.status === 'sold_at_source' ? 'SOLD AT SOURCE' : 'RESERVED'}</span> : h.band && <span className={'chip' + (h.band !== 'hit' ? ' ' + h.band : '')}>{BAND_NAME[h.band].toUpperCase()}</span>}</div>
        <div className="co-bd">
          <Rarity type={h.render.type} price={value} />
          <h3>{h.name}</h3>
          <div className="cl mono">{h.class} · {mass(h.mass_g)} · {originLabel(h)}</div>
          <dl className="kv">
            <dt>{VIA[h.acquired_via]}</dt><dd>{new Date(h.acquired_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
            {h.paid_usd != null && <><dt>You paid</dt><dd>{h.paid_usd ? usd(h.paid_usd) : 'Free'}</dd></>}
            {shipping ? <>
              <dt>Rock price</dt><dd>{usd(value)}</dd>
            </> : r ? <>
              <dt>Rock price, held in escrow</dt><dd>{usd(value)}</dd>
              <dt>{r.status === 'sold_at_source' ? 'Full refund available' : 'If you cancel'}</dt><dd className="hot">{usd(r.status === 'sold_at_source' ? r.paid_usd : value)}{r.status === 'sold_at_source' ? '' : ' back'}</dd>
            </> : <>
              <dt>Rock value</dt><dd>{usd(value)}</dd>
              <dt>Instant offer, {pct(data.rules.buyback_share)}%</dt><dd className="hot">{usd(buyback(value, data.rules))}</dd>
            </>}
            {h.listing && <><dt>Listed for collectors</dt><dd>{usd(h.listing.price_usd)}</dd></>}
          </dl>
          <ul className="chk cols">
            {FILE_ITEMS.map((f, i) => <li key={f.key} className={done[i] ? 'y' : ''}>{f.label}</li>)}
          </ul>
          {r && !shipping && r.status === 'active' && <p className="fine src-line">Reserved for you. Sourced from an independent certified dealer, purchased and shipped when you redeem.</p>}
          <NftLine specimenId={h.id} />
          {!shipping && h.status.kind === 'held' && !h.listing && r?.status !== 'sold_at_source' && <SendNft h={h} linked={linked ?? null} />}
          {shipping ? <p className="ok">On its way to you. Tracking is under Shipments.</p> : r?.status === 'sold_at_source' ? <SoldAtSource h={h} r={r} /> : h.listing ? (
            <div className="acts">
              <button className="btn line" type="button" disabled={busy} onClick={unlist}>{busy ? <><Spinner label="Working" />Working…</> : 'Take off sale'}</button>
              <button className="btn line" type="button" onClick={() => open({ kind: 'share', reveal })}>Share</button>
            </div>
          ) : (
            <div className="acts">
              <button className="btn" type="button" onClick={() => open({ kind: 'list', holding: h })}>Sell to collectors</button>
              {r
                ? <button className="btn line" type="button" onClick={() => open({ kind: 'reveal', reveal, via: 'holding', reservation: r, confirm: true })}>Cancel · {usd(value)} back</button>
                : <button className="btn line" type="button" onClick={() => open({ kind: 'reveal', reveal, via: 'holding', confirm: true })}>Sell back · {usd(buyback(value, data.rules))}</button>}
              <button className="btn line" type="button" onClick={() => open({ kind: 'redeem', specimen: h, reservation: r })}>Redeem</button>
              <button className="btn line" type="button" onClick={() => open({ kind: 'share', reveal })}>Share</button>
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
  const r = liveReservation(h.reservation);
  const value = r ? r.escrow_usd || r.reserved_price_usd : h.vault_value_usd ?? 0;
  const ref = r ? marketPriceOf(h, data.rules) : value ? marketPrice(value, data.rules) : 0;
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
        <p className="dlg-p">It shows on the market under “From collectors”. Whoever buys it gets the NFT{r ? ' and your reservation with its escrow' : ''}. You can take it off sale any time before that.</p>
        <label>Your price, USD<input type="number" min={1} step="0.01" value={price} onChange={e => setPrice(e.target.value)} required data-autofocus /></label>
        <div className="refs">
          <button type="button" onClick={() => setPrice(String(ref))}>Market price <b>{usd(ref)}</b></button>
          <button type="button" onClick={() => setPrice(String(value))}>Rock {r ? 'price' : 'value'} <b>{usd(value)}</b></button>
        </div>
        <dl className="kv"><dt>Royalty to the platform, {pct(data.rules.royalty)}%</dt><dd>{usd(fee)}</dd><dt>You receive, in USDC</dt><dd className="hot">{usd(Math.max(0, p - fee))}</dd>{r ? <><dt>Or cancel now for</dt><dd>{usd(value)}</dd></> : <><dt>Or sell back now for</dt><dd>{usd(buyback(value, data.rules))}</dd></>}</dl>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn wide" type="submit" disabled={busy || p < 1}>{busy ? <><Spinner label="Listing" />Listing…</> : `List for ${usd(p)}`}</button>
      </form>
    </Overlay>
  );
}
