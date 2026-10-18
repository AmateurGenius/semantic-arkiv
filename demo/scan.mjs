#!/usr/bin/env node
/**
 * Demo segment 2 — what is actually on chain.
 *
 * Two sources, and the on-screen labels say which is which:
 *
 *   [live] entities on Tiramisu. `$createdAt >= u64(0)` is the one filter that
 *          matches every entity, so its count IS the whole chain. Counts are
 *          not cost-metered (Arkiv-Cost 0 on every probe), so this is a free
 *          live read. The chain is under active write load, so the number
 *          moves during a take — the drift is the finding, not a bug.
 *
 *   [walk] the vocabulary figures, derived from data/global-vocabulary.json —
 *          a 5,773-row walk of the live chain (48 pages). These are sample
 *          statistics: only a full re-walk refreshes them, and they describe
 *          the sample, not the current chain.
 *
 * Every figure is derived from the committed artifact, never hardcoded, so a
 * rebuild of the vocabulary moves the on-screen numbers with it.
 *
 *   node demo/scan.mjs             live total + walk vocabulary
 *   node demo/scan.mjs --cached    total from the last observed probe
 */
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createClient } from '../src/rpc.mjs';

const ROOT = new URL('..', import.meta.url);
const ROOT_PATH = ROOT.pathname.replace(/\/$/, '');

const v = JSON.parse(await readFile(new URL('data/global-vocabulary.json', ROOT), 'utf8'));
const attrCount = Object.keys(v.attributes).length;
const ambiguous = Object.values(v.attributes).filter((a) => a.observedTypes.length > 1).length;

// the walk's own capture date, when the vocabulary carries one
let walkedOn = '';
if (v.probedAt) {
  walkedOn = v.probedAt.slice(0, 10);
} else {
  try {
    walkedOn = execFileSync('git', ['log', '-1', '--format=%cs', '--', 'data/global-vocabulary.json'], {
      cwd: ROOT_PATH, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { /* not a git checkout — omit the date */ }
}
const walk = `${v.walkedRows.toLocaleString()}-row walk${walkedOn ? `, ${walkedOn}` : ''}`;
const live = (x) => x.toLocaleString();

// Distinguish project-affiliated rows from the unaffiliated chain sample.
// walkedRows counts only entities in known projects; the unaffiliated sample
// is reported separately so the label is honest about coverage.
const unaffiliated = Object.values(v.projects).reduce((a, b) => a + b, 0) - v.walkedRows;
const coverageNote = unaffiliated > 0 ? ` (+${unaffiliated.toLocaleString()} unaffiliated sample)` : '';

let total = null;
if (!process.argv.includes('--cached')) {
  for (let attempt = 0; attempt < 3 && total === null; attempt++) {
    try {
      total = await createClient({ useCache: false, paceMs: 0 }).count('$createdAt >= u64(0)');
    } catch { /* retry once, then fall through to the label */ }
  }
}
const how = total === null
  ? (process.argv.includes('--cached') ? 'no live read (LIVE=0)' : 'unavailable')
  : 'live';
const shown = total === null ? 'n/a' : live(total);

console.log('');
console.log(`  entities on Tiramisu     ${shown.padStart(7)}   [${how}]`);
console.log(`  project namespaces       ${String(Object.keys(v.projects).length).padStart(7)}   [${walk}]`);
console.log(`  distinct entity types    ${String(v.entityTypes ? Object.keys(v.entityTypes).length : 'n/a').padStart(7)}   [${walk}]`);
console.log(`  distinct attribute names ${live(attrCount + v.baseloadNoiseCount).padStart(7)}   [${walk}]`);
console.log(`     real, load-generator-free  ${String(attrCount).padStart(7)}`);
console.log(`     load-generator noise        ${live(v.baseloadNoiseCount).padStart(7)}`);
console.log(`  attribute names carrying ${String(ambiguous).padStart(2)} types   [${walk}]`);
console.log('');
console.log(`  type          observed ${live(v.attributes.type.observations)} times   [${walk}]`);
console.log(`  entity_type   observed ${String(v.attributes.entity_type.observations).padStart(6)} times   [${walk}]`);
console.log('');
