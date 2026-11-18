// Admin › Network: run the site on devnet (testing) or mainnet (real money, real NFTs), and the
// payouts queue with the treasury. Each network has its own data, keys and wallets.
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { Badge, Card, Empty, ErrorBox, Field, Loading, Modal, PageHead, Stat, Toggle, money, short, useAction, useFetch, when } from '../ui';

interface Bal { address: string | null; sol: number | null; usdc: number | null; error: string | null }
interface Net {
  id: 'devnet' | 'mainnet-beta'; label: string; active: boolean; payments: 'live' | 'simulated';
  rpc: string; rpc_custom: boolean; rpc_from_env: boolean; priority_fee: number; usdc_mint: string | null;
  vault: Bal; treasury: Bal; escrow: Bal;
  counts: { specimens: number; on_market: number; accounts: number; payouts_waiting: number; nfts_waiting: number };
  checks: { ok: boolean; label: string; hint: string; required?: boolean }[];
  ready: boolean;
}
interface Status { active: Net['id']; simulated_chain: boolean; payments_live: boolean; networks: Net[] }

export const explorer = (net: string, kind: 'address' | 'tx', id: string) => `https://explorer.solana.com/${kind}/${id}${net === 'mainnet-beta' ? '' : `?cluster=${net}`}`;
const sol = (x: number | null) => (x == null ? '—' : `${x.toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL`);
const usdc = (x: number | null) => (x == null ? '—' : `${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`);

function WalletRow({ net, title, hint, b }: { net: string; title: string; hint: string; b: Bal }) {
  return (
    <div className="nwal">
      <div><b>{title}</b><small className="dim">{hint}</small></div>
      {b.address ? (
        <>
          <code className="mono" title={b.address}>{b.address}</code>
          <div className="nwal-b mono"><span>{sol(b.sol)}</span><span>{usdc(b.usdc)}</span></div>
          <div className="nwal-a">
            <button className="ab ghost sm" onClick={() => navigator.clipboard?.writeText(b.address!)}>Copy</button>
            <a className="ab ghost sm" href={explorer(net, 'address', b.address)} target="_blank" rel="noreferrer">Explorer ↗</a>
          </div>
          {b.error && <small className="late-t">{b.error}</small>}
        </>
      ) : <span className="dim small">Created when this network is first used.</span>}
    </div>
  );
}

function NetCard({ n, onSwitch, onSaved }: { n: Net; onSwitch: () => void; onSaved: (s: Status) => void }) {
  const [rpc, setRpc] = useState('');
  const [fee, setFee] = useState(String(n.priority_fee));
  const { busy, run } = useAction();
  const save = async (body: any, msg: string) => { const r = await run(() => api<Status>('PUT', '/api/admin/network/' + n.id, body), msg); if (r) { onSaved(r); setRpc(''); } };
  const main = n.id === 'mainnet-beta';
  return (
    <Card className={'netc' + (n.active ? ' on' : '') + (main ? ' main' : '')} title={<>{n.label} {n.active ? <Badge v="active">site runs here</Badge> : null}</>}
      actions={n.active ? null : <button className={'ab ' + (main ? 'danger' : 'primary')} onClick={onSwitch}>Switch the site to {n.label}</button>}>
      <p className="dim small">{main ? 'Real SOL, real USDC, real NFTs. Starts empty: no sample data. Payments are always real.' : 'Testing. Free devnet SOL and USDC, sample data. Payments can be simulated or real devnet transfers.'}</p>
      <div className="nstats mono">
        <span><b>{n.counts.specimens}</b> specimens</span><span><b>{n.counts.on_market}</b> on the market</span><span><b>{n.counts.accounts}</b> accounts</span>
        <span className={n.counts.payouts_waiting ? 'late-t' : ''}><b>{n.counts.payouts_waiting}</b> payouts waiting</span><span><b>{n.counts.nfts_waiting}</b> NFTs waiting</span>
      </div>

      <h3 className="ed-h">Ready to run {main && (n.ready ? <Badge v="active">required checks pass</Badge> : <Badge v="sold_at_source">not ready</Badge>)}</h3>
      <ul className="nchk">{n.checks.map(c => (
        <li key={c.label} className={c.ok ? 'ok' : c.required ? 'bad' : 'warn'}>
          <i aria-hidden="true">{c.ok ? '✓' : c.required ? '✕' : '!'}</i>
          <div><b>{c.label}</b>{!c.ok && <small>{c.hint}</small>}</div>
        </li>
      ))}</ul>

      <h3 className="ed-h">Wallets</h3>
      <div className="nwals">
        <WalletRow net={n.id} title="Vault (authority)" hint="Pays network fees, mints and burns NFTs. Keep SOL here." b={n.vault} />
        <WalletRow net={n.id} title="Treasury" hint="Receives sales; pays refunds, buybacks and seller payouts." b={n.treasury} />
        <WalletRow net={n.id} title="Escrow" hint="Holds the rock price of every reservation. No admin can withdraw it." b={n.escrow} />
      </div>
      {n.usdc_mint && <p className="dim small">USDC mint <code className="mono">{short(n.usdc_mint)}</code>{main ? '' : ' · devnet USDC is free at faucet.circle.com'}</p>}

      <h3 className="ed-h">Settings</h3>
      {!main && (
        <div className="tgls">
          <Toggle checked={n.payments === 'live'} onChange={v => save({ payments_live: v }, v ? 'Devnet payments are now real devnet transfers' : 'Devnet payments are simulated')}
            label="Real devnet payments" hint="Collectors pay with devnet USDC or SOL from their wallet, exactly as on mainnet. Off: purchases are simulated." />
        </div>
      )}
      <div className="form-grid">
        <Field label="RPC URL" span={2} hint={n.rpc_from_env ? 'Set in .env (overrides this field)' : `Now: ${n.rpc}${n.rpc_custom ? '' : ' (public, rate-limited)'}`}>
          <input value={rpc} onChange={e => setRpc(e.target.value)} placeholder={main ? 'https://mainnet.helius-rpc.com/?api-key=…' : 'https://devnet.helius-rpc.com/?api-key=…'} disabled={n.rpc_from_env} />
        </Field>
        <Field label="Priority fee" hint="micro-lamports per compute unit"><input type="number" min={0} value={fee} onChange={e => setFee(e.target.value)} /></Field>
      </div>
      <div className="row-a">
        <button className="ab ghost sm" disabled={busy || (!rpc.trim() && Number(fee) === n.priority_fee)} onClick={() => save({ ...(rpc.trim() ? { rpc_url: rpc.trim() } : {}), priority_fee: Number(fee) }, 'Saved')}>Save</button>
        {n.rpc_custom && !n.rpc_from_env && <button className="ab ghost sm" disabled={busy} onClick={() => save({ rpc_url: '' }, 'Back to the public RPC')}>Use the public RPC</button>}
      </div>
    </Card>
  );
}

function SwitchModal({ to, onClose, onDone }: { to: Net; onClose: () => void; onDone: (s: Status) => void }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, run } = useAction();
  const main = to.id === 'mainnet-beta';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api<Status>('POST', '/api/admin/network/switch', { network: to.id, password: pw, confirm }), `The site now runs on ${to.label}`);
    if (r) onDone(r);
  };
  return (
    <Modal title={`Switch the site to ${to.label}?`} onClose={onClose} footer={<>
      <span className="grow" />
      <button className="ab ghost" onClick={onClose}>Cancel</button>
      <button className={'ab ' + (main ? 'danger' : 'primary')} form="netsw" disabled={busy || !pw || (main && confirm !== 'MAINNET')}>{busy ? 'Switching…' : `Switch to ${to.label}`}</button>
    </>}>
      <form id="netsw" onSubmit={submit} className="form-grid">
        <div style={{ gridColumn: '1/-1' }}>
          <p>Everyone on the site moves to {to.label} at once. Collectors are signed out: their accounts, specimens and wallets belong to one network. Nothing is deleted; switching back brings everything back.</p>
          {main && <p className="late-t">On mainnet every purchase, refund and NFT is real. {to.ready ? '' : 'Some required checks do not pass yet: payments and NFTs will wait until they do.'}</p>}
        </div>
        <Field label="Admin password" span={main ? undefined : 3}><input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} autoFocus /></Field>
        {main && <Field label="Type MAINNET to confirm" span={2}><input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="MAINNET" /></Field>}
      </form>
    </Modal>
  );
}

export function NetworkPage() {
  const d = useFetch<Status>('/api/admin/network');
  const [to, setTo] = useState<Net | null>(null);
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data) return <Loading />;
  const s = d.data;
  return (
    <>
      <PageHead kicker="System" title="Network"><button className="ab ghost" onClick={d.reload}>Refresh</button></PageHead>
      <p className="lede">The site runs on one Solana network at a time. Devnet and mainnet are separate worlds: each has its own specimens, accounts, wallets and orders, so test orders never mix with real ones.{s.simulated_chain ? ' (CHAIN=simulated: nothing touches Solana on this server.)' : ''}</p>
      <div className="grid2">{s.networks.map(n => <NetCard key={n.id} n={n} onSwitch={() => setTo(n)} onSaved={d.setData} />)}</div>
      {to && <SwitchModal to={to} onClose={() => setTo(null)} onDone={r => { d.setData(r); setTo(null); setTimeout(() => location.reload(), 600); }} />}
    </>
  );
}

/* ---------- payouts and the treasury ---------- */

interface Payout { id: number; to_owner: string; from_party: string; currency: string; usd: number; units: string; memo: string; status: string; attempts: number; signature: string | null; error: string | null; created_at: string; updated_at: string }

export function Payouts({ network }: { network: string }) {
  const [f, setF] = useState('');
  const d = useFetch<{ rows: Payout[]; counts: Record<string, number>; note: string; live: boolean }>('/api/admin/payouts' + (f ? '?status=' + f : ''), [f]);
  const [w, setW] = useState(false);
  const { busy, run } = useAction();
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data) return <Loading />;
  const c = d.data.counts;
  const amount = (p: Payout) => p.currency === 'SOL' ? `${Number(p.units) / 1e9} SOL` : p.currency === 'USDC' ? money(Number(p.units) / 1e6) : `${p.units} units`;
  return (
    <>
      <PageHead kicker="Operations" title="Payouts & treasury">
        <button className="ab ghost" onClick={d.reload}>Refresh</button>
        {d.data.live && <button className="ab primary" onClick={() => setW(true)}>Withdraw from treasury</button>}
      </PageHead>
      <p className="lede">Refunds, buybacks, seller payouts, escrow moves and treasury withdrawals, sent on-chain in order. A payout waits (and retries) until the wallet it comes from can pay it. {d.data.live ? '' : 'Payments are simulated on this network, so nothing is queued here.'}</p>
      <div className="stats4">
        <Stat label="Waiting" value={(c.pending ?? 0) + (c.sending ?? 0)} hint={d.data.note || 'sent within seconds'} tone={(c.pending ?? 0) > 0 && d.data.note ? 'warn' : undefined} />
        <Stat label="Failed" value={c.failed ?? 0} hint="after 5 attempts; retry below" tone={(c.failed ?? 0) > 0 ? 'warn' : undefined} />
        <Stat label="Sent" value={c.done ?? 0} hint="confirmed on-chain" tone="hot" />
        <Stat label="Network" value={network === 'mainnet-beta' ? 'Mainnet' : 'Devnet'} hint={d.data.live ? 'real transfers' : 'simulated'} />
      </div>
      <div className="seg-row">{(['', 'pending', 'failed', 'done'] as const).map(k => <button key={k} className={'ab sm ' + (f === k ? 'primary' : 'ghost')} onClick={() => setF(k)}>{k || 'All'}</button>)}</div>
      {d.data.rows.length === 0 ? <Empty>No payouts{f ? ' with this status' : ''}.</Empty> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>What</th><th>From</th><th>To</th><th className="r">Amount</th><th>Status</th><th>Transaction</th><th className="r">When</th><th /></tr></thead>
            <tbody>{d.data.rows.map(p => (
              <tr key={p.id}>
                <td className="mono dim">{p.id}</td>
                <td>{p.memo}{p.error && <><br /><small className="late-t">{p.error}</small></>}</td>
                <td><Badge v={p.from_party === 'escrow' ? 'esc_locked' : 'grey'}>{p.from_party}</Badge></td>
                <td className="mono">{p.to_owner.startsWith('sys:') ? p.to_owner.slice(4) : short(p.to_owner)}</td>
                <td className="r mono">{amount(p)}</td>
                <td><Badge v={p.status === 'done' ? 'active' : p.status === 'failed' ? 'sold_at_source' : 'requested'}>{p.status}</Badge>{p.attempts > 0 && <small className="dim"> ×{p.attempts}</small>}</td>
                <td className="mono">{p.signature ? <a href={explorer(network, 'tx', p.signature)} target="_blank" rel="noreferrer">{short(p.signature)} ↗</a> : '—'}</td>
                <td className="r dim">{when(p.updated_at)}</td>
                <td className="r">{(p.status === 'failed' || (p.status === 'pending' && p.error)) && <button className="ab ghost sm" disabled={busy} onClick={async () => { await run(() => api('POST', `/api/admin/payouts/${p.id}/retry`, {}), 'Retrying'); d.reload(); }}>Retry</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {w && <WithdrawModal onClose={() => setW(false)} onDone={() => { setW(false); d.reload(); }} />}
    </>
  );
}

function WithdrawModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [to, setTo] = useState('');
  const [currency, setCurrency] = useState<'USDC' | 'SOL'>('USDC');
  const [amount, setAmount] = useState('');
  const [pw, setPw] = useState('');
  const { busy, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await run(() => api('POST', '/api/admin/treasury/withdraw', { to, currency, amount: Number(amount), password: pw }), 'Withdrawal queued');
    if (r) onDone();
  };
  return (
      <Modal title="Withdraw from the treasury" onClose={onClose} footer={<><span className="grow" /><button className="ab ghost" onClick={onClose}>Cancel</button><button className="ab danger" form="wdr" disabled={busy || !to || !(Number(amount) > 0) || !pw}>{busy ? 'Queuing…' : 'Withdraw'}</button></>}>
        <form id="wdr" onSubmit={submit} className="form-grid">
          <p style={{ gridColumn: '1/-1' }} className="dim small">Moves revenue to an address you control (a cold wallet or a Squads multisig). Leave enough USDC for refunds and buybacks. Escrow money is never withdrawable.</p>
          <Field label="To address" span={3}><input value={to} onChange={e => setTo(e.target.value.trim())} placeholder="Solana address" /></Field>
          <Field label="Currency"><select value={currency} onChange={e => setCurrency(e.target.value as 'USDC' | 'SOL')}><option>USDC</option><option>SOL</option></select></Field>
          <Field label="Amount"><input type="number" min={0} step="0.000001" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          <Field label="Admin password"><input type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
        </form>
      </Modal>
  );
}
