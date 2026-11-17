// SQLite storage (node:sqlite, built into Node 22.5+; no native dependency).
// The database lives in data/space-rocks.db (git-ignored). Set DATA_DIR to move it.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
`;

type Row = Record<string, any>;

const g = globalThis as unknown as { __srdb?: DatabaseSync };

function open() {
  const db = new DatabaseSync(path.join(DATA_DIR, 'space-rocks.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** One connection per process (survives Vite's module reloads in dev). */
export const db: DatabaseSync = g.__srdb ?? (g.__srdb = open());
db.exec(SCHEMA); // idempotent: picks up new tables when Vite reloads this module in dev

/** Adds columns introduced after a database was created. */
function addColumn(table: string, col: string, def: string) {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('specimens', 'mint_status', "TEXT NOT NULL DEFAULT 'none'");
addColumn('specimens', 'mint_tx', 'TEXT');
addColumn('specimens', 'nft_owner', 'TEXT');
addColumn('users', 'google_sub', 'TEXT');
addColumn('series', 'ends_at', 'TEXT');

export const all = <T = Row>(sql: string, ...p: any[]) => db.prepare(sql).all(...p) as T[];
export const get = <T = Row>(sql: string, ...p: any[]) => db.prepare(sql).get(...p) as T | undefined;
export const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);

let depth = 0;
/** Runs fn in a transaction (nested calls join the outer one). */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export const now = () => new Date().toISOString();
