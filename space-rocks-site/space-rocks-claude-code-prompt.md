You are taking over the final website design for Space Rocks (real certified meteorites, sold at fixed prices on a market and in guaranteed-floor packs, vaulted and minted on Solana) and building it for production.

1. Unzip space-rocks-site.zip into a new private repository and commit it unchanged as the first commit.
2. Read space-rocks-site/HANDOFF.md first: files, tokens, page structure, product rules, data model, sample data, what to wire, open decisions.
3. Serve it locally (python3 -m http.server 8080 inside the folder). Confirm at 1440, 1024, 768, 390 and 360 px wide: no sideways scroll, no console errors, the 3D hero renders, every nav link scrolls to its section.
4. Rebuild the page in the team's production stack 1:1. Keep copy, spacing, colours, fonts and motion exactly; reuse src/rocks.js for the 3D as is; use the SVGs in assets/logo for the logo and favicon.
5. Keep all sample data behind one data layer (specimens, series, reveal, launch drop) so the API can replace it later. Do not invent prices or counts.
6. Do not add API keys, tokens or credentials to the repository.
7. Deploy a private preview and send back the preview URL, the repo link, and anything that did not match the original design.
