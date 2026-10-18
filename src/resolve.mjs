/**
 * The resolver: natural-language intent -> grammar-valid Arkiv filter.
 *
 * Design contract:
 *   1. Every attribute, project and entity_type emitted MUST be attested in
 *      the captured live vocabulary. Nothing is invented.
 *   2. The emitted expression MUST pass grammar.validate(). If it does not,
 *      the resolver returns valid:false rather than a query that will run and
 *      silently return nothing.
 *   3. Type-ambiguous attributes are WIDENED with OR across their observed
 *      types, and the widening is reported, because a typed predicate matches
 *      only cells stored with that exact type.
 *   4. Arkiv has no ORDER BY and no aggregates. Requests for "highest"/"top"
 *      return a postProcessing instruction instead of a fake ORDER BY clause.
 *
 * Matching is deliberately conservative: a weak substring coincidence must
 * not produce a predicate. Silent over-matching is the same failure class as
 * silent zero-matching.
 */
import { literal, validate } from './grammar.mjs';
import { norm, singular, SYNONYMS_PROJECT, SYNONYMS_TYPE, SYNONYMS_ATTR, INTENT_OPERATORS } from './vocab.mjs';

const STOP = new Set(['the', 'a', 'an', 'me', 'show', 'find', 'get', 'list', 'all', 'for', 'of',
  'in', 'on', 'with', 'and', 'or', 'to', 'from', 'by', 'that', 'are', 'is', 'were', 'was',
  'give', 'i', 'want', 'need', 'please', 'some', 'any', 'how', 'many', 'what', 'which',
  'highest', 'lowest', 'top', 'most', 'least', 'recent', 'latest', 'newest']);

/** Minimum score for a candidate to be emitted. Below this, report the gap. */
const MIN_SCORE = 8;
/** Substring matching is only safe for names long enough to be distinctive. */
const MIN_SUBSTRING_LEN = 5;

/**
 * An explicit string value for an attribute, if the intent supplies one.
 * Without an explicit value there is nothing to compare against, so the
 * resolver must NOT invent an equality such as `district = str('district')`.
 */
function explicitStringValue(intent, attr) {
  const quoted = intent.match(/['"]([^'"]+)['"]/);
  if (quoted) return quoted[1];
  const m = intent.match(new RegExp(`\\b${attr}\\b\\s*(?:=|is|of|equals)\\s*([A-Za-z0-9_]+)`, 'i'));
  return m ? m[1] : null;
}

/** The first standalone numeric literal in the intent, if any. */
function explicitNumber(intent) {
  const m = intent.match(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/);
  return m ? m[1] : null;
}

function tokenize(intent) {
  return norm(intent).split('_').filter((t) => t && !STOP.has(t));
}

/**
 * Score how well a candidate name matches the intent.
 * Exact token matches dominate; substring coincidences are capped and gated
 * behind a minimum length so short names like `v`, `op`, `by` cannot match.
 */
function scoreName(name, tokens, phrase) {
  const n = norm(name);
  let score = 0;
  if (tokens.includes(n)) score += 10;
  else if (tokens.includes(singular(n))) score += 8;

  const parts = n.split('_').filter(Boolean);
  if (parts.length > 1 && parts.every((p) => tokens.includes(p))) score += 9;

  if (score === 0 && n.length >= MIN_SUBSTRING_LEN && phrase.includes(n)) score += 6;
  return score;
}

export function resolve(intent, vocab) {
  const tokens = tokenize(intent);
  const phrase = norm(intent);

  const resolved = { project: null, entityType: null, attributes: [] };
  const disambiguation = [];
  const warnings = [];

  // ---- 1. project namespace -------------------------------------------
  let bestProject = null;
  for (const [name] of vocab.projects) {
    let s = scoreName(name, tokens, phrase);
    for (const t of tokens) {
      if (SYNONYMS_PROJECT[t] && norm(SYNONYMS_PROJECT[t]) === norm(name)) s += 10;
      if (norm(name).startsWith(t + '_') && t.length >= MIN_SUBSTRING_LEN) s += 7;
    }
    if (s >= MIN_SCORE && (!bestProject || s > bestProject.score)) bestProject = { name, score: s };
  }
  if (bestProject) resolved.project = bestProject.name;

  // ---- 1b. infer the project from its own attributes/values -------------
  // "delhi" is a mandi_board_v1 state value, "fatehpur" an underthetable
  // district, "tip" a bhaiyaplease attribute. An unnamed project can still be
  // identified from the vocabulary it alone uses.
  if (!resolved.project) {
    let inferred = null;
    for (const [name, schema] of vocab.projectSchemas) {
      let s = 0;
      for (const t of tokens) {
        if (schema.attributes.has(t) || schema.attributes.has(singular(t))) s += 5;
        for (const vals of schema.values.values()) {
          if ([...vals].some((v) => norm(v) === t || norm(v) === singular(t))) { s += 6; break; }
        }
      }
      if (s > 0 && (!inferred || s > inferred.score)) inferred = { name, score: s };
    }
    if (inferred && inferred.score >= 8) resolved.project = inferred.name;
  }

  // ---- 2. discriminator: `entity_type` OR a bare `type`, per project ----
  // Most real projects discriminate on a bare `type` attribute, not
  // `entity_type` (measured live: `type` is 5.8× more common than `entity_type`).
  // Emitting `entity_type` against such a project is a silent zero.
  const pSchema = resolved.project ? vocab.projectSchemas.get(resolved.project) : null;
  const discAttr = pSchema?.discriminator ?? 'entity_type';
  const discPool = pSchema?.discriminatorValues?.length
    ? pSchema.discriminatorValues
    : [...vocab.entityTypes.keys()];

  let bestType = null;
  let unattestedTypeHint = null;
  for (const name of discPool) {
    let s = scoreName(name, tokens, phrase);
    // Multi-part discriminator values: 'votes' should match 'price_vote'.
    const parts = norm(name).split('_');
    if (parts.length > 1 && parts.some((p) => p.length >= 4 && tokens.some((t) => singular(t) === p))) s += 8;
    for (const t of tokens) {
      if (SYNONYMS_TYPE[t] && norm(SYNONYMS_TYPE[t]) === norm(name)) s += 10;
      if (norm(name) === singular(t)) s += 9;
    }
    if (s >= MIN_SCORE && (!bestType || s > bestType.score)) bestType = { name, score: s };
  }
  // A synonym may point at a type that is not attested. Report, never invent.
  if (!bestType && !pSchema) {
    for (const t of tokens) {
      const target = SYNONYMS_TYPE[t];
      if (target && !vocab.entityTypes.has(target)) { unattestedTypeHint = { token: t, target }; break; }
    }
  }
  if (bestType) resolved.entityType = bestType.name;
  resolved.discriminator = discAttr;

  // ---- 3. attributes ---------------------------------------------------
  const consumed = new Set([resolved.project, resolved.entityType].filter(Boolean).map(norm));
  // A token that resolved the namespace must not also become an attribute.
  for (const t of tokens) {
    const n = norm(t);
    if (resolved.project && (n === norm(resolved.project) || singular(n) === norm(resolved.project) ||
        (SYNONYMS_PROJECT[t] && norm(SYNONYMS_PROJECT[t]) === norm(resolved.project)))) consumed.add(n);
    if (resolved.entityType && (n === norm(resolved.entityType) || singular(n) === norm(resolved.entityType) ||
        (SYNONYMS_TYPE[t] && norm(SYNONYMS_TYPE[t]) === norm(resolved.entityType)))) consumed.add(n);
  }
  const picked = new Map();
  const knownValues = [];
  // Scope the attribute pool to the project's real schema, and to the resolved
  // discriminator value's OWN attribute set when known. Attributes from sibling
  // entity types must not leak in: in mandi_board_v1, `price` belongs to the 63
  // price-report entities, not to the 34 price_vote entities. Merging them
  // produced filters whose intersection was empty.
  const scoped = pSchema && resolved.entityType ? pSchema.byValue.get(resolved.entityType) : null;
  const poolSource = scoped?.attributes ?? pSchema?.attributes;
  const attrPool = poolSource
    ? [...poolSource.entries()].map(([name, types]) => [name, { observedTypes: [...types] }])
    : [...vocab.attributes.entries()];
  for (const [name, meta] of attrPool) {
    const n = norm(name);
    if (consumed.has(n)) continue;                       // already a namespace
    if (n === norm(discAttr)) continue;                  // discriminator handled above
    if (n.length < 3 && !tokens.includes(n)) continue;   // too short to be distinctive
    const s = scoreName(name, tokens, phrase);
    if (s >= MIN_SCORE) picked.set(name, { name, meta, score: s, source: 'literal-token' });
  }
  for (const t of tokens) {
    const target = SYNONYMS_ATTR[t];
    if (!target || !vocab.attributes.has(target)) continue;
    if (poolSource && !poolSource.has(target)) continue;  // not in this project/type
    if (consumed.has(norm(target))) continue;
    const prev = picked.get(target);
    picked.set(target, {
      name: target, meta: vocab.attributes.get(target),
      score: (prev?.score ?? 0) + 12, source: `synonym:${t}`,
    });
  }
  resolved.attributes = [...picked.values()].sort((a, b) => b.score - a.score);

  // ---- 3b. known values (attribute = str('literal') from the real data) --
  // 'potato' is a crop value, 'fatehpur' a district, 'delhi' a state. The
  // ontology carries the observed values, so these become equality predicates
  // rather than being dropped.
  const valueSource = scoped?.values ?? pSchema?.values;
  if (valueSource) {
    for (const [attr, vals] of valueSource) {
      if (norm(attr) === norm(discAttr)) continue;
      if (!poolSource.has(attr)) continue;
      for (const v of vals) {
        const nv = norm(v);
        if (nv.length < 3 || consumed.has(nv)) continue;
        if (tokens.includes(nv)) {
          knownValues.push({ attribute: attr, value: String(v) });
          consumed.add(nv);
          break;
        }
      }
    }
  }
  resolved.values = knownValues;

  // ---- 4. operator intent ---------------------------------------------
  const ops = INTENT_OPERATORS.filter((o) => o.match.test(phrase));
  const ordering = ops.find((o) => o.op === 'desc' || o.op === 'asc') ?? null;

  // ---- 5. build predicates --------------------------------------------
  const predicates = [];
  const projections = [];
  const addPred = (attribute, op, type, value, source) => {
    predicates.push({ attribute, op, type, literal: literal(type, value), source });
  };

  if (resolved.project) addPred('project', '=', 'str', resolved.project, 'namespace');
  if (resolved.entityType) addPred(discAttr, '=', 'str', resolved.entityType, 'namespace');
  for (const v of knownValues) addPred(v.attribute, '=', 'str', v.value, 'known-value');

  const rangeOp = ops.find((o) => ['gte', 'lte'].includes(o.op));
  for (const a of resolved.attributes.slice(0, 2)) {
    if (knownValues.some((v) => v.attribute === a.name)) continue; // already exact-matched
    const types = a.meta.observedTypes;
    const op = rangeOp?.op === 'lte' ? '<=' : '>=';
    const numeric = types.filter((t) => ['u64', 'u256', 'i32', 'dec'].includes(t));
    const isRange = Boolean(rangeOp) || Boolean(ordering);

    if (!isRange && !numeric.length && types.includes('str')) {
      const explicit = explicitStringValue(intent, a.name);
      if (explicit !== null) addPred(a.name, '=', 'str', explicit, a.source);
      else projections.push(a.name);
      continue;
    }
    const explicitNum = explicitNumber(intent);
    for (const t of numeric) {
      // A fractional literal cannot be stored in an integer cell.
      if (explicitNum && explicitNum.includes('.') && t !== 'dec') continue;
      addPred(a.name, op, t, explicitNum ?? '0', a.source);
    }
    if (numeric.length > 1) {
      disambiguation.push({
        attribute: a.name,
        observedTypes: numeric,
        strategy: 'widened-with-OR',
        note: `'${a.name}' was observed as ${numeric.join(' and ')}. A typed predicate matches only cells stored with that exact type, so the resolver widened across all observed types. Narrow it if you know the project's encoding.`,
      });
    }
  }

  // ---- 6. assemble -----------------------------------------------------
  const groupByAttr = new Map();
  for (const p of predicates) {
    if (!groupByAttr.has(p.attribute)) groupByAttr.set(p.attribute, []);
    groupByAttr.get(p.attribute).push(p);
  }
  const clauses = [];
  for (const [attr, ps] of groupByAttr) {
    if (ps.length === 1) clauses.push(`${attr} ${ps[0].op} ${ps[0].literal}`);
    else clauses.push(`(${ps.map((p) => `${attr} ${p.op} ${p.literal}`).join(' OR ')})`);
  }
  const expression = clauses.join(' AND ');

  // ---- 7. post-processing (Arkiv has no ORDER BY / aggregates) ---------
  let postProcessing = null;
  if (ordering) {
    const attr = resolved.attributes[0]?.name;
    postProcessing = {
      reason: 'Arkiv exposes no server-side ORDER BY and no aggregate API.',
      instruction: attr
        ? `Fetch every page in scope at one pinned block, then sort a copy client-side by '${attr}' ${ordering.op === 'desc' ? 'descending' : 'ascending'} and take N.`
        : 'Fetch every page in scope at one pinned block, then sort a copy client-side.',
      caveat: 'Sorting a single page cannot establish a global top-N.',
    };
  }

  // ---- 8. honest gaps --------------------------------------------------
  if (!resolved.project) {
    warnings.push({
      kind: 'unresolved-namespace',
      detail: `No project namespace matched. Attested projects (${vocab.projects.size}): ${[...vocab.projects.keys()].slice(0, 12).join(', ')}...`,
    });
  }
  if (!resolved.entityType) {
    if (pSchema?.discriminatorValues?.length) {
      warnings.push({
        kind: 'no-discriminator-match',
        detail: `No '${discAttr}' value matched the intent. Project '${resolved.project}' uses '${discAttr}' with observed values: ${pSchema.discriminatorValues.join(', ')}. The ontology will not invent one.`,
      });
    } else if (unattestedTypeHint) {
      warnings.push({
        kind: 'entity-type-not-attested',
        detail: `'${unattestedTypeHint.token}' implies entity_type '${unattestedTypeHint.target}', which is NOT attested on chain. The ontology will not invent it. Attested: ${[...vocab.entityTypes.keys()].join(', ')}.`,
      });
    } else {
      const candidates = tokens.filter((t) => t.length > 3);
      if (candidates.length) {
        warnings.push({
          kind: 'no-attested-entity-type',
          detail: `No attested entity_type matched ${JSON.stringify(candidates)}. The ontology will not invent one. Attested: ${[...vocab.entityTypes.keys()].join(', ')}.`,
        });
      }
    }
  }
  if (resolved.attributes.length === 0) {
    warnings.push({
      kind: 'no-attested-attribute',
      detail: 'No attested attribute matched the intent; the expression uses namespace scope only.',
    });
  }

  const validation = validate(expression);
  const confidence = resolved.project && resolved.entityType && resolved.attributes.length && validation.ok
    ? 'high'
    : resolved.project && validation.ok ? 'medium' : 'low';

  return {
    intent,
    expression,
    predicates,
    resolved: {
      project: resolved.project,
      entityType: resolved.entityType,
      discriminator: resolved.discriminator,
      attributes: resolved.attributes.map((a) => ({ name: a.name, observedTypes: a.meta.observedTypes, source: a.source })),
    },
    values: resolved.values,
    projections,
    disambiguation,
    warnings,
    postProcessing,
    validation,
    confidence,
    vocabMeta: vocab.meta,
  };
}
