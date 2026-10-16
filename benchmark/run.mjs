/**
 * Benchmark: markdown-only baseline (A) vs ontology resolver (B).
 *
 * Measures, per prompt:
 *   - grammar validity (does the emitted expression pass the contract?)
 *   - silent-zero risk (will it run and match nothing?)
 *   - live parse outcome and row count (via the cost-aware cached client)
 *   - guidance bytes the agent must consume (token-consumption proxy)
 *
 * Honest scope statement (repeated in the report):
 *   Condition A is a SIMULATED baseline derived from documented markdown-only
 *   failure modes, not a live LLM sample. Condition B is the real resolver.
 *   Both are executed against the same live RPC, so the parse/row outcomes are
 *   measured, while the baseline's expression TEXT is simulated.
 *
 * Usage: node benchmark/run.mjs
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadVocabulary } from '../src/vocab.mjs';
import { resolve } from '../src/resolve.mjs';
import { validate } from '../src/grammar.mjs';
import { createClient, BudgetExhausted } from '../src/rpc.mjs';
import { PROMPTS, BASELINE_STYLE_NOTES } from '../src/baseline.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const vocab = await loadVocabulary();
const client = createClient({ paceMs: 2000 });

/** Bytes of prose an agent must read to act without the ontology. */
async function baselineGuidanceBytes() {
  const candidates = [
    path.join(ROOT, '..', 'arkiv-skills', 'skills', 'arkiv', 'SKILL.md'),
    path.join(ROOT, '..', 'arkiv-skills', 'skills', 'arkiv-query', 'SKILL.md'),
    path.join(ROOT, '..', 'arkiv-skills', 'skills', 'arkiv-query', 'references', 'json-rpc.md'),
    path.join(ROOT, '..', 'arkiv-skills', 'skills', 'arkiv-data-modeling', 'SKILL.md'),
  ];
  let total = 0;
  const files = [];
  for (const f of candidates) {
    try { total += (await stat(f)).size; files.push(path.basename(path.dirname(f)) + '/' + path.basename(f)); }
    catch { /* not installed */ }
  }
  return { bytes: total, files };
}

async function probeLive(expression) {
  if (!expression?.trim()) return { outcome: 'no-expression' };
  try {
    const page = await client.query(expression, { limit: 5 });
    const rows = page.data?.length ?? 0;
    return { outcome: rows > 0 ? 'rows' : 'silent-zero', rows, hasCursor: Boolean(page.cursor) };
  } catch (e) {
    if (e instanceof BudgetExhausted) return { outcome: 'budget-exhausted', retryAfter: e.retryAfter };
    return { outcome: 'parse-error', code: e.code, message: e.message };
  }
}

const guidance = await baselineGuidanceBytes();
const rows = [];

for (const p of PROMPTS) {
  // ---- Condition A: markdown-only baseline --------------------------
  const aVal = validate(p.baseline);
  const aLive = await probeLive(p.baseline);

  // ---- Condition B: ontology resolver -------------------------------
  const r = resolve(p.intent, vocab);
  const bVal = r.validation;
  const bLive = await probeLive(r.expression);

  const bGuidanceBytes = Buffer.byteLength(JSON.stringify({
    expression: r.expression, resolved: r.resolved, disambiguation: r.disambiguation,
  }), 'utf8');

  rows.push({
    id: p.id,
    intent: p.intent,
    A: {
      condition: 'markdown-only (simulated)',
      expression: p.baseline,
      grammarValid: aVal.ok,
      violations: aVal.violations.map((v) => `${v.kind}:${v.id}`),
      silentZeroRisk: aVal.violations.some((v) => v.kind === 'silent-zero'),
      live: aLive,
      expressionBytes: Buffer.byteLength(p.baseline, 'utf8'),
    },
    B: {
      condition: 'ontology (ontoskill)',
      expression: r.expression,
      grammarValid: bVal.ok,
      violations: bVal.violations.map((v) => `${v.kind}:${v.id}`),
      silentZeroRisk: bVal.violations.some((v) => v.kind === 'silent-zero'),
      live: bLive,
      confidence: r.confidence,
      disambiguation: r.disambiguation.length,
      warnings: r.warnings.map((w) => w.kind),
      expressionBytes: Buffer.byteLength(r.expression, 'utf8'),
      guidanceBytes: bGuidanceBytes,
    },
  });
  process.stderr.write(`  ${p.id} A=${aLive.outcome} B=${bLive.outcome}\n`);
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const n = rows.length;
const sum = (f) => rows.reduce((a, r) => a + f(r), 0);

const summary = {
  prompts: n,
  baselineIsSimulated: true,
  guidanceBytes: guidance,
  A: {
    grammarValidRate: pct(rows.filter((r) => r.A.grammarValid).length, n),
    silentZeroRate: pct(rows.filter((r) => r.A.silentZeroRisk).length, n),
    liveRowsRate: pct(rows.filter((r) => r.A.live.outcome === 'rows').length, n),
    parseErrorRate: pct(rows.filter((r) => r.A.live.outcome === 'parse-error').length, n),
    totalExpressionBytes: sum((r) => r.A.expressionBytes),
  },
  B: {
    grammarValidRate: pct(rows.filter((r) => r.B.grammarValid).length, n),
    silentZeroRate: pct(rows.filter((r) => r.B.silentZeroRisk).length, n),
    liveRowsRate: pct(rows.filter((r) => r.B.live.outcome === 'rows').length, n),
    parseErrorRate: pct(rows.filter((r) => r.B.live.outcome === 'parse-error').length, n),
    totalExpressionBytes: sum((r) => r.B.expressionBytes),
    totalGuidanceBytes: sum((r) => r.B.guidanceBytes),
  },
  budgetExhausted: rows.filter((r) => r.A.live.outcome === 'budget-exhausted' || r.B.live.outcome === 'budget-exhausted').length,
  rpcStats: client.stats,
};

await writeFile(path.join(ROOT, 'benchmark', 'results.json'), JSON.stringify({ summary, rows, baselineStyleNotes: BASELINE_STYLE_NOTES }, null, 2));

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 2));
console.log('\n=== PER PROMPT ===');
for (const r of rows) {
  console.log(`${r.id}  A[${r.A.grammarValid ? 'valid' : 'INVALID'} ${r.A.live.outcome}]  B[${r.B.grammarValid ? 'valid' : 'INVALID'} ${r.B.live.outcome}]  ${r.intent}`);
  console.log(`     A: ${r.A.expression}`);
  console.log(`     B: ${r.B.expression || '(refused: no attested filter)'}`);
}
