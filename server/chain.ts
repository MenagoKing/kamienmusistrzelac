// Money on Solana. Every payment and payout goes through here.
//
//   charge  - a collector pays (USDC, SOL or the project token) from their Space Rocks wallet
//   payout  - USDC (or a refund in what was paid) from the treasury or escrow wallet to a collector
//
// Two modes:
//   simulated - nothing moves; fake signatures (tests with CHAIN=simulated, and devnet when Admin ›
//               Network leaves "real devnet payments" off)
//   live      - real transfers on the active network. Always on mainnet. The vault pays the fees.
//
// A purchase is paid before anything is written (withPayment): the first pass of the purchase stops
// at chain.charge() and says what to charge; the money moves on-chain; the purchase then runs again
// with that payment. If it fails at that point (sold in the meantime, price changed) the payment is
// refunded through the payout queue. Payouts are queued in the database with the rest of the purchase
// and sent by a worker that retries until the wallet they come from can pay.
//
// Wallets (server/custody.ts): each collector's account wallet; sys:treasury receives sales and pays
// payouts; sys:escrow holds the rock price of every market reservation until it is released after
// the holder burns the NFT (Addendum 1). Payments in SOL or the token go to the treasury, which then
// funds the escrow in USDC.
import type { Currency } from '../shared/types.ts';
import type * as SolanaModule from './solana.ts';
import { activeNetwork, all, ctlGet, get, now, pinNetwork, run } from './db.ts';
import { getRules } from './store.ts';
import { custodialOf, ensureWallet, secretOf } from './custody.ts';
import { HttpError, cents, fail, randomB58 } from './util.ts';

export interface ChargeResult { tx: string; currency: Currency; amount: number; usd: number; simulated: boolean; pending?: boolean }
export type Party = 'treasury' | 'escrow';
export const SYS = { treasury: 'sys:treasury', escrow: 'sys:escrow' } as const;

interface ChargeReq { from: string; usd: number; currency: Currency; solUsd: number; memo: string; tokenAmount?: number; escrowUsd?: number }
interface Paid { req: ChargeReq; res: ChargeResult; units: bigint; escrowUnits: bigint }

const SIMULATED_CHAIN = process.env.CHAIN === 'simulated';
const g = globalThis as unknown as { __srpaid?: Paid | null; __srpayworker?: NodeJS.Timeout; __srpaybusy?: boolean; __srpaynote?: string; __srtestlive?: typeof SolanaModule };

/** The Solana module (tests swap in an in-memory stand-in through __srtestlive). */
const solana = async (): Promise<typeof SolanaModule> => g.__srtestlive ?? (await import('./solana.ts'));

/** Real money moves on this network right now? */
export function paymentsLive() {
  if (g.__srtestlive) return true;
  if (SIMULATED_CHAIN) return false;
  return activeNetwork() === 'mainnet-beta' || ctlGet('payments:devnet') === 'live';
}

// store.ts reads this for the page data (no import cycle)
(globalThis as unknown as { __srpaylive?: () => boolean }).__srpaylive = () => paymentsLive();

class NeedsPayment extends Error {
  req: ChargeReq;
  constructor(req: ChargeReq) { super('A payment is needed first'); this.req = req; }
}

const solAmount = (usd: number, solUsd: number) => Math.round((usd / solUsd) * 1e9) / 1e9;
function amountOf(req: ChargeReq) {
  return req.currency === 'SOL' ? solAmount(req.usd, req.solUsd) : req.currency === 'TOKEN' ? req.tokenAmount ?? 0 : cents(req.usd);
}

function mintOf(currency: Currency): { mint: string; decimals: number } | null {
  if (currency === 'USDC') return { mint: '', decimals: 6 }; // filled in with the network's USDC mint
  if (currency === 'TOKEN') { const r = getRules(); return r.token_mint ? { mint: r.token_mint, decimals: r.token_decimals } : null; }
  return null;
}

export const chain = {
  get mode() { return paymentsLive() ? 'solana' as const : 'simulated' as const; },

  /** Called inside a purchase. Live: returns the payment made by withPayment(), or asks for one. */
  charge(req: ChargeReq): ChargeResult {
    if (!paymentsLive()) return { tx: randomB58(64), currency: req.currency, amount: amountOf(req), usd: cents(req.usd), simulated: true };
    const paid = g.__srpaid;
    if (!paid) throw new NeedsPayment(req);
    g.__srpaid = null;
    const p = paid.req;
    if (p.from !== req.from || p.currency !== req.currency || Math.abs(p.usd - req.usd) > 0.004 || Math.abs((p.escrowUsd ?? 0) - (req.escrowUsd ?? 0)) > 0.004)
      throw new HttpError(409, 'The price changed while you were paying. Your payment is being refunded.', { code: 'changed' });
    // SOL / token payments land in the treasury: it funds the escrow in USDC (queued with the purchase).
    if (req.currency !== 'USDC' && (req.escrowUsd ?? 0) > 0) queuePayout({ to: SYS.escrow, from: 'treasury', currency: 'USDC', usd: req.escrowUsd!, memo: `fund escrow · ${req.memo}` });
    return paid.res;
  },

  /** A payout (USDC). Live: queued with the rest of the purchase, sent by the worker. */
  payout(p: { to: string; usd: number; memo: string; from?: Party }): ChargeResult {
    if (!paymentsLive()) return { tx: randomB58(64), currency: 'USDC', amount: cents(p.usd), usd: cents(p.usd), simulated: true };
    if (cents(p.usd) > 0) queuePayout({ to: p.to, from: p.from ?? 'treasury', currency: 'USDC', usd: p.usd, memo: p.memo });
    return { tx: '', currency: 'USDC', amount: cents(p.usd), usd: cents(p.usd), simulated: false, pending: true };
  },
};

/**
 * Runs a purchase that charges the collector. Live: the money moves on-chain first, then the purchase
 * is written; if it can no longer complete, the payment is refunded.
 */
export async function withPayment<T>(fn: () => T): Promise<T> {
  if (!paymentsLive()) return fn();
  let req: ChargeReq;
  try { return fn(); } catch (e) { if (!(e instanceof NeedsPayment)) throw e; req = e.req; }
  const paid = await chargeOnChain(req);
  g.__srpaid = paid;
  try {
    return fn();
  } catch (e: any) {
    refundPaid(paid, 'refund · purchase did not complete');
    if (e instanceof HttpError) { if (!/refund/i.test(e.message)) e.message += ' Your payment is being refunded.'; throw e; }
    throw new HttpError(500, 'Something went wrong after your payment. It is being refunded.');
  } finally {
    g.__srpaid = null;
  }
}

async function chargeOnChain(req: ChargeReq): Promise<Paid> {
  const sol = await solana();
  const n = activeNetwork();
  const payer = custodialOf(req.from) ?? fail(403, 'Payments come from your Space Rocks wallet. Sign in with a Space Rocks account to pay.');
  const treasury = ensureWallet(SYS.treasury), escrow = ensureWallet(SYS.escrow);
  if ((await sol.balanceSol().catch(() => 0)) < 0.003) fail(503, 'Payments are paused for a moment (the network fee wallet is being topped up). Nothing was charged. Try again soon.');
  const amount = amountOf(req);
  const top = `Top up your Space Rocks wallet (${payer.slice(0, 4)}…${payer.slice(-4)}) in Account › Wallet.`;
  let signature: string, units: bigint, escrowUnits = 0n;
  if (req.currency === 'SOL') {
    units = BigInt(Math.round(amount * 1e9));
    const have = await sol.balanceOf(payer);
    if (have * 1e9 < Number(units)) throw new HttpError(402, `Not enough SOL in your wallet: you have ${have.toFixed(4)} SOL, this costs ${amount.toFixed(4)} SOL. ${top}`, { code: 'funds', currency: 'SOL', have, need: amount, address: payer });
    signature = await sol.paySol({ secret: secretOf(req.from), transfers: [{ to: treasury, lamports: units }] });
  } else {
    const m = mintOf(req.currency) ?? fail(409, 'Paying with the token is not available right now');
    const mint = req.currency === 'USDC' ? sol.USDC_MINT[n] : m.mint;
    units = BigInt(Math.round(amount * 10 ** m.decimals));
    const have = await sol.tokenBalance(payer, mint);
    const label = req.currency === 'USDC' ? 'USDC' : getRules().token_symbol;
    if (have * 10 ** m.decimals < Number(units)) throw new HttpError(402, `Not enough ${label} in your wallet: you have ${have.toLocaleString('en-US')} ${label}, this costs ${amount.toLocaleString('en-US')} ${label}. ${top}`, { code: 'funds', currency: req.currency, have, need: amount, address: payer });
    if (req.currency === 'USDC') escrowUnits = BigInt(Math.round(Math.min(req.escrowUsd ?? 0, req.usd) * 1e6));
    const transfers = req.currency === 'USDC' && escrowUnits > 0n
      ? [{ to: escrow, units: escrowUnits }, { to: treasury, units: units - escrowUnits }]
      : [{ to: treasury, units }];
    signature = await sol.payTokens({ secret: secretOf(req.from), mint, transfers });
  }
  return { req, units, escrowUnits, res: { tx: signature, currency: req.currency, amount, usd: cents(req.usd), simulated: false } };
}

/** Sends a payment back exactly as it came in (used when a paid purchase cannot complete). */
function refundPaid(p: Paid, memo: string) {
  const r = p.req;
  if (p.escrowUnits > 0n) queuePayout({ to: r.from, from: 'escrow', currency: r.currency, usd: Number(p.escrowUnits) / 1e6, units: p.escrowUnits, memo });
  const rest = p.units - p.escrowUnits;
  if (rest > 0n) queuePayout({ to: r.from, from: 'treasury', currency: r.currency, usd: cents(r.usd - Number(p.escrowUnits) / 1e6), units: rest, memo });
  kickPayouts();
}

/* ---------- payout queue ---------- */

interface PayoutRow { id: number; to_owner: string; from_party: Party; currency: Currency; usd: number; units: string; memo: string; status: string; attempts: number; signature: string | null; error: string | null; created_at: string; updated_at: string }

export function queuePayout(p: { to: string; from: Party; currency: Currency; usd: number; units?: bigint; memo: string }) {
  const units = p.units ?? (p.currency === 'USDC' ? BigInt(Math.round(p.usd * 1e6)) : 0n);
  if (units <= 0n) return;
  run("INSERT INTO payouts (to_owner, from_party, currency, usd, units, memo, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
    p.to, p.from, p.currency, cents(p.usd), units.toString(), p.memo, now(), now());
  kickPayouts();
}

/** Where a payout goes: system wallets, a collector's account wallet, or a plain address (wallet sign-in, admin withdrawals). */
function destinationOf(owner: string) {
  if (owner === SYS.treasury || owner === SYS.escrow) return ensureWallet(owner);
  return custodialOf(owner) ?? owner;
}

async function sendPayout(p: PayoutRow) {
  const sol = await solana();
  const n = activeNetwork();
  const fromOwner = p.from_party === 'escrow' ? SYS.escrow : SYS.treasury;
  const fromAddr = ensureWallet(fromOwner);
  const to = destinationOf(p.to_owner);
  const units = BigInt(p.units);
  if ((await sol.balanceSol()) < 0.003) throw Object.assign(new Error('The vault has too little SOL to pay network fees.'), { wait: true });
  if (p.currency === 'SOL') {
    const have = await sol.balanceOf(fromAddr);
    if (have * 1e9 < Number(units)) throw Object.assign(new Error(`The ${p.from_party} wallet has ${have.toFixed(4)} SOL, needs ${(Number(units) / 1e9).toFixed(4)}.`), { wait: true });
    return sol.paySol({ secret: secretOf(fromOwner), transfers: [{ to, lamports: units }] });
  }
  const m = mintOf(p.currency) ?? fail(409, 'Token payouts are not set up');
  const mint = p.currency === 'USDC' ? sol.USDC_MINT[n] : m.mint;
  const have = await sol.tokenBalance(fromAddr, mint);
  if (have * 10 ** m.decimals < Number(units)) throw Object.assign(new Error(`The ${p.from_party} wallet has ${have} ${p.currency}, needs ${Number(units) / 10 ** m.decimals}.`), { wait: true });
  return sol.payTokens({ secret: secretOf(fromOwner), mint, transfers: [{ to, units }] });
}

/** One payout run, pinned to the network that is active when it starts. */
const payoutTick = () => pinNetwork(payoutTickOn);

async function payoutTickOn() {
  if (g.__srpaybusy || !paymentsLive()) return;
  g.__srpaybusy = true;
  try {
    for (let i = 0; i < 20; i++) {
      const p = get<PayoutRow>("SELECT * FROM payouts WHERE status = 'pending' ORDER BY id LIMIT 1");
      if (!p) break;
      run("UPDATE payouts SET status = 'sending', updated_at = ? WHERE id = ?", now(), p.id);
      try {
        const signature = await sendPayout(p);
        run("UPDATE payouts SET status = 'done', signature = ?, error = NULL, updated_at = ? WHERE id = ?", signature, now(), p.id);
        g.__srpaynote = '';
      } catch (e: any) {
        const msg = String(e?.message ?? e).slice(0, 300);
        g.__srpaynote = msg;
        if (e?.wait) { run("UPDATE payouts SET status = 'pending', error = ?, updated_at = ? WHERE id = ?", msg, now(), p.id); break; }
        const attempts = p.attempts + 1;
        run('UPDATE payouts SET status = ?, attempts = ?, error = ?, updated_at = ? WHERE id = ?', attempts >= 5 ? 'failed' : 'pending', attempts, msg, now(), p.id);
        break;
      }
    }
  } finally {
    g.__srpaybusy = false;
  }
}

let kicked: NodeJS.Timeout | null = null;
export function kickPayouts() {
  if (kicked || !paymentsLive()) return;
  kicked = setTimeout(() => { kicked = null; payoutTick(); }, 100);
}

export function startPayoutWorker() {
  run("UPDATE payouts SET status = 'pending' WHERE status = 'sending'");
  if (g.__srpayworker) clearInterval(g.__srpayworker);
  g.__srpayworker = setInterval(payoutTick, 15000);
  kickPayouts();
}

/* ---------- admin ---------- */

export function payoutsList(status: string | null) {
  return {
    rows: all<PayoutRow>(`SELECT * FROM payouts ${status ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT 200`, ...(status ? [status] : [])),
    counts: Object.fromEntries(all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM payouts GROUP BY status').map(r => [r.status, r.n])),
    note: g.__srpaynote ?? '',
    live: paymentsLive(),
  };
}

export function retryPayout(id: number) {
  run("UPDATE payouts SET status = 'pending', attempts = 0, updated_at = ? WHERE id = ? AND status IN ('failed', 'pending')", now(), id);
  kickPayouts();
  return { ok: true };
}

/** Admin: moves revenue out of the treasury to an address (cold wallet, multisig). Escrow money can never be withdrawn. */
export function withdrawTreasury(p: { to: string; currency: Currency; amount: number }) {
  if (!paymentsLive()) fail(409, 'Payments are simulated on this network: there is nothing to withdraw.');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.to)) fail(400, 'Enter a Solana address');
  if (p.currency !== 'USDC' && p.currency !== 'SOL') fail(400, 'Withdraw USDC or SOL');
  if (!(p.amount > 0)) fail(400, 'Enter an amount');
  const units = BigInt(Math.round(p.amount * (p.currency === 'SOL' ? 1e9 : 1e6)));
  queuePayout({ to: p.to, from: 'treasury', currency: p.currency, usd: p.currency === 'USDC' ? p.amount : 0, units, memo: 'treasury withdrawal' });
  return { ok: true };
}

/* ---------- the collector sends from their own wallet ---------- */

/**
 * Sends USDC or SOL from a collector's Space Rocks wallet to any Solana address. Real on the active
 * network whatever the payment mode (the wallet and its balance are real). The vault pays the fee.
 */
export async function sendFromAccount(owner: string, to: string, currency: 'USDC' | 'SOL', amountIn: number | 'max') {
  if (SIMULATED_CHAIN && !g.__srtestlive) fail(409, 'The chain is simulated on this server: there is nothing to send.');
  const sol = await solana();
  const from = custodialOf(owner) ?? fail(404, 'This account has no Space Rocks wallet: you signed in with your own.');
  if (to === from) fail(400, 'That is this wallet\u2019s own address');
  if ((await sol.balanceSol().catch(() => 0)) < 0.003) fail(503, 'Sending is paused for a moment (the network fee wallet is being topped up). Nothing was sent.');
  const n = activeNetwork();
  if (currency === 'SOL') {
    const have = await sol.balanceOf(from);
    const amount = amountIn === 'max' ? have : amountIn;
    if (!(amount > 0)) fail(400, 'Enter an amount');
    if (amount > have + 1e-9) fail(400, `You have ${have.toFixed(4)} SOL`);
    const lamports = BigInt(Math.floor(amount * 1e9));
    const signature = await sol.paySol({ secret: secretOf(owner), transfers: [{ to, lamports }] });
    return { signature, currency, amount: Number(lamports) / 1e9, to, from };
  }
  const mint = sol.USDC_MINT[n];
  const have = await sol.tokenBalance(from, mint);
  const amount = amountIn === 'max' ? have : amountIn;
  if (!(amount > 0)) fail(400, 'Enter an amount');
  if (amount > have + 1e-9) fail(400, `You have ${have.toLocaleString('en-US', { maximumFractionDigits: 6 })} USDC`);
  const units = BigInt(Math.floor(amount * 1e6 + 1e-6));
  const signature = await sol.payTokens({ secret: secretOf(owner), mint, transfers: [{ to, units }] });
  return { signature, currency, amount: Number(units) / 1e6, to, from };
}
