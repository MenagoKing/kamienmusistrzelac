// Every account has its own Solana wallet, created when the account is created (password, Google or
// demo sign-up). New accounts use the wallet's address as their account address; accounts made before
// this existed get a wallet linked to their old address. NFTs are minted straight to it.
//
// The private key is kept by the server, encrypted with AES-256-GCM. The encryption key is
// CUSTODY_KEY (32 bytes, base64 or hex) or data/custody-key.bin, generated on first start. Back up the
// data directory: without that key the wallets cannot be used. The holder can export their key
// (password or a fresh sign-in required; refused on mainnet unless ALLOW_KEY_EXPORT=1).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, all, get, now, run } from './db.ts';
import { b58encode, fail } from './util.ts';

interface CustodyRow { owner: string; pubkey: string; secret_enc: string; created_at: string; faucet_at: string | null; exported_at: string | null }

const g = globalThis as unknown as { __srcustodykey?: Buffer };

function masterKey(): Buffer {
  if (g.__srcustodykey) return g.__srcustodykey;
  const env = process.env.CUSTODY_KEY?.trim();
  let key: Buffer;
  if (env) {
    key = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, 'hex') : Buffer.from(env, 'base64');
    if (key.length !== 32) throw new Error('CUSTODY_KEY must be 32 bytes (64 hex characters or base64)');
  } else {
    const file = path.join(DATA_DIR, 'custody-key.bin');
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600 });
    key = fs.readFileSync(file);
  }
  return (g.__srcustodykey = key);
}

/** A fresh ed25519 keypair in Solana's format: the 64-byte secret is seed + public key. */
export function newKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const pk = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { pubkey: b58encode(pk), secret: Buffer.concat([seed, pk]) };
}

function seal(secret: Buffer, pubkey: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  c.setAAD(Buffer.from(pubkey));
  const body = Buffer.concat([c.update(secret), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

function unseal(enc: string, pubkey: string) {
  const b = Buffer.from(enc, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), b.subarray(0, 12));
  d.setAAD(Buffer.from(pubkey));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

const row = (owner: string) => get<CustodyRow>('SELECT * FROM custody WHERE owner = ?', owner);

/** Creates a wallet. For a new account pass no owner: the wallet's address becomes the account address. */
export function createWallet(owner?: string): string {
  const kp = newKeypair();
  run('INSERT INTO custody (owner, pubkey, secret_enc, created_at) VALUES (?, ?, ?, ?)', owner ?? kp.pubkey, kp.pubkey, seal(kp.secret, kp.pubkey), now());
  return kp.pubkey;
}

/** The account's own Solana wallet address, or null for wallets that signed in with their own key. */
export const custodialOf = (owner: string) => row(owner)?.pubkey ?? null;

export function ensureWallet(owner: string) {
  return custodialOf(owner) ?? createWallet(owner);
}

/** The 64-byte secret key (for signing on the holder's behalf, and for export). */
export function secretOf(owner: string) {
  const r = row(owner) ?? fail(404, 'This account has no Space Rocks wallet');
  const s = unseal(r.secret_enc, r.pubkey);
  if (b58encode(s.subarray(32)) !== r.pubkey) fail(500, 'Wallet key check failed');
  return s;
}

export function markExported(owner: string) { run('UPDATE custody SET exported_at = ? WHERE owner = ?', now(), owner); }
export function faucetAt(owner: string) { return row(owner)?.faucet_at ?? null; }
export function markFaucet(owner: string) { run('UPDATE custody SET faucet_at = ? WHERE owner = ?', now(), owner); }

/**
 * Accounts made before wallets existed (and demo sessions) get one now. Their NFTs follow: queued
 * mints are re-addressed, NFTs already minted to the old address are moved (the vault is the
 * permanent transfer delegate, so it needs no signature).
 */
export function backfillWallets(queueTransfer: (specimenId: string, to: string) => void) {
  const owners = all<{ address: string }>(`SELECT w.address FROM wallets w LEFT JOIN custody c ON c.owner = w.address
    WHERE w.kind IN ('account', 'demo') AND c.owner IS NULL`);
  for (const { address } of owners) {
    const pk = createWallet(address);
    const linked = get<{ linked_wallet: string | null }>('SELECT linked_wallet FROM users WHERE address = ?', address)?.linked_wallet;
    if (linked) continue; // their NFTs go to the wallet they linked
    run("UPDATE nft_jobs SET owner = ?, updated_at = ? WHERE owner = ? AND status IN ('pending', 'failed') AND action IN ('mint', 'transfer')", pk, now(), address);
    for (const s of all<{ id: string }>("SELECT id FROM specimens WHERE owner = ? AND nft_owner = ? AND mint IS NOT NULL", address, address)) queueTransfer(s.id, pk);
  }
  return owners.length;
}
