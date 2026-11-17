// Data model, following space-rocks-site/HANDOFF.md ("Data model (suggested)").
// Every value the page shows comes through these types from src/data/index.ts.

/** Shape preset for the procedural 3D render (RK.rock). Used until real specimen photos exist. */
export type RockType = 'stone' | 'iron' | 'martian' | 'lunar' | 'pallasite';

export interface RenderHint {
  type: RockType;
  seed: number;
}

export type SpecimenStatus =
  | { kind: 'on_market' }
  | { kind: 'in_series'; series_id: string; sold_back?: boolean }
  | { kind: 'held' }
  | { kind: 'redeemed' }
  | { kind: 'not_listed'; reason?: 'file_incomplete' };

export interface SpecimenFile {
  bulletin_name?: string;
  weigh_video?: string;
  photos?: string[];
  coa?: string;
  provenance_export?: string;
  invoice?: string;
  capsule_tag?: string;
  mint?: string;
}

export interface Specimen {
  id: string; // "SR-00007"
  name: string;
  /** Classification as shown on listings, e.g. "Martian, shergottite". */
  class: string;
  mass_g: number;
  /** Country of origin; null while papers are pending. */
  origin: string | null;
  /** Year of an observed fall, or "find". null when unknown. */
  fall: number | 'find' | null;
  /** Documented purchase price. null when not published. */
  vault_value_usd: number | null;
  status: SpecimenStatus;
  /** Where the specimen is, as shown in the vault register ("Collector", "Shipped"...). */
  where?: string;
  file?: SpecimenFile;
  /** Sample only: drives the generated thumbnail. Replace with photos from the file. */
  render: RenderHint;
}

export type Band = 'floor' | 'par' | 'hit';

export interface BandRule {
  /** Vault value as a share of the pack price. max null = open-ended. */
  min: number;
  max: number | null;
  /** Packs per series in this band. */
  count: number;
}

/** Product rules shown on the page. All are proposals until confirmed (HANDOFF "Open decisions"). */
export interface Rules {
  market_markup: number; // market price = vault value x markup
  buyback_share: number; // instant offer = vault value x share
  series_size: number;
  bands: Record<Band, BandRule>;
}

export interface Series {
  id: string; // "001"
  name: string;
  size: number;
  counts: Record<Band, number>;
  remaining: Record<Band, number>;
  /** Bands of the packs already opened, in draw order (drives the 100-dot board). */
  opened: Band[];
  pack_price_usd: number | null;
  status: 'upcoming' | 'open' | 'sold_out';
  composition_published_at: string | null;
}

/** A series announced but not yet open (shown under the live board). */
export interface UpcomingSeries {
  id: string;
  name: string;
  note: string;
}

export interface PackReveal {
  series_id: string | null;
  band: Band;
  pack_price_usd: number;
  vault_value_usd: number;
  specimen: {
    id: string;
    name: string;
    /** As shown on the reveal card, e.g. "Martian shergottite". */
    class: string;
    mass_g: number;
    render: RenderHint;
  };
}

export interface LockedSpecimen {
  batch: 'A' | 'B';
  name: string;
  class: string;
  render: RenderHint;
}

export interface LaunchDrop {
  id: string;
  /** ISO time the drop opens (T-24h). */
  opens_at: string;
  locked: LockedSpecimen[];
  rolled_over_from: string | null;
}

export interface PageData {
  rules: Rules;
  market: Specimen[];
  register: Specimen[];
  series: Series;
  upcoming: UpcomingSeries[];
  reveal: PackReveal;
  drop: LaunchDrop;
}
