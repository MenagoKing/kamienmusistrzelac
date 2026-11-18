import { useMemo, useRef, useState } from 'react';
import type { Listing, RockType, Specimen } from '../data';
import { useApp } from '../lib/store';
import { marketPrice, mass, originLabel, rockPriceOf, usd } from '../lib/format';
import { tokenPrice } from '../../shared/rules.ts';
import { RockView } from './RockView';
import { Rarity } from './Checkout';

const CLASSES: [RockType | '', string][] = [['', 'All'], ['martian', 'Martian'], ['lunar', 'Lunar'], ['pallasite', 'Pallasite'], ['iron', 'Iron'], ['stone', 'Chondrite']];
const RARITY: Record<RockType, number> = { martian: 0, lunar: 1, pallasite: 2, iron: 3, stone: 4 };
const LABEL: Record<RockType, string> = { martian: 'Martian', lunar: 'Lunar', pallasite: 'Pallasite', iron: 'Iron', stone: 'Chondrite' };

interface Item { key: string; sp: Specimen; price: number; seller?: string; mine?: boolean; listing?: Listing }

function Card({ it, big }: { it: Item; big?: boolean }) {
  const { data, withWallet, toast } = useApp();
  const ref = useRef<HTMLElement>(null);
  const p = it.sp;
  const rock = rockPriceOf(p);
  const verb = it.mine ? 'Yours' : it.listing || !p.sourced ? 'Buy' : 'Reserve';
  const tk = data.token;
  const buy = () => {
    if (it.mine) return toast('That one is yours: manage it from your account');
    withWallet(it.listing ? { kind: 'buy-listing', listing: it.listing } : { kind: 'buy', specimen: p });
  };
  return (
    <article ref={ref} className={'mcard ' + p.render.type + (big ? ' big' : '')} onClick={buy}>
      <div className="mcard-ph">
        <RockView hint={p.render} mode="hover" level={6} scale={big ? 1.32 : 1.28} hoverRef={ref} label={`${p.name} in 3D. Drag to turn it.`} />
        <span className="mcard-cls mono">{LABEL[p.render.type]}</span>
        {(p.photos?.length ?? 0) > 0 && <span className="mcard-ph-n mono" title="Photos of this specimen">◉ {p.photos!.length}</span>}
        <span className="mcard-drag mono" aria-hidden="true">Drag to turn</span>
      </div>
      <div className="mcard-bd">
        <div className="mcard-top mono"><span>{p.id}</span><span>{it.seller ? (it.mine ? 'Your listing' : `by ${it.seller}`) : originLabel(p)}</span></div>
        <h3>{p.name}</h3>
        <div className="mcard-cl">{p.class} · {mass(p.mass_g)} <Rarity type={p.render.type} price={rock} /></div>
        <div className="mcard-px">
          <div><b>{usd(it.price)}</b>{rock != null && <small className="mono">Rock price {usd(rock)}{tk?.enabled && !it.listing && p.sourced ? ` · ${usd(tokenPrice(it.price, data.rules))} in $${tk.symbol}` : ''}</small>}</div>
          <button type="button" className="btn sm" onClick={e => { e.stopPropagation(); buy(); }} aria-label={`${verb} ${p.name} for ${usd(it.price)}`}>{verb}</button>
        </div>
      </div>
    </article>
  );
}

/** §01 The market: fixed-price specimens from certified dealers (reserved, escrow-backed) and from collectors. */
export function Market() {
  const { data } = useApp();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'vault' | 'collectors'>('vault');
  const [cls, setCls] = useState<RockType | ''>('');
  const [sort, setSort] = useState<'featured' | 'low' | 'high' | 'mass'>('featured');
  const [q, setQ] = useState('');
  const vault: Item[] = useMemo(() => data.market.filter(p => rockPriceOf(p) != null && p.source_available !== false).map(p => ({ key: p.id, sp: p, price: marketPrice(rockPriceOf(p)!, data.rules) })), [data.market, data.rules]);
  const collectors: Item[] = useMemo(() => (data.listings ?? []).map(l => ({ key: l.id, sp: l.specimen, price: l.price_usd, seller: l.seller, mine: l.mine, listing: l })), [data.listings]);
  const featured = useMemo(() => [...vault].sort((a, b) => RARITY[a.sp.render.type] - RARITY[b.sp.render.type] || b.price - a.price).slice(0, 3), [vault]);
  const list = useMemo(() => {
    let l = (tab === 'vault' ? vault : collectors).filter(x => (!cls || x.sp.render.type === cls) && (!q || (x.sp.name + ' ' + x.sp.class + ' ' + x.sp.id).toLowerCase().includes(q.toLowerCase())));
    if (sort === 'low') l = [...l].sort((a, b) => a.price - b.price);
    if (sort === 'high') l = [...l].sort((a, b) => b.price - a.price);
    if (sort === 'mass') l = [...l].sort((a, b) => b.sp.mass_g - a.sp.mass_g);
    if (sort === 'featured') l = [...l].sort((a, b) => RARITY[a.sp.render.type] - RARITY[b.sp.render.type] || b.price - a.price);
    return l;
  }, [tab, vault, collectors, cls, q, sort]);
  const prices = vault.map(v => v.price);
  const range = prices.length ? `${usd(Math.min(...prices))} to ${usd(Math.max(...prices))}` : '';

  return (
    <section className="s wrap" id="market" aria-labelledby="h-market">
      <div className="intro rv">
        <div><div className="sec mono"><span>§01</span><span>The market</span></div><h2 id="h-market">Pick the rock. Pay the price.</h2></div>
        <p>Every specimen is listed on its own, at one fixed price: the dealer’s price plus our commission. Sourced from independent certified dealers, purchased and shipped when you redeem. No draw, no luck: you see the exact rock you reserve, with its whole file.</p>
      </div>

      {!vault.length && !collectors.length ? (
        <div className="mkt-empty rv in">
          <b>The first specimens are on their way.</b>
          <p>Every rock is checked and documented before it is listed. Join the list at the bottom of the page and you will hear when they go live.</p>
        </div>
      ) : (
      <>
      <div className="mfeat rv in">
        {featured.map(it => <Card key={it.key} it={it} big />)}
      </div>

      <div className={'mpanel' + (open ? ' is-open' : '')}>
        <button type="button" className="mtoggle" aria-expanded={open} aria-controls="market-all" onClick={() => setOpen(!open)}>
          <span className="mtoggle-t"><b>{open ? 'Close the market' : 'Open the full market'}</b><span className="mono">{vault.length} from dealers{range && ` · ${range}`} · {collectors.length} from collectors</span></span>
          <i aria-hidden="true" />
        </button>
        <div className="mbody" id="market-all" hidden={!open}>
          {open && (
            <>
              <div className="mbar">
                <div className="stabs" role="tablist" aria-label="Market">
                  <button role="tab" type="button" aria-selected={tab === 'vault'} className={tab === 'vault' ? 'on' : ''} onClick={() => setTab('vault')}>From dealers · {vault.length}</button>
                  <button role="tab" type="button" aria-selected={tab === 'collectors'} className={tab === 'collectors' ? 'on' : ''} onClick={() => setTab('collectors')}>From collectors · {collectors.length}</button>
                </div>
                <input className="msearch" type="search" placeholder="Search name, class or SR number" value={q} onChange={e => setQ(e.target.value)} aria-label="Search the market" />
                <select className="msort" value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort">
                  <option value="featured">Rarest first</option><option value="low">Price, low to high</option><option value="high">Price, high to low</option><option value="mass">Heaviest first</option>
                </select>
              </div>
              <div className="chips mchips">{CLASSES.map(([k, l]) => <button key={k} type="button" className={cls === k ? 'on' : ''} onClick={() => setCls(k)}>{l}</button>)}</div>
              {list.length ? <div className="mgrid">{list.map(it => <Card key={it.key} it={it} />)}</div> : (
                <p className="mkt-empty">{tab === 'collectors' && !collectors.length ? 'No collector has a specimen up for sale right now. Yours can be the first: open your account and choose “Sell to collectors”.' : 'Nothing matches. Try another class or clear the search.'}</p>
              )}
            </>
          )}
        </div>
      </div>
      </>
      )}
      <div className="rule mono rv"><span>Reserved for you the moment you pay</span><span>Rock price held in escrow until you redeem</span><span>Cancel any time: the rock’s price comes back</span></div>
    </section>
  );
}
