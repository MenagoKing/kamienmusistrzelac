// Impact Hunter: the mini-game. Shoot falling meteors, catch their fragments, survive the waves.
//
// Prizes are deliberately very hard to win and decided here, never in the browser:
//   - only collectors holding at least game_min_token_usd worth of the project token may play;
//   - a run must reach game_min_score to qualify, in a plausible time (score rate and waves checked
//     against the server's own clock);
//   - a qualifying run then has a game_win_chance roll for a real specimen from the vault worth at
//     most game_prize_max_usd (cheap stock not sealed in any series), minted to the winner as an NFT;
//   - game_daily_runs runs per collector per day.
import crypto from 'node:crypto';
import { activeNetwork, all, get, now, run, tx } from './db.ts';
import { custodialOf } from './custody.ts';
import { queueMint } from './nft.ts';
import { audit, ledger } from './ops.ts';
import { getRules, specimenRow, toPublic } from './store.ts';
import { tokenPriceUsd } from './token.ts';
import { fail, uid } from './util.ts';

const WAVE_MS = 20_000;
const MAX_POINTS_PER_SECOND = 600; // a flawless player peaks around 400 in late waves
const today = () => new Date().toISOString().slice(0, 10);
const runsToday = (wallet: string) => get<{ n: number }>('SELECT COUNT(*) n FROM game_runs WHERE wallet = ? AND day = ?', wallet, today())!.n;

/** USD value of the project token the collector holds (account wallet + linked wallet). */
async function tokenHoldingUsd(wallet: string): Promise<{ usd: number | null; amount: number | null; reason?: string }> {
  const r = getRules();
  if (!r.token_mint) return { usd: null, amount: null, reason: `$${r.token_symbol} is not live yet` };
  const price = tokenPriceUsd();
  if (price == null) return { usd: null, amount: null, reason: `No $${r.token_symbol} price right now` };
  if (process.env.CHAIN === 'simulated') return { usd: 0, amount: 0 };
  const sol = await import('./solana.ts');
  const addrs = [custodialOf(wallet) ?? wallet, get<{ linked_wallet: string | null }>('SELECT linked_wallet FROM users WHERE address = ?', wallet)?.linked_wallet].filter(Boolean) as string[];
  let amount = 0;
  for (const a of [...new Set(addrs)]) amount += await sol.tokenBalance(a, r.token_mint).catch(() => 0);
  return { usd: Math.round(amount * price * 100) / 100, amount };
}

const prizePool = (max: number) => all<{ id: string }>("SELECT id FROM specimens WHERE state = 'vault' AND sold_back = 0 AND vault_value_usd IS NOT NULL AND vault_value_usd <= ? AND vault_value_usd > 0", max);

export async function gameStatus(wallet: string | null) {
  const r = getRules();
  const base = {
    enabled: r.game_enabled, min_token_usd: r.game_min_token_usd, token_required: r.game_token_required, symbol: r.token_symbol,
    min_score: r.game_min_score, win_chance: r.game_win_chance, daily_runs: r.game_daily_runs, prize_max_usd: r.game_prize_max_usd,
    prizes_left: prizePool(r.game_prize_max_usd).length, network: activeNetwork(),
    best: all<{ name: string; score: number }>(`SELECT coalesce(u.username, substr(g.wallet, 1, 4) || '…') name, MAX(g.score) score FROM game_runs g LEFT JOIN users u ON u.address = g.wallet
      WHERE g.finished_at IS NOT NULL GROUP BY g.wallet ORDER BY score DESC LIMIT 5`),
    winners: all<{ name: string; specimen: string; at: string }>(`SELECT coalesce(u.username, substr(g.wallet, 1, 4) || '…') name, s.name specimen, g.created_at at FROM game_runs g
      LEFT JOIN users u ON u.address = g.wallet LEFT JOIN specimens s ON s.id = g.won_specimen WHERE g.won_specimen IS NOT NULL ORDER BY g.created_at DESC LIMIT 5`),
  };
  if (!wallet) return { ...base, signed_in: false, can_play: false, token_usd: null, runs_left: 0, reason: 'Sign in to play' };
  const left = Math.max(0, r.game_daily_runs - runsToday(wallet));
  const tok = r.game_token_required ? await tokenHoldingUsd(wallet) : { usd: null, amount: null };
  let reason = '';
  if (!r.game_enabled) reason = 'The game is closed for now';
  else if (r.game_token_required && (tok.usd ?? 0) < r.game_min_token_usd) reason = tok.reason ? `Needs $${r.game_min_token_usd} in $${r.token_symbol}: ${tok.reason}` : `Needs $${r.game_min_token_usd} in $${r.token_symbol} in your wallet (you hold $${(tok.usd ?? 0).toFixed(2)})`;
  else if (!left) reason = 'No runs left today. Come back tomorrow.';
  return { ...base, signed_in: true, can_play: !reason, token_usd: tok.usd, token_amount: tok.amount, runs_left: left, reason };
}

export async function startRun(wallet: string) {
  const st = await gameStatus(wallet);
  if (!st.can_play) fail(403, st.reason || 'You cannot play right now');
  const id = uid('gr');
  const seed = crypto.randomBytes(8).toString('hex');
  run('INSERT INTO game_runs (id, wallet, day, seed, started_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, wallet, today(), seed, Date.now(), now());
  return { run_id: id, seed, runs_left: st.runs_left - 1 };
}

export function finishRun(wallet: string, b: any) {
  const rules = getRules();
  return tx(() => {
    const g = get<{ id: string; wallet: string; started_ms: number; finished_at: string | null }>('SELECT * FROM game_runs WHERE id = ?', String(b?.run_id ?? '')) ?? fail(404, 'Run not found');
    if (g.wallet !== wallet) fail(403, 'Not your run');
    if (g.finished_at) fail(409, 'This run is already over');
    const elapsed = Date.now() - g.started_ms;
    const claimed = Math.max(0, Math.round(Number(b?.duration_ms) || 0));
    const score = Math.max(0, Math.floor(Number(b?.score) || 0));
    const waves = Math.max(1, Math.floor(Number(b?.waves) || 1));
    // plausibility: the run cannot be longer than the server saw, nor score faster than humanly possible
    const flags: string[] = [];
    if (claimed > elapsed + 3000) flags.push('duration');
    const secs = Math.min(claimed, elapsed) / 1000;
    if (score > secs * MAX_POINTS_PER_SECOND + 500) flags.push('score-rate');
    if (waves > Math.floor(secs * 1000 / WAVE_MS) + 2) flags.push('waves');
    const valid = !flags.length;
    const qualified = valid && score >= rules.game_min_score;
    let won: string | null = null;
    if (qualified && Math.random() < rules.game_win_chance) {
      const pool = prizePool(rules.game_prize_max_usd);
      if (pool.length) {
        won = pool[Math.floor(Math.random() * pool.length)].id;
        run("UPDATE specimens SET state = 'held', owner = ?, acquired_via = 'game', acquired_at = ?, paid_usd = 0, sold_back = 0, updated_at = ? WHERE id = ?", wallet, now(), now(), won);
        queueMint(won, wallet);
        ledger('game_prize', { wallet, specimen_id: won, usd: 0, currency: 'USDC', amount: 0, split: { score, run: g.id } });
        audit('game', 'game.prize', won, { wallet, score });
      }
    }
    run('UPDATE game_runs SET finished_at = ?, score = ?, waves = ?, duration_ms = ?, valid = ?, flags = ?, qualified = ?, won_specimen = ? WHERE id = ?',
      now(), score, waves, claimed, valid ? 1 : 0, flags.join(','), qualified ? 1 : 0, won, g.id);
    const s = won ? specimenRow(won) : null;
    return { score, valid, qualified, won: s ? toPublic(s) : null, min_score: rules.game_min_score, runs_left: Math.max(0, rules.game_daily_runs - runsToday(wallet)) };
  });
}
