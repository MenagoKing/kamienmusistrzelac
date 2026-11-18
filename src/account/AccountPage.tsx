// /account: the collector's own space. Profile with level and rank, the collection (sell, cancel or
// sell back, redeem, share), listings, achievements, activity, shipments and settings.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Holding, PageData, RockType, WalletInfo } from '../data';
import { api } from '../lib/api';
import { AppProvider, callsign, useApp } from '../lib/store';
import { useStill } from '../lib/stills';
import { WALLETS, signOut, type WalletId } from '../lib/wallet';
import { liveReservation, mass, usd } from '../lib/format';
import { Rarity } from '../components/Checkout';
import { BAND_NAME, shortAddr } from '../../shared/rules.ts';
import { Header } from '../components/Header';
import { Footer } from '../components/Closing';
import { Spinner, Toasts } from '../components/Overlay';
import { NetBadge } from '../components/Funds';
import { DialogHost } from '../components/Dialogs';
import { AvatarTurn, ROCK_LABEL } from '../components/Avatar';
import { RockView } from '../components/RockView';

/** What a holding is worth to its holder: the escrowed rock price for reservations, else the rock value. */
const valueOf = (h: Holding) => (h.reservation ? h.reservation.escrow_usd || h.reservation.reserved_price_usd : h.vault_value_usd);

type Tab = 'collection' | 'selling' | 'wallet' | 'achievements' | 'activity' | 'shipments' | 'settings';
const TABS: [Tab, string][] = [['collection', 'Collection'], ['selling', 'For sale'], ['wallet', 'Wallet'], ['achievements', 'Achievements'], ['activity', 'Activity'], ['shipments', 'Shipments'], ['settings', 'Settings']];

const tabFromHash = (): Tab => {
  const h = (typeof location !== 'undefined' ? location.hash.slice(1) : '') as Tab;
  return TABS.some(([t]) => t === h) ? h : 'collection';
};

/* ---------- profile banner ---------- */

function Banner() {
  const { me, open } = useApp();
  if (!me) return null;
  const p = me.profile;
  const into = p.xp - p.xp_level_start, span = Math.max(1, p.xp_next - p.xp_level_start);
  return (
    <section className="acc-hero wrap">
      <AvatarTurn seed={p.avatar_seed} size={220} />
      <div className="acc-id">
        <div className="sec mono"><span>Collector</span><span>{p.kind === 'account' ? 'Space Rocks account' : p.kind === 'demo' ? 'Demo wallet' : 'Solana wallet'}</span></div>
        <h1>{p.username ?? shortAddr(p.wallet ?? p.address)}</h1>
        <WalletChip />
        {!p.username && <button type="button" className="lnk" onClick={() => { location.hash = 'settings'; }}>Pick a callsign →</button>}
        <div className="lvl">
          <span className="badge-lv mono">Level {p.level}</span>
          <b>{p.rank}</b>
        </div>
        <div className="xp" role="progressbar" aria-valuemin={0} aria-valuemax={span} aria-valuenow={into} aria-label="Experience to the next level">
          <i style={{ width: Math.min(100, (into / span) * 100) + '%' }} />
        </div>
        <p className="mono dim xpl">{p.xp} XP · {p.xp_next - p.xp} to level {p.level + 1}{p.next_rank ? ` · ${p.next_rank}` : ''}</p>
      </div>
      <div className="acc-stats">
        <div><b>{p.stats.held}</b><span className="mono">Specimens</span></div>
        <div><b>{usd(p.stats.value)}</b><span className="mono">Collection value</span></div>
        <div><b>{p.stats.packs}</b><span className="mono">Packs opened</span></div>
        <div><b>{p.stats.hits}</b><span className="mono">Hits</span></div>
        <div><b>{p.stats.sold}</b><span className="mono">Sold</span></div>
        <div><b>{usd(p.stats.earned)}</b><span className="mono">Earned</span></div>
      </div>
      <div className="acc-cta">
        <a className="btn" href="/#packs">Open a pack</a>
        <a className="btn line" href="/#market">Go to the market</a>
        <button type="button" className="btn line" onClick={() => open({ kind: 'register' })}>The specimen register</button>
      </div>
    </section>
  );
}

/* ---------- collection ---------- */

function Card({ h, i }: { h: Holding; i: number }) {
  const { open } = useApp();
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button ref={ref} type="button" className={'ccard ' + h.render.type} onClick={() => open({ kind: 'item', holding: h })}>
      <span className="ccard-ph"><RockView hint={h.render} mode="hover" startRot={-2 + (i % 7) * .2} hoverRef={ref as React.RefObject<HTMLElement>} label={`${h.name} in 3D`} />
        {liveReservation(h.reservation) ? <em className={'cb ' + (h.reservation!.status === 'sold_at_source' ? 'sas' : 'res')}>{h.reservation!.status === 'sold_at_source' ? 'Sold at source · choose' : 'Reserved'}</em> : h.band && <em className={'cb ' + h.band}>{BAND_NAME[h.band]}</em>}
        {h.listing && <em className="cb sale">For sale · {usd(h.listing.price_usd)}</em>}
        {h.status.kind === 'redeeming' && <em className="cb ship">Shipping</em>}
      </span>
      <span className="ccard-bd">
        <span className="mono dim">{h.id} · {ROCK_LABEL[h.render.type]}</span>
        <b>{h.name}</b>
        <span className="mono dim">{h.class} · {mass(h.mass_g)}</span>
        <span className="ccard-v"><span className="mono dim">{liveReservation(h.reservation) ? 'In escrow' : 'Rock value'} <Rarity type={h.render.type} price={valueOf(h)} /></span><strong>{valueOf(h) != null ? usd(valueOf(h)!) : '—'}</strong></span>
      </span>
    </button>
  );
}

const ORDER: RockType[] = ['martian', 'lunar', 'pallasite', 'iron', 'stone'];

function Collection() {
  const { me } = useApp();
  const [f, setF] = useState<'' | RockType>('');
  const [sort, setSort] = useState<'new' | 'value' | 'rare'>('new');
  const list = useMemo(() => {
    const l = (me?.holdings ?? []).filter(h => !f || h.render.type === f);
    if (sort === 'value') l.sort((a, b) => (valueOf(b) ?? 0) - (valueOf(a) ?? 0));
    if (sort === 'rare') l.sort((a, b) => ORDER.indexOf(a.render.type) - ORDER.indexOf(b.render.type));
    return l;
  }, [me, f, sort]);
  if (!me) return null;
  return (
    <>
      <div className="book">
        {me.profile.book.map(b => (
          <button key={b.type} type="button" className={'bk ' + b.type + (b.held ? ' got' : b.ever ? ' was' : ' lock') + (f === b.type ? ' on' : '')} onClick={() => setF(f === b.type ? '' : b.type)} aria-pressed={f === b.type}>
            <BookRock type={b.type} locked={!b.ever} />
            <b>{b.label}</b>
            <span className="mono">{b.held ? `${b.held} held` : b.ever ? 'Found before' : 'Not found yet'}</span>
          </button>
        ))}
      </div>
      <div className="cbar">
        <span className="mono dim">{list.length} specimen{list.length === 1 ? '' : 's'}{f ? ` · ${ROCK_LABEL[f]}` : ''}</span>
        <div className="chips">
          {([['new', 'Newest'], ['value', 'Value'], ['rare', 'Rarity']] as const).map(([k, l]) => <button key={k} type="button" className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{l}</button>)}
        </div>
      </div>
      {list.length ? <div className="cgrid">{list.map((h, i) => <Card key={h.id} h={h} i={i} />)}</div> : (
        <div className="cempty">
          <p>{f ? `No ${ROCK_LABEL[f].toLowerCase()} in your collection yet.` : 'Your collection is empty. Every collection starts with one rock.'}</p>
          <div className="acts"><a className="btn" href="/#packs">Open a pack</a><a className="btn line" href="/#market">Pick one on the market</a></div>
        </div>
      )}
    </>
  );
}

function BookRock({ type, locked }: { type: RockType; locked: boolean }) {
  const seed = { stone: 47, iron: 57, pallasite: 33, lunar: 81, martian: 21 }[type];
  const img = useStill({ type, seed }, { w: 120, h: 120, rot: -1.9, scale: 1.5 });
  return <span className={'bkr' + (locked ? ' sil' : '')}>{img && <img src={img} alt="" />}</span>;
}

/* ---------- for sale ---------- */

function Selling() {
  const { me, data, refresh, toast, open } = useApp();
  const [busy, setBusy] = useState('');
  if (!me) return null;
  const cancel = async (id: string) => {
    setBusy(id);
    try { await api('POST', `/api/listings/${id}/cancel`, {}); await refresh(); toast('Taken off sale'); } catch (e: any) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  const listable = me.holdings.filter(h => h.status.kind === 'held' && !h.listing && h.reservation?.status !== 'sold_at_source');
  return (
    <>
      {me.listings.length ? (
        <div className="cgrid">{me.listings.map(l => (
          <div key={l.id} className={'ccard sale ' + l.specimen.render.type}>
            <span className="ccard-ph"><RockView hint={l.specimen.render} mode="hover" label={`${l.specimen.name} in 3D`} /><em className="cb sale">On sale</em></span>
            <span className="ccard-bd">
              <span className="mono dim">{l.specimen.id} · listed {new Date(l.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              <b>{l.specimen.name}</b>
              <span className="mono dim">{l.specimen.class} · {mass(l.specimen.mass_g)}</span>
              <span className="ccard-v"><span className="mono dim">Your price</span><strong className="hotv">{usd(l.price_usd)}</strong></span>
              <span className="ccard-v small"><span className="mono dim">You receive</span><span className="mono">{usd(l.price_usd * (1 - data.rules.royalty))}</span></span>
              <button type="button" className="btn line sm" disabled={busy === l.id} onClick={() => cancel(l.id)}>{busy === l.id ? <Spinner label="Working" /> : 'Take off sale'}</button>
            </span>
          </div>
        ))}</div>
      ) : <p className="cempty-p">Nothing on sale. Set a price on any specimen you hold and it shows on the market under “From collectors”.</p>}
      {listable.length > 0 && (
        <>
          <h3 className="acc-h">Put one up for sale</h3>
          <div className="pickl">{listable.map(h => <button key={h.id} type="button" className="pk" onClick={() => open({ kind: 'list', holding: h })}><b>{h.name}</b><span className="mono dim">{h.id} · {valueOf(h) != null ? usd(valueOf(h)!) : '—'}</span></button>)}</div>
        </>
      )}
    </>
  );
}

/* ---------- achievements, activity, shipments ---------- */

function Achievements() {
  const { me } = useApp();
  if (!me) return null;
  const done = me.profile.achievements.filter(a => a.done).length;
  return (
    <>
      <p className="mono dim">{done} of {me.profile.achievements.length} unlocked</p>
      <div className="achs">{me.profile.achievements.map(a => (
        <div key={a.id} className={'ach' + (a.done ? ' on' : '')}>
          <i aria-hidden="true">{a.done ? '★' : '☆'}</i>
          <b>{a.title}</b>
          <span>{a.desc}</span>
          {!a.done && a.progress && <em className="mono">{a.progress}</em>}
        </div>
      ))}</div>
    </>
  );
}

const ACT: Record<string, string> = { market_buy: 'Bought on the market', reservation: 'Reserved on the market', reservation_cancel: 'Reservation cancelled, rock price back', reservation_refund: 'Refunded in full (sold at source)', replacement_refund: 'Replacement, difference back', price_difference_refund: 'Dealer price lower, difference back', price_difference_topup: 'Dealer price higher, difference paid', escrow_release: 'Escrow paid the dealer', pack: 'Opened a pack', raffle: 'Won a drop raffle', secondary_sale: 'Bought from a collector', seller_payout: 'Sold to a collector', buyback: 'Sold back', redemption_fee: 'Shipping and handling', redemption_refund: 'Redemption refunded' };
const INCOMING = new Set(['seller_payout', 'buyback', 'redemption_refund', 'reservation_cancel', 'reservation_refund', 'replacement_refund', 'price_difference_refund']);

function ActivityList() {
  const { me } = useApp();
  if (!me) return null;
  if (!me.activity.length) return <p className="cempty-p">No activity yet.</p>;
  return (
    <ul className="plist">{me.activity.map(a => {
      const incoming = INCOMING.has(a.kind);
      return (
        <li key={a.id}><span><b>{ACT[a.kind] ?? a.kind}</b><small className="mono">{a.specimen_name ?? ''}{a.specimen_id ? ` · ${a.specimen_id}` : ''} · {new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span><em className={'mono ' + (incoming ? 'in' : '')}>{incoming ? '+' : a.usd === 0 ? '' : '−'}{usd(Math.abs(a.usd))}</em></li>
      );
    })}</ul>
  );
}

function Shipments() {
  const { me } = useApp();
  if (!me) return null;
  if (!me.redemptions.length) return <p className="cempty-p">No shipments. Redeem a specimen from your collection to get the rock itself.</p>;
  const steps = ['requested', 'ordered', 'packing', 'shipped', 'delivered'];
  return (
    <ul className="ships">{me.redemptions.map(r => (
      <li key={r.id}>
        <div className="sh-t"><b>{r.specimen_name}</b><span className="mono dim">{r.address.city}, {r.address.country}{r.dealer_name ? ` · ships from ${r.dealer_name}` : ''}{r.tracking ? ` · tracking ${r.tracking}` : r.kind === 'dealer' && r.status === 'requested' && r.due_at ? ` · ordered by ${new Date(r.due_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</span></div>
        {r.status === 'cancelled' ? <span className="st pend">Cancelled, fee refunded</span> : (
          <ol className="steps">{(r.kind === 'dealer' ? steps : steps.filter(s => s !== 'ordered')).map((s, i, all) => <li key={s} className={all.indexOf(r.status) >= i ? 'on' : ''}>{s}</li>)}</ol>
        )}
      </li>
    ))}</ul>
  );
}

/* ---------- the account's Solana wallet ---------- */

const copyText = async (t: string) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };
const solFmt = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: x < 1 ? 4 : 3 }) + ' SOL';

/** Short address chip with copy, for the profile banner. */
function WalletChip() {
  const { me, toast } = useApp();
  if (!me) return null;
  const addr = me.profile.wallet ?? me.address;
  return (
    <button type="button" className="wchip mono" title={addr} onClick={async () => toast((await copyText(addr)) ? 'Wallet address copied' : addr)}>
      <i aria-hidden="true">◎</i>{shortAddr(addr)}<span>Copy</span>
    </button>
  );
}

function WalletPanel() {
  const { me, toast, refresh } = useApp();
  const [w, setW] = useState<WalletInfo | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [pw, setPw] = useState('');
  const [secret, setSecret] = useState<{ b58: string; json: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [reveal, setReveal] = useState(false);
  const load = async () => { try { setW(await api<WalletInfo>('GET', '/api/me/wallet')); setErr(''); } catch (e: any) { setErr(e.message); } };
  useEffect(() => { load(); }, []);
  if (!me) return null;
  if (!w) return err ? <p className="err">{err}</p> : <p className="cempty-p"><Spinner label="Loading" /> Loading your wallet…</p>;

  const faucet = async () => {
    setBusy('faucet'); setErr('');
    try {
      const r = await api<{ source: string; amount_sol: number; balance_sol: number | null }>('POST', '/api/me/wallet/faucet', {});
      toast(`${solFmt(r.amount_sol)} of test SOL ${r.source === 'faucet' ? 'from the devnet faucet' : 'from the Space Rocks vault'}`);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const exportKey = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('export'); setErr('');
    try {
      const r = await api<{ secret_base58: string; secret_json: string }>('POST', '/api/me/wallet/export', { password: pw });
      setSecret({ b58: r.secret_base58, json: r.secret_json }); setPw(''); setAsking(false); setReveal(false);
    } catch (er: any) { setErr(er.message); } finally { setBusy(''); }
  };
  const net = w.cluster === 'mainnet-beta' ? 'Mainnet' : w.cluster === 'simulated' ? 'Simulated chain' : w.cluster[0].toUpperCase() + w.cluster.slice(1);

  return (
    <div className="wpanel">
      <div className="wcard">
        <div className="wcard-top">
          <span className="mono">{w.custodial ? 'Your Space Rocks wallet' : 'The wallet you signed in with'}</span>
          <span className={'wnet mono' + (w.cluster === 'mainnet-beta' ? ' main' : '')}>{net}</span>
        </div>
        <div className="wbal">
          <b>{w.balance_usdc == null ? '—' : w.balance_usdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDC'}</b>
          <span className="mono">{w.balance_sol == null ? (w.error ? 'Balance unavailable right now' : 'Balance shows once the chain is live') : solFmt(w.balance_sol)}</span>
        </div>
        <div className="waddr">
          <code>{w.address}</code>
          <div className="acts">
            <button className="btn sm" type="button" onClick={async () => toast((await copyText(w.address)) ? 'Wallet address copied' : 'Copy it by hand')}>Copy address</button>
            <a className="btn sm line" href={w.explorer} target="_blank" rel="noreferrer">Solana Explorer ↗</a>
            <button className="btn sm line" type="button" onClick={() => { load(); refresh(); }}>Refresh</button>
          </div>
        </div>
        <dl className="kv wkv">
          <dt>NFTs in this wallet</dt><dd>{w.nfts_on_chain}</dd>
          {w.nfts_pending > 0 && <><dt>Being minted</dt><dd>{w.nfts_pending}</dd></>}
          {w.linked_wallet && <><dt>Withdrawals go to</dt><dd className="mono">{shortAddr(w.linked_wallet)}</dd></>}
        </dl>
        <p className="fine">{w.custodial
          ? `Created with your account. Every specimen you get is minted here as an NFT, and Space Rocks pays the network fees.${w.payments === 'live' ? ' Purchases are paid from this wallet: send USDC (or SOL) to the address above to top it up.' : ''}`
          : 'Your specimens are minted straight to this wallet.'}</p>
        {w.custodial && w.cluster === 'devnet' && <p className="fine">Devnet test funds: <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">USDC at faucet.circle.com</a> (choose Solana Devnet) · <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">SOL at faucet.solana.com</a></p>}
      </div>

      {w.custodial && (
        <div className="wside">
          {w.faucet && (
            <div className="setc">
              <h3 className="acc-h">Test SOL</h3>
              <p className="dlg-p">This is {net.toLowerCase()}: SOL here has no value. Get some to try the wallet in Phantom or Solflare.</p>
              <button className="btn line" type="button" disabled={busy === 'faucet' || !!w.faucet.next_at} onClick={faucet}>{busy === 'faucet' ? <><Spinner label="Sending" />Sending…</> : w.faucet.next_at ? `Again at ${new Date(w.faucet.next_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Get test SOL'}</button>
              <p className="fine">Or paste your address at <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">faucet.solana.com</a>.</p>
            </div>
          )}
          {w.export && (
            <div className="setc">
              <h3 className="acc-h">Private key</h3>
              {secret ? (
                <>
                  <p className="err">Anyone with this key controls the wallet and its NFTs. Never share it, never paste it into a website.</p>
                  <code className={'wkey' + (reveal ? '' : ' blur')} onClick={() => setReveal(true)}>{secret.b58}</code>
                  <div className="acts">
                    {!reveal && <button className="btn sm line" type="button" onClick={() => setReveal(true)}>Show</button>}
                    <button className="btn sm" type="button" onClick={async () => toast((await copyText(secret.b58)) ? 'Private key copied' : 'Copy it by hand')}>Copy key</button>
                    <button className="btn sm line" type="button" onClick={async () => toast((await copyText(secret.json)) ? 'Key copied as a JSON array' : 'Copy it by hand')}>Copy as JSON</button>
                    <button className="btn sm line" type="button" onClick={() => setSecret(null)}>Hide</button>
                  </div>
                  <p className="fine">In Phantom: Add account › Import private key, then switch Phantom to {net.toLowerCase()} to see your specimens.</p>
                </>
              ) : asking ? (
                <form className="fm" onSubmit={exportKey}>
                  {w.export.needs_password
                    ? <label>Your password<input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} required data-autofocus /></label>
                    : <p className="dlg-p">{w.export.needs_fresh_sign_in ? 'You need to have signed in within the last 15 minutes.' : 'This is a demo wallet.'}</p>}
                  <div className="acts">
                    <button className="btn" type="submit" disabled={busy === 'export'}>{busy === 'export' ? <><Spinner label="Checking" />Checking…</> : 'Show my private key'}</button>
                    <button className="btn line" type="button" onClick={() => { setAsking(false); setPw(''); }}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="dlg-p">Export the key to use this wallet in Phantom or Solflare.{w.export.needs_password ? ' You will be asked for your password.' : w.export.needs_fresh_sign_in ? ' You need to have signed in within the last 15 minutes.' : ''}</p>
                  <button className="btn line" type="button" onClick={() => setAsking(true)}>Export private key</button>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {err && <p className="err" role="alert">{err}</p>}
    </div>
  );
}

/* ---------- settings ---------- */

function Settings() {
  const { me, refresh, toast } = useApp();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  if (!me) return null;
  const p = me.profile;
  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key); setErr(e => ({ ...e, [key]: '' }));
    try { await fn(); await refresh(); toast(msg); } catch (e: any) { setErr(x => ({ ...x, [key]: e.message })); } finally { setBusy(''); }
  };
  const profile = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    run('profile', () => api('PUT', '/api/me/profile', { username: f.username, email: f.email }), 'Profile saved');
  };
  const password = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    if (f.next !== f.next2) { setErr(x => ({ ...x, password: 'The two new passwords do not match' })); return; }
    run('password', () => api('PUT', '/api/me/password', { current: f.current, next: f.next }), p.has_password ? 'Password changed' : 'Password set').then(() => form.reset());
  };
  const link = (id: WalletId) => run('wallet', async () => {
    const info = WALLETS.find(x => x.id === id)!;
    const prov = info.detect();
    if (!prov) throw new Error(`${info.name} is not installed in this browser`);
    const res = await prov.connect();
    const pk = (res?.publicKey ?? prov.publicKey)?.toString();
    const { message } = await api<{ message: string }>('POST', '/api/auth/nonce', { address: pk });
    const out = await prov.signMessage(new TextEncoder().encode(message), 'utf8');
    const sig: Uint8Array = out instanceof Uint8Array ? out : out.signature;
    await api('POST', '/api/me/link-wallet', { address: pk, signature: btoa(String.fromCharCode(...sig)) });
  }, 'Wallet linked');

  return (
    <div className="sets">
      <form className="fm setc" onSubmit={profile}>
        <h3 className="acc-h">Profile</h3>
        <label>Callsign<input name="username" defaultValue={p.username ?? ''} required pattern="[A-Za-z0-9_]{3,20}" placeholder="meteor_hunter" /></label>
        <label>Email<input name="email" type="email" defaultValue={p.email ?? ''} placeholder="you@email.com" /></label>
        {err.profile && <p className="err">{err.profile}</p>}
        <button className="btn" disabled={busy === 'profile'}>{busy === 'profile' ? <Spinner label="Saving" /> : 'Save profile'}</button>
      </form>

      <div className="fm setc">
        <h3 className="acc-h">Collector rock</h3>
        <p className="dlg-p">Your avatar is a procedural meteorite. Roll until one feels like yours.</p>
        <button className="btn line" type="button" disabled={busy === 'avatar'} onClick={() => run('avatar', () => api('PUT', '/api/me/profile', { avatar_seed: Math.floor(Math.random() * 100000) }), 'New rock rolled')}>Roll a new rock ↻</button>
      </div>

      <form className="fm setc" onSubmit={password}>
        <h3 className="acc-h">{p.has_password ? 'Change password' : 'Set a password'}</h3>
        {!p.has_password && <p className="dlg-p">Add a password (and an email above) to sign in without your wallet.</p>}
        {p.has_password && <label>Current password<input name="current" type="password" required autoComplete="current-password" /></label>}
        <div className="two">
          <label>New password<input name="next" type="password" required minLength={8} autoComplete="new-password" /></label>
          <label>Repeat it<input name="next2" type="password" required minLength={8} autoComplete="new-password" /></label>
        </div>
        {err.password && <p className="err">{err.password}</p>}
        <button className="btn" disabled={busy === 'password'}>{busy === 'password' ? <Spinner label="Saving" /> : p.has_password ? 'Change password' : 'Set password'}</button>
      </form>

      <div className="fm setc">
        <h3 className="acc-h">Withdrawal wallet</h3>
        {!p.wallet ? <p className="dlg-p">You signed in with the wallet <code>{shortAddr(p.address)}</code>: your specimens are minted straight to it.</p> : p.linked_wallet ? (
          <>
            <p className="dlg-p">Withdrawals go to <code>{shortAddr(p.linked_wallet)}</code>.</p>
            <button className="btn line" type="button" onClick={() => run('wallet', () => api('POST', '/api/me/unlink-wallet', {}), 'Wallet unlinked')}>Unlink wallet</button>
          </>
        ) : (
          <>
            <p className="dlg-p">Your NFTs are in your Space Rocks wallet (see the Wallet tab). Link Phantom, Solflare or Backpack to send them there instead.</p>
            <div className="wl tight">{WALLETS.map(w => w.detect() ? <button key={w.id} className="wrow" type="button" onClick={() => link(w.id)} disabled={busy === 'wallet'}><b>{w.name}</b><span className="mono">Link</span></button> : <a key={w.id} className="wrow off" href={w.url} target="_blank" rel="noreferrer"><b>{w.name}</b><span className="mono">Install ↗</span></a>)}</div>
          </>
        )}
        {err.wallet && <p className="err">{err.wallet}</p>}
        <p className="fine mono">Wallet {shortAddr(p.wallet ?? p.address)} · since {new Date(p.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</p>
      </div>

      <div className="setc out">
        <button className="btn line" type="button" onClick={async () => { await signOut(); location.href = '/'; }}>Sign out</button>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

function Page() {
  const { me, meLoaded, dialog, open, refresh } = useApp();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  useEffect(() => {
    const f = () => setTab(tabFromHash());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { document.title = me ? `${callsign(me)} · Space Rocks` : 'Your account · Space Rocks'; }, [me]);

  return (
    <>
      <div className="grain" aria-hidden="true" />
      <Header always base="/" />
      <main className="acc">
        {!meLoaded ? <div className="acc-load"><Spinner label="Loading" /></div> : !me ? (
          <section className="acc-gate wrap">
            <div className="sec mono"><span>Your account</span></div>
            <h1>Your collection lives here.</h1>
            <p>Sign in to see your specimens, sell them to other collectors, cancel or redeem, follow your shipments and level up as you collect.</p>
            <div className="acts">
              <button className="btn" type="button" onClick={() => open({ kind: 'auth', mode: 'register' })}>Create an account</button>
              <button className="btn line" type="button" onClick={() => open({ kind: 'auth', mode: 'login' })}>Sign in</button>
            </div>
          </section>
        ) : (
          <>
            <Banner />
            <nav className="acc-tabs wrap" role="tablist" aria-label="Account">
              {TABS.map(([t, l]) => (
                <a key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} href={'#' + t}>{l}
                  {t === 'collection' && <small>{me.holdings.length}</small>}
                  {t === 'selling' && me.listings.length > 0 && <small>{me.listings.length}</small>}
                  {t === 'achievements' && <small>{me.profile.achievements.filter(a => a.done).length}</small>}
                </a>
              ))}
            </nav>
            <section className="acc-body wrap">
              {tab === 'collection' && <Collection />}
              {tab === 'selling' && <Selling />}
              {tab === 'wallet' && <WalletPanel />}
              {tab === 'achievements' && <Achievements />}
              {tab === 'activity' && <ActivityList />}
              {tab === 'shipments' && <Shipments />}
              {tab === 'settings' && <Settings />}
            </section>
          </>
        )}
      </main>
      <Footer />
      <DialogHost d={dialog} />
      <Toasts />
      <NetBadge />
    </>
  );
}

export function AccountPage({ data }: { data: PageData }) {
  return (
    <AppProvider initial={data}>
      <Page />
    </AppProvider>
  );
}
