/**
 * Vocabulary access layer.
 *
 * Loads the compiled ontology (Turtle) plus the structured capture it was
 * built from, and exposes lookup helpers for the resolver.
 *
 * The Turtle file is the shipped artifact; the JSON is the same data in a
 * form that is cheap to query at runtime. `loadVocabulary()` cross-checks
 * that the two agree so a stale .ttl can never silently diverge from the
 * resolver's behaviour.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Normalise a token for matching: lowercase, strip punctuation. */
export const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');

/** Crude singular/plural fold so "listings" matches entity_type "listing". */
export const singular = (s) => (s.length > 3 && s.endsWith('s') && !s.endsWith('ss') ? s.slice(0, -1) : s);

export async function loadVocabulary() {
  const json = JSON.parse(await readFile(path.join(ROOT, 'data', 'global-vocabulary.json'), 'utf8'));
  const ttl = await readFile(path.join(ROOT, 'ontology', 'arkiv-vocab.ttl'), 'utf8');

  // Cross-check: every project and attribute in the JSON must appear in the TTL.
  const missing = [];
  for (const p of Object.keys(json.projects)) {
    if (!ttl.includes(`arkiv:canonicalName "${p}"`)) missing.push(`project:${p}`);
  }
  const attrNames = Object.keys(json.attributes);
  for (const a of attrNames) {
    if (!ttl.includes(`arkiv:canonicalName "${a}"`)) missing.push(`attr:${a}`);
  }

  const projects = new Map(Object.entries(json.projects));
  const entityTypes = new Map(Object.entries(json.entityTypes));
  const attributes = new Map(Object.entries(json.attributes));

  // Per-namespace schema captured by the anchor probe, when present.
  // This is what reveals that most real projects discriminate on a bare `type`
  // attribute rather than `entity_type`.
  const projectSchemas = new Map();
  const anchorPath = path.join(ROOT, 'data', 'anchor-schemas.json');
  if (existsSync(anchorPath)) {
    const raw = JSON.parse(await readFile(anchorPath, 'utf8'));
    for (const [project, s] of Object.entries(raw.projects ?? {})) {
      const attrs = new Map();      // merged across all entity types (fallback)
      const values = new Map();
      const byValue = new Map();    // discriminator value -> its OWN attribute set
      const discValues = new Set();

      for (const et of s.entityTypes ?? []) {
        const amap = new Map();
        const vmap = new Map();
        for (const a of et.attributes ?? []) {
          const add = (m, k, xs) => { if (!m.has(k)) m.set(k, new Set()); for (const x of xs) m.get(k).add(x); };
          add(attrs, a.name, a.observedTypes);
          add(amap, a.name, a.observedTypes);
          add(values, a.name, a.sampleValues ?? []);
          add(vmap, a.name, a.sampleValues ?? []);
          if (a.name === 'entity_type' || a.name === 'type') {
            for (const v of a.sampleValues ?? []) discValues.add(v);
          }
        }
        byValue.set(et.entityType, { count: et.count, attributes: amap, values: vmap });
      }

      projectSchemas.set(project, {
        project,
        entityCount: s.entityCount,
        snapshotBlock: s.snapshotBlockNumber,
        // Trust the probe's discriminator detection; fall back to `entity_type`.
        discriminator: s.discriminator ?? 'entity_type',
        discriminatorValues: [...discValues],
        attributes: attrs,
        values,
        byValue,
      });
    }
  }

  return {
    meta: {
      source: json.source,
      walkedRows: json.walkedRows,
      pages: json.pages,
      counts: json.counts,
      ttlConsistent: missing.length === 0,
      ttlMismatches: missing.slice(0, 10),
    },
    projects,
    entityTypes,
    attributes,
    projectSchemas,
    /** All attribute names whose observed types include `t`. */
    attributesOfType: (t) => [...attributes.entries()].filter(([, a]) => a.observedTypes.includes(t)).map(([n]) => n),
    /** Attributes carrying more than one observed type. */
    ambiguous: () => [...attributes.entries()].filter(([, a]) => a.observedTypes.length > 1),
  };
}

/**
 * Intent keyword -> canonical attribute/entity hints.
 *
 * Seeded from the REAL vocabulary. Every right-hand side must exist in the
 * captured vocabulary or `loadVocabulary` + `resolve` will flag it, so this
 * table cannot drift into invention.
 */
/** Intent keyword -> attested project namespace. */
export const SYNONYMS_PROJECT = {
  mandi: 'mandi_board_v1',
  mandi_board: 'mandi_board_v1',
  mandiboard: 'mandi_board_v1',
  underthetable: 'underthetable',
  under_the_table: 'underthetable',
  bhaiyaplease: 'bhaiyaplease',
  tolmol: 'tolmol',
  arkivate: 'arkivate',
  slotbazaar: 'slotbazaar',
  safestay: 'safestay_v1',
  globalpay: 'globalpay',
  arkivtrace: 'arkivtrace',
};

/**
 * Intent keyword -> entity_type. A target here is only emitted if it is
 * attested in the captured vocabulary; otherwise the resolver reports the
 * gap instead of inventing a namespace.
 */
export const SYNONYMS_TYPE = {
  listing: 'listing',
  listings: 'listing',
  booking: 'booking',
  bookings: 'booking',
  receipt: 'receipt',
  receipts: 'receipt',
  worker: 'worker',
  mandate: 'mandate',
  deposit: 'deposit_terms',
  deposits: 'deposit_terms',
  evidence: 'evidence_log',
  slot: 'slot',
  slots: 'slot',
  trigger: 'trigger',
  completion: 'completion',
  acceptance: 'acceptance',
  publication: 'publication',
  community: 'community',
  follow: 'follow',
};

/** Intent keyword -> attested attribute name. */
export const SYNONYMS_ATTR = {
  // mandi_board_v1 (Indian agri-market price votes)
  crop: 'crop',
  produce: 'crop',
  commodity: 'crop',
  mandi: 'mandi',
  market: 'mandi',
  // underthetable (food-diversion reports)
  amount: 'amount_inr',
  spend: 'amount_inr',
  spending: 'amount_inr',
  payment: 'amount_inr',
  diversion: 'kind',
  // bhaiyaplease (delivery receipts)
  tip: 'tip',
  // generic
  volume: 'amount',
  value: 'amount',
  worth: 'amount',
  cost: 'price',
  pricing: 'price',
  quantity: 'qty',
  weight: 'grain_g',
  region: 'district',
  area: 'district',
  state: 'lga',
  timestamp: 'ts',
  time: 'ts',
};

/** Intent phrase -> (attribute, operator) shaping. */
export const INTENT_OPERATORS = [
  { match: /\b(highest|largest|greatest|most|top|max|maximum|biggest)\b/, op: 'desc', note: 'descending' },
  { match: /\b(lowest|smallest|least|cheapest|min|minimum)\b/, op: 'asc', note: 'ascending' },
  { match: /\b(above|over|greater|more than|at least)\b/, op: 'gte' },
  { match: /\b(below|under|less|fewer|at most)\b/, op: 'lte' },
  { match: /\b(recent|latest|newest)\b/, op: 'recent' },
  { match: /\b(active|live|open)\b/, op: 'active' },
];
