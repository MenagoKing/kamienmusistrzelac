// Real NFTs on Solana with Metaplex Core (devnet by default).
// Every specimen NFT carries the specimen file as on-chain Attributes, a 3% Royalties plugin, and the
// vault as PermanentTransferDelegate + PermanentBurnDelegate: the vault can move the NFT on a sale and
// burn it on buyback or redemption without asking the holder to sign (the rock never leaves the vault
// otherwise). The authority keypair lives in data/solana-authority.json (git-ignored) or SOLANA_AUTHORITY.
//
// SOLANA_CLUSTER = devnet (default) | mainnet-beta | testnet,  SOLANA_RPC overrides the endpoint.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, keypairIdentity, publicKey, sol, type Umi } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { burn, create, fetchAsset, mplCore, ruleSet, transfer } from '@metaplex-foundation/mpl-core';
import { DATA_DIR } from './db.ts';

export const CLUSTER = (process.env.SOLANA_CLUSTER || 'devnet') as 'devnet' | 'mainnet-beta' | 'testnet';
export const RPC = process.env.SOLANA_RPC || `https://api.${CLUSTER}.solana.com`;

const g = globalThis as unknown as { __srumi?: Umi };

function authoritySecret(): Uint8Array {
  if (process.env.SOLANA_AUTHORITY) return Uint8Array.from(JSON.parse(process.env.SOLANA_AUTHORITY));
  const file = path.join(DATA_DIR, 'solana-authority.json');
  if (!fs.existsSync(file)) {
    const { privateKey, publicKey: pub } = crypto.generateKeyPairSync('ed25519');
    const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
    const pk = pub.export({ format: 'der', type: 'spki' }).subarray(-32);
    fs.writeFileSync(file, JSON.stringify([...seed, ...pk]), { mode: 0o600 });
  }
  return Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')));
}

export function umi(): Umi {
  if (g.__srumi) return g.__srumi;
  const u = createUmi(RPC, 'confirmed').use(mplCore());
  const kp = u.eddsa.createKeypairFromSecretKey(authoritySecret());
  u.use(keypairIdentity(kp));
  return (g.__srumi = u);
}

export const authority = () => umi().identity.publicKey.toString();
const sig = (s: Uint8Array) => base58.deserialize(s)[0];

export async function balanceSol() {
  const b = await umi().rpc.getBalance(umi().identity.publicKey);
  return Number(b.basisPoints) / 1e9;
}

/** Devnet only: asks the faucet for SOL. The public faucet rate-limits; fund the authority by hand if it refuses. */
export async function airdrop(amountSol = 1) {
  if (CLUSTER === 'mainnet-beta') throw new Error('No airdrops on mainnet');
  await umi().rpc.airdrop(umi().identity.publicKey, sol(amountSol));
  return balanceSol();
}

export interface MintInput { name: string; uri: string; owner: string; attributes: { key: string; value: string }[]; royaltyBps: number }

export async function mintAsset(m: MintInput): Promise<{ asset: string; signature: string }> {
  const u = umi();
  const asset = generateSigner(u);
  const me = u.identity.publicKey;
  const r = await create(u, {
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
  }).sendAndConfirm(u);
  return { asset: asset.publicKey.toString(), signature: sig(r.signature) };
}

export async function transferAsset(assetAddr: string, newOwner: string): Promise<string> {
  const u = umi();
  const asset = await fetchAsset(u, publicKey(assetAddr));
  const r = await transfer(u, { asset, newOwner: publicKey(newOwner) }).sendAndConfirm(u);
  return sig(r.signature);
}

export async function burnAsset(assetAddr: string): Promise<string> {
  const u = umi();
  const asset = await fetchAsset(u, publicKey(assetAddr));
  const r = await burn(u, { asset }).sendAndConfirm(u);
  return sig(r.signature);
}

export async function readAsset(assetAddr: string) {
  const a = await fetchAsset(umi(), publicKey(assetAddr));
  return { owner: a.owner.toString(), name: a.name, uri: a.uri, attributes: a.attributes?.attributeList ?? [] };
}

export const explorer = (kind: 'address' | 'tx', id: string) => `https://explorer.solana.com/${kind}/${id}${CLUSTER === 'mainnet-beta' ? '' : `?cluster=${CLUSTER}`}`;
