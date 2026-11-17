import { useState } from 'react';
import { buySpecimen, openPack, sellBack, type Currency, type PackReveal, type Series, type Specimen, type TxResult } from '../data';
import { useApp } from '../lib/store';
import { useStill } from '../lib/stills';
import { clientSeed } from '../lib/wallet';
import { buyback, marketPrice, mass, multiple, originLabel, pct, sol, usd } from '../lib/format';
import { BANDS, BAND_NAME, CATEGORY_NAME } from '../../shared/rules.ts';
import { FILE_ITEMS } from '../../shared/types.ts';
import { Overlay, Spinner, TxLine } from './Overlay';
import { api } from '../lib/api';

function PayWith({ value, onChange, price }: { value: Currency; onChange: (c: Currency) => void; price: number }) {
  const { data } = useApp();
  return (
    <div className="pay" role="radiogroup" aria-label="Pay with">
      {(['USDC', 'SOL'] as Currency[]).map(c => (
        <button key={c} type="button" role="radio" aria-checked={value === c} className={value === c ? 'on' : ''} onClick={() => onChange(c)}>
          <b className="mono">{c}</b><span>{c === 'USDC' ? usd(price) : sol(price, data.rules)}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- market ---------- */

export function BuyDialog({ specimen }: { specimen: Specimen }) {
  const { data, open, refresh, toast } = useApp();
  const [cur, setCur] = useState<Currency>('USDC');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const img = useStill(specimen.render, { w: 520, h: 346, rot: -1.25, scale: 1.35 }, specimen.photo);
  const price = marketPrice(specimen.vault_value_usd!, data.rules);
  const done = specimen.file_done ?? [];

  const buy = async () => {
    setBusy(true); setErr('');
    try {
      const r = await buySpecimen(specimen.id, cur);
      await refresh();
      toast(`${specimen.name} is yours`);
      open({ kind: 'reveal', reveal: r.reveal, payment: r.payment, mint: r.mint, via: 'market' });
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  return (
    <Overlay label={`Buy ${specimen.name}`} wide title={<div className="sec mono"><span>The market</span><span>{specimen.id}</span></div>}>
      <div className="co">
        <div className="co-ph"><img src={img} alt={`${specimen.name}, ${specimen.class}`} /></div>
        <div className="co-bd">
          <h3>{specimen.name}</h3>
          <div className="cl mono">{specimen.class} · {mass(specimen.mass_g)} · {originLabel(specimen)}</div>
          <ul className="chk">
            {FILE_ITEMS.map((f, i) => <li key={f.key} className={done[i] ? 'y' : ''}>{f.label}</li>)}
          </ul>
          <dl className="kv"><dt>Vault value</dt><dd>{usd(specimen.vault_value_usd!)}</dd><dt>Fixed price</dt><dd>{usd(price)}</dd><dt>Instant offer if you sell back, {pct(data.rules.buyback_share)}%</dt><dd>{usd(buyback(specimen.vault_value_usd!, data.rules))}</dd></dl>
          <PayWith value={cur} onChange={setCur} price={price} />
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn wide" type="button" onClick={buy} disabled={busy}>{busy ? <><Spinner label="Paying" />Confirming…</> : `Buy for ${cur === 'USDC' ? usd(price) : sol(price, data.rules)}`}</button>
          <p className="fine">Minted to your wallet on Solana when you buy. Simulated chain on this preview: nothing is charged.</p>
        </div>
      </div>
    </Overlay>
  );
}

/* ---------- packs ---------- */

export function PackDialog({ series }: { series: Series }) {
  const { data, open, refresh, toast } = useApp();
  const [cur, setCur] = useState<Currency>('USDC');
  const [phase, setPhase] = useState<'review' | 'opening'>('review');
  const [err, setErr] = useState('');
  const [seed] = useState(clientSeed);
  const price = series.pack_price_usd ?? 0;
  const left = series.remaining.floor + series.remaining.par + series.remaining.hit;

  const go = async () => {
    setErr(''); setPhase('opening');
    const t0 = Date.now();
    try {
      const r = await openPack(series.id, cur, seed);
      await new Promise(res => setTimeout(res, Math.max(0, 1900 - (Date.now() - t0)))); // let the capsule turn
      await refresh();
      if (r.reveal.band === 'hit') toast('A hit. Film this one.');
      open({ kind: 'reveal', reveal: r.reveal, payment: r.payment, mint: r.mint, via: 'pack' });
    } catch (e: any) { setErr(e.message); setPhase('review'); }
  };

  return (
    <Overlay label={`Open a pack from ${series.name}`} title={<div className="sec mono"><span>The packs</span><span>{series.name}</span></div>}>
      {phase === 'opening' ? (
        <div className="opening" aria-live="polite">
          <div className="capsule" aria-hidden="true"><i /><i /><i /></div>
          <p className="mono">Drawing one of {left} sealed packs…</p>
        </div>
      ) : (
        <>
          <h3 className="dlg-h">One sealed pack, one real specimen.</h3>
          <div className="odds">
            {BANDS.map(b => (
              <div key={b}><span className="mono"><i className={'c-' + b} />{BAND_NAME[b]}</span><b>{series.remaining[b]}</b><em className="mono">{left ? Math.round(series.remaining[b] / left * 1000) / 10 : 0}%</em></div>
            ))}
          </div>
          {series.left_by_class.length > 0 && (
            <p className="live mono">{series.left_by_class.map(c => `${c.left} ${c.label}`).join(' · ')} left in this pool</p>
          )}
          <dl className="kv"><dt>Pack price</dt><dd>{usd(price)}</dd><dt>Floor, in vault value</dt><dd>{usd(price * data.rules.bands.floor.min)} or more</dd><dt>Packs left</dt><dd>{left} of {series.size}</dd></dl>
          <PayWith value={cur} onChange={setCur} price={price} />
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn wide" type="button" onClick={go} disabled={!left}>Open a pack for {cur === 'USDC' ? usd(price) : sol(price, data.rules)}</button>
          <p className="fine">Verifiable draw without replacement. Commitment <code>{series.commit_hash?.slice(0, 12)}…</code>, your seed <code>{seed}</code>. Simulated chain on this preview: nothing is charged.</p>
        </>
      )}
    </Overlay>
  );
}

/* ---------- the reveal ---------- */

const PIECE: Record<string, string> = { martian: 'a piece of Mars', lunar: 'a piece of the Moon' };

export function RevealDialog({ reveal, payment, mint, via }: { reveal: PackReveal; payment?: TxResult; mint?: string; via: 'pack' | 'market' | 'holding' }) {
  const { data, open, close, refresh, toast } = useApp();
  const sp = reveal.specimen;
  const img = useStill(sp.render, { w: 520, h: 346, rot: -1.25, scale: 1.35 }, sp.photo);
  const offer = buyback(reveal.vault_value_usd, data.rules);
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'sold'>('idle');
  const [sold, setSold] = useState<TxResult | null>(null);
  const [err, setErr] = useState('');

  const sell = async () => {
    setState('busy'); setErr('');
    try { const r = await sellBack(sp.id); setSold(r.payout); setState('sold'); await refresh(); toast(`Sold back for ${usd(r.usd)} USDC`); } catch (e: any) { setErr(e.message); setState('idle'); }
  };

  const chip = via === 'market' ? 'MARKET' : `${reveal.band.toUpperCase()} · ${multiple(reveal.vault_value_usd, reveal.pack_price_usd || reveal.vault_value_usd)}×`;
  return (
    <Overlay label={`Reveal: ${sp.name}`} title={<div className="sec mono"><span>{via === 'pack' ? (reveal.bonus ? 'Bonus pull' : 'The reveal') : 'It’s yours'}</span><span>{sp.id}</span></div>}>
      <div className="reveal in-dlg">
        <div className="ph"><img alt={`${sp.name}, ${sp.class}, ${mass(sp.mass_g)}`} src={img} /><span className={'chip' + (reveal.band !== 'hit' && via !== 'market' ? ' ' + reveal.band : '')}>{chip}</span></div>
        <div className="bd">
          <h3>{sp.name}</h3>
          <div className="cl mono">{sp.class} · {mass(sp.mass_g)} · {sp.id}</div>
          <dl className="kv">
            {via !== 'holding' && <><dt>{via === 'market' ? 'Price paid' : 'Pack price'}</dt><dd>{usd(reveal.pack_price_usd)}</dd></>}
            <dt>Vault value</dt><dd>{usd(reveal.vault_value_usd)}</dd>
            <dt>Instant offer, {pct(data.rules.buyback_share)}%</dt><dd className="hot">{usd(offer)}</dd>
          </dl>
          {state === 'sold' ? (
            <>
              <p className="ok">Sold back. {usd(offer)} USDC is on its way to your wallet; the rock goes into the next unopened series.</p>
              {sold && <TxLine tx={sold.tx} simulated={sold.simulated} label="Payout" />}
              <div className="acts"><button className="btn" type="button" onClick={close}>Done</button></div>
            </>
          ) : state === 'confirm' || state === 'busy' ? (
            <>
              <p className="dlg-p">Sell {sp.name} back for {usd(offer)} USDC? The NFT is burned and the specimen returns to the vault.</p>
              <div className="acts">
                <button className="btn" type="button" onClick={sell} disabled={state === 'busy'}>{state === 'busy' ? <><Spinner label="Selling" />Selling…</> : `Yes, sell for ${usd(offer)}`}</button>
                <button className="btn line" type="button" onClick={() => setState('idle')} disabled={state === 'busy'}>Keep it</button>
              </div>
            </>
          ) : (
            <div className="acts">
              <button className="btn" type="button" onClick={() => { toast('Kept in your vault'); close(); }}>Hold</button>
              <button className="btn line" type="button" onClick={() => setState('confirm')}>Sell back for {usd(offer)}</button>
              <button className="btn line" type="button" onClick={() => open({ kind: 'redeem', specimen: sp })}>Redeem</button>
              <button className="btn line" type="button" onClick={() => open({ kind: 'share', reveal })}>Share</button>
            </div>
          )}
          {err && <p className="err" role="alert">{err}</p>}
          {state !== 'sold' && payment && <TxLine tx={payment.tx} simulated={payment.simulated} label={`Paid ${payment.currency === 'SOL' ? payment.amount + ' SOL' : usd(payment.amount)}`} />}
          {state !== 'sold' && mint && <TxLine tx={mint} simulated={payment?.simulated} label="NFT mint" />}
        </div>
      </div>
      {via === 'pack' && PIECE[sp.render.type] && state !== 'sold' && <p className="brag mono">You pulled {PIECE[sp.render.type]}.</p>}
      {via !== 'pack' && <p className="fine">{CATEGORY_NAME[sp.render.type]} · held in the vault under your wallet until you decide what happens next.</p>}
    </Overlay>
  );
}

/* ---------- collector listings ---------- */

export function BuyListingDialog({ listing }: { listing: import('../data').Listing }) {
  const { data, open, refresh, toast } = useApp();
  const sp = listing.specimen;
  const [cur, setCur] = useState<Currency>('USDC');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const img = useStill(sp.render, { w: 520, h: 346, rot: -1.25, scale: 1.35 }, sp.photo);
  const done = sp.file_done ?? [];
  const buy = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api<{ reveal: PackReveal; payment: TxResult; mint: string }>('POST', `/api/listings/${listing.id}/buy`, { currency: cur });
      await refresh();
      toast(`${sp.name} is yours`);
      open({ kind: 'reveal', reveal: r.reveal, payment: r.payment, mint: r.mint, via: 'market' });
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Overlay label={`Buy ${sp.name} from ${listing.seller}`} wide title={<div className="sec mono"><span>From collectors</span><span>{sp.id}</span></div>}>
      <div className="co">
        <div className="co-ph"><img src={img} alt={`${sp.name}, ${sp.class}`} /></div>
        <div className="co-bd">
          <h3>{sp.name}</h3>
          <div className="cl mono">{sp.class} · {mass(sp.mass_g)} · {originLabel(sp)}</div>
          <p className="seller mono">Listed by <b>{listing.seller}</b></p>
          <ul className="chk">{FILE_ITEMS.map((f, i) => <li key={f.key} className={done[i] ? 'y' : ''}>{f.label}</li>)}</ul>
          <dl className="kv"><dt>Vault value</dt><dd>{sp.vault_value_usd != null ? usd(sp.vault_value_usd) : '—'}</dd><dt>Collector’s price</dt><dd>{usd(listing.price_usd)}</dd>{sp.vault_value_usd != null && <><dt>Instant offer if you sell back</dt><dd>{usd(buyback(sp.vault_value_usd, data.rules))}</dd></>}</dl>
          <PayWith value={cur} onChange={setCur} price={listing.price_usd} />
          {err && <p className="err" role="alert">{err}</p>}
          {listing.mine ? <p className="ok">This is your listing. Manage it from your account.</p> : (
            <button className="btn wide" type="button" onClick={buy} disabled={busy}>{busy ? <><Spinner label="Paying" />Confirming…</> : `Buy for ${cur === 'USDC' ? usd(listing.price_usd) : sol(listing.price_usd, data.rules)}`}</button>
          )}
          <p className="fine">The rock stays sealed in the vault; the NFT moves to you. {pct(data.rules.royalty)}% of the price goes back to the vault’s inventory. Simulated chain on this preview.</p>
        </div>
      </div>
    </Overlay>
  );
}
