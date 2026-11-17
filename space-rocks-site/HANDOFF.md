# Space Rocks · site design handoff

Final design: **Field Journal** (editorial, dusk palette, procedural 3D meteorites). Logo: **A, The Fall**.
`index.html` is a complete, working single-file build of the design. Rebuild it in the production stack 1:1; keep the copy, spacing, colours and motion.

## Run it

```
cd space-rocks-site
python3 -m http.server 8080
# open http://localhost:8080
```

External requests: three.js r128 from cdnjs (pinned) and Google Fonts (Instrument Serif, Hanken Grotesk, IBM Plex Mono). Nothing else.
Checked in Chromium at 1440, 1280, 1024, 768, 390, 360 and 320 px: no sideways scroll, no console errors, no failed requests, every in-page link has a target, no duplicate ids, every image renders.

## Files

| Path | What |
|---|---|
| `index.html` | The whole page: markup, CSS, the 3D library inlined, page script |
| `src/rocks.js` | The same 3D library, readable: procedural meteorites (shape on the CPU, surface per pixel on the GPU), Mars globe, light, stars, render loop |
| `assets/logo/space-rocks-logo-on-dark.svg` | Primary lockup, wordmark outlined (no font needed) |
| `assets/logo/space-rocks-logo-on-light.svg` | Lockup for light backgrounds |
| `assets/logo/space-rocks-symbol.svg` | The fragment alone |
| `assets/logo/space-rocks-app-icon.svg` | 1024 app icon / avatar |
| `assets/logo/favicon.svg` | Favicon (also inlined in the page head) |

## Design tokens

`--bg #0E0A08` · `--ink #EFE6DA` · `--soft #D6CABC` · `--mute #A39484` · `--dust #E3693A` (accent, buttons) · `--dust2 #F08A5D` (accent text) · `--line rgba(239,230,218,.13)` · `--panel #15100D`
Pack bands: Floor `#7D7166` · Par `#D6CABC` · Hit `#F08A5D`
Type: Instrument Serif (display), Hanken Grotesk 400/500/600 (body), IBM Plex Mono 400/500 (labels, numbers, uppercase with 0.12em tracking).
Breakpoints: 980 px (single column, menu hidden) and 700 px (phone).

## Page structure (anchor ids)

1. `#top` Hero: dusk sky (2D canvas stars), falling meteor, horizon, 3D Tissint end cut that turns and follows scroll, headline, two CTAs, three stats.
2. `#market` §01 The market: fixed-price listings, one card per specimen.
3. `#packs` §02 The packs: the three value bands, live counter of the open series (100 dots, remaining per band), upcoming series, the four-step flow.
4. `#drops` §03 Launch drops: flight timeline, three locked specimens in 3D, drop countdown.
5. `#vault` §04 The vault: public register (where each specimen is and its status), the eight items of a specimen file.
6. `#after` §05 After you buy: hold, sell back, redeem, share; the reveal screen with the instant offer.
7. `#rocks` §06 $ROCKS.
8. `#faq` §07 Questions (native details/summary).
9. `#join` Waitlist form, then the footer.
A fixed header slides in once the hero is scrolled past.

## Product rules the design shows (all numbers are proposals until confirmed)

- **Market (primary):** every specimen listed alone at a fixed price. Price = vault value x 1.15. Vault value = documented purchase price. No randomness.
- **Packs (secondary):** sealed series of exactly 100 packs, composition published before sale opens. Bands, as vault value against pack price: Floor 70 to 85% (78 packs, never below 70%), Par 90 to 120% (19), Hit 150%+ (3). Expected value about 86%. Draw by VRF without replacement inside a series. Live counters per series: Floor / Par / Hit remaining.
- **Buyback:** 85% of vault value in USDC, shown on the reveal screen next to the specimen. A bought-back specimen goes into the next unopened series, never the current one.
- **Launch drops:** a bonus on top of the regular series. Opens T-24h; booster catch unlocks Batch A; ship catch raffles Batch B as bonus pulls to everyone who opened a pack in the drop; scrub or miss rolls the locked specimens over. Results resolved by multisig with a link to the official source.
- **$ROCKS:** launched on pump.fun; holders above a set balance get 30 minutes early access to each drop; a share of every pack sale buys back and burns; not a claim on the vault.

## Data model (suggested)

```
Specimen   { id "SR-00007", name, class, mass_g, origin, fall_year|find, vault_value_usd,
             market_price_usd = vault_value_usd * 1.15, status: on_market | in_series(series_id) | held | redeemed | not_listed,
             file: { bulletin_name, weigh_video, photos, coa, provenance_export, invoice, capsule_tag, mint } }
Series     { id "001", name, size 100, counts { floor 78, par 19, hit 3 }, remaining { floor, par, hit },
             pack_price_usd, status: upcoming | open | sold_out, composition_published_at }
PackReveal { series_id, specimen_id, band, pack_price_usd, vault_value_usd, multiple = vault/pack, buyback_usd = 0.85 * vault }
LaunchDrop { id, t0, opens_at = t0 - 24h, batches { A [specimen_id], B [specimen_id] }, events [booster_catch|ship_catch|scrub|fail + source_url], rolled_over_from }
```

## Sample data to replace (all in the page script)

- `SPEC`: market listings (name, class, mass, origin, vault value). Prices are computed as vault x 1.15.
- `REG`: vault register rows and statuses.
- Series 001 state: `PRE` (packs already opened) and the 100-dot board; the demo opens one pack every 3.4 s and resets at 60.
- Reveal card: Tissint SR-00011, pack $96.00, vault $240.00 (2.5x), offer $204.00.
- Drop clock: counts down 1d 14h 36m from page load.
- Footer line "Sample data on this page": remove at launch.

## To wire

Waitlist form (no network now, shows a confirmation line) · market card links and reveal buttons (point to `#join` / `#after` now) · series counters from the API · drop clock from the launch schedule · public vault page · Terms and Privacy pages.

## 3D notes

- `RK.rock({type, seed, level, stretch, chips, dents, cut, cutD, bump})`, types: stone, iron, martian, lunar, pallasite. `RK.run(canvas, renderer, camera, draw)` sizes the canvas, renders only while on screen and honours reduced motion.
- Live WebGL canvases: hero and the locked tiles. Market, register and reveal images are rendered once into PNGs by one temporary renderer, after first paint.
- Real specimen photos should replace the generated thumbnails once the vault has them; keep the 3D hero.
- Add a static image fallback for devices without WebGL.

## Open decisions for Mac

1. Market markup 15% and the band ranges and counts (proposals).
2. Show vault value under the market price, or price only.
3. Mars Window series: kept as a themed series until 31 Dec (assumption, not in the update).
4. Does market revenue also fund the $ROCKS buyback, or pack sales only.
5. Ticker and token threshold for early access.

Legal (not legal advice): have a lawyer check packs against gambling and loot-box rules per country, band and odds disclosure, consumer law, the token not being a security, and any future use of SpaceX or Starship names (none appear on the page).
