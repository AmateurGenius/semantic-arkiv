/**
 * Resolver demo / smoke test.
 * Prints the full resolution for a set of intents so behaviour is inspectable.
 *
 * Usage: node scripts/demo.mjs ["custom intent"]
 */
import { loadVocabulary } from '../src/vocab.mjs';
import { resolve } from '../src/resolve.mjs';

const INTENTS = [
  'Show me the highest-volume mandi listings',
  'recent receipts',
  'find expert mentors for account abstraction',
  'highest price crops by district',
  'list bookings',
];

const vocab = await loadVocabulary();
console.log(`vocabulary: ${vocab.meta.counts.realAttributes} attributes, ` +
  `${vocab.meta.counts.distinctProjects} projects, ` +
  `${vocab.meta.counts.distinctEntityTypes} entity types, ` +
  `ttlConsistent=${vocab.meta.ttlConsistent}`);
console.log('');

const list = process.argv[2] ? [process.argv[2]] : INTENTS;
for (const intent of list) {
  const r = resolve(intent, vocab);
  console.log('='.repeat(72));
  console.log(`INTENT      ${intent}`);
  console.log(`EXPRESSION  ${r.expression || '(none)'}`);
  console.log(`CONFIDENCE  ${r.confidence}   grammarValid=${r.validation.ok}`);
  console.log(`PROJECT     ${r.resolved.project ?? '-'}`);
  console.log(`ENTITY_TYPE ${r.resolved.entityType ?? '-'}`);
  console.log(`ATTRIBUTES  ${r.resolved.attributes.map((a) => `${a.name}[${a.observedTypes.join('|')}]`).join(', ') || '-'}`);
  if (r.disambiguation.length) {
    for (const d of r.disambiguation) console.log(`AMBIGUITY   ${d.attribute}: ${d.observedTypes.join('|')} -> ${d.strategy}`);
  }
  for (const w of r.warnings) console.log(`WARNING     [${w.kind}] ${w.detail}`);
  if (r.postProcessing) console.log(`POST        ${r.postProcessing.instruction}`);
  if (!r.validation.ok) {
    for (const v of r.validation.violations) console.log(`VIOLATION   [${v.kind}] ${v.node}`);
  }
  console.log('');
}
