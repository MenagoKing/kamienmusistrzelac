// Chain adapter. Every on-chain effect goes through this interface:
//   charge  - collect a payment in SOL or USDC from the buyer
//   payout  - pay USDC to a seller (instant buyback)
//   mint    - mint a Metaplex Core NFT for a specimen to an owner
//   burn    - burn the NFT (buyback, redemption)
//
// SimulatedChain is the default: no keys, no network, deterministic-looking signatures, so the
// whole product works end to end. To go live, implement SolanaChain with the same methods
// (Solana Pay / USDC transfer verification, Umi + mpl-core for mint/burn, a treasury multisig for
// payouts) and select it with CHAIN=solana. Never commit keys: read them from the environment.
import type { Currency } from '../shared/types.ts';
import { cents, randomB58 } from './util.ts';

export interface ChargeResult { tx: string; currency: Currency; amount: number; usd: number; simulated: boolean }

export interface Chain {
  readonly mode: 'simulated' | 'solana';
  charge(p: { from: string; usd: number; currency: Currency; solUsd: number; memo: string }): ChargeResult;
  payout(p: { to: string; usd: number; memo: string }): ChargeResult;
  mint(p: { owner: string; specimenId: string; name: string }): { mint: string; tx: string };
  burn(p: { mint: string; owner: string }): { tx: string };
}

class SimulatedChain implements Chain {
  readonly mode = 'simulated' as const;
  charge(p: { from: string; usd: number; currency: Currency; solUsd: number }): ChargeResult {
    const amount = p.currency === 'SOL' ? Math.round((p.usd / p.solUsd) * 1e6) / 1e6 : cents(p.usd);
    return { tx: randomB58(64), currency: p.currency, amount, usd: cents(p.usd), simulated: true };
  }
  payout(p: { usd: number }): ChargeResult {
    return { tx: randomB58(64), currency: 'USDC', amount: cents(p.usd), usd: cents(p.usd), simulated: true };
  }
  mint() {
    return { mint: randomB58(32), tx: randomB58(64) };
  }
  burn() {
    return { tx: randomB58(64) };
  }
}

export const chain: Chain = new SimulatedChain();
