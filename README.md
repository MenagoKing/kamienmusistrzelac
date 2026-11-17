# Space Rocks

Real certified meteorites, sold at fixed prices on a market and in guaranteed-floor packs, vaulted and minted on Solana, with limited drops that open with every launch.

- `space-rocks-site/` is the final design kit, committed unchanged. Read `space-rocks-site/HANDOFF.md` for the design, and keep the kit as is: the app reuses its files directly (3D library, logo, favicon).
- Everything else is the working product built on that design (dev brief v1): the public site, the API with its database, and the admin panel at `/admin`.
- The $ROCKS token is **not** built. The site still explains it (§06), and 5% of every pack sale is set aside in the ledger as the "buyback and burn" reserve, ready for when the token launches.

## Run

Node 22.18 or newer (uses the built-in `node:sqlite` and runs the TypeScript server directly).

```
npm install
npm run dev          # site + API on http://localhost:5173, admin on http://localhost:5173/admin
npm test             # end-to-end API check on a throwaway database
npm run build        # typecheck, client build (site + admin), server-render bundle
npm start            # production server on http://localhost:3000 (PORT), renders the page with live data
```

The first start creates `data/space-rocks.db` with the sample data (see below) and, unless `ADMIN_PASSWORD` is set, writes a random admin password to `data/admin-password.txt`. Settings go in `.env` (see `.env.example`). `data/` is git-ignored; never commit it.

`npm run seed -- --reset` (or Admin › Rules & settings › Reset demo data) wipes the database and loads the sample data again.

## What works

**Accounts**
- Game-style sign-in screen: create an account with a callsign, email and password (scrypt-hashed), roll your collector rock (a procedural meteorite avatar), or sign in. Or use a Solana wallet: Phantom, Solflare or Backpack sign a one-time message (no transaction) and the server checks the ed25519 signature. A demo wallet lets anyone try the flow without signing up (turn it off in settings at launch).
- `/account`: your profile with level, rank and XP (earned by opening packs, hits, drops, trades, redemptions), the collection book (five classes, locked until found), your collection with sell-to-collectors, sell back, redeem and share, your listings, 12 achievements, activity, shipments, and settings (callsign, email, avatar, password, link a withdrawal wallet, sign out).
- Collector market: list a specimen you hold at your price; it appears under “From collectors” in §01. The buyer pays, the seller receives the price minus the 3% royalty in USDC, the royalty goes to inventory. A listed specimen cannot be sold back or redeemed until it is taken off sale.

**Site** (the design, wired to the API)
- §01 Market: buy a specimen at its fixed price (vault value × markup), pay in USDC or SOL.
- §02 Packs: live board of every open series (polled), live odds by band and by class ("2 Martian left in this pool"), open a pack, animated reveal with band, multiple and the instant buyback offer. Every draw is verifiable: the proof dialog shows the commitment and, once the series sells out or closes, replays every draw in the browser.
- §03 Launch drops: countdown to T-24h, then to T-0, locked batches in 3D with their state, drop packs while the drop is open, public event log with official sources.
- §04 Vault: the register on the page plus the full searchable register with each specimen's file checklist.
- After a pull or purchase: Hold, Sell back (85% of vault value in USDC, the rock goes to the next unopened series), Redeem (burn, address form with the shipping allowlist, fee), Share (generated 1200×630 card, post to X).
- Waitlist form stores emails.

**Admin** (`/admin`, password)
- Overview: sales, buybacks, vault value, reserves by edge split, 14-day chart, what needs attention, live series, recent activity.
- Specimens: search and filter, editor with the 7-item file (photos upload), list on the market, feature on the site register, history. A specimen cannot be listed or sealed until its file is complete; its vault value is fixed once it is sealed, locked or held.
- Series & packs: create a series (tier, size, pack price), build the composition from the vault (autofill by band, sold-back specimens first, or pick by hand), live composition check against the band rules and EV target, announce, open sale, close (reveals the seed). Draw log per series.
- Launch drops: schedule (T-0, pool), lock Batch A / Batch B, move T-0, resolve the flight with an official https source: liftoff, booster catch (Batch A joins the pool), ship catch (Batch B raffled to participants with a verifiable draw, drop closes), scrub or failed catch (everything rolls over to the next drop).
- Redemptions: queue, address label, packing → shipped (tracking) → delivered, or cancel with refund and re-mint.
- Orders & ledger (CSV), collector listings (take down), collectors with callsign, email and holdings, waitlist (CSV), audit log of every admin change.
- Rules & settings: markup, buyback share, bands and counts, EV target and edge split (validated), royalty, fees, ship-to countries, SOL quote price, demo wallet, sample notice.

## What is simulated (to wire before mainnet)

All on-chain effects go through one interface, `server/chain.ts`:

| Method | Today (SimulatedChain) | Production |
|---|---|---|
| `charge` | returns a fake signature | Solana Pay / USDC or SOL transfer, verified on-chain before the pull |
| `payout` | fake signature | USDC from the treasury multisig |
| `mint` / `burn` | fake addresses | Metaplex Core via Umi, specimen file as metadata, 3% royalty enforced |

The draw is commit-reveal (`shared/fair.ts`): publish sha256(seed) at open, draw with HMAC-SHA256(seed, series:nonce:client seed), reveal the seed at sell-out. Swap in an on-chain VRF (Switchboard or ORAO) behind the same `drawPick` when the program exists. Launch drop resolution is recorded by the admin today; the brief's multisig signs it later. Social login (Google, X), email verification and password reset by email, withdrawing NFTs to the linked wallet, listings on external marketplaces (Tensor / Magic Eden) and the $ROCKS holder early access are not built.

## Layout

| Path | What |
|---|---|
| `shared/types.ts` | The data model (specimen, series, pack reveal, launch drop, rules) used by site, admin and server. |
| `shared/rules.ts` | Price, buyback, band and edge-split math, the composition check. Prices are never stored. |
| `shared/fair.ts` | Verifiable draw and its in-browser replay. |
| `server/app.ts` | The HTTP API (public, wallet, admin). Runs inside Vite in dev, inside `server/index.ts` in production. |
| `server/store.ts`, `ops.ts`, `admin.ts` | Read queries, collector actions, admin operations. |
| `server/auth.ts` | Wallet sign-in (ed25519), sessions, admin password. |
| `server/accounts.ts` | Registration, sign-in, profile, levels, ranks, achievements. |
| `server/market.ts` | Collector listings: list, cancel, buy, royalty and payout. |
| `server/db.ts`, `seed.ts` | SQLite schema, sample data. |
| `src/` | The site: one component per design section, plus dialogs (`Checkout`, `Account`, `Explore`, `WalletDialog`). `src/styles/site.css` is the design's stylesheet verbatim; product UI lives in `app.css`. |
| `src/account/` | The account page (`/account`). |
| `src/admin/` | The admin panel. |

## Sample data

The database starts with the design's specimens and register, an open Earth series of 100 packs at $96 (78 floor, 19 par, 3 hit; 35 already opened by sample collectors), Series 002 and the Mars Window announced, free vault stock, and Launch drop 01 opening in 1 d 14 h 36 m with a Lunar and a Martian in Batch A and a Pallasite in Batch B. All of it is sample data: replace it from the admin, and switch off "Sample data on this page" in settings at launch.

## Open decisions (from HANDOFF and the brief)

Market markup and the band ranges and counts; showing vault value under the market price; the Mars Window end date; whether market revenue funds the $ROCKS buyback (a toggle exists); the token ticker and early-access threshold. Have a lawyer review packs against gambling and loot-box rules per country, odds disclosure, consumer law, the token, and any use of launch-provider names.
