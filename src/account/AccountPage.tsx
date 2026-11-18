// /account: the collector's own space. Profile with level and rank, the collection (sell, cancel or
// sell back, redeem, share), listings, achievements, activity, shipments and settings.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Holding, PageData, RockType } from '../data';
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
import { DialogHost } from '../components/Dialogs';
import { AvatarTurn, ROCK_LABEL } from '../components/Avatar';
import { RockView } from '../components/RockView';

/** What a holding is worth to its holder: the escrowed rock price for reservations, else the rock value. */
const valueOf = (h: Holding) => (h.reservation ? h.reservation.escrow_usd || h.reservation.reserved_price_usd : h.vault_value_usd);

type Tab = 'collection' | 'selling' | 'achievements' | 'activity' | 'shipments' | 'settings';
const TABS: [Tab, string][] = [['collection', 'Collection'], ['selling', 'For sale'], ['achievements', 'Achievements'], ['activity', 'Activity'], ['shipments', 'Shipments'], ['settings', 'Settings']];

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
        <h1>{p.username ?? shortAddr(p.address)}</h1>
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
        <h3 className="acc-h">Solana wallet</h3>
        {p.kind !== 'account' ? <p className="dlg-p">You signed in with the wallet <code>{shortAddr(p.address)}</code>: your specimens are minted straight to it.</p> : p.linked_wallet ? (
          <>
            <p className="dlg-p">Withdrawals go to <code>{shortAddr(p.linked_wallet)}</code>.</p>
            <button className="btn line" type="button" onClick={() => run('wallet', () => api('POST', '/api/me/unlink-wallet', {}), 'Wallet unlinked')}>Unlink wallet</button>
          </>
        ) : (
          <>
            <p className="dlg-p">Your NFTs are held in your Space Rocks account. Link a wallet to withdraw them to it later.</p>
            <div className="wl tight">{WALLETS.map(w => w.detect() ? <button key={w.id} className="wrow" type="button" onClick={() => link(w.id)} disabled={busy === 'wallet'}><b>{w.name}</b><span className="mono">Link</span></button> : <a key={w.id} className="wrow off" href={w.url} target="_blank" rel="noreferrer"><b>{w.name}</b><span className="mono">Install ↗</span></a>)}</div>
          </>
        )}
        {err.wallet && <p className="err">{err.wallet}</p>}
        <p className="fine mono">Vault address {shortAddr(p.address)} · since {new Date(p.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</p>
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
