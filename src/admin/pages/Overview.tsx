import { BAND_NAME, BANDS, TIER_NAME } from '../../../shared/rules.ts';
import type { LaunchDrop, Series } from '../../../shared/types.ts';
import { Badge, Card, ErrorBox, Loading, PageHead, Stat, ago, money, money0, short, useFetch, when } from '../ui';

interface OverviewData {
  revenue: { packs: number; market: number; redemption_fees: number; buybacks_paid: number };
  reserves: { rocks_buyback: number; launch_reserve: number; ops: number; inventory: number };
  counts: { specimens: number; by_state: Record<string, number>; vault_value: number; packs_opened: number; wallets: number; waitlist: number; redemptions_open: number; drafts: number; sold_back_waiting: number };
  days: { day: string; packs: number; market: number; buyback: number }[];
  series: Series[];
  drop: LaunchDrop | null;
  activity: any[];
}

function Chart({ days }: { days: OverviewData['days'] }) {
  const max = Math.max(1, ...days.map(d => d.packs + d.market));
  const W = 560, H = 160, bw = W / days.length;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label="Sales over the last 14 days">
      {[0.25, 0.5, 0.75, 1].map(f => <line key={f} x1="0" x2={W} y1={H - H * f} y2={H - H * f} className="grid" />)}
      {days.map((d, i) => {
        const hp = (d.packs / max) * H, hm = (d.market / max) * H;
        return (
          <g key={d.day} transform={`translate(${i * bw + bw * 0.18},0)`}>
            <title>{`${d.day}: packs ${money(d.packs)}, market ${money(d.market)}, buybacks ${money(d.buyback)}`}</title>
            <rect y={H - hp} width={bw * 0.64} height={Math.max(hp, 0)} rx="3" className="b-packs" />
            <rect y={H - hp - hm} width={bw * 0.64} height={Math.max(hm, 0)} rx="3" className="b-market" />
            {i % 2 === 0 && <text x={bw * 0.32} y={H + 16} textAnchor="middle">{d.day.slice(8)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function SeriesMini({ s }: { s: Series }) {
  const left = s.remaining.floor + s.remaining.par + s.remaining.hit;
  const opened = s.opened.length;
  return (
    <a className="smini" href={'#/series/' + s.id}>
      <div className="smini-t"><b>{s.name}</b><Badge v={s.status} /></div>
      <div className="mono dim">{TIER_NAME[s.tier]} · {money(s.pack_price_usd)} a pack</div>
      <div className="bar"><i style={{ width: (s.size ? opened / s.size * 100 : 0) + '%' }} /></div>
      <div className="mono dim smini-c">
        <span>{opened} opened · {left} sealed</span>
        <span>{BANDS.map(b => `${BAND_NAME[b][0]} ${s.remaining[b]}`).join(' · ')}</span>
      </div>
    </a>
  );
}

const KIND: Record<string, string> = { pack: 'Pack opened', market_buy: 'Market sale', buyback: 'Buyback paid', redemption_fee: 'Redemption', redemption_refund: 'Refund', raffle: 'Drop raffle' };

export function Overview() {
  const { data, error, loading, reload } = useFetch<OverviewData>('/api/admin/overview');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const { revenue: r, reserves: rs, counts: c } = data;
  const gross = r.packs + r.market + r.redemption_fees;
  const todo: { t: string; href: string; n: number }[] = [
    { t: 'redemptions to ship', href: '#/redemptions', n: c.redemptions_open },
    { t: 'specimens with an incomplete file', href: '#/specimens', n: c.drafts },
    { t: 'sold-back specimens waiting for the next series', href: '#/specimens', n: c.sold_back_waiting },
  ].filter(x => x.n > 0);

  return (
    <>
      <PageHead kicker="Space Rocks" title="Overview">
        <button className="ab ghost" onClick={reload}>Refresh</button>
      </PageHead>

      <div className="stats4">
        <Stat label="Gross sales" value={money0(gross)} hint={`${money0(r.packs)} packs · ${money0(r.market)} market`} tone="hot" />
        <Stat label="Buybacks paid" value={money0(r.buybacks_paid)} hint="USDC, instant offers" />
        <Stat label="Vault value" value={money0(c.vault_value)} hint={`${c.specimens} specimens on record`} />
        <Stat label="Packs opened" value={c.packs_opened.toLocaleString()} hint={`${c.wallets} collectors · ${c.waitlist} on the waitlist`} />
      </div>

      <div className="grid2">
        <Card title="Sales, last 14 days" actions={<span className="legend mono"><i className="b-packs" />Packs <i className="b-market" />Market</span>}>
          <Chart days={data.days} />
        </Card>
        <Card title="Where pack money goes" actions={<a className="ab ghost sm" href="#/settings">Edit split</a>}>
          <ul className="split">
            <li><span>Inventory, the pack EV</span><b>{money(rs.inventory)}</b></li>
            <li><span>$ROCKS buyback and burn <em className="mono">reserved, token not live</em></span><b className="hot">{money(rs.rocks_buyback)}</b></li>
            <li><span>Launch reserve, funds locked specimens</span><b>{money(rs.launch_reserve)}</b></li>
            <li><span>Operations: vault, certs, capsules</span><b>{money(rs.ops)}</b></li>
          </ul>
        </Card>
      </div>

      <div className="grid2">
        <Card title="Needs attention">
          {todo.length ? (
            <ul className="todo">{todo.map(t => <li key={t.t}><a href={t.href}><b>{t.n}</b>{t.t}<span>→</span></a></li>)}</ul>
          ) : <p className="dim">Nothing waiting. The vault is in order.</p>}
          {data.drop && (
            <a className="dropmini" href={'#/drops/' + data.drop.id}>
              <div><span className="mono dim">Next launch drop</span><b>{data.drop.name}</b></div>
              <div className="r"><Badge v={data.drop.status} /><span className="mono dim">T-0 {when(data.drop.t0)}</span></div>
            </a>
          )}
        </Card>
        <Card title="Live series" actions={<a className="ab ghost sm" href="#/series">All series</a>}>
          {data.series.length ? <div className="smini-list">{data.series.map(s => <SeriesMini key={s.id} s={s} />)}</div> : <p className="dim">No series open or announced.</p>}
        </Card>
      </div>

      <Card title="Specimens by status">
        <div className="states">
          {['draft', 'vault', 'market', 'series', 'locked', 'held', 'redeeming', 'redeemed'].map(s => (
            <a key={s} href={'#/specimens'} className="state"><Badge v={s} /><b>{c.by_state[s] ?? 0}</b></a>
          ))}
        </div>
      </Card>

      <Card title="Recent activity" actions={<a className="ab ghost sm" href="#/orders">Full ledger</a>}>
        <table className="tbl">
          <thead><tr><th>What</th><th>Collector</th><th>Specimen</th><th className="r">Amount</th><th className="r">When</th></tr></thead>
          <tbody>{data.activity.map(a => (
            <tr key={a.id}><td><Badge v={a.kind}>{KIND[a.kind] ?? a.kind}</Badge></td><td className="mono">{short(a.wallet)}</td><td className="mono">{a.specimen_id ?? '—'}</td><td className={'r mono' + (a.usd < 0 ? ' neg' : '')}>{money(a.usd)}</td><td className="r dim">{ago(a.created_at)}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </>
  );
}
