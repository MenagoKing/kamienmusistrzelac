// Whoever holds the NFT holds the specimen.
//
// A specimen belongs to the account whose wallet holds its NFT: the account's own Space Rocks wallet,
// a wallet the account linked (proven with a signature), or the wallet it signed in with. When the NFT
// sits in a wallet no account controls, the specimen is "outside" (state external): nobody can sell,
// cancel or redeem it on the site until the holder links that wallet, and its reservation and escrow
// follow the NFT's address. The chain watcher (nft.ts) calls nftMovedTo() whenever an NFT moves
// on-chain (a sale on another marketplace, a transfer from Phantom), so the site follows the chain.
// The vault never takes an NFT back from a holder; it only moves or burns it on their own request.
import { all, get, now, run, tx } from './db.ts';
import { audit, ledger } from './ops.ts';
import { moveReservation } from './sources.ts';
import { specimenRow } from './store.ts';

/** The account an address belongs to, if any. */
export function accountOfAddress(addr: string): string | null {
  return get<{ owner: string }>("SELECT owner FROM custody WHERE pubkey = ? AND owner NOT LIKE 'sys:%'", addr)?.owner
    ?? get<{ address: string }>('SELECT address FROM users WHERE linked_wallet = ?', addr)?.address
    ?? (get("SELECT 1 FROM wallets WHERE address = ? AND kind IN ('wallet', 'phantom', 'solflare', 'backpack')", addr) ? addr : null);
}

/** The specimen's NFT is now at addr (seen on-chain or sent there). Ownership follows it. */
export function nftMovedTo(specimenId: string, addr: string, reason: string) {
  return tx(() => {
    const s = specimenRow(specimenId);
    if (!s || !['held', 'external'].includes(s.state)) return null;
    const acct = accountOfAddress(addr);
    const before = s.owner;
    if (acct && s.state === 'held' && s.owner === acct) {
      run('UPDATE specimens SET nft_owner = ?, updated_at = ? WHERE id = ?', addr, now(), s.id);
      return { owner: acct, changed: false };
    }
    run("UPDATE listings SET status = 'cancelled', closed_at = ? WHERE specimen_id = ? AND status = 'active'", now(), s.id);
    if (acct) {
      run("UPDATE specimens SET state = 'held', owner = ?, nft_owner = ?, acquired_via = 'secondary', acquired_at = ?, paid_usd = NULL, updated_at = ? WHERE id = ?", acct, addr, now(), now(), s.id);
      moveReservation(s.id, acct);
      ledger('nft_received', { wallet: acct, specimen_id: s.id, usd: 0, currency: 'USDC', amount: 0, split: { from: before ?? s.nft_owner, reason } });
    } else {
      run("UPDATE specimens SET state = 'external', owner = NULL, nft_owner = ?, updated_at = ? WHERE id = ?", addr, now(), s.id);
      moveReservation(s.id, addr);
    }
    if (before && before !== acct) ledger('nft_left', { wallet: before, specimen_id: s.id, usd: 0, currency: 'USDC', amount: 0, split: { to: addr, reason } });
    audit('chain', 'specimen.holder', s.id, { to: addr, account: acct, reason });
    return { owner: acct, changed: true };
  });
}

/** After an account links (or signs in with) a wallet: specimens whose NFT sits there become its. */
export function claimByWallet(addr: string) {
  const rows = all<{ id: string }>("SELECT id FROM specimens WHERE nft_owner = ? AND state IN ('external', 'held')", addr);
  let n = 0;
  for (const r of rows) if (nftMovedTo(r.id, addr, 'wallet linked')?.changed) n++;
  return n;
}

/** Before an account unlinks a wallet: specimens whose NFT sits in it leave the account. */
export function releaseByWallet(account: string, addr: string) {
  return tx(() => {
    const rows = all<{ id: string }>("SELECT id FROM specimens WHERE owner = ? AND nft_owner = ? AND state = 'held'", account, addr);
    for (const r of rows) {
      run("UPDATE listings SET status = 'cancelled', closed_at = ? WHERE specimen_id = ? AND status = 'active'", now(), r.id);
      run("UPDATE specimens SET state = 'external', owner = NULL, updated_at = ? WHERE id = ?", now(), r.id);
      moveReservation(r.id, addr);
      ledger('nft_left', { wallet: account, specimen_id: r.id, usd: 0, currency: 'USDC', amount: 0, split: { to: addr, reason: 'wallet unlinked' } });
    }
    return rows.length;
  });
}
