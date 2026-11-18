// SQLite storage (node:sqlite, built into Node 22.5+; no native dependency).
//
// Two networks, two separate worlds: devnet (testing) keeps its data in data/ (as before), mainnet in
// data/mainnet/. Each has its own database, Solana keys and account wallets, so test orders never mix
// with real ones. Admin switches the site between them (server/network.ts). A small control database
// (data/control.db) holds the active network, per-network settings and admin sessions.
// Set DATA_DIR to move everything.
import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export type Network = 'devnet' | 'mainnet-beta';
export const NETWORKS: Network[] = ['devnet', 'mainnet-beta'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS specimens (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, class TEXT NOT NULL, category TEXT NOT NULL,
  mass_g REAL NOT NULL, origin TEXT, fall TEXT, vault_value_usd REAL,
  state TEXT NOT NULL, series_id TEXT, drop_id TEXT, sold_back INTEGER NOT NULL DEFAULT 0,
  owner TEXT, mint TEXT, vault_id TEXT, file TEXT NOT NULL DEFAULT '{}', notes TEXT NOT NULL DEFAULT '',
  render_seed INTEGER NOT NULL, featured INTEGER NOT NULL DEFAULT 0,
  acquired_via TEXT, acquired_at TEXT, paid_usd REAL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS specimens_state ON specimens(state);
CREATE INDEX IF NOT EXISTS specimens_owner ON specimens(owner);
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, tier TEXT NOT NULL, size INTEGER NOT NULL,
  pack_price_usd REAL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  server_seed TEXT NOT NULL, commit_hash TEXT NOT NULL, seed_revealed INTEGER NOT NULL DEFAULT 0,
  drop_id TEXT, sort INTEGER NOT NULL DEFAULT 0,
  composition_published_at TEXT, sold_out_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS slots (
  series_id TEXT NOT NULL, idx INTEGER NOT NULL, specimen_id TEXT NOT NULL, band TEXT NOT NULL,
  vault_value_usd REAL NOT NULL, added_at INTEGER NOT NULL DEFAULT 0, opened_nonce INTEGER,
  PRIMARY KEY (series_id, idx)
);
CREATE TABLE IF NOT EXISTS pulls (
  id TEXT PRIMARY KEY, series_id TEXT, drop_id TEXT, specimen_id TEXT NOT NULL, wallet TEXT NOT NULL,
  band TEXT NOT NULL, pack_price_usd REAL NOT NULL, vault_value_usd REAL NOT NULL,
  nonce INTEGER, client_seed TEXT, pool INTEGER, pick INTEGER, slot INTEGER,
  bonus INTEGER NOT NULL DEFAULT 0, tx TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pulls_series ON pulls(series_id);
CREATE INDEX IF NOT EXISTS pulls_wallet ON pulls(wallet);
CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, wallet TEXT, specimen_id TEXT, series_id TEXT,
  usd REAL NOT NULL, currency TEXT NOT NULL, amount REAL NOT NULL, tx TEXT,
  split TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_kind ON ledger(kind);
CREATE TABLE IF NOT EXISTS redemptions (
  id TEXT PRIMARY KEY, specimen_id TEXT NOT NULL, wallet TEXT NOT NULL, name TEXT NOT NULL,
  address TEXT NOT NULL, status TEXT NOT NULL, fee_usd REAL NOT NULL, tracking TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drops (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, t0 TEXT NOT NULL, series_id TEXT, closed INTEGER NOT NULL DEFAULT 0,
  server_seed TEXT NOT NULL, commit_hash TEXT NOT NULL, rolled_over_from TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drop_locks (
  drop_id TEXT NOT NULL, specimen_id TEXT NOT NULL, batch TEXT NOT NULL, state TEXT NOT NULL,
  PRIMARY KEY (drop_id, specimen_id)
);
CREATE TABLE IF NOT EXISTS drop_events (
  id TEXT PRIMARY KEY, drop_id TEXT NOT NULL, kind TEXT NOT NULL, source_url TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wallets (address TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, subject TEXT NOT NULL, role TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS nonces (address TEXT PRIMARY KEY, message TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  address TEXT PRIMARY KEY, username TEXT UNIQUE COLLATE NOCASE, email TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT, avatar_seed INTEGER NOT NULL DEFAULT 1, linked_wallet TEXT,
  created_at TEXT NOT NULL, last_login TEXT
);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY, specimen_id TEXT NOT NULL, seller TEXT NOT NULL, price_usd REAL NOT NULL,
  status TEXT NOT NULL, buyer TEXT, created_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX IF NOT EXISTS listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS listings_specimen ON listings(specimen_id);
CREATE TABLE IF NOT EXISTS nft_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, specimen_id TEXT NOT NULL, action TEXT NOT NULL, owner TEXT, asset TEXT,
  status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, signature TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS nft_jobs_status ON nft_jobs(status);
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, to_owner TEXT NOT NULL, from_party TEXT NOT NULL, currency TEXT NOT NULL,
  usd REAL NOT NULL, units TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  signature TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payouts_status ON payouts(status);
CREATE TABLE IF NOT EXISTS game_runs (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL, day TEXT NOT NULL, seed TEXT NOT NULL, started_ms INTEGER NOT NULL, finished_at TEXT,
  score INTEGER NOT NULL DEFAULT 0, waves INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, valid INTEGER NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '', qualified INTEGER NOT NULL DEFAULT 0, won_specimen TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS game_runs_wallet_day ON game_runs(wallet, day);
CREATE TABLE IF NOT EXISTS custody (owner TEXT PRIMARY KEY, pubkey TEXT NOT NULL UNIQUE, secret_enc TEXT NOT NULL, created_at TEXT NOT NULL, faucet_at TEXT, exported_at TEXT);
CREATE TABLE IF NOT EXISTS dealers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL, region TEXT NOT NULL DEFAULT 'OTHER',
  ship_domestic_usd REAL NOT NULL DEFAULT 15, ship_region_usd REAL NOT NULL DEFAULT 28, ship_world_usd REAL NOT NULL DEFAULT 45,
  insurance_pct REAL NOT NULL DEFAULT 0.015, contact TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  api_kind TEXT NOT NULL DEFAULT 'manual', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY, specimen_id TEXT NOT NULL, holder TEXT NOT NULL, status TEXT NOT NULL,
  reserved_price_usd REAL NOT NULL, commission_usd REAL NOT NULL, paid_usd REAL NOT NULL, currency TEXT NOT NULL,
  token_amount REAL, replaced_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX IF NOT EXISTS reservations_specimen ON reservations(specimen_id);
CREATE INDEX IF NOT EXISTS reservations_holder ON reservations(holder);
CREATE TABLE IF NOT EXISTS escrows (
  id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL, specimen_id TEXT NOT NULL, holder TEXT NOT NULL,
  amount_usd REAL NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX IF NOT EXISTS escrows_status ON escrows(status);
CREATE TABLE IF NOT EXISTS escrow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, escrow_id TEXT NOT NULL, kind TEXT NOT NULL, amount_usd REAL NOT NULL,
  to_party TEXT NOT NULL, tx TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
`;

type Row = Record<string, any>;

const g = globalThis as unknown as { __srconns?: Map<Network, DatabaseSync>; __srctl?: DatabaseSync; __srnet?: Network; __srpin?: AsyncLocalStorage<Network> };

// Every request and every worker run is pinned to the network it started on (through its awaits),
// so a network switch can never send a half-finished payment, payout or NFT job to the other network.
const pin: AsyncLocalStorage<Network> = (g.__srpin ??= new AsyncLocalStorage<Network>());

function openFile(file: string, schema: string) {
  const c = new DatabaseSync(file);
  c.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  c.exec(schema);
  return c;
}

/* ---------- control database: active network, per-network settings, admin sessions ---------- */

const CONTROL_SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_sessions (token TEXT PRIMARY KEY, subject TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
`;
export const ctl: DatabaseSync = g.__srctl ?? (g.__srctl = openFile(path.join(DATA_DIR, 'control.db'), CONTROL_SCHEMA));
ctl.exec(CONTROL_SCHEMA);
export const ctlGet = (key: string) => (ctl.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
export function ctlSet(key: string, value: string | null) {
  if (value == null || value === '') ctl.prepare('DELETE FROM kv WHERE key = ?').run(key);
  else ctl.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** The network this request or job runs on (pinned when it started), else the site's network. */
export function activeNetwork(): Network {
  return pin.getStore() ?? siteNetwork();
}

/** The network the site runs on: what Admin › Network chose, else SOLANA_CLUSTER, else devnet. */
export function siteNetwork(): Network {
  if (g.__srnet) return g.__srnet;
  const saved = ctlGet('network');
  const n: Network = saved === 'mainnet-beta' || saved === 'devnet' ? saved : process.env.SOLANA_CLUSTER === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';
  return (g.__srnet = n);
}
export function setActiveNetwork(n: Network) {
  ctlSet('network', n);
  g.__srnet = n;
}

/** Runs fn (and everything it awaits) on the given network. */
export function onNetwork<T>(n: Network, fn: () => T): T {
  return pin.run(n, fn);
}

/** Pins fn to the network that is active now: a switch while it runs does not affect it. */
export function pinNetwork<T>(fn: () => T): T {
  return pin.run(activeNetwork(), fn);
}

/** Where a network keeps its database and keys. Devnet uses the data folder itself (as before). */
export function netDir(n: Network = activeNetwork()) {
  const d = n === 'devnet' ? DATA_DIR : path.join(DATA_DIR, 'mainnet');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/* ---------- one database per network ---------- */

const ready = new WeakSet<DatabaseSync>(); // schema applied by this copy of the module (Vite reloads it in dev)

/** The connection for a network (opened once per process). */
export function connFor(n: Network): DatabaseSync {
  const conns = (g.__srconns ??= new Map());
  let c = conns.get(n);
  if (!c) { c = openFile(path.join(netDir(n), 'space-rocks.db'), SCHEMA); conns.set(n, c); }
  if (!ready.has(c)) { c.exec(SCHEMA); migrate(c); ready.add(c); }
  return c;
}

/** The active network's connection. */
export const conn = () => connFor(activeNetwork());

/** The active network's database (follows a network switch). */
export const db = new Proxy({} as DatabaseSync, {
  get(_, k) { const c = conn() as any; const v = c[k]; return typeof v === 'function' ? v.bind(c) : v; },
});

/** Adds columns introduced after a database was created. */
function migrate(c: DatabaseSync) {
  const addColumn = (table: string, col: string, def: string) => {
    const cols = (c.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(x => x.name);
    if (!cols.includes(col)) c.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addColumn('specimens', 'mint_status', "TEXT NOT NULL DEFAULT 'none'");
  addColumn('specimens', 'mint_tx', 'TEXT');
  addColumn('specimens', 'nft_owner', 'TEXT');
  addColumn('users', 'google_sub', 'TEXT');
  addColumn('series', 'ends_at', 'TEXT');
  // Addendum 1: specimens sourced from dealers, reservations instead of vault stock.
  addColumn('specimens', 'dealer_id', 'TEXT');
  addColumn('specimens', 'dealer_price_usd', 'REAL');
  addColumn('specimens', 'dealer_sku', "TEXT NOT NULL DEFAULT ''");
  addColumn('specimens', 'dealer_url', "TEXT NOT NULL DEFAULT ''");
  addColumn('specimens', 'source_status', "TEXT NOT NULL DEFAULT 'available'");
  addColumn('specimens', 'source_verified_at', 'TEXT');
  addColumn('redemptions', 'kind', "TEXT NOT NULL DEFAULT 'vault'");
  addColumn('redemptions', 'reservation_id', 'TEXT');
  addColumn('redemptions', 'dealer_id', 'TEXT');
  addColumn('redemptions', 'dealer_order_ref', "TEXT NOT NULL DEFAULT ''");
  addColumn('redemptions', 'due_at', 'TEXT');
  addColumn('redemptions', 'shipping_usd', 'REAL');
  addColumn('redemptions', 'price_delta_usd', 'REAL');
  addColumn('sessions', 'created_at', 'INTEGER NOT NULL DEFAULT 0');
}

export const all = <T = Row>(sql: string, ...p: any[]) => conn().prepare(sql).all(...p) as T[];
export const get = <T = Row>(sql: string, ...p: any[]) => conn().prepare(sql).get(...p) as T | undefined;
export const run = (sql: string, ...p: any[]) => conn().prepare(sql).run(...p);

let depth = 0;
/** Runs fn in a transaction (nested calls join the outer one). */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  const c = conn();
  depth++;
  c.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    c.exec('COMMIT');
    return out;
  } catch (e) {
    c.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export const now = () => new Date().toISOString();
