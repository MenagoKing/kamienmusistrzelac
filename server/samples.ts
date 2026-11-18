// Sample inventory: many realistic specimens at once (Admin › Specimens › Add sample specimens).
// Names, classes, masses and prices follow real meteorite types; each gets its own 3D model (render
// seed). Their file items are sample references, marked "sample" in the notes so they can be found
// and removed. On devnet they go straight onto the market through a dealer; on mainnet they are
// created unlisted (state vault), so nothing fake is sold for real money unless an admin lists it.
import type { RockType } from '../shared/types.ts';
import { activeNetwork, all, get, now, run, tx } from './db.ts';
import { audit } from './ops.ts';
import { cents, fail } from './util.ts';

const R = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const between = (a: number, b: number) => a + Math.random() * (b - a);

interface Kind { cat: RockType; names: string[]; classes: string[]; origins: string[]; mass: [number, number]; perGram: [number, number]; finds: boolean }

const KINDS: Kind[] = [
  { cat: 'stone', finds: false, mass: [2, 180], perGram: [0.4, 3.5],
    names: ['NWA 869', 'Chelyabinsk', 'Aba Panu', 'Viñales', 'Kamil', 'Ozona', 'Gao-Guenie', 'Bjurböle', 'Holbrook', 'Mocs', 'Pultusk', 'Jilin', 'Murchison', 'Allende', 'Saratov', 'Tamdakht', 'Mifflin', 'Sayh al Uhaymir 001', 'Dhofar 1180', 'Jiddat al Harasis 055', 'NWA 4560', 'NWA 10851', 'Ghubara', 'Zag', 'Bensour', 'Benguerir', 'Oued Awlitis 011'],
    classes: ['Ordinary chondrite, L6', 'Ordinary chondrite, LL5', 'Ordinary chondrite, H5', 'Ordinary chondrite, L3-6', 'Ordinary chondrite, H4', 'Carbonaceous chondrite, CV3', 'Carbonaceous chondrite, CM2', 'Enstatite chondrite, EL6'],
    origins: ['Morocco', 'Algeria', 'Oman', 'Russia', 'Poland', 'Cuba', 'Mali', 'Sweden', 'USA', 'Australia', 'Mauritania', 'China', 'Mexico'] },
  { cat: 'iron', finds: true, mass: [8, 420], perGram: [0.6, 2.5],
    names: ['Muonionalusta', 'Sikhote-Alin', 'Campo del Cielo', 'Gibeon', 'Canyon Diablo', 'Odessa', 'Henbury', 'Seymchan', 'Nantan', 'Toluca', 'Mundrabilla', 'Aletai', 'Uruaçu', 'Agoudal', 'Taza', 'Gebel Kamil', 'Willamette', 'Hoba'],
    classes: ['Iron, IVA', 'Iron, IIAB', 'Iron, IAB', 'Iron, IIIAB', 'Iron, IAB-MG', 'Iron, IIE', 'Iron, ungrouped'],
    origins: ['Sweden', 'Russia', 'Argentina', 'Namibia', 'USA', 'Australia', 'China', 'Mexico', 'Morocco', 'Egypt', 'Brazil'] },
  { cat: 'pallasite', finds: true, mass: [2, 60], perGram: [8, 28],
    names: ['Seymchan', 'Imilac', 'Brenham', 'Esquel', 'Fukang', 'Brahin', 'Admire', 'Sericho', 'Huckitta', 'Glorieta Mountain', 'Springwater', 'Jepara', 'NWA 10019', 'Krasnojarsk'],
    classes: ['Pallasite, main group', 'Pallasite, PMG-an', 'Pallasite, Eagle Station'],
    origins: ['Russia', 'Chile', 'USA', 'Argentina', 'China', 'Belarus', 'Kenya', 'Australia', 'Indonesia'] },
  { cat: 'lunar', finds: true, mass: [0.2, 6], perGram: [180, 900],
    names: ['NWA 11273', 'NWA 8686', 'Dhofar 1428', 'Dhofar 025', 'NWA 5000', 'NWA 2995', 'NWA 10989', 'Oued Awlitis 001', 'Jiddat al Harasis 838', 'NWA 13190', 'Sayh al Uhaymir 169', 'Kalahari 009', 'NWA 7611'],
    classes: ['Lunar, feldspathic breccia', 'Lunar, regolith breccia', 'Lunar, mingled breccia', 'Lunar, basalt', 'Lunar, fragmental breccia'],
    origins: ['Morocco', 'Oman', 'Algeria', 'Mauritania', 'Western Sahara', 'Botswana'] },
  { cat: 'martian', finds: true, mass: [0.1, 4], perGram: [300, 1500],
    names: ['Tissint', 'NWA 6963', 'Zagami', 'NWA 7034', 'NWA 2737', 'NWA 10170', 'Dhofar 019', 'NWA 4925', 'Sayh al Uhaymir 005', 'NWA 12522', 'Black Beauty', 'NWA 7397', 'NWA 13227'],
    classes: ['Martian, shergottite', 'Martian, nakhlite', 'Martian, chassignite', 'Martian, polymict breccia', 'Martian, olivine-phyric shergottite'],
    origins: ['Morocco', 'Nigeria', 'Oman', 'Algeria', 'Mauritania'] },
];
// stones are common, Moon and Mars rare
const WEIGHTS: [number, number][] = [[0, 42], [1, 26], [2, 14], [3, 10], [4, 8]];
function pickKind() {
  let x = Math.random() * 100;
  for (const [i, w] of WEIGHTS) { if ((x -= w) < 0) return KINDS[i]; }
  return KINDS[0];
}

export function generateSamples(actor: string, countIn: unknown) {
  const count = Math.round(Number(countIn));
  if (!(count >= 1 && count <= 500)) fail(400, 'Add between 1 and 500 at a time');
  const mainnet = activeNetwork() === 'mainnet-beta';
  const dealers = mainnet ? [] : all<{ id: string; country: string }>('SELECT id, country FROM dealers WHERE active = 1');
  return tx(() => {
    let n = get<{ n: number | null }>("SELECT MAX(CAST(substr(id, 4) AS INTEGER)) n FROM specimens WHERE id LIKE 'SR-%'")!.n ?? 0;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const k = pickKind();
      const id = 'SR-' + String(++n).padStart(5, '0');
      const mass = Math.round(between(k.mass[0], k.mass[1]) * (k.mass[1] < 10 ? 100 : 10)) / (k.mass[1] < 10 ? 100 : 10);
      const value = Math.max(15, cents(Math.round(mass * between(k.perGram[0], k.perGram[1]) / 5) * 5));
      const fall = !k.finds && Math.random() < 0.5 ? String(Math.floor(between(1868, 2024))) : Math.random() < 0.8 ? 'find' : String(Math.floor(between(1900, 2024)));
      const file = {
        bulletin: `https://www.lpi.usra.edu/meteor/metbull.php?sea=${encodeURIComponent(R(k.names))}`,
        weigh_video: `sample · weigh-in ${id}`,
        photos: [`sample · 360° turn ${id}`],
        coa: `sample · COA ${id}`,
        provenance: `sample · provenance and export papers ${id}`,
        invoice: `sample · invoice ${id}`,
        capsule_tag: `sample · capsule tag ${id}`,
      };
      const vaultId = `V${Math.floor(between(1, 4))}-${String.fromCharCode(65 + Math.floor(Math.random() * 6))}${String(Math.floor(between(1, 99))).padStart(2, '0')}`;
      const dealer = dealers.length ? R(dealers) : null;
      const state = mainnet ? 'vault' : 'market';
      run(`INSERT INTO specimens (id, name, class, category, mass_g, origin, fall, vault_value_usd, state, vault_id, file, notes, render_seed, featured,
             dealer_id, dealer_price_usd, dealer_sku, dealer_url, source_status, source_verified_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'available', ?, ?, ?)`,
        id, R(k.names), R(k.classes), k.cat, mass, R(k.origins), fall, value, state, vaultId, JSON.stringify(file),
        'sample specimen (generated)', Math.floor(between(10, 99999)), Math.random() < 0.15 ? 1 : 0,
        dealer?.id ?? null, dealer ? value : null, dealer ? `SMP-${id.slice(3)}` : '', dealer ? now() : null, now(), now());
      ids.push(id);
    }
    audit(actor, 'specimen.samples', '', { count, network: activeNetwork() });
    return { created: ids.length, first: ids[0], last: ids[ids.length - 1], listed: !mainnet };
  });
}

/** Removes generated samples that nobody holds (never touches reserved, sealed or redeemed ones). */
export function removeSamples(actor: string) {
  return tx(() => {
    const r = run("DELETE FROM specimens WHERE notes = 'sample specimen (generated)' AND state IN ('market', 'vault', 'draft') AND owner IS NULL");
    audit(actor, 'specimen.samples_removed', '', { count: Number(r.changes) });
    return { removed: Number(r.changes) };
  });
}
