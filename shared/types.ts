// Data model shared by the site, the admin panel and the server.
// Follows space-rocks-site/HANDOFF.md ("Data model (suggested)") and the dev brief v1.

/** Shape preset for the procedural 3D render (RK.rock). Used until real specimen photos exist. */
export type RockType = 'stone' | 'iron' | 'martian' | 'lunar' | 'pallasite';

export interface RenderHint {
  type: RockType;
  seed: number;
}

export type Band = 'floor' | 'par' | 'hit';

/** Pack tiers from the brief. A series belongs to one tier. */
export type Tier = 'earth' | 'orbit' | 'mars' | 'launch';

export type Currency = 'USDC' | 'SOL';

/** Where a specimen is. Stored as a plain string on the server. */
export type SpecimenState =
  | 'draft' // file incomplete: cannot be listed or sealed
  | 'vault' // file complete, in the vault, not assigned yet
  | 'market' // listed on the market at a fixed price
  | 'series' // sealed into a series (a pack slot)
  | 'locked' // locked in a launch drop batch
  | 'held' // owned by a collector (NFT in their wallet)
  | 'redeeming' // NFT burned, shipment being prepared
  | 'redeemed'; // shipped to the collector

/** Public status, as the vault register shows it. */
export type SpecimenStatus =
  | { kind: 'on_market' }
  | { kind: 'in_series'; series_id: string; sold_back?: boolean }
  | { kind: 'in_vault'; sold_back?: boolean }
  | { kind: 'locked'; drop_id: string }
  | { kind: 'held' }
  | { kind: 'redeeming' }
  | { kind: 'redeemed' }
  | { kind: 'not_listed'; reason?: 'file_incomplete' };

/** The specimen file (HANDOFF §04, eight items). A non-empty value is a link or reference. */
export interface SpecimenFile {
  bulletin?: string; // Meteoritical Bulletin entry
  weigh_video?: string;
  photos?: string[]; // macro set + 360 turn
  coa?: string;
  provenance?: string; // provenance + export documents
  invoice?: string; // sets the vault value
  capsule_tag?: string; // tamper-evident capsule, QR/NFC tag id
}

export const FILE_ITEMS: { key: keyof SpecimenFile; label: string }[] = [
  { key: 'bulletin', label: 'Meteoritical Bulletin entry' },
  { key: 'weigh_video', label: 'Weigh-in video, calibrated scale' },
  { key: 'photos', label: 'Macro photos and 360° turn' },
  { key: 'coa', label: 'Certificate of authenticity' },
  { key: 'provenance', label: 'Provenance and export papers' },
  { key: 'invoice', label: 'Purchase invoice (sets vault value)' },
  { key: 'capsule_tag', label: 'Sealed capsule, QR / NFC tag' },
];

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
  /** Which file items are present (public), in FILE_ITEMS order. */
  file_done?: boolean[];
  /** First photo from the file, if any. Replaces the generated thumbnail. */
  photo?: string | null;
  /** NFT mint address once minted. */
  mint?: string | null;
  /** Owner's callsign, or short address ("7xKX…9fQ2"), when held. */
  owner?: string | null;
  /** Active collector listing, when the holder has put it up for sale. */
  listing?: { id: string; price_usd: number } | null;
  render: RenderHint;
}

/** A specimen a collector has listed for sale to other collectors (secondary market). */
export interface Listing {
  id: string;
  price_usd: number;
  seller: string; // callsign or short address
  mine?: boolean;
  created_at: string;
  specimen: Specimen;
}

export interface Achievement { id: string; title: string; desc: string; done: boolean; progress?: string }

/** A collector's profile with game progress (computed from their history). */
export interface Profile {
  address: string;
  username: string | null;
  email: string | null;
  has_password: boolean;
  avatar_seed: number;
  linked_wallet: string | null;
  kind: string;
  created_at: string;
  level: number;
  xp: number;
  xp_level_start: number;
  xp_next: number;
  rank: string;
  next_rank: string | null;
  stats: { held: number; value: number; packs: number; hits: number; sold: number; earned: number; redeemed: number };
  book: { type: RockType; label: string; held: number; ever: boolean }[];
  achievements: Achievement[];
}

export interface Activity { id: string; kind: string; usd: number; specimen_id: string | null; specimen_name: string | null; created_at: string }

/** Full specimen record, admin only. */
export interface SpecimenAdmin {
  id: string;
  name: string;
  class: string;
  category: RockType;
  mass_g: number;
  origin: string | null;
  fall: number | 'find' | null;
  vault_value_usd: number | null;
  state: SpecimenState;
  series_id: string | null;
  drop_id: string | null;
  sold_back: boolean;
  owner: string | null;
  mint: string | null;
  vault_id: string | null;
  file: SpecimenFile;
  notes: string;
  render_seed: number;
  featured?: number;
  created_at: string;
  updated_at: string;
}

export interface BandRule {
  /** Vault value as a share of the pack price. max null = open-ended. */
  min: number;
  max: number | null;
  /** Packs per series in this band. */
  count: number;
}

/** Product rules and fees. All are proposals until confirmed (HANDOFF "Open decisions"). */
export interface Rules {
  market_markup: number; // market price = vault value x markup
  buyback_share: number; // instant offer = vault value x share
  series_size: number;
  bands: Record<Band, BandRule>;
  ev_target: number; // pack EV target in vault value
  edge_split: { rocks_buyback: number; launch_reserve: number; ops: number };
  royalty: number; // secondary royalty, goes to inventory
  handling_fee_usd: number; // redemption handling fee
  shipping_usd: number; // flat insured shipping estimate, charged at cost
  shipping_countries: string[]; // allowlist (ISO 3166-1 alpha-2)
  sol_usd: number; // SOL price used for quotes (simulated chain)
  demo_wallet: boolean; // allow the demo wallet (no extension needed)
  sample_notice: boolean; // footer line "Sample data on this page"
  market_funds_buyback: boolean; // open decision 4
}

export interface Series {
  id: string; // "001"
  name: string;
  tier: Tier;
  size: number;
  counts: Record<Band, number>;
  remaining: Record<Band, number>;
  /** Bands of the packs already opened, in draw order (drives the 100-dot board). */
  opened: Band[];
  /** What is still sealed, by class ("Martian" -> 2). Real counts, the live odds. */
  left_by_class: { label: string; type: RockType; left: number }[];
  pack_price_usd: number | null;
  status: 'draft' | 'upcoming' | 'open' | 'sold_out' | 'closed';
  composition_published_at: string | null;
  commit_hash: string | null;
  drop_id: string | null;
  note: string;
}

/** A series announced but not yet open (shown under the live board). */
export interface UpcomingSeries {
  id: string;
  name: string;
  note: string;
}

export interface PackReveal {
  pull_id: string | null;
  series_id: string | null;
  band: Band;
  pack_price_usd: number;
  vault_value_usd: number;
  bonus?: boolean;
  specimen: {
    id: string;
    name: string;
    /** As shown on the reveal card, e.g. "Martian shergottite". */
    class: string;
    mass_g: number;
    render: RenderHint;
    photo?: string | null;
  };
}

export interface LockedSpecimen {
  id: string;
  batch: 'A' | 'B';
  name: string;
  class: string;
  state: 'locked' | 'unlocked' | 'raffled' | 'rolled' | 'carried';
  render: RenderHint;
}

export type DropEventKind = 'liftoff' | 'booster_catch' | 'ship_catch' | 'scrub' | 'fail';

export interface DropEvent {
  id: string;
  kind: DropEventKind;
  source_url: string;
  note: string;
  actor: string;
  created_at: string;
}

export interface LaunchDrop {
  id: string;
  name: string;
  /** ISO time of T-0. */
  t0: string;
  /** ISO time the drop opens (T-24h). */
  opens_at: string;
  status: 'scheduled' | 'open' | 'closed';
  series_id: string | null;
  locked: LockedSpecimen[];
  events: DropEvent[];
  rolled_over_from: string | null;
}

export interface PageStats {
  specimens: number;
  held: number;
  packs_opened: number;
  redeemed: number;
}

export interface PageData {
  rules: Rules;
  market: Specimen[];
  register: Specimen[];
  register_total: number;
  series: Series | null;
  open_series: Series[];
  upcoming: UpcomingSeries[];
  reveal: PackReveal;
  drop: LaunchDrop | null;
  stats: PageStats;
  listings: Listing[];
}

export interface Holding extends Specimen {
  acquired_via: 'market' | 'pack' | 'raffle' | 'secondary';
  acquired_at: string;
  paid_usd: number | null;
  band: Band | null;
}

export interface Redemption {
  id: string;
  specimen_id: string;
  specimen_name: string;
  wallet: string;
  name: string;
  address: { line1: string; line2?: string; city: string; postal: string; country: string; email: string; phone?: string };
  status: 'requested' | 'packing' | 'shipped' | 'delivered' | 'cancelled';
  fee_usd: number;
  tracking: string;
  created_at: string;
  updated_at: string;
}

export interface Me {
  address: string;
  kind: string;
  profile: Profile;
  holdings: Holding[];
  pulls: PackReveal[];
  redemptions: Redemption[];
  listings: Listing[];
  activity: Activity[];
}

export interface TxResult {
  tx: string;
  currency: Currency;
  amount: number;
  usd: number;
  simulated: boolean;
}

export interface ProofPull {
  nonce: number;
  client_seed: string;
  wallet: string;
  pool: number;
  pick: number;
  slot: number;
  specimen_id: string;
  band: Band;
  added_before?: number[];
}

export interface SeriesProof {
  series_id: string;
  commit_hash: string | null;
  server_seed: string | null;
  slots: { idx: number; specimen_id: string; band: Band; added_at: number }[];
  pulls: ProofPull[];
}
