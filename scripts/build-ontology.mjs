/**
 * Compile the captured live vocabulary into a Turtle (OWL 2) ontology plus
 * SHACL shapes constraining emitted filter expressions.
 *
 * Input : data/global-vocabulary.json  (from a real 45-page walk of Tiramisu)
 *         src/grammar.mjs             (empirically established grammar contract)
 * Output: ontology/arkiv-vocab.ttl
 *         ontology/arkiv-grammar.shacl.ttl
 *         ontology/stats.json
 *
 * Every emitted triple is traceable to an observation count captured live.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REJECTIONS, ACCEPTED, NAME_GRAMMAR, NETWORK } from '../src/grammar.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'ontology');

/** Escape for a Turtle double-quoted string. Backslash FIRST, then quote. */
const ttlStr = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const esc = ttlStr;
const local = (s) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, 'n$1');

async function main() {
  await mkdir(OUT, { recursive: true });
  const v = JSON.parse(await readFile(path.join(ROOT, 'data', 'global-vocabulary.json'), 'utf8'));

  const T = [];
  T.push(`@prefix arkiv:  <https://semantic-arkiv.dev/ontology/arkiv#> .`);
  T.push(`@prefix arkv:  <https://semantic-arkiv.dev/ontology/arkiv/vocab#> .`);
  T.push(`@prefix skos:  <http://www.w3.org/2004/02/skos/core#> .`);
  T.push(`@prefix owl:   <http://www.w3.org/2002/07/owl#> .`);
  T.push(`@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .`);
  T.push(`@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .`);
  T.push(`@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .`);
  T.push(`@prefix dct:   <http://purl.org/dc/terms/> .`);
  T.push('');

  // ---- ontology header -------------------------------------------------
  T.push(`arkv:ArkivVocabularyOntology a owl:Ontology ;`);
  T.push(`    dct:title "Arkiv Vocabulary Ontology" ;`);
  T.push(`    dct:description "A live-derived catalogue of the Arkiv Tiramisu entity vocabulary. Every individual is traceable to an observation captured by a real arkiv_query walk." ;`);
  T.push(`    owl:versionInfo "1.0.0" ;`);
  T.push(`    dct:source <${NETWORK.rpc}> ;`);
  T.push(`    dct:created "${new Date().toISOString().slice(0, 10)}"^^xsd:date ;`);
  T.push(`    arkiv:chainId ${NETWORK.chainId} ;`);
  T.push(`    arkiv:sdkVersion ${esc(NETWORK.sdk)} ;`);
  T.push(`    arkiv:derivedFrom "live-tiramisu-scan" ;`);
  T.push(`    arkiv:observedRows ${v.walkedRows} ;`);
  T.push(`    arkiv:observedProjects ${v.counts.distinctProjects} ;`);
  T.push(`    arkiv:observedEntityTypes ${v.counts.distinctEntityTypes} ;`);
  T.push(`    arkiv:observedAttributes ${v.counts.realAttributes} ;`);
  T.push(`    arkiv:observedAmbiguousAttributes ${v.counts.ambiguousAttributes} .`);
  T.push('');

  // ---- classes ---------------------------------------------------------
  for (const [c, d] of [
    ['Project', 'An Arkiv project namespace (the `project` attribute value).'],
    ['EntityType', 'A discovered `entity_type` value.'],
    ['Attribute', 'A discovered application attribute name.'],
    ['AmbiguousAttribute', 'An attribute name observed carrying more than one Arkiv type across projects.'],
    ['GrammarRule', 'A syntax rule the node enforces, established by live probe.'],
    ['GrammarRejection', 'A syntax construct the node rejects, with its error code and message.'],
  ]) {
    T.push(`arkiv:${c} a owl:Class ; rdfs:comment ${esc(d)} .`);
  }
  T.push('');

  // ---- grammar rejections (the crown jewels) ---------------------------
  T.push('# ===== Grammar rejections (empirically confirmed) =====');
  for (const r of REJECTIONS) {
    T.push(`arkv:rule_${local(r.id)} a arkiv:GrammarRejection ;`);
    T.push(`    rdfs:label ${esc(r.id)} ;`);
    T.push(`    arkiv:nodeErrorCode ${r.code} ;`);
    T.push(`    arkiv:nodeMessage ${esc(r.node)} ;`);
    T.push(`    arkiv:rationale ${esc(r.why)} .`);
  }
  T.push('');

  // ---- grammar acceptances --------------------------------------------
  T.push('# ===== Accepted forms =====');
  T.push(`arkv:rule_boolean_keywords a arkiv:GrammarRule ; rdfs:label "boolean keywords" ;`);
  T.push(`    arkiv:emits ${esc(ACCEPTED.booleanKeywords.join(' / '))} ;`);
  T.push(`    arkiv:rationale "Symbol operators && || ~ were removed from the language." .`);
  T.push(`arkv:rule_startswith_infix a arkiv:GrammarRule ; rdfs:label "STARTSWITH is infix" ;`);
  T.push(`    arkiv:emits ${esc(ACCEPTED.stringMatch)} ;`);
  T.push(`    arkiv:rationale "The function form STARTSWITH(a, str('x')) is rejected with -32001." .`);
  for (const [t, form] of Object.entries(ACCEPTED.literals)) {
    T.push(`arkv:literal_${local(t)} a arkiv:GrammarRule ; rdfs:label ${esc(`${t} literal`)} ;`);
    T.push(`    arkiv:emits ${esc(form)} .`);
  }
  T.push(`arkv:rule_name_grammar a arkiv:GrammarRule ; rdfs:label "attribute name grammar" ;`);
  T.push(`    arkiv:emits ${esc(NAME_GRAMMAR.note)} ;`);
  T.push(`    arkiv:rationale "camelCase and UPPERCASE names PARSE on the read path and return count=0, but the write path rejects them ('outside the name charset', Ident32InvalidByte 0x276f7798). Such a name can never match a stored cell." .`);
  T.push(`arkv:rule_silent_zero a arkiv:GrammarRule ; rdfs:label "silent-zero trap" ;`);
  T.push(`    arkiv:rationale "A query using an uppercase attribute name, or a bare numeric literal against a u64/u256/dec cell, SUCCEEDS and returns an empty set with no error. This is worse than a parse failure." .`);
  T.push('');

  // ---- projects --------------------------------------------------------
  T.push('# ===== Observed project namespaces =====');
  for (const [p, n] of Object.entries(v.projects)) {
    T.push(`arkv:project_${local(p)} a arkiv:Project ;`);
    T.push(`    arkiv:canonicalName ${esc(p)} ;`);
    T.push(`    arkiv:observationCount ${n} .`);
  }
  T.push('');

  // ---- entity types ----------------------------------------------------
  T.push('# ===== Observed entity types =====');
  for (const [e, n] of Object.entries(v.entityTypes)) {
    T.push(`arkv:type_${local(e)} a arkiv:EntityType ;`);
    T.push(`    arkiv:canonicalName ${esc(e)} ;`);
    T.push(`    arkiv:observationCount ${n} .`);
  }
  T.push('');

  // ---- anchor namespaces: the real per-type discriminator structure ----
  const anchorPath = path.join(ROOT, 'data', 'anchor-schemas.json');
  if (existsSync(anchorPath)) {
    const anchor = JSON.parse(await readFile(anchorPath, 'utf8'));
    T.push('# ===== Anchor namespaces: real discriminator structure =====');
    T.push('# `type` is the conventional discriminator (5425 observations on a');
    T.push('# 9000-row walk) far more often than `entity_type` (185). Attributes');
    T.push('# are scoped per (project, type-value) pair, not per project.');
    for (const [project, s] of Object.entries(anchor.projects ?? {})) {
      T.push(`arkv:ns_${local(project)} a arkiv:Project ;`);
      T.push(`    arkiv:canonicalName ${esc(project)} ;`);
      T.push(`    arkiv:discriminator ${esc(s.discriminator ?? 'entity_type')} ;`);
      T.push(`    arkiv:observationCount ${s.entityCount} .`);
      for (const et of s.entityTypes ?? []) {
        T.push(`arkv:nsType_${local(project)}_${local(et.entityType)} a arkiv:EntityType ;`);
        T.push(`    arkiv:belongsToProject ${esc(project)} ;`);
        T.push(`    arkiv:canonicalName ${esc(et.entityType)} ;`);
        T.push(`    arkiv:observationCount ${et.count} ;`);
        T.push(`    arkiv:attributeName ${(et.attributes ?? []).map((a) => esc(a.name)).join(', ')} .`);
      }
    }
    T.push('');
  }

  // ---- attributes ------------------------------------------------------
  T.push('# ===== Observed attributes =====');
  let ambCount = 0;
  for (const [name, a] of Object.entries(v.attributes)) {
    const ambiguous = a.observedTypes.length > 1;
    if (ambiguous) ambCount++;
    T.push(`arkv:attr_${local(name)} a ${ambiguous ? 'arkiv:AmbiguousAttribute' : 'arkiv:Attribute'} ;`);
    T.push(`    arkiv:canonicalName ${esc(name)} ;`);
    T.push(`    arkiv:observationCount ${a.observations} ;`);
    T.push(`    arkiv:observedType ${a.observedTypes.map((t) => esc(t)).join(', ')} ;`);
    if (ambiguous) {
      T.push(`    arkiv:requiresDisambiguation true ;`);
      T.push(`    arkiv:rationale "A typed predicate matches only cells stored with that exact type, so a single-type filter silently misses the other projects." ;`);
    }
    T.push(`    arkiv:nameGrammarValid ${NAME_GRAMMAR.pattern.test(name)} .`);
  }
  T.push('');

  await writeFile(path.join(OUT, 'arkiv-vocab.ttl'), T.join('\n'));

  // ---- SHACL shapes ----------------------------------------------------
  // Patterns are written as XSD regex sources and escaped into Turtle by ttlStr.
  // Written as sh:not [ sh:pattern ... ] so a match is a VIOLATION.
  const forbids = [
    ['"', 'Expression must not contain a double quote: Arkiv string literals are str(\'x\').'],
    ['&&', 'Symbol operator && was removed. Use AND.'],
    ['\\|\\|', 'Symbol operator || was removed. Use OR.'],
    ['~', 'Symbol operator ~ was removed.'],
    ['EXISTS\\s*\\(', 'EXISTS is rejected by the node (-32002).'],
    ['TYPEOF\\s*\\(', 'TYPEOF is rejected by the node (-32002).'],
    ['LIKE\\b', 'No SQL LIKE. Prefix matching is STARTSWITH.'],
    ['STARTSWITH\\s*\\(', 'STARTSWITH is infix only: attr STARTSWITH str(\'x\').'],
    ['bool\\s*\\(', 'bool() takes no wrapper: write the literal true or false.'],
    ['dec\\s*\\(\\s*\'', 'dec() takes bare digits: dec(4.5), never dec(\'4.5\').'],
    ['[A-Za-z_][A-Za-z0-9_]*\\s*(=|>=|<=|>|<)\\s*\\d+\\.\\d+', 'Bare decimal literals are rejected. Use dec(4.5).'],
  ];

  const S = [];
  S.push(`@prefix sh:   <http://www.w3.org/ns/shacl#> .`);
  S.push(`@prefix arkiv: <https://semantic-arkiv.dev/ontology/arkiv#> .`);
  S.push(`@prefix xsd:  <http://www.w3.org/2001/XMLSchema#> .`);
  S.push('');
  S.push(`# Shapes constraining any Arkiv filter expression emitted by the resolver.`);
  S.push(`# Violating one of these yields a query that either errors (-32001/-32002) or,`);
  S.push(`# worse, succeeds and silently returns nothing.`);
  S.push(`#`);
  S.push(`# Every sh:not pattern below was confirmed against the live Tiramisu node.`);
  S.push('');
  S.push(`arkiv:EmittedFilterShape a sh:NodeShape ;`);
  S.push(`    sh:targetClass arkiv:EmittedFilter ;`);
  S.push(`    sh:property [`);
  S.push(`        sh:path arkiv:expression ;`);
  S.push(`        sh:datatype xsd:string ;`);
  S.push(`        sh:minCount 1 ;`);
  S.push(`        sh:message ${ttlStr('An emitted filter must carry an expression string.')}`);
  S.push(`    ] ;`);
  forbids.forEach(([rx, msg], i) => {
    S.push(`    sh:not [`);
    S.push(`        sh:pattern ${ttlStr(rx)} ;`);
    S.push(`        sh:message ${ttlStr(msg)}`);
    S.push(`    ]${i === forbids.length - 1 ? ' .' : ' ;'}`);
  });
  S.push('');
  S.push(`# The silent-zero shape: an emitted predicate whose attribute name can never match.`);
  S.push(`arkiv:EmittedPredicateShape a sh:NodeShape ;`);
  S.push(`    sh:targetClass arkiv:EmittedPredicate ;`);
  S.push(`    sh:property [`);
  S.push(`        sh:path arkiv:attributeName ;`);
  S.push(`        sh:pattern ${ttlStr('^[a-z][a-z0-9_]*$')} ;`);
  S.push(`        sh:maxLength 32 ;`);
  S.push(`        sh:message ${ttlStr('Attribute names must be lowercase snake_case (<=32 bytes). Uppercase names parse on read but can never match a stored cell: the write path rejects them.')}`);
  S.push(`    ] ;`);
  S.push(`    sh:property [`);
  S.push(`        sh:path arkiv:requiresDisambiguation ;`);
  S.push(`        sh:maxCount 0 ;`);
  S.push(`        sh:severity sh:Warning ;`);
  S.push(`        sh:message ${ttlStr('This attribute carries multiple observed types. Emit an explicit type constructor or widen with OR across the observed types.')}`);
  S.push(`    ] .`);
  await writeFile(path.join(OUT, 'arkiv-grammar.shacl.ttl'), S.join('\n'));

  await writeFile(path.join(OUT, 'stats.json'), JSON.stringify({
    triples: T.filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('@')).length,
    shaclLines: S.length,
    projects: Object.keys(v.projects).length,
    entityTypes: Object.keys(v.entityTypes).length,
    attributes: Object.keys(v.attributes).length,
    ambiguousAttributes: ambCount,
    grammarRejections: REJECTIONS.length,
    shaclConstraints: forbids.length + 3,
    source: v.source,
  }, null, 2));

  console.log(`ontology/arkiv-vocab.ttl          ${T.length} lines`);
  console.log(`ontology/arkiv-grammar.shacl.ttl  ${S.length} lines`);
  console.log(`projects=${Object.keys(v.projects).length} entityTypes=${Object.keys(v.entityTypes).length} attributes=${Object.keys(v.attributes).length} ambiguous=${ambCount}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
