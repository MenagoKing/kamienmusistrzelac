// Solana for both networks (devnet for testing, mainnet-beta for real), selected in Admin › Network.
// Every specimen NFT is a Metaplex Core asset carrying the specimen file as on-chain Attributes, a 3%
// Royalties plugin, and the vault as PermanentTransferDelegate + PermanentBurnDelegate (it can move the
// NFT on a sale and burn it on buyback or redemption without the holder's signature).
// The vault (authority) key per network: SOLANA_AUTHORITY / SOLANA_AUTHORITY_MAINNET, else
// solana-authority.json in that network's data folder (generated on first use; git-ignored).
// RPC per network: SOLANA_RPC / SOLANA_RPC_MAINNET, else the URL set in Admin › Network, else the
// public endpoint (rate-limited: use a provider such as Helius for mainnet).
// The vault pays every network fee, including for collectors' payments from their own wallets.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, generateSigner, keypairIdentity, publicKey, sol, transactionBuilder, type Signer, type TransactionBuilder, type Umi } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { burn, create, fetchAsset, mplCore, ruleSet, safeFetchAllAssetV1, transfer } from '@metaplex-foundation/mpl-core';
import { createIdempotentAssociatedToken, findAssociatedTokenPda, mplToolbox, setComputeUnitPrice, transferSol, transferTokens } from '@metaplex-foundation/mpl-toolbox';
import { activeNetwork, ctlGet, netDir, type Network } from './db.ts';

/** USDC on each network (devnet: Circle's test USDC, free at faucet.circle.com). */
export const USDC_MINT: Record<Network, string> = {
  devnet: process.env.USDC_MINT_DEVNET || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  'mainnet-beta': process.env.USDC_MINT_MAINNET || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

export const cluster = () => activeNetwork();

export function rpcUrl(n: Network = activeNetwork()) {
  const env = n === 'mainnet-beta' ? process.env.SOLANA_RPC_MAINNET : process.env.SOLANA_RPC;
  return env || ctlGet('rpc:' + n) || `https://api.${n}.solana.com`;
}

/** Priority fee in micro-lamports per compute unit (mainnet default 20 000: lands quickly, costs a fraction of a cent). */
export const priorityFee = (n: Network = activeNetwork()) => Number(ctlGet('priority:' + n) ?? (n === 'mainnet-beta' ? 20000 : 0)) || 0;

const g = globalThis as unknown as { __srumis?: Map<string, Umi> };

function authoritySecret(n: Network): Uint8Array {
  const env = n === 'mainnet-beta' ? process.env.SOLANA_AUTHORITY_MAINNET : process.env.SOLANA_AUTHORITY;
  if (env) return Uint8Array.from(JSON.parse(env));
  const file = path.join(netDir(n), 'solana-authority.json');
  if (!fs.existsSync(file)) {
    const { privateKey, publicKey: pub } = crypto.generateKeyPairSync('ed25519');
    const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
    const pk = pub.export({ format: 'der', type: 'spki' }).subarray(-32);
    fs.writeFileSync(file, JSON.stringify([...seed, ...pk]), { mode: 0o600 });
  }
  return Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function umi(n: Network = activeNetwork()): Umi {
  const url = rpcUrl(n);
  const key = n + ' ' + url;
  const cache = (g.__srumis ??= new Map());
  const hit = cache.get(key);
  if (hit) return hit;
  const u = createUmi(url, 'confirmed').use(mplCore()).use(mplToolbox());
  u.use(keypairIdentity(u.eddsa.createKeypairFromSecretKey(authoritySecret(n))));
  cache.set(key, u);
  return u;
}

export const authority = (n: Network = activeNetwork()) => umi(n).identity.publicKey.toString();
const sig = (s: Uint8Array) => base58.deserialize(s)[0];

/** Adds the priority fee (mainnet) so transactions land when the network is busy. */
function withFee(u: Umi, b: TransactionBuilder, n: Network) {
  const f = priorityFee(n);
  return f > 0 ? b.prepend(setComputeUnitPrice(u, { microLamports: f })) : b;
}

export async function balanceSol(n: Network = activeNetwork()) {
  const b = await umi(n).rpc.getBalance(umi(n).identity.publicKey);
  return Number(b.basisPoints) / 1e9;
}

/** Devnet only: asks the faucet for SOL. The public faucet is closed; fund the authority by hand. */
export async function airdrop(amountSol = 1) {
  if (activeNetwork() === 'mainnet-beta') throw new Error('No airdrops on mainnet');
  await umi().rpc.airdrop(umi().identity.publicKey, sol(amountSol));
  return balanceSol();
}

/** SOL balance of any address. */
export async function balanceOf(address: string, n: Network = activeNetwork()) {
  const b = await umi(n).rpc.getBalance(publicKey(address));
  return Number(b.basisPoints) / 1e9;
}

/** Token balance (in token units, e.g. USDC) of an owner's associated token account. 0 if it has none. */
export async function tokenBalance(owner: string, mint: string, n: Network = activeNetwork()) {
  const u = umi(n);
  const ata = findAssociatedTokenPda(u, { mint: publicKey(mint), owner: publicKey(owner) })[0];
  const r = await fetch(rpcUrl(n), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTokenAccountBalance', params: [ata.toString(), { commitment: 'confirmed' }] }),
  });
  const j: any = await r.json();
  if (j.error) { if (/could not find account|Invalid param/i.test(j.error.message ?? '')) return 0; throw new Error(j.error.message); }
  return Number(j.result?.value?.uiAmountString ?? 0);
}

/** Devnet: asks the public faucet to send SOL to an address (closed on devnet today). */
export async function airdropTo(address: string, amountSol: number) {
  if (activeNetwork() === 'mainnet-beta') throw new Error('No airdrops on mainnet');
  await umi().rpc.airdrop(publicKey(address), sol(amountSol));
}

const signerFrom = (u: Umi, secret: Uint8Array): Signer => createSignerFromKeypair(u, u.eddsa.createKeypairFromSecretKey(secret));

/** Sends SOL from the vault authority (devnet test SOL for collectors). */
export async function sendSol(to: string, amountSol: number): Promise<string> {
  const n = activeNetwork(), u = umi(n);
  const b = transactionBuilder().add(transferSol(u, { source: u.identity, destination: publicKey(to), amount: sol(amountSol) }));
  return sig((await withFee(u, b, n).sendAndConfirm(u)).signature);
}

/**
 * Moves SOL out of a wallet whose key the server holds (a collector's account wallet, the treasury
 * or the escrow wallet). The vault pays the fee, so the sender needs no extra SOL.
 */
export async function paySol(p: { secret: Uint8Array; transfers: { to: string; lamports: bigint }[] }) {
  const n = activeNetwork(), u = umi(n);
  const from = signerFrom(u, p.secret);
  let b = transactionBuilder();
  for (const t of p.transfers) if (t.lamports > 0n) b = b.add(transferSol(u, { source: from, destination: publicKey(t.to), amount: { basisPoints: t.lamports, identifier: 'SOL', decimals: 9 } }));
  b = b.setFeePayer(u.identity);
  return sig((await withFee(u, b, n).sendAndConfirm(u)).signature);
}

/** Moves SPL tokens (USDC, the project token) the same way; creates the receivers' token accounts if needed (the vault pays). */
export async function payTokens(p: { secret: Uint8Array; mint: string; transfers: { to: string; units: bigint }[] }) {
  const n = activeNetwork(), u = umi(n);
  const from = signerFrom(u, p.secret);
  const mint = publicKey(p.mint);
  const source = findAssociatedTokenPda(u, { mint, owner: from.publicKey })[0];
  let b = transactionBuilder();
  for (const t of p.transfers) {
    if (t.units <= 0n) continue;
    const owner = publicKey(t.to);
    const ata = findAssociatedTokenPda(u, { mint, owner })[0];
    b = b.add(createIdempotentAssociatedToken(u, { ata, mint, owner, payer: u.identity }));
    b = b.add(transferTokens(u, { source, destination: ata, authority: from, amount: t.units }));
  }
  b = b.setFeePayer(u.identity);
  return sig((await withFee(u, b, n).sendAndConfirm(u)).signature);
}

export interface MintInput { name: string; uri: string; owner: string; attributes: { key: string; value: string }[]; royaltyBps: number }

export async function mintAsset(m: MintInput): Promise<{ asset: string; signature: string }> {
  const u = umi();
  const asset = generateSigner(u);
  const me = u.identity.publicKey;
  const r = create(u, {
    asset,
    name: m.name.slice(0, 32),
    uri: m.uri,
    owner: publicKey(m.owner),
    plugins: [
      { type: 'Attributes', attributeList: m.attributes },
      { type: 'Royalties', basisPoints: m.royaltyBps, creators: [{ address: me, percentage: 100 }], ruleSet: ruleSet('None') },
      { type: 'PermanentTransferDelegate', authority: { type: 'Address', address: me } },
      { type: 'PermanentBurnDelegate', authority: { type: 'Address', address: me } },
    ],
  });
  const r2 = await withFee(u, r, activeNetwork()).sendAndConfirm(u);
  return { asset: asset.publicKey.toString(), signature: sig(r2.signature) };
}

export async function transferAsset(assetAddr: string, newOwner: string): Promise<string> {
  const u = umi();
  const asset = await fetchAsset(u, publicKey(assetAddr));
  const r = await withFee(u, transfer(u, { asset, newOwner: publicKey(newOwner) }), activeNetwork()).sendAndConfirm(u);
  return sig(r.signature);
}

export async function burnAsset(assetAddr: string): Promise<string> {
  const u = umi();
  const asset = await fetchAsset(u, publicKey(assetAddr));
  const r = await withFee(u, burn(u, { asset }), activeNetwork()).sendAndConfirm(u);
  return sig(r.signature);
}

/** Current holders of many NFTs at once (missing or burned assets are left out). */
export async function readOwners(mints: string[], n: Network = activeNetwork()): Promise<Record<string, string>> {
  const assets = await safeFetchAllAssetV1(umi(n), mints.map(m => publicKey(m)));
  return Object.fromEntries(assets.map(a => [a.publicKey.toString(), a.owner.toString()]));
}

export async function readAsset(assetAddr: string) {
  const a = await fetchAsset(umi(), publicKey(assetAddr));
  return { owner: a.owner.toString(), name: a.name, uri: a.uri, attributes: a.attributes?.attributeList ?? [] };
}

export const explorer = (kind: 'address' | 'tx', id: string, n: Network = activeNetwork()) => `https://explorer.solana.com/${kind}/${id}${n === 'mainnet-beta' ? '' : `?cluster=${n}`}`;
