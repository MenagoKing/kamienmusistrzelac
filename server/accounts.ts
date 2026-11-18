// Collector accounts: callsign + email + password registration, sign-in, profile and game progress
// (levels, ranks, collection book, achievements). Every account has a vault address that owns its
// specimens; Solana wallet sign-in uses the wallet's own address. A wallet can also be linked to an
// email account as its payout / withdrawal wallet.
import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Achievement, Activity, Profile, RockType } from '../shared/types.ts';
import { CATEGORY_NAME } from '../shared/rules.ts';
import { all, get, now, run, tx } from './db.ts';
import { DAY, WALLET_COOKIE, newSession, sessionAge, touchWallet, verifyWalletSignature } from './auth.ts';
import { createWallet, custodialOf, faucetAt, markExported, markFaucet, secretOf } from './custody.ts';
import { b58encode, fail, str } from './util.ts';

interface UserRow { address: string; username: string | null; email: string | null; password_hash: string | null; avatar_seed: number; linked_wallet: string | null; created_at: string; last_login: string | null }

const userRow = (address: string) => get<UserRow>('SELECT * FROM users WHERE address = ?', address);

/* ---------- passwords ---------- */

function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function checkPassword(pw: string, stored: string | null) {
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

/* ---------- validation ---------- */

const USERNAME = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function readUsername(v: unknown) {
  const u = str(v, 'Callsign', 40);
  if (!USERNAME.test(u)) fail(400, 'Callsign: 3 to 20 letters, numbers or _');
  return u;
}
function readEmail(v: unknown) {
  const e = str(v, 'Email', 200).toLowerCase();
  if (!EMAIL.test(e)) fail(400, 'Enter a valid email');
  return e;
}
function readPassword(v: unknown) {
  if (typeof v !== 'string' || v.length < 8) fail(400, 'Password: at least 8 characters');
  if ((v as string).length > 200) fail(400, 'Password is too long');
  return v as string;
}
const taken = (col: 'username' | 'email', v: string, except = '') => !!get(`SELECT 1 FROM users WHERE ${col} = ? COLLATE NOCASE AND address != ?`, v, except);

/* ---------- register / sign in ---------- */

const attempts = new Map<string, { n: number; until: number }>();
function throttle(req: IncomingMessage) {
  const ip = req.socket.remoteAddress ?? '?';
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) fail(429, 'Too many attempts. Wait a minute and try again.');
  return {
    bad() { const n = (a?.n ?? 0) + 1; attempts.set(ip, { n, until: n >= 8 ? Date.now() + 60000 : 0 }); },
    ok() { attempts.delete(ip); },
  };
}

export function register(req: IncomingMessage, res: ServerResponse, b: any) {
  const t = throttle(req);
  const username = readUsername(b?.username), email = readEmail(b?.email), password = readPassword(b?.password);
  const seed = Number.isFinite(Number(b?.avatar_seed)) ? Math.abs(Math.round(Number(b.avatar_seed))) % 100000 : Math.floor(Math.random() * 100000);
  if (taken('username', username)) { t.bad(); fail(409, 'That callsign is taken'); }
  if (taken('email', email)) { t.bad(); fail(409, 'An account with this email already exists. Sign in instead.'); }
  let address = '';
  tx(() => {
    address = createWallet(); // the account's own Solana wallet; its address is the account address
    touchWallet(address, 'account');
    run('INSERT INTO users (address, username, email, password_hash, avatar_seed, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?)', address, username, email, hashPassword(password), seed, now(), now());
  });
  t.ok();
  newSession(res, WALLET_COOKIE, address, 'wallet', 30 * DAY);
  return { address, username };
}

export function login(req: IncomingMessage, res: ServerResponse, b: any) {
  const t = throttle(req);
  const id = str(b?.login, 'Callsign or email', 200);
  const pw = typeof b?.password === 'string' ? b.password : '';
  const u = get<UserRow>('SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE', id, id.toLowerCase());
  if (!u || !checkPassword(pw, u.password_hash)) { t.bad(); fail(401, 'Wrong callsign, email or password'); }
  t.ok();
  run('UPDATE users SET last_login = ? WHERE address = ?', now(), u!.address);
  touchWallet(u!.address, 'account');
  newSession(res, WALLET_COOKIE, u!.address, 'wallet', 30 * DAY);
  return { address: u!.address, username: u!.username };
}

/* ---------- profile edits ---------- */

function ensureUser(address: string) {
  run('INSERT INTO users (address, avatar_seed, created_at) VALUES (?, ?, ?) ON CONFLICT(address) DO NOTHING', address, Math.floor(Math.random() * 100000), now());
  return userRow(address)!;
}

export function updateProfile(address: string, b: any) {
  const u = ensureUser(address);
  const username = b?.username === undefined ? u.username : readUsername(b.username);
  const email = b?.email === undefined ? u.email : b.email === '' || b.email === null ? null : readEmail(b.email);
  const seed = b?.avatar_seed === undefined ? u.avatar_seed : Math.abs(Math.round(Number(b.avatar_seed) || 1)) % 100000;
  if (username && taken('username', username, address)) fail(409, 'That callsign is taken');
  if (email && taken('email', email, address)) fail(409, 'That email is used by another account');
  run('UPDATE users SET username = ?, email = ?, avatar_seed = ? WHERE address = ?', username, email, seed, address);
  return profileOf(address);
}

export function changePassword(address: string, b: any) {
  const u = ensureUser(address);
  if (u.password_hash && !checkPassword(String(b?.current ?? ''), u.password_hash)) fail(401, 'Your current password is wrong');
  if (!u.email && !b?.email) fail(400, 'Add an email first, so you can sign in with it');
  run('UPDATE users SET password_hash = ? WHERE address = ?', hashPassword(readPassword(b?.next)), address);
  return { ok: true };
}

/** Links a Solana wallet (signed message) as the account's withdrawal wallet. */
export function linkWallet(address: string, b: any) {
  const wallet = verifyWalletSignature(b);
  ensureUser(address);
  if (get('SELECT 1 FROM users WHERE linked_wallet = ? AND address != ?', wallet, address)) fail(409, 'This wallet is linked to another account');
  run('UPDATE users SET linked_wallet = ? WHERE address = ?', wallet, address);
  return profileOf(address);
}

export function unlinkWallet(address: string) {
  run('UPDATE users SET linked_wallet = NULL WHERE address = ?', address);
  return profileOf(address);
}

/* ---------- game progress ---------- */

const RANKS: [number, string][] = [[1, 'Stargazer'], [3, 'Meteor spotter'], [5, 'Field hunter'], [8, 'Strewn-field ranger'], [12, 'Impact collector'], [17, 'Planetary archivist']];
const XP_STEP = 40; // level n starts at 40 × (n−1)²

export const levelOf = (xp: number) => Math.floor(Math.sqrt(xp / XP_STEP)) + 1;
const rankOf = (lvl: number) => [...RANKS].reverse().find(([l]) => lvl >= l)![1];
const nextRank = (lvl: number) => RANKS.find(([l]) => l > lvl) ?? null;
const BOOK: RockType[] = ['stone', 'iron', 'pallasite', 'lunar', 'martian'];

export function profileOf(address: string): Profile {
  const u = userRow(address);
  const w = get<{ kind: string; created_at: string }>('SELECT kind, created_at FROM wallets WHERE address = ?', address);
  const n = (sql: string, ...p: any[]) => get<{ n: number }>(sql, ...p)!.n ?? 0;
  const s = (sql: string, ...p: any[]) => get<{ s: number | null }>(sql, ...p)!.s ?? 0;

  const packs = n('SELECT COUNT(*) n FROM pulls WHERE wallet = ? AND bonus = 0', address);
  const hits = n("SELECT COUNT(*) n FROM pulls WHERE wallet = ? AND bonus = 0 AND band = 'hit'", address);
  const dropPacks = n('SELECT COUNT(*) n FROM pulls WHERE wallet = ? AND bonus = 0 AND drop_id IS NOT NULL', address);
  const raffles = n('SELECT COUNT(*) n FROM pulls WHERE wallet = ? AND bonus = 1', address);
  const marketBuys = n("SELECT COUNT(*) n FROM ledger WHERE wallet = ? AND kind IN ('market_buy', 'reservation')", address);
  const secondaryBuys = n("SELECT COUNT(*) n FROM ledger WHERE wallet = ? AND kind = 'secondary_sale'", address);
  const sold = n("SELECT COUNT(*) n FROM ledger WHERE wallet = ? AND kind = 'seller_payout'", address);
  const buybacks = n("SELECT COUNT(*) n FROM ledger WHERE wallet = ? AND kind = 'buyback'", address);
  const redeemed = n("SELECT COUNT(*) n FROM redemptions WHERE wallet = ? AND status != 'cancelled'", address);
  const earned = -s("SELECT SUM(usd) s FROM ledger WHERE wallet = ? AND kind IN ('seller_payout', 'buyback')", address);

  const held = all<{ category: RockType; vault_value_usd: number | null }>("SELECT category, vault_value_usd FROM specimens WHERE owner = ? AND state IN ('held', 'redeeming')", address);
  const everIds = new Set(all<{ specimen_id: string }>("SELECT DISTINCT specimen_id FROM ledger WHERE wallet = ? AND kind IN ('market_buy', 'reservation', 'pack', 'raffle', 'secondary_sale') AND specimen_id IS NOT NULL", address).map(r => r.specimen_id));
  const ever = new Set<RockType>();
  let rareEver = 0;
  for (const id of everIds) {
    const c = get<{ category: RockType }>('SELECT category FROM specimens WHERE id = ?', id)?.category;
    if (c) { ever.add(c); if (c === 'lunar' || c === 'martian') rareEver++; }
  }
  for (const h of held) ever.add(h.category);
  const heldCats = new Set(held.map(h => h.category));

  const xp = packs * 10 + hits * 40 + dropPacks * 15 + raffles * 50 + (marketBuys + secondaryBuys) * 15 + sold * 20 + buybacks * 5 + redeemed * 25 + rareEver * 30 + ever.size * 10;
  const level = levelOf(xp);
  const nr = nextRank(level);

  const ach = (id: string, title: string, desc: string, done: boolean, progress?: string): Achievement => ({ id, title, desc, done, progress: done ? undefined : progress });
  const achievements: Achievement[] = [
    ach('first_light', 'First light', 'Open your first pack', packs > 0),
    ach('worth_filming', 'Worth filming', 'Pull a Hit from a pack', hits > 0),
    ach('box_breaker', 'Box breaker', 'Open 10 packs', packs >= 10, `${packs} / 10`),
    ach('picked_by_hand', 'Picked by hand', 'Buy a specimen on the market', marketBuys + secondaryBuys > 0),
    ach('piece_of_mars', 'A piece of Mars', 'Own a Martian specimen', ever.has('martian')),
    ach('moonstruck', 'Moonstruck', 'Own a lunar specimen', ever.has('lunar')),
    ach('core_sample', 'Core sample', 'Own a pallasite', ever.has('pallasite')),
    ach('full_set', 'Planetary archivist', 'Hold all five classes at once', BOOK.every(c => heldCats.has(c)), `${heldCats.size} / 5`),
    ach('launch_witness', 'Launch witness', 'Open a pack in a launch drop', dropPacks > 0),
    ach('ship_catch', 'Ship catch', 'Win a Batch B raffle', raffles > 0),
    ach('trader', 'Trader', 'Sell a specimen to another collector', sold > 0),
    ach('homecoming', 'Homecoming', 'Redeem a specimen to your door', redeemed > 0),
  ];

  return {
    address,
    username: u?.username ?? null,
    email: u?.email ?? null,
    has_password: !!u?.password_hash,
    avatar_seed: u?.avatar_seed ?? (parseInt(address.slice(0, 6), 36) % 100000 || 1),
    linked_wallet: u?.linked_wallet ?? null,
    wallet: custodialOf(address),
    kind: w?.kind ?? 'wallet',
    created_at: u?.created_at ?? w?.created_at ?? now(),
    level, xp,
    xp_level_start: XP_STEP * (level - 1) ** 2,
    xp_next: XP_STEP * level ** 2,
    rank: rankOf(level),
    next_rank: nr ? `${nr[1]} at level ${nr[0]}` : null,
    stats: { held: held.length, value: Math.round(held.reduce((a, h) => a + (h.vault_value_usd ?? 0), 0) * 100) / 100, packs, hits, sold, earned: Math.round(earned * 100) / 100, redeemed },
    book: BOOK.map(t => ({ type: t, label: CATEGORY_NAME[t], held: held.filter(h => h.category === t).length, ever: ever.has(t) })),
    achievements,
  };
}

const ACT_KINDS = ['market_buy', 'pack', 'raffle', 'secondary_sale', 'seller_payout', 'buyback', 'redemption_fee', 'redemption_refund', 'reservation', 'reservation_cancel', 'reservation_refund', 'replacement_refund', 'price_difference_refund', 'price_difference_topup'];

export function activityOf(address: string): Activity[] {
  return all<any>(`SELECT l.id, l.kind, l.usd, l.specimen_id, s.name specimen_name, l.created_at FROM ledger l LEFT JOIN specimens s ON s.id = l.specimen_id
    WHERE l.wallet = ? AND l.kind IN (${ACT_KINDS.map(() => '?').join(',')}) ORDER BY l.created_at DESC LIMIT 100`, address, ...ACT_KINDS);
}

/* ---------- the account's own Solana wallet ---------- */

const CLUSTER = () => (process.env.CHAIN === 'simulated' ? 'simulated' : process.env.SOLANA_CLUSTER || 'devnet');
const FAUCET_EVERY = 6 * 3600e3;
const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('The Solana network did not answer in time')), ms))]);
const exportAllowed = () => CLUSTER() !== 'mainnet-beta' || process.env.ALLOW_KEY_EXPORT === '1';

/** Address, balance and NFTs of the collector's wallet (their own wallet if they signed in with one). */
export async function walletInfo(address: string) {
  const kind = get<{ kind: string }>('SELECT kind FROM wallets WHERE address = ?', address)?.kind ?? 'wallet';
  let pk = custodialOf(address);
  if (!pk && (kind === 'account' || kind === 'demo')) pk = createWallet(address); // accounts always have one
  const own = pk ?? address;
  const u = userRow(address);
  const cluster = CLUSTER();
  let balance: number | null = null, error: string | null = null;
  if (cluster !== 'simulated') {
    try { const sol = await import('./solana.ts'); balance = await withTimeout(sol.balanceOf(own), 8000); } catch (e: any) { error = String(e?.message ?? e).slice(0, 200); }
  }
  const last = pk ? faucetAt(address) : null;
  const next = last ? Date.parse(last) + FAUCET_EVERY : 0;
  return {
    address: own, custodial: !!pk, cluster, balance_sol: balance, error,
    nfts_on_chain: get<{ n: number }>("SELECT COUNT(*) n FROM specimens WHERE nft_owner = ? AND mint IS NOT NULL AND state IN ('held', 'redeeming')", own)!.n,
    nfts_pending: get<{ n: number }>("SELECT COUNT(*) n FROM specimens WHERE owner = ? AND mint_status = 'pending'", address)!.n,
    linked_wallet: u?.linked_wallet ?? null,
    explorer: `https://explorer.solana.com/address/${own}${cluster === 'mainnet-beta' ? '' : `?cluster=${cluster === 'simulated' ? 'devnet' : cluster}`}`,
    faucet: pk && cluster !== 'mainnet-beta' && cluster !== 'simulated' ? { next_at: next > Date.now() ? new Date(next).toISOString() : null } : null,
    export: pk && exportAllowed() ? { needs_password: !!u?.password_hash, needs_fresh_sign_in: !u?.password_hash && kind !== 'demo' } : null,
  };
}

/**
 * Devnet test SOL for the collector's wallet: the public faucet first, then a little from the vault
 * authority if the faucet refuses. Once every 6 hours per account.
 */
export async function walletFaucet(address: string) {
  const pk = custodialOf(address) ?? fail(404, 'This account has no Space Rocks wallet');
  const cluster = CLUSTER();
  if (cluster === 'simulated') fail(409, 'The chain is simulated on this server: there is no test SOL to send.');
  if (cluster === 'mainnet-beta') fail(403, 'Test SOL is only for devnet.');
  const last = faucetAt(address);
  if (last && Date.parse(last) + FAUCET_EVERY > Date.now()) fail(429, `You can ask for test SOL again at ${new Date(Date.parse(last) + FAUCET_EVERY).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} UTC.`);
  const sol = await import('./solana.ts');
  try {
    await withTimeout(sol.airdropTo(pk!, 1), 25000);
    markFaucet(address);
    return { source: 'faucet', amount_sol: 1, signature: null, balance_sol: await sol.balanceOf(pk!).catch(() => null) };
  } catch { /* the public faucet is often rate-limited: fall back to the vault */ }
  const spare = await withTimeout(sol.balanceSol(), 8000).catch(() => 0);
  if (spare < 0.3) fail(503, `The devnet faucet is busy and the vault has no spare SOL. Paste your address ${pk} at https://faucet.solana.com to get test SOL.`);
  const signature = await withTimeout(sol.sendSol(pk!, 0.05), 40000);
  markFaucet(address);
  return { source: 'vault', amount_sol: 0.05, signature, balance_sol: await sol.balanceOf(pk!).catch(() => null) };
}

/** The wallet's private key, for importing it into Phantom or Solflare. Needs the password (or a fresh sign-in). */
export function walletExport(req: IncomingMessage, address: string, b: any) {
  if (!exportAllowed()) fail(403, 'Key export is turned off on mainnet.');
  const pk = custodialOf(address) ?? fail(404, 'This account has no Space Rocks wallet: you signed in with your own.');
  const t = throttle(req);
  const u = userRow(address);
  const kind = get<{ kind: string }>('SELECT kind FROM wallets WHERE address = ?', address)?.kind;
  if (u?.password_hash) {
    if (!checkPassword(typeof b?.password === 'string' ? b.password : '', u.password_hash)) { t.bad(); fail(401, 'Wrong password'); }
  } else if (kind !== 'demo' && sessionAge(req) > 15 * 60e3) {
    fail(403, 'For your safety, sign out and sign in again, then export within 15 minutes.');
  }
  t.ok();
  const secret = secretOf(address);
  markExported(address);
  return { address: pk, secret_base58: b58encode(secret), secret_json: JSON.stringify([...secret]) };
}
