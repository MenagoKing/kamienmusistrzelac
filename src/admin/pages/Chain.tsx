import { api } from '../../lib/api';
import { Badge, Card, Empty, ErrorBox, Loading, PageHead, Stat, short, useAction, useFetch, when } from '../ui';

interface ChainStatus {
  mode: 'solana' | 'simulated'; cluster: string; rpc?: string; authority: string | null; balance: number | null;
  counts: Record<string, number>; minted: number; note: string; faucet?: string;
  jobs: { id: number; specimen_id: string; action: string; owner: string | null; asset: string | null; status: string; attempts: number; signature: string | null; error: string | null; updated_at: string }[];
}

const ex = (cluster: string, kind: 'address' | 'tx', id: string) => `https://explorer.solana.com/${kind}/${id}${cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`}`;

export function Chain() {
  const d = useFetch<ChainStatus>('/api/admin/chain');
  const { busy, run } = useAction();
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data) return <Loading />;
  const c = d.data;
  const low = c.mode === 'solana' && (c.balance ?? 0) < 0.05;
  return (
    <>
      <PageHead kicker="System" title="Solana NFTs">
        <button className="ab ghost" onClick={d.reload}>Refresh</button>
        <button className="ab ghost" disabled={busy} onClick={async () => { const r = await run(() => api<ChainStatus>('POST', '/api/admin/chain/process', {}), 'Queue processed'); if (r) d.setData(r); }}>Process queue now</button>
        {(c.counts.failed ?? 0) > 0 && <button className="ab primary" disabled={busy} onClick={async () => { await run(() => api('POST', '/api/admin/chain/retry', {}), 'Retrying failed jobs'); d.reload(); }}>Retry failed</button>}
      </PageHead>
      <p className="lede">Every specimen a collector owns is a Metaplex Core NFT: minted on purchase or pull with the specimen file as on-chain attributes and a {`3%`} royalty, moved on a collector sale, burned on buyback or redemption. The vault is the permanent transfer and burn delegate, so it never needs the holder’s signature.</p>

      {low && (
        <div className="a-err" style={{ marginBottom: 18 }}>
          The vault authority has {c.balance ?? 0} SOL, so NFTs wait in the queue. Fund it on {c.cluster}: open <a href={c.faucet} target="_blank" rel="noreferrer">faucet.solana.com</a>, paste <code>{c.authority}</code> and request SOL. Minting resumes on its own.
        </div>
      )}

      <div className="stats4">
        <Stat label="Network" value={c.cluster} hint={c.mode === 'simulated' ? 'CHAIN=simulated (tests)' : c.rpc} />
        <Stat label="Authority balance" value={c.balance == null ? '—' : `${c.balance.toFixed(3)} SOL`} hint={c.authority ? <a href={ex(c.cluster, 'address', c.authority)} target="_blank" rel="noreferrer">{short(c.authority)} ↗</a> : 'simulated'} tone={low ? 'warn' : undefined} />
        <Stat label="NFTs live" value={c.minted} hint="specimens with a minted NFT" tone="hot" />
        <Stat label="Queue" value={(c.counts.pending ?? 0) + (c.counts.running ?? 0)} hint={`${c.counts.done ?? 0} done · ${c.counts.failed ?? 0} failed`} />
      </div>
      {c.authority && (
        <Card title="Vault authority">
          <p className="dim small">This keypair mints the NFTs and is their permanent transfer and burn delegate. It lives in <code>data/solana-authority.json</code> (git-ignored) or <code>SOLANA_AUTHORITY</code>. Back it up: losing it means losing control of the NFTs.</p>
          <div className="addr-card"><pre>{c.authority}</pre><button className="ab ghost sm" onClick={() => navigator.clipboard?.writeText(c.authority!)}>Copy</button></div>
          {c.note && <p className="warnline">{c.note}</p>}
        </Card>
      )}
      <Card title="Recent jobs">
        {c.jobs.length === 0 ? <Empty>No NFT jobs yet. They appear here when collectors buy or open packs.</Empty> : (
          <table className="tbl compact">
            <thead><tr><th>#</th><th>Action</th><th>Specimen</th><th>To</th><th>Status</th><th>Result</th><th className="r">Updated</th></tr></thead>
            <tbody>{c.jobs.map(j => (
              <tr key={j.id}>
                <td className="mono dim">{j.id}</td>
                <td><Badge v={j.action === 'burn' ? 'rolled' : j.action === 'transfer' ? 'blue' : 'unlocked'}>{j.action}</Badge></td>
                <td className="mono"><a href={'#/specimens/' + j.specimen_id}>{j.specimen_id}</a></td>
                <td className="mono dim">{short(j.owner)}</td>
                <td><Badge v={j.status === 'done' ? 'open' : j.status === 'failed' ? 'cancelled' : j.status === 'pending' ? 'upcoming' : 'closed'}>{j.status}{j.attempts ? ` · ${j.attempts}` : ''}</Badge></td>
                <td className="mono small">{j.signature && c.mode === 'solana' ? <a href={ex(c.cluster, 'tx', j.signature)} target="_blank" rel="noreferrer">{short(j.signature)} ↗</a> : j.error ? <span className="neg trunc" title={j.error}>{j.error}</span> : j.signature ? short(j.signature) : '—'}</td>
                <td className="r dim">{when(j.updated_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}
