/**
 * Condition A: the "markdown-only agent" baseline.
 *
 * This is a SIMULATED baseline, and the report says so plainly. It is not a
 * live LLM call. It encodes the documented failure modes of resolving an
 * intent by reading prose documentation alone — the exact patterns the Arkiv
 * markdown skill does not warn against:
 *
 *   - SQL/C-style operators (&&, ||, !) that the node removed
 *   - double-quoted string literals instead of str('x')
 *   - bool(true) instead of the bare literal
 *   - camelCase attribute names, which parse on read and can never match
 *   - invented attribute names with no on-chain attestation
 *   - bare decimal literals instead of dec(4.5)
 *   - LIKE for prefix matching instead of infix STARTSWITH
 *   - subqueries (IN (SELECT ...))
 *   - `entity_type` as the discriminator, when most real projects use `type`
 *
 * Each baseline expression is paired with the ontology condition's semantic
 * target for the SAME prompt, so the comparison isolates rendering grammar and
 * attestation — not intent.
 *
 * The plan's own example expression is prompt b1, verbatim. It is a genuine
 * artefact of the markdown-only approach rather than a straw man.
 */

export const BASELINE_STYLE_NOTES = [
  'SQL/C-style operators && || ! (removed from the language)',
  'double-quoted string literals',
  'bool(true) wrapper',
  'camelCase attribute names (parse on read, can never match)',
  'attribute names with no on-chain attestation',
  'bare decimal literals',
  'LIKE instead of infix STARTSWITH',
  'IN (SELECT ...) subqueries',
  'entity_type as the discriminator (most real projects use `type`)',
];

/**
 * Render an intent the way a markdown-only agent typically would.
 * Deterministic and mechanical: same semantic target, naive rendering.
 * Notably it reaches for `entity_type`, which is the discriminator the
 * documentation implies and which most real projects do not use.
 */
export function baselineRender(spec) {
  const parts = [];
  if (spec.project) parts.push(`project = "${spec.project}"`);
  if (spec.entityType) parts.push(`entity_type = "${spec.entityType}"`);
  for (const a of spec.attributes ?? []) {
    if (a.kind === 'range') parts.push(`${a.name} >= ${a.value ?? 0}`);
    else if (a.kind === 'bool') parts.push(`${a.name} = bool(true)`);
    else if (a.kind === 'prefix') parts.push(`LIKE(${a.name}, "${a.value}%")`);
    else if (a.kind === 'ne') parts.push(`${a.name} != "${a.value}"`);
    else parts.push(`${a.name} = "${a.value ?? ''}"`);
  }
  return parts.join(' && ');
}

/**
 * Ten benchmark prompts over the real anchor vocabulary.
 *
 * b1 is the plan's original example and is expected to fail on both sides
 * (its schema does not exist on chain). b2-b10 target the three captured
 * namespaces, so Condition B is expected to return real rows.
 */
export const PROMPTS = [
  {
    id: 'b1',
    intent: 'Find expert mentors for account abstraction',
    note: "The original build plan's own example expression, verbatim. Targets a schema that does not exist on chain.",
    baseline: '(reputationScore >= 4.5 || id IN (SELECT wallet FROM Cert WHERE level = "Expert")) && type = "Profile" && is_mentor = true',
    spec: { project: null, entityType: 'Profile', attributes: [{ name: 'is_mentor', kind: 'bool' }, { name: 'reputationScore', kind: 'range', value: 4.5 }] },
  },
  {
    id: 'b2',
    intent: 'mandi potato price votes',
    baseline: baselineRender({ project: 'mandi_board_v1', entityType: 'price_vote', attributes: [{ name: 'crop', kind: 'eq', value: 'potato' }, { name: 'price', kind: 'range', value: 0 }] }),
    spec: { project: 'mandi_board_v1', entityType: 'price_vote' },
  },
  {
    id: 'b3',
    intent: 'highest price crops in delhi',
    baseline: baselineRender({ project: 'mandi_board_v1', entityType: 'price_vote', attributes: [{ name: 'state', kind: 'eq', value: 'delhi' }, { name: 'price', kind: 'range', value: 0 }] }),
    spec: { project: 'mandi_board_v1', entityType: 'price_vote' },
  },
  {
    id: 'b4',
    intent: 'food diversion reports in fatehpur',
    baseline: baselineRender({ project: 'underthetable', entityType: 'report', attributes: [{ name: 'district', kind: 'eq', value: 'fatehpur' }] }),
    spec: { project: 'underthetable', entityType: 'report' },
  },
  {
    id: 'b5',
    intent: 'delivery receipts with a tip over 10',
    baseline: baselineRender({ project: 'bhaiyaplease', entityType: 'receipt', attributes: [{ name: 'tip', kind: 'range', value: 10 }] }),
    spec: { project: 'bhaiyaplease', entityType: 'receipt' },
  },
  {
    id: 'b6',
    intent: 'mandi onion prices',
    baseline: baselineRender({ project: 'mandi_board_v1', entityType: 'price_vote', attributes: [{ name: 'crop', kind: 'eq', value: 'onion' }, { name: 'price', kind: 'range', value: 0 }] }),
    spec: { project: 'mandi_board_v1', entityType: 'price_vote' },
  },
  {
    id: 'b7',
    intent: 'reports from fatehpur',
    baseline: baselineRender({ project: 'underthetable', entityType: 'report', attributes: [{ name: 'district', kind: 'eq', value: 'fatehpur' }] }),
    spec: { project: 'underthetable', entityType: 'report' },
  },
  {
    id: 'b8',
    intent: 'delivery receipts in tdr3c1',
    baseline: baselineRender({ project: 'bhaiyaplease', entityType: 'receipt', attributes: [{ name: 'zone', kind: 'eq', value: 'tdr3c1' }] }),
    spec: { project: 'bhaiyaplease', entityType: 'receipt' },
  },
  {
    id: 'b9',
    intent: 'mandi tomato price votes',
    baseline: baselineRender({ project: 'mandi_board_v1', entityType: 'price_vote', attributes: [{ name: 'crop', kind: 'eq', value: 'tomato' }, { name: 'price', kind: 'range', value: 0 }] }),
    spec: { project: 'mandi_board_v1', entityType: 'price_vote' },
  },
  {
    id: 'b10',
    intent: 'receipts with a tip over 20',
    baseline: baselineRender({ project: 'bhaiyaplease', entityType: 'receipt', attributes: [{ name: 'tip', kind: 'range', value: 20 }] }),
    spec: { project: 'bhaiyaplease', entityType: 'receipt' },
  },
];
