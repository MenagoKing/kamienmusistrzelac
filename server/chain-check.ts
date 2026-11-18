// npm run chain:check — proves the NFT path end to end on the configured cluster (devnet by default):
// funds the authority if needed, mints a test Core asset with the specimen plugins, transfers it with
// the permanent transfer delegate, reads it back, then burns it with the permanent burn delegate.
import crypto from 'node:crypto';
import { airdrop, authority, balanceSol, burnAsset, cluster, explorer, mintAsset, readAsset, transferAsset } from './solana.ts';
import { b58encode } from './util.ts';

console.log(`cluster ${cluster()} · authority ${authority()}`);
let bal = await balanceSol();
console.log('balance', bal, 'SOL');
if (bal < 0.05) {
  console.log('requesting a devnet airdrop…');
  try { bal = await airdrop(1); console.log('balance', bal, 'SOL'); } catch (e: any) { console.log('airdrop failed:', e.message?.slice(0, 200)); process.exit(1); }
}
const ownerA = b58encode(crypto.randomBytes(32)), ownerB = b58encode(crypto.randomBytes(32));
const m = await mintAsset({ name: 'Chain check SR-00000', uri: 'https://example.com/sr-00000.json', owner: ownerA, royaltyBps: 300, attributes: [{ key: 'Specimen', value: 'SR-00000' }, { key: 'Class', value: 'Test' }] });
console.log('minted', explorer('address', m.asset));
const t = await transferAsset(m.asset, ownerB);
console.log('transferred', explorer('tx', t));
const a = await readAsset(m.asset);
if (a.owner !== ownerB) throw new Error('owner did not change');
console.log('owner is now', a.owner, '· attributes', a.attributes.map(x => `${x.key}=${x.value}`).join(', '));
const b = await burnAsset(m.asset);
console.log('burned', explorer('tx', b));
console.log('CHAIN OK · balance', await balanceSol(), 'SOL');
process.exit(0);
