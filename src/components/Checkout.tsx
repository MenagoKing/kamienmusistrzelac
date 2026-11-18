import { useEffect, useState } from 'react';
import { buySpecimen, openPack, sellBack, type Currency, type Listing, type PackReveal, type Reservation, type Series, type Specimen, type TxResult } from '../data';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { useStill } from '../lib/stills';
import { clientSeed } from '../lib/wallet';
import { buyback, marketPrice, mass, multiple, originLabel, pct, rockPriceOf, sol, usd } from '../lib/format';
import { BANDS, BAND_NAME, TIER_NAME, rarityOf, tokenPrice } from '../../shared/rules.ts';
import { FILE_ITEMS } from '../../shared/types.ts';
import { Overlay, Spinner, TxLine } from './Overlay';
import { Media } from './Media';
import { RockView } from './RockView';
import type { PlanetKind } from '../lib/planet';

/** Pay with USDC or SOL, and the project token once it is switched on (with its saving shown). */
function PayWith({ value, onChange, price, allowToken = false }: { value: Currency; onChange: (c: Currency) => void; price: number; allowToken?: boolean }) {
  const { data } = useApp();
  const tk = data.token;
  const opts: Currency[] = allowToken && tk?.enabled ? ['USDC', 'SOL', 'TOKEN'] : ['USDC', 'SOL'];
  return (
    <div className={'pay' + (opts.length === 3 ? ' three' : '')} role="radiogroup" aria-label="Pay with">
      {opts.map(c => {
        const p = c === 'TOKEN' ? tokenPrice(price, data.rules) : price;
        return (
          <button key={c} type="button" role="radio" aria-checked={value === c} className={value === c ? 'on' : ''} onClick={() => onChange(c)}>
            <b className="mono">{c === 'TOKEN' ? '$' + tk.symbol : c}</b>
            <span>{c === 'USDC' ? usd(p) : c === 'SOL' ? sol(p, data.rules) : tokenUnits(p, tk)}</span>
            {c === 'TOKEN' && <em className="save mono">Save {usd(price - p)}</em>}
          </button>
        );
      })}
    </div>
  );
}

const tokenUnits = (usdValue: number, tk: { price_usd: number | null; symbol: string }) =>
  tk.price_usd ? `${(usdValue / tk.price_usd).toLocaleString('en-US', { maximumFractionDigits: usdValue / tk.price_usd > 100 ? 0 : 2 })} ${tk.symbol}` : '';

/** "Reserve for $110.00", "… for 0.733 SOL", "… for 209 ROCKS" */
function payLabel(verb: string, cur: Currency, price: number, rules: any, tk: { price_usd: number | null; symbol: string }) {
  if (cur === 'SOL') return `${verb} for ${sol(price, rules)}`;
  if (cur === 'TOKEN') return `${verb} for ${tokenUnits(tokenPrice(price, rules), tk)}`;
  return `${verb} for ${usd(price)}`;
}

/* ---------- the NFT, live ---------- */

const explorerUrl = (mint: string, cluster: string) => `https://explorer.solana.com/address/${mint}${cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`}`;

/** Shows the specimen's NFT as it is minted on Solana, with a link to the explorer once it exists. */
export function NftLine({ specimenId }: { specimenId: string }) {
  const { data } = useApp();
  const [s, setS] = useState<{ mint?: string | null; mint_status?: string; nft_owner?: string | null } | null>(null);
  useEffect(() => {
    let alive = true, n = 0;
    const tick = async () => {
      try { const r = await api<Specimen>('GET', `/api/specimens/${specimenId}`); if (!alive) return; setS(r); if (['pending', 'burning'].includes(r.mint_status ?? '') && n++ < 60) setTimeout(tick, 3000); } catch { /* keep trying quietly */ if (alive && n++ < 60) setTimeout(tick, 4000); }
    };
    tick();
    return () => { alive = false; };
  }, [specimenId]);
  const cluster = data.chain?.cluster ?? 'devnet';
  if (!s) return null;
  if (s.mint_status === 'minted' && s.mint) {
    return (
      <div className="nftl ok">
        <i aria-hidden="true">◆</i>
        <span><b>NFT minted on Solana {cluster === 'simulated' ? '(simulated)' : cluster}</b><small className="mono">{s.mint.slice(0, 6)}…{s.mint.slice(-6)}{s.nft_owner ? ` · held by ${s.nft_owner.slice(0, 4)}…${s.nft_owner.slice(-4)}` : ''}</small></span>
        {cluster !== 'simulated' && <a href={explorerUrl(s.mint, cluster)} target="_blank" rel="noreferrer">Explorer ↗</a>}
      </div>
    );
  }
  if (s.mint_status === 'pending') return <div className="nftl"><Spinner label="Minting" /><span><b>Minting your NFT on Solana {cluster}…</b><small className="mono">Metaplex Core · full specimen file on-chain</small></span></div>;
  if (s.mint_status === 'failed') return <div className="nftl warn"><i aria-hidden="true">!</i><span><b>Minting is delayed</b><small className="mono">It retries automatically; the specimen is already yours.</small></span></div>;
  if (s.mint_status === 'burned' || s.mint_status === 'burning') return <div className="nftl"><i aria-hidden="true">◇</i><span><b>NFT burned</b><small className="mono">The specimen left your wallet.</small></span></div>;
  return null;
}

/* ---------- after the reveal: hold, cancel or sell back, redeem, share ---------- */

function RevealActions({ reveal, reservation, onDone, extra, confirm }: { reveal: PackReveal; reservation?: Reservation | null; onDone: () => void; extra?: React.ReactNode; confirm?: boolean }) {
  if (reservation) return <ReservationActions reveal={reveal} reservation={reservation} onDone={onDone} extra={extra} confirm={confirm} />;
  return <OwnedActions reveal={reveal} onDone={onDone} extra={extra} confirm={confirm} />;
}

/** Dealer-sourced: cancel refunds the rock's price (the commission is kept). */
function ReservationActions({ reveal, reservation, onDone, extra, confirm }: { reveal: PackReveal; reservation: Reservation; onDone: () => void; extra?: React.ReactNode; confirm?: boolean }) {
  const { open, refresh, toast } = useApp();
  const sp = reveal.specimen;
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'done'>(confirm ? 'confirm' : 'idle');
  const [payout, setPayout] = useState<TxResult | null>(null);
  const [err, setErr] = useState('');
  const back = reservation.escrow_usd || reservation.reserved_price_usd;
  const cancel = async () => {
    setState('busy'); setErr('');
    try {
      const r = await api<{ refunded_usd: number; payout: TxResult }>('POST', `/api/reservations/${reservation.id}/cancel`, {});
      setPayout(r.payout); setState('done'); await refresh(); toast(`Cancelled: ${usd(r.refunded_usd)} back in USDC`);
    } catch (e: any) { setErr(e.message); setState('idle'); }
  };
  if (reservation.status === 'sold_at_source') return <p className="err">The dealer sold this specimen. Open it from your account to pick a replacement or take a full refund.</p>;
  if (state === 'done') return (
    <>
      <p className="ok">Cancelled. {usd(back)}, the rock’s price, is on its way in USDC; the commission is kept. The NFT is burned.</p>
      {payout && <TxLine tx={payout.tx} simulated={payout.simulated} label="Refund" />}
      <div className="acts"><button className="btn" type="button" onClick={onDone}>Done</button>{extra}</div>
    </>
  );
  if (state === 'confirm' || state === 'busy') return (
    <>
      <p className="dlg-p">Cancel your reservation of {sp.name}? {usd(back)} (the rock’s price) comes back in USDC; the {usd(reservation.commission_usd)} commission is kept.</p>
      <div className="acts">
        <button className="btn" type="button" onClick={cancel} disabled={state === 'busy'}>{state === 'busy' ? <><Spinner label="Cancelling" />Cancelling…</> : `Yes, cancel and get ${usd(back)}`}</button>
        <button className="btn line" type="button" onClick={() => setState('idle')} disabled={state === 'busy'}>Keep it</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
    </>
  );
  return (
    <>
      <div className="acts">
        <button className="btn" type="button" onClick={() => { toast('Reserved for you'); onDone(); }}>Keep it</button>
        <button className="btn line" type="button" onClick={() => setState('confirm')}>Cancel · {usd(back)} back</button>
        <button className="btn line" type="button" onClick={() => open({ kind: 'redeem', specimen: sp, reservation })}>Redeem</button>
        <button className="btn line" type="button" onClick={() => open({ kind: 'share', reveal })}>Share</button>
        {extra}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
    </>
  );
}

/** Own stock (pack pulls): instant buyback offer. */
function OwnedActions({ reveal, onDone, extra, confirm }: { reveal: PackReveal; onDone: () => void; extra?: React.ReactNode; confirm?: boolean }) {
  const { data, open, refresh, toast } = useApp();
  const sp = reveal.specimen;
  const offer = buyback(reveal.vault_value_usd, data.rules);
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'sold'>(confirm ? 'confirm' : 'idle');
  const [sold, setSold] = useState<TxResult | null>(null);
  const [err, setErr] = useState('');
  const sell = async () => {
    setState('busy'); setErr('');
    try { const r = await sellBack(sp.id); setSold(r.payout); setState('sold'); await refresh(); toast(`Sold back for ${usd(r.usd)} USDC`); } catch (e: any) { setErr(e.message); setState('idle'); }
  };
  if (state === 'sold') return (
    <>
      <p className="ok">Sold back. {usd(offer)} USDC is on its way; the NFT is burned and the rock goes into the next unopened series.</p>
      {sold && <TxLine tx={sold.tx} simulated={sold.simulated} label="Payout" />}
      <div className="acts"><button className="btn" type="button" onClick={onDone}>Done</button>{extra}</div>
    </>
  );
  if (state === 'confirm' || state === 'busy') return (
    <>
      <p className="dlg-p">Sell {sp.name} back for {usd(offer)} USDC? The NFT is burned and the specimen goes into the next pack series.</p>
      <div className="acts">
        <button className="btn" type="button" onClick={sell} disabled={state === 'busy'}>{state === 'busy' ? <><Spinner label="Selling" />Selling…</> : `Yes, sell for ${usd(offer)}`}</button>
        <button className="btn line" type="button" onClick={() => setState('idle')} disabled={state === 'busy'}>Keep it</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
    </>
  );
  return (
    <>
      <div className="acts">
        <button className="btn" type="button" onClick={() => { toast('Kept in your collection'); onDone(); }}>Keep it</button>
        <button className="btn line" type="button" onClick={() => setState('confirm')}>Sell back · {usd(offer)}</button>
        <button className="btn line" type="button" onClick={() => open({ kind: 'redeem', specimen: sp })}>Redeem</button>
        <button className="btn line" type="button" onClick={() => open({ kind: 'share', reveal })}>Share</button>
        {extra}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
    </>
  );
}

/* ---------- market ---------- */

/** Rarity badge: class first, then price. */
export function Rarity({ type, price }: { type: Specimen['render']['type']; price: number | null | undefined }) {
  const r = rarityOf(type, price);
  return <span className={'rar ' + r.toLowerCase()}>{r}</span>;
}

export function BuyDialog({ specimen: initial }: { specimen: Specimen }) {
  const { data, open, refresh, toast } = useApp();
  const [specimen, setSpecimen] = useState(initial);
  const [cur, setCur] = useState<Currency>('USDC');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [gone, setGone] = useState(false);
  const rock = rockPriceOf(specimen) ?? 0;
  const price = marketPrice(rock, data.rules);
  const sourced = !!specimen.sourced;
  const done = specimen.file_done ?? [];
  const buy = async () => {
    setBusy(true); setErr('');
    try {
      const r = await buySpecimen(specimen.id, cur, price);
      await refresh();
      toast(sourced ? `${specimen.name} is reserved for you` : `${specimen.name} is yours`);
      open({ kind: 'reveal', reveal: r.reveal, payment: r.payment, via: 'market', reservation: r.reservation ?? null });
    } catch (e: any) {
      setBusy(false);
      const d = e?.data;
      if (d?.code === 'changed' || d?.available === false) {
        // Live re-check: the dealer's price or availability changed. Stop, show the fresh state.
        try { const fresh = await api<Specimen>('GET', `/api/specimens/${specimen.id}`); setSpecimen(fresh); } catch { /* keep */ }
        refresh();
        if (d?.available === false) setGone(true);
      }
      setErr(e.message);
    }
  };
  return (
    <Overlay label={`Reserve ${specimen.name}`} wide title={<div className="sec mono"><span>The market</span><span>{specimen.id}</span></div>}>
      <div className="co">
        <Media hint={specimen.render} photos={specimen.photos} label={specimen.name} className="co-ph" />
        <div className="co-bd">
          <Rarity type={specimen.render.type} price={rock} />
          <h3>{specimen.name}</h3>
          <div className="cl mono">{specimen.class} · {mass(specimen.mass_g)} · {originLabel(specimen)}</div>
          <ul className="chk">{FILE_ITEMS.map((f, i) => <li key={f.key} className={done[i] ? 'y' : ''}>{f.label}</li>)}</ul>
          {sourced ? (
            <dl className="kv">
              <dt>Rock price, held in escrow</dt><dd>{usd(rock)}</dd>
              <dt>Commission, {pct(data.rules.market_markup - 1)}%</dt><dd>{usd(price - rock)}</dd>
              <dt>You pay</dt><dd className="hot">{usd(price)}</dd>
              <dt>If you cancel later</dt><dd>{usd(rock)} back</dd>
            </dl>
          ) : (
            <dl className="kv"><dt>Rock value</dt><dd>{usd(rock)}</dd><dt>Fixed price</dt><dd>{usd(price)}</dd><dt>Instant offer if you sell back, {pct(data.rules.buyback_share)}%</dt><dd>{usd(buyback(rock, data.rules))}</dd></dl>
          )}
          <PayWith value={cur} onChange={setCur} price={price} allowToken={sourced} />
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn wide" type="button" onClick={buy} disabled={busy || gone}>{busy ? <><Spinner label="Checking with the dealer" />Checking price and availability…</> : gone ? 'No longer available' : payLabel(sourced ? 'Reserve' : 'Buy', cur, price, data.rules, data.token)}</button>
          <p className="fine">{sourced
            ? 'Sourced from an independent certified dealer, purchased and shipped when you redeem. Reserved for you the moment you pay and minted to you as an NFT on Solana. Price and availability are checked again when you confirm.'
            : 'From our own stock. Minted to you as a Metaplex Core NFT on Solana with the full specimen file.'} Payments on this preview are simulated: nothing is charged.</p>
        </div>
      </div>
    </Overlay>
  );
}

export function BuyListingDialog({ listing }: { listing: Listing }) {
  const { data, open, refresh, toast } = useApp();
  const sp = listing.specimen;
  const [cur, setCur] = useState<Currency>('USDC');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const done = sp.file_done ?? [];
  const rock = rockPriceOf(sp);
  const buy = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api<{ reveal: PackReveal; payment: TxResult; mint: string }>('POST', `/api/listings/${listing.id}/buy`, { currency: cur });
      await refresh();
      toast(`${sp.name} is yours`);
      open({ kind: 'reveal', reveal: r.reveal, payment: r.payment, via: 'market' });
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Overlay label={`Buy ${sp.name} from ${listing.seller}`} wide title={<div className="sec mono"><span>From collectors</span><span>{sp.id}</span></div>}>
      <div className="co">
        <Media hint={sp.render} photos={sp.photos} label={sp.name} className="co-ph" />
        <div className="co-bd">
          <Rarity type={sp.render.type} price={rock} />
          <h3>{sp.name}</h3>
          <div className="cl mono">{sp.class} · {mass(sp.mass_g)} · {originLabel(sp)}</div>
          <p className="seller mono">Listed by <b>{listing.seller}</b></p>
          <ul className="chk">{FILE_ITEMS.map((f, i) => <li key={f.key} className={done[i] ? 'y' : ''}>{f.label}</li>)}</ul>
          <dl className="kv">
            <dt>{sp.sourced ? 'Rock price in its escrow' : 'Rock value'}</dt><dd>{rock != null ? usd(rock) : '—'}</dd>
            <dt>Collector’s price</dt><dd>{usd(listing.price_usd)}</dd>
            {rock != null && (sp.sourced ? <><dt>If you cancel later</dt><dd>{usd(rock)} back</dd></> : <><dt>Instant offer if you sell back</dt><dd>{usd(buyback(rock, data.rules))}</dd></>)}
          </dl>
          <PayWith value={cur} onChange={setCur} price={listing.price_usd} />
          {err && <p className="err" role="alert">{err}</p>}
          {listing.mine ? <p className="ok">This is your listing. Manage it from your account.</p> : (
            <button className="btn wide" type="button" onClick={buy} disabled={busy}>{busy ? <><Spinner label="Paying" />Confirming…</> : payLabel('Buy', cur, listing.price_usd, data.rules, data.token)}</button>
          )}
          <p className="fine">{sp.sourced ? 'The reservation and its escrow move to you with the NFT; the dealer ships when you redeem.' : 'The NFT moves to you on Solana.'} {pct(data.rules.royalty)}% of the price goes to the platform as a royalty. Payments on this preview are simulated.</p>
        </div>
      </div>
    </Overlay>
  );
}

/* ---------- packs: choosing ---------- */

const BAND_NOTE: Record<string, string> = { floor: 'The guaranteed minimum', par: 'About what you paid, or more', hit: 'The pulls worth filming' };

function MiniRock({ type }: { type: Specimen['render']['type'] }) {
  const seed = { stone: 47, iron: 57, pallasite: 33, lunar: 81, martian: 21 }[type];
  const img = useStill({ type, seed }, { w: 72, h: 72, rot: -1.9, scale: 1.5 });
  return <span className="mini">{img && <img src={img} alt="" />}</span>;
}

export function PackDialog({ series }: { series: Series }) {
  const { data, open } = useApp();
  const [cur, setCur] = useState<Currency>('USDC');
  const price = series.pack_price_usd ?? 0;
  const left = series.remaining.floor + series.remaining.par + series.remaining.hit;
  const b = data.rules.bands;
  const range = (k: 'floor' | 'par' | 'hit') => b[k].max == null ? `${usd(price * b[k].min)}+` : `${usd(price * b[k].min)} – ${usd(price * b[k].max!)}`;
  return (
    <Overlay wide label={`Open a pack from ${series.name}`} title={<div className="sec mono"><span>The packs</span><span>{series.name} · {TIER_NAME[series.tier]}</span></div>}>
      <div className="pk2">
        <div className="pk2-pack">
          <PackCover series={series} />
          <p className="mono">{left} of {series.size} still sealed · drag the planet</p>
        </div>
        <div className="pk2-bd">
          <h3 className="dlg-h">One pack. One real specimen.</h3>
          <p className="dlg-p">Its vault value is guaranteed to be at least <b>{usd(price * b.floor.min)}</b>, {pct(b.floor.min)}% of the price. A verifiable draw picks one of the packs still sealed.</p>
          <div className="odds2" role="table" aria-label="What can be inside">
            {BANDS.map(k => {
              const chance = left ? series.remaining[k] / left : 0;
              return (
                <div key={k} className={'o2 ' + k} role="row">
                  <span className="o2-n"><i />{BAND_NAME[k]}</span>
                  <span className="o2-v"><b>{range(k)}</b><small>{BAND_NOTE[k]}</small></span>
                  <span className="o2-c"><b>{Math.round(chance * 1000) / 10}%</b><small className="mono">{series.remaining[k]} left</small></span>
                  <u style={{ width: chance * 100 + '%' }} />
                </div>
              );
            })}
          </div>
          {series.left_by_class.length > 0 && (
            <div className="cls2"><span className="mono">Still sealed</span>{series.left_by_class.map(c => <span key={c.type} className="cl2"><MiniRock type={c.type} /><b>{c.left}</b> {c.label}</span>)}</div>
          )}
          <ol className="how2"><li><b>1</b>Pay</li><li><b>2</b>The draw picks a sealed pack</li><li><b>3</b>The rock is yours, minted as an NFT</li></ol>
          <PayWith value={cur} onChange={setCur} price={price} />
          <button className="btn wide big" type="button" disabled={!left} onClick={() => open({ kind: 'opening', series, currency: cur, seed: clientSeed() })}>Open a pack · {cur === 'USDC' ? usd(price) : sol(price, data.rules)}</button>
          <p className="fine">Verifiable draw, no replacement: commitment <code>{series.commit_hash?.slice(0, 12)}…</code>. <button type="button" className="lnk" onClick={() => open({ kind: 'proof', seriesId: series.id, name: series.name })}>Check every draw</button>. Payments on this preview are simulated.</p>
        </div>
      </div>
    </Overlay>
  );
}

/* ---------- packs: the opening ---------- */

const PIECE: Record<string, string> = { martian: 'a piece of Mars', lunar: 'a piece of the Moon', pallasite: 'a piece of a planet’s core', iron: 'a piece of an asteroid’s core', stone: 'a piece of another world' };

const TIER_PLANET: Record<Series['tier'], PlanetKind> = { earth: 'earth', orbit: 'moon', mars: 'mars', launch: 'earth' };
const TIER_LINE: Record<Series['tier'], string> = { earth: 'Chondrite and iron fragments', orbit: 'Pallasites and rare classes', mars: 'Lunar and Martian chances', launch: 'Limited launch drop pool' };

/** The pack itself: a sealed card with its planet in 3D (Earth for Earth packs, the Moon, Mars). */
export function PackCover({ series, still }: { series: Series; still?: boolean }) {
  const kind = TIER_PLANET[series.tier];
  return (
    <div className={'pcov tier-' + series.tier}>
      <div className="pcov-in">
        <div className="pcov-top mono"><span>Space Rocks</span><span>{series.name}</span></div>
        <div className="pcov-planet">
          <i className="pcov-orbit" aria-hidden="true" />
          <RockView hint={{ type: 'stone', seed: 1 }} model={kind} mode="live" auto={still ? 0.12 : 0.22} scale={1.05} label={`${kind === 'earth' ? 'Earth' : kind === 'moon' ? 'The Moon' : 'Mars'} in 3D. Drag to turn it.`} />
        </div>
        <div className="pcov-bt">
          <b>{TIER_NAME[series.tier]} pack</b>
          <span className="mono">{TIER_LINE[series.tier]}</span>
          <span className="pcov-seal mono">1 real meteorite · sealed</span>
        </div>
      </div>
      <i className="pcov-sheen" aria-hidden="true" />
    </div>
  );
}

/** Full screen: the pack glows, opens along a seam of light, and the drawn specimen appears. */
export function PackOpening({ series, currency, seed }: { series: Series; currency: Currency; seed: string }) {
  const { data, close, open, refresh } = useApp();
  const [phase, setPhase] = useState<'charge' | 'open' | 'reveal'>('charge');
  const [res, setRes] = useState<{ reveal: PackReveal; payment: TxResult } | null>(null);
  const [err, setErr] = useState('');
  const [minTime, setMinTime] = useState(false);
  const left = series.remaining.floor + series.remaining.par + series.remaining.hit;

  useEffect(() => {
    let alive = true;
    openPack(series.id, currency, seed).then(r => { if (alive) { setRes(r); refresh(); } }, e => alive && setErr(e.message));
    const t = setTimeout(() => alive && setMinTime(true), 1300);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (phase === 'charge' && res && minTime) setPhase('open');
    if (phase === 'open') { const t = setTimeout(() => setPhase('reveal'), 750); return () => clearTimeout(t); }
  }, [phase, res, minTime]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && (phase === 'reveal' || err)) close(); };
    addEventListener('keydown', k);
    document.documentElement.classList.add('locked');
    return () => { removeEventListener('keydown', k); document.documentElement.classList.remove('locked'); };
  }, [phase, err, close]);

  const band = res?.reveal.band ?? 'floor';
  const sp = res?.reveal.specimen;

  return (
    <div className={`opn2 ph-${phase} band-${band}`} role="dialog" aria-modal="true" aria-label="Opening your pack">
      <div className="opn2-glow" aria-hidden="true" />

      {phase !== 'reveal' && !err && (
        <div className="opn2-pack" aria-hidden="true">
          <div className="half top"><PackCover series={series} still /></div>
          <div className="half bot"><PackCover series={series} still /></div>
          <i className="seam" />
        </div>
      )}
      {phase !== 'reveal' && !err && <p className="opn2-status mono" aria-live="polite">{phase === 'charge' ? `Opening one of ${left} sealed packs…` : 'Here it is'}</p>}

      {sp && phase !== 'charge' && (
        <div className="opn2-stage">
          <div className="opn2-rock">
            <i className="halo" aria-hidden="true" />
            <i className="pedestal" aria-hidden="true" />
            <RockView hint={sp.render} mode="live" auto={0.4} scale={1.42} label={`${sp.name} in 3D. Drag to turn it.`} />
            <span className="opn2-drag mono" aria-hidden="true">Drag to turn it</span>
          </div>
          {res && phase === 'reveal' && (
            <div className="opn2-side">
              <div className="opn2-panel">
                <div className="opn2-top">
                  <span className={'chip' + (band !== 'hit' ? ' ' + band : '')}>{BAND_NAME[band].toUpperCase()} · {multiple(res.reveal.vault_value_usd, res.reveal.pack_price_usd)}×</span>
                  <span className="mono dim">{sp.id}</span>
                </div>
                <h3>{sp.name}</h3>
                <div className="cl mono">{sp.class} · {mass(sp.mass_g)}</div>
                <p className="brag">You pulled {PIECE[sp.render.type]}.</p>
                <dl className="kv">
                  <dt>Pack price</dt><dd>{usd(res.reveal.pack_price_usd)}</dd>
                  <dt>Rock value</dt><dd>{usd(res.reveal.vault_value_usd)}</dd>
                  <dt>Instant offer, {pct(data.rules.buyback_share)}%</dt><dd className="hot">{usd(buyback(res.reveal.vault_value_usd, data.rules))}</dd>
                </dl>
                <NftLine specimenId={sp.id} />
                <RevealActions reveal={res.reveal} onDone={close} extra={<button className="btn line" type="button" onClick={() => open({ kind: 'pack', series })}>Open another</button>} />
                <TxLine tx={res.payment.tx} simulated={res.payment.simulated} label={`Paid ${res.payment.currency === 'SOL' ? res.payment.amount + ' SOL' : usd(res.payment.amount)}`} />
                <button className="x opn-x" type="button" onClick={close} aria-label="Close"><i aria-hidden="true" /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="opn2-panel solo"><h3>The pack did not open.</h3><p className="dlg-p">{err}</p><div className="acts"><button className="btn" type="button" onClick={close}>Back</button></div></div>
      )}
    </div>
  );
}

/* ---------- the reveal (market buys, holdings) ---------- */

export function RevealDialog({ reveal, payment, via, reservation, confirm }: { reveal: PackReveal; payment?: TxResult; mint?: string; via: 'pack' | 'market' | 'holding'; reservation?: Reservation | null; confirm?: boolean }) {
  const { close, data } = useApp();
  const sp = reveal.specimen;
  const chip = reservation ? 'RESERVED' : via === 'market' ? 'MARKET' : `${reveal.band.toUpperCase()} · ${multiple(reveal.vault_value_usd, reveal.pack_price_usd || reveal.vault_value_usd)}×`;
  return (
    <Overlay label={`${sp.name}`} title={<div className="sec mono"><span>{via === 'holding' ? 'Your collection' : reservation ? 'Reserved for you' : 'It’s yours'}</span><span>{sp.id}</span></div>}>
      <div className="reveal in-dlg">
        <div className="ph r3dph"><RockView hint={sp.render} mode="live" auto={0.35} scale={1.35} label={`${sp.name} in 3D. Drag to turn it.`} /><span className={'chip' + (reveal.band !== 'hit' && via !== 'market' && !reservation ? ' ' + reveal.band : '')}>{chip}</span></div>
        <div className="bd">
          <h3>{sp.name}</h3>
          <div className="cl mono">{sp.class} · {mass(sp.mass_g)} · {sp.id}</div>
          <RevealKv reveal={reveal} via={via} reservation={reservation} />
          {reservation && <p className="fine src-line">Sourced from an independent certified dealer, purchased and shipped when you redeem.</p>}
          {via !== 'holding' && <NftLine specimenId={sp.id} />}
          <RevealActions reveal={reveal} reservation={reservation} onDone={close} confirm={confirm} />
          {payment && <TxLine tx={payment.tx} simulated={payment.simulated} label={`Paid ${payment.currency === 'SOL' ? payment.amount + ' SOL' : payment.currency === 'TOKEN' ? payment.amount.toLocaleString('en-US') + ' ' + data.token.symbol : usd(payment.amount)}`} />}
        </div>
      </div>
    </Overlay>
  );
}

function RevealKv({ reveal, via, reservation }: { reveal: PackReveal; via: string; reservation?: Reservation | null }) {
  const { data } = useApp();
  if (reservation) return (
    <dl className="kv">
      <dt>You paid</dt><dd>{usd(reservation.paid_usd)}</dd>
      <dt>Rock price, held in escrow</dt><dd>{usd(reservation.escrow_usd || reservation.reserved_price_usd)}</dd>
      <dt>If you cancel</dt><dd className="hot">{usd(reservation.escrow_usd || reservation.reserved_price_usd)} back</dd>
    </dl>
  );
  return (
    <dl className="kv">
      {via !== 'holding' && <><dt>{via === 'market' ? 'Price paid' : 'Pack price'}</dt><dd>{usd(reveal.pack_price_usd)}</dd></>}
      <dt>Rock value</dt><dd>{usd(reveal.vault_value_usd)}</dd>
      <dt>Instant offer, {pct(data.rules.buyback_share)}%</dt><dd className="hot">{usd(buyback(reveal.vault_value_usd, data.rules))}</dd>
    </dl>
  );
}
