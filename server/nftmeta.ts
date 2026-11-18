// Off-chain NFT metadata (the asset's `uri`) and a generated card image, in the Metaplex JSON standard.
// The specimen file is also on-chain as Attributes; this JSON adds the image and description.
import type { IncomingMessage } from 'node:http';
import { specimenRow, fileOf, photoOf } from './store.ts';
import { activeNetwork } from './db.ts';

/** The network part of NFT links: metadata must always come from the network the NFT lives on. */
export const netSlug = () => (activeNetwork() === 'mainnet-beta' ? 'mainnet' : 'devnet');
const shareFile = (id: string) => (activeNetwork() === 'mainnet-beta' ? `share-mainnet-${id}.png` : `share-${id}.png`);
import { fail } from './util.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const base = (req: IncomingMessage) => (process.env.PUBLIC_URL || `http://${req.headers.host ?? 'localhost'}`).replace(/\/$/, '');

export function nftJson(req: IncomingMessage, id: string) {
  const s = specimenRow(id.replace(/\.json$/, '')) ?? fail(404, 'Unknown specimen');
  const f = fileOf(s);
  const photo = photoOf(s);
  const image = photo ? (photo.startsWith('http') ? photo : base(req) + photo) : `${base(req)}/api/nft/${netSlug()}/${s.id}.svg`;
  return {
    name: `${s.name} ${s.id}`,
    symbol: 'ROCK',
    description: s.dealer_id
      ? `${s.name}, ${s.class}, ${s.mass_g} g. A real, certified meteorite specimen reserved for the holder of this NFT, sourced from an independent certified dealer. Burn to redeem: it is purchased and shipped to you.`
      : `${s.name}, ${s.class}, ${s.mass_g} g. A real, certified meteorite specimen (${s.vault_id ?? 'Space Rocks'}). Burn to redeem the physical rock.`,
    image,
    external_url: `${base(req)}/#vault`,
    attributes: [
      ['Specimen', s.id], ['Class', s.class], ['Category', s.category], ['Mass (g)', s.mass_g], ['Origin', s.origin ?? 'pending'],
      ['Fall', s.fall ?? 'unknown'], ['Vault ID', s.dealer_id ? '' : s.vault_id ?? ''], ['Rock value (USD)', s.dealer_id ? s.dealer_price_usd ?? s.vault_value_usd ?? '' : s.vault_value_usd ?? ''], ['Sourcing', s.dealer_id ? 'Independent certified dealer' : 'Own stock'], ['Meteoritical Bulletin', f.bulletin ?? ''],
      ['Certificate', f.coa ?? ''], ['Capsule tag', f.capsule_tag ?? ''],
    ].filter(([, v]) => v !== '').map(([trait_type, value]) => ({ trait_type, value })),
    properties: { category: 'image', files: [{ uri: image, type: photo ? 'image/jpeg' : 'image/svg+xml' }] },
  };
}

const COLORS: Record<string, [string, string]> = { stone: ['#4a2412', '#B3A595'], iron: ['#2a2422', '#C9C2BA'], pallasite: ['#4a3a18', '#E8C27A'], lunar: ['#2c3340', '#A9B6C9'], martian: ['#5c2a12', '#F08A5D'] };

export function nftSvg(id: string) {
  const s = specimenRow(id.replace(/\.svg$/, '')) ?? fail(404, 'Unknown specimen');
  const [bg, accent] = COLORS[s.category] ?? COLORS.stone;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
<defs><radialGradient id="g" cx="65%" cy="85%" r="80%"><stop offset="0" stop-color="${bg}"/><stop offset=".7" stop-color="#120d0b"/><stop offset="1" stop-color="#0E0A08"/></radialGradient>
<radialGradient id="r" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="${accent}" stop-opacity=".9"/><stop offset=".55" stop-color="#3a2a22"/><stop offset="1" stop-color="#140e0b"/></radialGradient></defs>
<rect width="1000" height="1000" fill="url(#g)"/>
<path d="M600 300 L760 360 L800 520 L720 680 L540 720 L420 610 L430 420 Z" fill="url(#r)" stroke="${accent}" stroke-opacity=".35" stroke-width="3"/>
<text x="70" y="120" fill="${accent}" font-family="monospace" font-size="30" letter-spacing="5">${esc(s.id)} · SPACE ROCKS</text>
<text x="66" y="800" fill="#EFE6DA" font-family="Georgia, serif" font-size="96">${esc(s.name)}</text>
<text x="70" y="860" fill="#A39484" font-family="monospace" font-size="30" letter-spacing="3">${esc(s.class.toUpperCase())} · ${s.mass_g} G</text>
<text x="70" y="920" fill="#A39484" font-family="monospace" font-size="24" letter-spacing="4">CERTIFIED · DOCUMENTED · MINTED ON SOLANA</text>
</svg>`;
}

/* ---------- share pages ---------- */
// /s/<specimen id>: a tiny page whose Open Graph / X card tags carry the share card image, so a link
// posted on X (or anywhere) shows the specimen picture. People who open it land on the site.
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from './db.ts';

export function saveShareImage(id: string, data: unknown) {
  const s = specimenRow(id) ?? fail(404, 'Unknown specimen');
  const m = /^data:image\/png;base64,(.+)$/.exec(String(data ?? ''));
  if (!m) fail(400, 'Send the card as a PNG');
  const buf = Buffer.from(m![1], 'base64');
  if (buf.length > 3 * 1024 * 1024) fail(413, 'The card image is too large');
  fs.writeFileSync(path.join(UPLOAD_DIR, shareFile(s.id)), buf);
  return { image: `/uploads/${shareFile(s.id)}`, page: `/s/${s.id}` };
}

export function sharePage(req: IncomingMessage, id: string) {
  const s = specimenRow(id);
  if (!s) return null;
  const b = base(req);
  const hasImg = fs.existsSync(path.join(UPLOAD_DIR, shareFile(s.id)));
  const img = hasImg ? `${b}/uploads/${shareFile(s.id)}` : `${b}/api/nft/${netSlug()}/${s.id}.svg`;
  const title = `${s.name} · ${s.class} · Space Rocks`;
  const desc = `A real, certified meteorite: ${s.name}, ${s.class}, ${s.mass_g} g. Minted on Solana.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Space Rocks"><meta property="og:url" content="${b}/s/${s.id}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${esc(s.name)}, ${esc(s.class)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${img}">
<meta http-equiv="refresh" content="0;url=/#vault"><style>body{background:#0E0A08;color:#EFE6DA;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#F08A5D}</style></head>
<body><p><a href="/#vault">${esc(s.name)} · Space Rocks</a></p></body></html>`;
}
