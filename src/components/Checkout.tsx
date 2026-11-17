import { useEffect, useMemo, useState } from 'react';
import { buySpecimen, openPack, sellBack, type Currency, type Listing, type PackReveal, type Series, type Specimen, type TxResult } from '../data';
import { api } from '../lib/api';
import { useApp } from '../lib/store';
import { useStill } from '../lib/stills';
import { clientSeed } from '../lib/wallet';
import { buyback, marketPrice, mass, multiple, originLabel, pct, sol, usd } from '../lib/format';
import { BANDS, BAND_NAME, TIER_NAME } from '../../shared/rules.ts';
import { FILE_ITEMS } from '../../shared/types.ts';
import { Overlay, Spinner, TxLine } from './Overlay';
import { Media } from './Media';
import { RockView } from './RockView';

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

/* ---------- after the reveal: hold, sell back, redeem, share ---------- */

function RevealActions({ reveal, onDone, extra }: { reveal: PackReveal; onDone: () => void; extra?: React.ReactNode }) {
  const { data, open, refresh, toast } = useApp();
  const sp = reveal.specimen;
  const offer = buyback(reveal.vault_value_usd, data.rules);
  const [state, setState] = useState<'idle' | 'confirm' | 'busy' | 'sold'>('idle');
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
      <p className="dlg-p">Sell {sp.name} back for {usd(offer)} USDC? The NFT is burned and the specimen returns to the vault.</p>
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

export function BuyDialog({ specimen }: { specimen: Specimen }) {
  const { data, open, refresh, toast } = useApp();
  const [cur, setCur] = useState<Currency>('USDC');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const price = marketPrice(specimen.vault_value_usd!, data.rules);
  const done = specimen.file_done ?? [];
  const buy = async () => {
    setBusy(true); setErr('');
    try {
      const r = await buySpecimen(specimen.id, cur);
      await refresh();
      toast(`${specimen.name} is yours`);
      open({ kind: 'reveal', reveal: r.reveal, payment: r.payment, via: 'market' });
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Overlay label={`Buy ${specimen.name}`} wide title={<div className="sec mono"><span>The market</span><span>{specimen.id}</span></div>}>
      <div className="co">
        <Media hint={specimen.render} photos={specimen.photos} label={specimen.name} className="co-ph" />
        <div className="co-bd">
          <h3>{specimen.name}</h3>
          <div className="cl mono">{specimen.class} · {mass(specimen.mass_g)} · {originLabel(specimen)}</div>
          <ul className="chk">{FILE_ITEMS.map((f, i) => <li key={f.key} className={done[i] ? 'y' : ''}>{f.label}</li>)}</ul>
          <dl className="kv"><dt>Vault value</dt><dd>{usd(specimen.vault_value_usd!)}</dd><dt>Fixed price</dt><dd>{usd(price)}</dd><dt>Instant offer if you sell back, {pct(data.rules.buyback_share)}%</dt><dd>{usd(buyback(specimen.vault_value_usd!, data.rules))}</dd></dl>
          <PayWith value={cur} onChange={setCur} price={price} />
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn wide" type="button" onClick={buy} disabled={busy}>{busy ? <><Spinner label="Paying" />Confirming…</> : `Buy for ${cur === 'USDC' ? usd(price) : sol(price, data.rules)}`}</button>
          <p className="fine">Minted to you as a Metaplex Core NFT on Solana with the full specimen file. Payments on this preview are simulated: nothing is charged.</p>
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
          <p className="fine">The rock stays sealed in the vault; its NFT moves to you on Solana. {pct(data.rules.royalty)}% of the price goes back to the vault’s inventory. Payments on this preview are simulated.</p>
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
        <div className="pk2-pack" aria-hidden="true">
          <div className="pack-card">
            <span className="mono">{series.name}</span>
            <i className="pack-sym" />
            <b>One real<br />meteorite</b>
            <span className="mono">{TIER_NAME[series.tier]} pack · sealed</span>
          </div>
          <p className="mono">{left} of {series.size} still sealed</p>
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

/** Full screen: a meteor falls and hits the ground, the drawn specimen rises from the crater and floats. */
export function PackOpening({ series, currency, seed }: { series: Series; currency: Currency; seed: string }) {
  const { data, close, open, refresh } = useApp();
  const [phase, setPhase] = useState<'fall' | 'impact' | 'rise' | 'reveal'>('fall');
  const [res, setRes] = useState<{ reveal: PackReveal; payment: TxResult } | null>(null);
  const [err, setErr] = useState('');
  const left = series.remaining.floor + series.remaining.par + series.remaining.hit;

  useEffect(() => {
    let alive = true;
    const t0 = Date.now();
    openPack(series.id, currency, seed).then(r => { if (alive) { setRes(r); refresh(); } }, e => alive && setErr(e.message));
    const a = setTimeout(() => alive && setPhase('impact'), 1250);
    return () => { alive = false; clearTimeout(a); void t0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (phase !== 'impact' || !res) return;
    const t = setTimeout(() => setPhase('rise'), 900);
    return () => clearTimeout(t);
  }, [phase, res]);
  useEffect(() => {
    if (phase !== 'rise') return;
    const t = setTimeout(() => setPhase('reveal'), 1500);
    return () => clearTimeout(t);
  }, [phase]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && (phase === 'reveal' || err)) close(); };
    addEventListener('keydown', k);
    document.documentElement.classList.add('locked');
    return () => { removeEventListener('keydown', k); document.documentElement.classList.remove('locked'); };
  }, [phase, err, close]);

  const band = res?.reveal.band ?? 'floor';
  const sp = res?.reveal.specimen;
  const stars = useMemo(() => Array.from({ length: 70 }, (_, i) => ({ l: (i * 37.7) % 100, t: (i * 53.3) % 62, s: i % 9 === 0 ? 2 : 1, d: (i % 7) * .6 })), []);

  return (
    <div className={`opn ph-${phase} band-${band}`} role="dialog" aria-modal="true" aria-label="Opening your pack">
      <div className="opn-sky">{stars.map((s, i) => <i key={i} style={{ left: s.l + '%', top: s.t + '%', width: s.s, height: s.s, animationDelay: s.d + 's' }} />)}</div>
      <div className="opn-meteor" aria-hidden="true"><i /></div>
      <div className="opn-ground" aria-hidden="true">
        <svg viewBox="0 0 1440 260" preserveAspectRatio="none"><path d="M0 120 C200 100 340 128 520 112 C660 100 760 118 900 108 C1080 96 1240 118 1440 104 L1440 260 L0 260 Z" fill="#120c09" /><path d="M0 120 C200 100 340 128 520 112 C660 100 760 118 900 108 C1080 96 1240 118 1440 104" stroke="rgba(240,138,93,.35)" fill="none" /></svg>
        <span className="crater" />
        <span className="shock" /><span className="shock s2" />
        {Array.from({ length: 16 }, (_, i) => <span key={i} className="debris" style={{ ['--a' as any]: `${-160 + i * 21}deg`, ['--d' as any]: `${70 + (i * 37) % 90}px`, animationDelay: `${(i % 4) * 40}ms` }} />)}
      </div>
      <div className="opn-flash" aria-hidden="true" />

      {sp && (phase === 'rise' || phase === 'reveal') && (
        <div className="opn-rock">
          <i className="aura" aria-hidden="true" />
          <div className="float"><RockView hint={sp.render} mode="live" auto={0.45} scale={1.45} label={`${sp.name} in 3D. Drag to turn it.`} /></div>
          <span className="opn-drag mono" aria-hidden="true">Drag to turn it</span>
        </div>
      )}

      {phase !== 'reveal' && !err && <p className="opn-status mono" aria-live="polite">{phase === 'fall' ? `${series.name} · drawing one of ${left} sealed packs` : phase === 'impact' ? (res ? 'Impact' : 'Confirming the draw…') : 'Rising from the crater…'}</p>}

      {err && (
        <div className="opn-panel in"><h3>The pack did not open.</h3><p className="dlg-p">{err}</p><div className="acts"><button className="btn" type="button" onClick={close}>Back</button></div></div>
      )}

      {res && sp && phase === 'reveal' && (
        <div className="opn-panel">
          <span className={'chip' + (band !== 'hit' ? ' ' + band : '')}>{band.toUpperCase()} · {multiple(res.reveal.vault_value_usd, res.reveal.pack_price_usd)}×</span>
          <h3>{sp.name}</h3>
          <div className="cl mono">{sp.class} · {mass(sp.mass_g)} · {sp.id}</div>
          <p className="brag">You pulled {PIECE[sp.render.type]}.</p>
          <dl className="kv">
            <dt>Pack price</dt><dd>{usd(res.reveal.pack_price_usd)}</dd>
            <dt>Vault value</dt><dd>{usd(res.reveal.vault_value_usd)}</dd>
            <dt>Instant offer, {pct(data.rules.buyback_share)}%</dt><dd className="hot">{usd(buyback(res.reveal.vault_value_usd, data.rules))}</dd>
          </dl>
          <NftLine specimenId={sp.id} />
          <RevealActions reveal={res.reveal} onDone={close} extra={<button className="btn line" type="button" onClick={() => open({ kind: 'pack', series })}>Open another</button>} />
          <TxLine tx={res.payment.tx} simulated={res.payment.simulated} label={`Paid ${res.payment.currency === 'SOL' ? res.payment.amount + ' SOL' : usd(res.payment.amount)}`} />
          <button className="x opn-x" type="button" onClick={close} aria-label="Close"><i aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}

/* ---------- the reveal (market buys, holdings) ---------- */

export function RevealDialog({ reveal, payment, via }: { reveal: PackReveal; payment?: TxResult; mint?: string; via: 'pack' | 'market' | 'holding' }) {
  const { close } = useApp();
  const sp = reveal.specimen;
  const chip = via === 'market' ? 'MARKET' : `${reveal.band.toUpperCase()} · ${multiple(reveal.vault_value_usd, reveal.pack_price_usd || reveal.vault_value_usd)}×`;
  return (
    <Overlay label={`${sp.name}`} title={<div className="sec mono"><span>{via === 'holding' ? 'Your collection' : 'It’s yours'}</span><span>{sp.id}</span></div>}>
      <div className="reveal in-dlg">
        <div className="ph r3dph"><RockView hint={sp.render} mode="live" auto={0.35} scale={1.35} label={`${sp.name} in 3D. Drag to turn it.`} /><span className={'chip' + (reveal.band !== 'hit' && via !== 'market' ? ' ' + reveal.band : '')}>{chip}</span></div>
        <div className="bd">
          <h3>{sp.name}</h3>
          <div className="cl mono">{sp.class} · {mass(sp.mass_g)} · {sp.id}</div>
          <RevealKv reveal={reveal} via={via} />
          {via !== 'holding' && <NftLine specimenId={sp.id} />}
          <RevealActions reveal={reveal} onDone={close} />
          {payment && <TxLine tx={payment.tx} simulated={payment.simulated} label={`Paid ${payment.currency === 'SOL' ? payment.amount + ' SOL' : usd(payment.amount)}`} />}
        </div>
      </div>
    </Overlay>
  );
}

function RevealKv({ reveal, via }: { reveal: PackReveal; via: string }) {
  const { data } = useApp();
  return (
    <dl className="kv">
      {via !== 'holding' && <><dt>{via === 'market' ? 'Price paid' : 'Pack price'}</dt><dd>{usd(reveal.pack_price_usd)}</dd></>}
      <dt>Vault value</dt><dd>{usd(reveal.vault_value_usd)}</dd>
      <dt>Instant offer, {pct(data.rules.buyback_share)}%</dt><dd className="hot">{usd(buyback(reveal.vault_value_usd, data.rules))}</dd>
    </dl>
  );
}
