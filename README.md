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
- Game-style sign-in screen: create an account with a callsign, email and password (scrypt-hashed) and roll your collector rock (a draggable 3D meteorite avatar), sign in, or **Continue with Google** (Google Identity Services; the server verifies the ID token against Google's keys). Google needs a public OAuth client ID in Admin › Rules & settings (or GOOGLE_CLIENT_ID); until then the button explains it is off. Wallet sign-in is hidden from the screen for now (the API remains); a Solana wallet can still be linked in account settings as the withdrawal wallet.
- `/account`: your profile with level, rank and XP (earned by opening packs, hits, drops, trades, redemptions), the collection book (five classes, locked until found), your collection with sell-to-collectors, sell back, redeem and share, your listings, 12 achievements, activity, shipments, and settings (callsign, email, avatar, password, link a withdrawal wallet, sign out).
- Collector market: list a specimen you hold at your price; it appears under “From collectors” in §01. The buyer pays, the seller receives the price minus the 3% royalty in USDC, the royalty goes to inventory. A listed specimen cannot be sold back or redeemed until it is taken off sale.

**Site** (the design, wired to the API)
- §01 Market: reserve a specimen at its fixed price (dealer price × commission), pay in USDC or SOL (or the token once it is switched on). See **Dealer model** below.
- §02 Packs: live board of every open series (polled), live odds by band and by class ("2 Martian left in this pool"), open a pack, animated reveal with band, multiple and the instant buyback offer. Every draw is verifiable: the proof dialog shows the commitment and, once the series sells out or closes, replays every draw in the browser.
- §03 Launch drops: countdown to T-24h, then to T-0, locked batches in 3D with their state, drop packs while the drop is open, public event log with official sources.
- §04 Vault: the register on the page plus the full searchable register with each specimen's file checklist.
- After a market reservation: Hold or sell to collectors, Cancel (the rock price back from escrow, commission kept), Redeem (shipping quote and price change first), Share. After a pack pull: Hold, Sell back (85% of rock value in USDC, the rock goes to the next unopened series), Redeem (burn, address form with the shipping allowlist, fee), Share (generated 1200×630 card, post to X).
- Rarity badges (Common to Legendary, by class and price) on market cards, dialogs and the collection.
- Waitlist form stores emails.

**Admin** (`/admin`, password)
- Overview: sales, buybacks, vault value, reserves by edge split, 14-day chart, what needs attention, live series, recent activity.
- Specimens: search and filter, editor with the 7-item file (photos upload), list on the market, feature on the site register, history. A specimen cannot be listed or sealed until its file is complete; its vault value is fixed once it is sealed, locked or held.
- Series & packs: create a series (tier, size, pack price), build the composition from the vault (autofill by band, sold-back specimens first, or pick by hand), live composition check against the band rules and EV target, announce, open sale, close (reveals the seed). Draw log per series.
- Launch drops: schedule (T-0, pool), lock Batch A / Batch B, move T-0, resolve the flight with an official https source: liftoff, booster catch (Batch A joins the pool), ship catch (Batch B raffled to participants with a verifiable draw, drop closes), scrub or failed catch (everything rolls over to the next drop).
- Dealers: dealers with their country, shipping rates by region and insurance; CSV import of offers (drafts); per specimen: dealer, dealer price, SKU, link, *Sold at source* and *Mark verified*.
- Escrow: read-only register of every reservation's escrow and its events (lock, refund, top-up, move, release). No admin action moves escrow money.
- Redemptions: dealer orders (order within 48 h, overdue flag, dealer SKU and link, order number → ordered → shipped with tracking) and own-stock shipments (packing → shipped → delivered); cancel refunds.
- Orders & ledger (CSV), collector listings (take down), collectors with callsign, email and holdings, waitlist (CSV), audit log of every admin change.
- Rules & settings: market commission, buyback share (pack pulls), dealer price max age, the dormant token payment (symbol, mint, discount, burn share, manual or Jupiter price), bands and counts, EV target and edge split (validated), royalty, fees, ship-to countries, SOL quote price, demo wallet, sample notice.

## Dealer model (client Addendum 1)

Market specimens stay with independent certified dealers (`server/sources.ts`). Buying one **reserves** that specific specimen: the price is checked again at checkout (if the dealer price changed, the collector sees the new price before paying), the rock price goes into an **escrow** tied to the NFT, and the commission is kept.

- **Cancel**: the rock price comes back in USDC from the escrow, the commission is kept, the NFT is burned.
- **Sold at source** (admin marks it): the holder picks a replacement at the same or lower price (the difference comes back) or takes a full refund.
- **Redeem**: the collector picks the country first and sees the dealer's shipping and insurance plus any price change. Higher price: pay the difference or take a full refund. Lower: the difference comes back. Then the NFT is burned, the escrow is released to the ops wallet and a dealer order opens with a 48-hour deadline (placed by hand in v1, no dealer APIs). The dealer is named to the collector only after redemption.
- A collector sale moves the reservation and its escrow to the buyer.
- Pack pulls stay own stock with the 85% instant buyback (packs and launch drops are unchanged until that decision is made).
- **Token payment** is built but off: the price is a 5-minute average (manual or Jupiter), a discount applies, and a share of the commission is reserved for burning. Switch it on in Rules & settings once the token exists.

Escrow is kept by the app for now (payments are simulated); the on-chain escrow program is an open decision.

## Account wallets (Solana)

Every account gets its own Solana wallet when it is created (password, Google or demo sign-up; `server/custody.ts`). For new accounts the wallet address is the account address; accounts made before this got a wallet at start-up and their queued NFTs were re-addressed to it. NFTs are minted straight to the wallet (or to a linked Phantom/Solflare/Backpack wallet if the collector linked one), and Space Rocks pays the network fees.

- The private key is stored encrypted (AES-256-GCM). The encryption key is `CUSTODY_KEY` (32 bytes, hex or base64) or `data/custody-key.bin`, generated on first start. **Back up the data directory** (`/var/lib/space-rocks` on the VPS): without that key the wallets cannot be used. A demo-data reset never deletes wallets.
- Account › Wallet: address with copy and Solana Explorer link, live SOL balance, NFTs in the wallet, **Get test SOL** (devnet; the public RPC faucet is closed, so it sends 0.05 SOL from the vault authority once every 6 hours) and **Export private key** (password, or a sign-in within 15 minutes for Google accounts) to import the wallet into Phantom. Export is refused on mainnet unless `ALLOW_KEY_EXPORT=1`.
- Admin › Collectors shows each collector's wallet and whether its key was exported.

## NFTs on Solana (real, devnet by default)

Every specimen a collector owns gets a real **Metaplex Core** NFT (`server/solana.ts`, queue in `server/nft.ts`): minted on a market purchase, pack pull or raffle with the specimen file as on-chain Attributes and a 3% Royalties plugin, transferred on a sale between collectors or a withdrawal to the linked wallet, burned on buyback or redemption. The vault authority is the asset's PermanentTransferDelegate and PermanentBurnDelegate, so it never needs the holder's signature. Metadata JSON and a generated card image are served at `/api/nft/<id>.json` and `.svg`. Purchases never wait for the chain: a worker processes the queue and retries; the reveal and the collection show the live status with an explorer link. Admin › Solana NFTs shows the authority, balance, queue and errors.

**Funding:** the devnet RPC faucet is closed, so fund the authority address (shown in Admin › Solana NFTs, generated into `data/solana-authority.json`) at https://faucet.solana.com. Until then NFTs wait in the queue. `npm run chain:check` mints, transfers and burns a test asset to prove the path.

## Devnet and mainnet

The site runs on one Solana network at a time, chosen in **Admin › Network** (the admin password, and typing MAINNET for mainnet). The two are separate worlds (`server/db.ts`, `server/network.ts`): each has its own database, vault key, account wallets, treasury and escrow (devnet in `data/`, mainnet in `data/mainnet/`). Switching signs collectors out (their accounts belong to one network) and keeps the admin signed in; nothing is deleted. Mainnet starts empty (no sample data, no demo wallet) and can never be reset.

**Payments** (`server/chain.ts`) come from the collector's own Space Rocks wallet, paid on-chain before the order is written; the vault pays the network fees, so collectors only need the USDC (or SOL) for the price:

| | devnet | mainnet |
|---|---|---|
| Payments | simulated, or real devnet transfers (toggle in Admin › Network) | always real |
| Money | devnet USDC (faucet.circle.com) and SOL (faucet.solana.com) | USDC and SOL |
| NFTs | real Metaplex Core NFTs on devnet | real NFTs on mainnet |

- A market reservation pays the rock price into the **escrow** wallet and the commission into the **treasury**, in one transaction (USDC). SOL and token payments go to the treasury, which then funds the escrow in USDC.
- Refunds, buybacks, seller payouts, escrow releases and treasury withdrawals go through a **payout queue** (Admin › Payouts & treasury) that sends them in order and waits, retrying, until the paying wallet has the funds. Escrow money can never be withdrawn by the admin.
- If a paid purchase can no longer complete (the rock sold in the meantime, the price changed), the payment is refunded automatically. Not enough funds: nothing is charged, the collector sees a top-up box with their address.
- SOL prices use a live 5-minute average from Jupiter; Rules › SOL price is the fallback.
- NFT metadata links carry the network (`/api/nft/devnet/…`, `/api/nft/mainnet/…`) and are always served from that network's data.

**Going live on mainnet** (Admin › Network shows these checks):
1. A dedicated mainnet RPC (Helius, Triton, QuickNode): paste the URL in Admin › Network or set `SOLANA_RPC_MAINNET`.
2. Send SOL to the mainnet vault address shown there (fees, about 0.005 SOL per NFT, mostly returned when it is burned).
3. Put USDC in the mainnet treasury for refunds and buybacks.
4. Serve the site on its https domain and set `PUBLIC_URL` to it (NFT metadata links), then remove `INSECURE_COOKIES`.
5. Keep `CUSTODY_KEY_MAINNET` (generated into `.env` by the install script) and the data folder backed up offline.
6. Add real specimens, then switch.

Keys per network: `SOLANA_AUTHORITY` / `SOLANA_AUTHORITY_MAINNET`, `CUSTODY_KEY` / `CUSTODY_KEY_MAINNET`, `SOLANA_RPC` / `SOLANA_RPC_MAINNET`; otherwise files in each network's data folder. Tests run with `CHAIN=simulated` and check the live payment logic against an in-memory stand-in for Solana.

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
| `server/sources.ts` | Dealer model: dealers, reservations, escrow, sold at source, redemption quotes, CSV import. |
| `server/token.ts` | Dormant token payment: price sampler (5-minute average), token amounts. |
| `server/db.ts`, `seed.ts` | SQLite schema, sample data. |
| `src/` | The site: one component per design section, plus dialogs (`Checkout`, `Account`, `Explore`, `WalletDialog`). `src/styles/site.css` is the design's stylesheet verbatim; product UI lives in `app.css`. |
| `src/account/` | The account page (`/account`). |
| `src/admin/` | The admin panel. |

## Sample data

The database starts with the design's specimens and register, an open Earth series of 100 packs at $96 (78 floor, 19 par, 3 hit; 35 already opened by sample collectors), Series 002 and the Mars Window announced, free vault stock, and Launch drop 01 opening in 1 d 14 h 36 m with a Lunar and a Martian in Batch A and a Pallasite in Batch B. All of it is sample data: replace it from the admin, and switch off "Sample data on this page" in settings at launch.

## Open decisions (from HANDOFF and the brief)

From the client notes and Addendum 1, waiting for a decision: the price formula (commission 1.10 or 1.20, token discount 5% or a 1.05 factor); whether packs and launch drops move to v2; the on-chain escrow program; spend-based random draws; the dealer research document.

Market markup and the band ranges and counts; showing vault value under the market price; the Mars Window end date; whether market revenue funds the $ROCKS buyback (a toggle exists); the token ticker and early-access threshold. Have a lawyer review packs against gambling and loot-box rules per country, odds disclosure, consumer law, the token, and any use of launch-provider names.
