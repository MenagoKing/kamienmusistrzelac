# Space Rocks · site

Real certified meteorites, sold at fixed prices on a market and in guaranteed-floor packs, vaulted and minted on Solana.

- `space-rocks-site/` is the final design kit, committed unchanged (first commit). Read `space-rocks-site/HANDOFF.md` first. Do not edit the kit; the app reuses files from it directly.
- Everything else is the production build of that design: Vite 6, React 18, TypeScript. Same copy, spacing, colours, fonts and motion.

## Run

```
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck, build, prerender the page into dist/index.html
npm run preview    # serves dist/
```

The original single-file design still runs on its own: `cd space-rocks-site && python3 -m http.server 8080`.

## Layout

| Path | What |
|---|---|
| `src/data/index.ts` | **The one data layer.** `getPageData()`, `subscribeSeries()`, `joinWaitlist()`. Swap the bodies for API calls; keep the return types. |
| `src/data/sample.ts` | All sample data from the design: market specimens, vault register, Series 001 state, upcoming series, the reveal, the launch drop, product rules. |
| `src/data/types.ts` | Data model from HANDOFF.md (Specimen, Series, PackReveal, LaunchDrop, Rules). |
| `src/lib/format.ts` | Price, mass, origin, status formatting. Market price = vault value × markup; buyback = vault value × share. Prices are never stored. |
| `src/lib/scene.ts` | Loads three.js r128 and `space-rocks-site/src/rocks.js` unchanged as classic scripts (global `RK`), shared lighting. |
| `src/components/*` | One component per section, same markup and class names as the design. |
| `src/styles/site.css` | The design's `<style>` block, verbatim. |
| `scripts/prerender.mjs` | Writes the server-rendered page into `dist/index.html` at build time; the browser hydrates it. |

Logo and favicon are the kit's files (`space-rocks-site/assets/logo/space-rocks-logo-on-dark.svg`, `favicon.svg`), bundled by Vite. three.js comes from the `three@0.128.0` package, byte-identical to the cdnjs r128 file the design pins, so the only third-party request left is Google Fonts.

## Sample data

Every number on the page comes from `src/data/sample.ts` or is computed from it. Nothing was added: values the design does not show (vault values of register-only specimens, series pack price, composition date) are `null`. Still to replace (HANDOFF "Sample data to replace"):

- Market listings and the vault register.
- Series 001 state and live counts. The sample replays the design's demo: one pack every 3.4 s, reset at 60 opened. It only runs with motion on.
- The reveal card (Tissint SR-00011, pack $96.00, vault $240.00, offer $204.00).
- The drop clock (sample opens 1d 14h 36m after page load).
- Footer line "Sample data on this page": remove at launch.

Copy that repeats rule numbers (hero stats, FAQ, "85%" in §05, "Never below 70%") is plain text; the band ranges and counts, the market price, and the buyback offer and its percentage come from `RULES`.

## To wire

Waitlist form (`joinWaitlist`, no network now) · market card links and reveal buttons (point to `#join` / `#after` now) · series counters from the API (`subscribeSeries`) · drop clock from the launch schedule · public vault page · Terms and Privacy pages (point to `#top` now) · real specimen photos in place of the generated thumbnails (keep the 3D hero) · a static image fallback for devices without WebGL.

## Previews

`#still` in the URL draws every 3D scene at a fixed moment and reveals all sections at once, as in the design (for screenshots).
