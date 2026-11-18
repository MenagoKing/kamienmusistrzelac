// The NFT queue. Every specimen a collector owns gets a real Metaplex Core NFT on Solana (devnet by
// default). Purchases never wait for the chain: they queue a job and a worker mints, transfers or burns
// in order, retrying on errors. With CHAIN=simulated (tests) jobs complete instantly with fake addresses.
//
// Where the NFT goes: the collector's linked Solana wallet if they linked one, else their account's
// own wallet (server/custody.ts), else the address they signed in with.
import { activeNetwork, all, get, now, pinNetwork, run } from './db.ts';
import { getRules, specimenRow } from './store.ts';
import { randomB58 } from './util.ts';

export const SIMULATED = process.env.CHAIN === 'simulated';
const g = globalThis as unknown as { __srworker?: NodeJS.Timeout; __srbusy?: boolean; __srnote?: string };

interface Job { id: number; specimen_id: string; action: 'mint' | 'transfer' | 'burn'; owner: string | null; asset: string | null; status: string; attempts: number; signature: string | null; error: string | null; created_at: string; updated_at: string }

/** The address that should hold a collector's NFTs. */
export function nftOwnerOf(account: string) {
  return get<{ linked_wallet: string | null }>('SELECT linked_wallet FROM users WHERE address = ?', account)?.linked_wallet
    ?? get<{ pubkey: string }>('SELECT pubkey FROM custody WHERE owner = ?', account)?.pubkey
    ?? account;
}

const pendingMint = (specimenId: string) => get<Job>("SELECT * FROM nft_jobs WHERE specimen_id = ? AND action = 'mint' AND status IN ('pending', 'failed') ORDER BY id DESC LIMIT 1", specimenId);

function job(specimenId: string, action: Job['action'], owner: string | null, asset: string | null) {
  run("INSERT INTO nft_jobs (specimen_id, action, owner, asset, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)", specimenId, action, owner, asset, now(), now());
  kick();
}

/** A collector now owns this specimen: mint its NFT to them. */
export function queueMint(specimenId: string, account: string) {
  run("UPDATE specimens SET mint = NULL, mint_tx = NULL, nft_owner = NULL, mint_status = 'pending' WHERE id = ?", specimenId);
  job(specimenId, 'mint', nftOwnerOf(account), null);
}

/** Ownership moved (sale between collectors, withdrawal to a wallet). */
export function queueTransfer(specimenId: string, toAddress: string) {
  const p = pendingMint(specimenId);
  if (p) { run("UPDATE nft_jobs SET owner = ?, status = 'pending', updated_at = ? WHERE id = ?", toAddress, now(), p.id); kick(); return; }
  const s = specimenRow(specimenId);
  if (s?.mint) { run("UPDATE specimens SET mint_status = 'pending' WHERE id = ?", specimenId); job(specimenId, 'transfer', toAddress, s.mint); }
}

/** The NFT must go (buyback, redemption). Cancels a mint that has not happened yet. */
export function queueBurn(specimenId: string) {
  const p = pendingMint(specimenId);
  if (p) { run("UPDATE nft_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?", now(), p.id); run("UPDATE specimens SET mint_status = 'none' WHERE id = ?", specimenId); return; }
  const s = specimenRow(specimenId);
  if (s?.mint) { job(specimenId, 'burn', null, s.mint); run("UPDATE specimens SET mint = NULL, mint_status = 'burning' WHERE id = ?", specimenId); }
}

/* ---------- worker ---------- */

const PUBLIC_URL = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5173}`).replace(/\/$/, '');

function attributesOf(id: string) {
  const s = specimenRow(id)!;
  const f = JSON.parse(s.file || '{}');
  const a: [string, unknown][] = [
    ['Specimen', s.id], ['Name', s.name], ['Class', s.class], ['Category', s.category], ['Mass (g)', s.mass_g],
    ['Origin', s.origin ?? 'pending'], ['Fall', s.fall ?? 'unknown'], ['Vault ID', s.vault_id ?? ''], ['Vault value (USD)', s.vault_value_usd ?? ''],
    ['Meteoritical Bulletin', f.bulletin ?? ''], ['Certificate', f.coa ?? ''], ['Capsule tag', f.capsule_tag ?? ''],
  ];
  return a.filter(([, v]) => v !== '' && v != null).map(([key, value]) => ({ key, value: String(value).slice(0, 120) }));
}

async function runJob(j: Job) {
  const s = specimenRow(j.specimen_id);
  if (!s) return { skip: 'specimen gone' };
  if (SIMULATED) {
    const signature = randomB58(64);
    if (j.action === 'mint') { const asset = randomB58(32); run("UPDATE specimens SET mint = ?, mint_tx = ?, nft_owner = ?, mint_status = 'minted' WHERE id = ?", asset, signature, j.owner, s.id); return { signature, asset }; }
    if (j.action === 'transfer') { run("UPDATE specimens SET mint_tx = ?, nft_owner = ?, mint_status = 'minted' WHERE id = ?", signature, j.owner, s.id); return { signature }; }
    run("UPDATE specimens SET mint_tx = ?, nft_owner = NULL, mint_status = CASE WHEN mint IS NULL THEN 'burned' ELSE mint_status END WHERE id = ?", signature, s.id);
    return { signature };
  }
  const sol = await import('./solana.ts');
  if (j.action !== 'burn' && (await sol.balanceSol()) < 0.004) throw Object.assign(new Error(`The vault authority ${sol.authority()} has no SOL. Fund it at https://faucet.solana.com (devnet).`), { wait: true });
  if (j.action === 'mint') {
    if (!['held', 'redeeming'].includes(s.state)) return { skip: 'no longer held' };
    const r = await sol.mintAsset({ name: `${s.name} ${s.id}`, uri: `${PUBLIC_URL()}/api/nft/${activeNetwork() === 'mainnet-beta' ? 'mainnet' : 'devnet'}/${s.id}.json`, owner: j.owner!, attributes: attributesOf(s.id), royaltyBps: Math.round(getRules().royalty * 10000) });
    run("UPDATE specimens SET mint = ?, mint_tx = ?, nft_owner = ?, mint_status = 'minted' WHERE id = ?", r.asset, r.signature, j.owner, s.id);
    return { signature: r.signature, asset: r.asset };
  }
  if (j.action === 'transfer') {
    const asset = j.asset ?? s.mint;
    if (!asset) return { skip: 'nothing minted' };
    const signature = await sol.transferAsset(asset, j.owner!);
    run("UPDATE specimens SET mint_tx = ?, nft_owner = ?, mint_status = 'minted' WHERE id = ? AND mint = ?", signature, j.owner, s.id, asset);
    return { signature };
  }
  const signature = await sol.burnAsset(j.asset!);
  run("UPDATE specimens SET mint_tx = ?, nft_owner = NULL, mint_status = CASE WHEN mint IS NULL THEN 'burned' ELSE mint_status END WHERE id = ?", signature, s.id);
  return { signature };
}

/** One worker run, pinned to the network that is active when it starts. */
const tick = () => pinNetwork(tickOn);

async function tickOn() {
  if (g.__srbusy) return;
  g.__srbusy = true;
  try {
    for (let n = 0; n < 20; n++) {
      const j = get<Job>("SELECT * FROM nft_jobs WHERE status = 'pending' ORDER BY id LIMIT 1");
      if (!j) break;
      run("UPDATE nft_jobs SET status = 'running', updated_at = ? WHERE id = ?", now(), j.id);
      try {
        const r: any = await runJob(j);
        if (r.skip) run("UPDATE nft_jobs SET status = 'skipped', error = ?, updated_at = ? WHERE id = ?", r.skip, now(), j.id);
        else run("UPDATE nft_jobs SET status = 'done', signature = ?, asset = coalesce(?, asset), error = NULL, updated_at = ? WHERE id = ?", r.signature, r.asset ?? null, now(), j.id);
        g.__srnote = '';
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 400);
        g.__srnote = msg;
        if (e?.wait) { run("UPDATE nft_jobs SET status = 'pending', error = ?, updated_at = ? WHERE id = ?", msg, now(), j.id); break; }
        const attempts = j.attempts + 1;
        run('UPDATE nft_jobs SET status = ?, attempts = ?, error = ?, updated_at = ? WHERE id = ?', attempts >= 5 ? 'failed' : 'pending', attempts, msg, now(), j.id);
        if (attempts >= 5 && j.action !== 'burn') run("UPDATE specimens SET mint_status = 'failed' WHERE id = ?", j.specimen_id);
        break; // back off until the next tick
      }
    }
  } finally {
    g.__srbusy = false;
  }
}

let kicked: NodeJS.Timeout | null = null;
function kick() {
  if (kicked) return;
  kicked = setTimeout(() => { kicked = null; tick(); }, SIMULATED ? 0 : 50);
}

/** Starts the background worker once per process. */
export function startWorker() {
  run("UPDATE nft_jobs SET status = 'pending' WHERE status = 'running'");
  if (g.__srworker) clearInterval(g.__srworker);
  g.__srworker = setInterval(tick, SIMULATED ? 200 : 8000);
  kick();
}

/** Runs queued jobs now (tests and the admin "process now" button). */
export const drain = () => tick();

/* ---------- admin ---------- */

export async function chainStatus() {
  const counts = Object.fromEntries(all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM nft_jobs GROUP BY status').map(r => [r.status, r.n]));
  const minted = get<{ n: number }>("SELECT COUNT(*) n FROM specimens WHERE mint_status = 'minted'")!.n;
  const jobs = all<Job>('SELECT * FROM nft_jobs ORDER BY id DESC LIMIT 60');
  if (SIMULATED) return { mode: 'simulated', cluster: 'simulated', authority: null, balance: null, counts, minted, jobs, note: '' };
  const sol = await import('./solana.ts');
  let balance: number | null = null, error = '';
  try { balance = await sol.balanceSol(); } catch (e: any) { error = String(e?.message ?? e).slice(0, 200); }
  return { mode: 'solana', cluster: sol.cluster(), rpc: sol.rpcUrl().replace(/(api[-_]?key=)[^&]+/i, '$1…'), authority: sol.authority(), balance, counts, minted, jobs, note: g.__srnote || error, faucet: sol.cluster() === 'mainnet-beta' ? null : 'https://faucet.solana.com' };
}

export async function chainAirdrop() {
  if (SIMULATED) throw new Error('Simulated chain');
  const sol = await import('./solana.ts');
  return sol.airdrop(1);
}

export function retryFailed() {
  run("UPDATE nft_jobs SET status = 'pending', attempts = 0, updated_at = ? WHERE status = 'failed'", now());
  run("UPDATE specimens SET mint_status = 'pending' WHERE mint_status = 'failed'");
  kick();
  return { ok: true };
}

export const chainCluster = () => (SIMULATED ? 'simulated' : activeNetwork());

/** One-time: specimens minted by the old simulated adapter get a real NFT (collectors) or none (sample data). */
export function migrateSimulatedMints() {
  if (get("SELECT 1 FROM settings WHERE key = 'nft_v1'")) return;
  const rows = all<{ id: string; owner: string | null; state: string; kind: string | null }>(
    "SELECT s.id, s.owner, s.state, w.kind FROM specimens s LEFT JOIN wallets w ON w.address = s.owner WHERE s.mint IS NOT NULL AND s.mint_status = 'none'");
  for (const r of rows) {
    if (r.owner && r.state === 'held' && r.kind && r.kind !== 'sample') queueMint(r.id, r.owner);
    else run("UPDATE specimens SET mint = NULL WHERE id = ?", r.id);
  }
  run("INSERT INTO settings (key, value) VALUES ('nft_v1', '1')");
}

/* ---------- the chain watcher: the site follows the NFT ---------- */
// Every few minutes, reads who holds each minted NFT on-chain. If one moved (a sale elsewhere, a
// transfer from Phantom with an exported key), the specimen follows it (server/holders.ts).
const gw = globalThis as unknown as { __srownerwatch?: NodeJS.Timeout; __srownerbusy?: boolean };

const watchOnce = () => pinNetwork(async () => {
  if (SIMULATED || gw.__srownerbusy) return;
  gw.__srownerbusy = true;
  try {
    const rows = all<{ id: string; mint: string; nft_owner: string | null }>(
      "SELECT id, mint, nft_owner FROM specimens WHERE mint IS NOT NULL AND mint_status = 'minted' AND state IN ('held', 'external') AND id NOT IN (SELECT specimen_id FROM nft_jobs WHERE status IN ('pending', 'running'))");
    if (!rows.length) return;
    const sol = await import('./solana.ts');
    const { nftMovedTo } = await import('./holders.ts');
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const owners = await sol.readOwners(batch.map(r => r.mint));
      for (const r of batch) {
        const now = owners[r.mint];
        if (now && now !== r.nft_owner) nftMovedTo(r.id, now, 'moved on-chain');
      }
    }
  } catch (e: any) {
    g.__srnote = 'Chain watcher: ' + String(e?.message ?? e).slice(0, 200);
  } finally {
    gw.__srownerbusy = false;
  }
});

export function startOwnerWatch() {
  if (gw.__srownerwatch) clearInterval(gw.__srownerwatch);
  gw.__srownerwatch = setInterval(watchOnce, 3 * 60_000);
  setTimeout(watchOnce, 20_000);
}
