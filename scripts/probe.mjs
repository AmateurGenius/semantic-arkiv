/**
 * Scoped live probe of the Arkiv Tiramisu RPC.
 *
 * Purpose: extract the REAL per-namespace vocabulary for a small set of anchor
 * projects, and cache every RPC response to disk so later stages (ontology
 * build, benchmark) replay offline and never re-hit HTTP 429.
 *
 * Read-only. No mutation is broadcast. No access key required for reads.
 *
 * Usage: node scripts/probe.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const RPC = 'https://rpc.tiramisu.db-chain.testnet.arkiv.network';
// Built per-call so the access key is read from the environment at request
// time. A module-level constant here silently falls back to the anonymous tier
// even when ARKIV_ACCESS_KEY is exported.
const HEADERS = () => ({
  'content-type': 'application/json',
  'user-agent': 'semantic-arkiv-probe/1.0.0',
  ...(process.env.ARKIV_ACCESS_KEY ? { 'x-api-key': process.env.ARKIV_ACCESS_KEY } : {}),
});
const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'rpc-cache');
const DATA_DIR = path.join(ROOT, 'data');

// Anchor namespaces. mandi_board_v1 is the primary (Indian agri-market track);
// the other two give contrast for cross-project type ambiguity.
const ANCHORS = ['mandi_board_v1', 'underthetable', 'bhaiyaplease'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let rpcCalls = 0;
const cacheLog = [];

async function rpc(method, params, { retries = 6 } = {}) {
  // Hash the FULL params. A truncated prefix collides: every query expression
  // begins with `["project = str('`, so a short prefix maps distinct queries
  // onto one cache entry and silently returns the wrong project's rows.
  const key = `${method}-${createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 32)}`;
  const cached = path.join(CACHE_DIR, `${key}.json`);
  if (existsSync(cached)) {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(cached, 'utf8'));
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: HEADERS(),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    rpcCalls++;
    if (res.status === 429) {
      const wait = Math.min(30_000, 1500 * 2 ** attempt);
      process.stderr.write(`  429 rate limited -> backoff ${wait}ms\n`);
      await sleep(wait);
      continue;
    }
    const body = await res.json();
    if (body.error) {
      const e = new Error(body.error.message);
      e.code = body.error.code;
      e.data = body.error.data;
      throw e;
    }
    await writeFile(cached, JSON.stringify(body.result));
    cacheLog.push(key);
    await sleep(1500); // global pacing: stay well under the provider rate limit
    return body.result;
  }
  throw new Error(`rate limited after ${retries} retries: ${method}`);
}

const SELECT = {
  key: true,
  creator: true,
  createdAt: true,
  expiresAt: true,
  contentType: true,
  attributes: true,
};

/** Walk every page of a scoped query at a pinned block. */
async function fetchAll(expr, { pageSize = 200, maxPages = 20 } = {}) {
  const snapshot = await rpc('eth_blockNumber', []);
  const rows = [];
  let cursor;
  let pages = 0;
  for (;;) {
    if (pages >= maxPages) throw new Error('page budget exhausted');
    const opts = { atBlock: snapshot, select: SELECT, limit: `0x${pageSize.toString(16)}` };
    if (cursor) opts.cursor = cursor;
    const page = await rpc('arkiv_query', [expr, opts]);
    pages++;
    rows.push(...(page.data ?? []));
    cursor = page.cursor;
    if (!cursor) break;
    await sleep(250);
  }
  return { snapshot, rows, pages };
}

/** Collapse a flat row list into a per-entity_type vocabulary map. */
function buildSchema(project, rows) {
  const byType = new Map();
  const discNames = new Set();
  for (const r of rows) {
    const attrs = Object.fromEntries((r.attributes ?? []).map((a) => [a.name, a]));
    // Group by the REAL discriminator. Most projects use a bare `type`
    // attribute; grouping only on `entity_type` merges distinct logical
    // entity types into one bucket and conflates their attribute sets.
    // Confirmed live: mandi_board_v1 reported 97 untyped entities and merged
    // `price` (63 entities) with `voter`/`verdict` (34 entities) into one map.
    const discAttr = attrs.entity_type ? 'entity_type' : (attrs.type ? 'type' : null);
    if (discAttr) discNames.add(discAttr);
    const et = discAttr ? attrs[discAttr].value : '<untyped>';
    if (!byType.has(et)) byType.set(et, { entityType: et, count: 0, attributes: new Map() });
    const bucket = byType.get(et);
    bucket.count++;
    for (const [name, a] of Object.entries(attrs)) {
      if (!bucket.attributes.has(name)) {
        bucket.attributes.set(name, { name, observedTypes: new Set(), sampleValues: [] });
      }
      const slot = bucket.attributes.get(name);
      slot.observedTypes.add(a.type);
      if (slot.sampleValues.length < 3 && !slot.sampleValues.includes(a.value)) {
        slot.sampleValues.push(a.value);
      }
    }
  }
  return {
    project,
    entityCount: rows.length,
    discriminator: [...discNames].length === 1 ? [...discNames][0] : (discNames.size ? [...discNames].join('|') : null),
    entityTypes: [...byType.values()].map((b) => ({
      entityType: b.entityType,
      count: b.count,
      attributes: [...b.attributes.values()].map((a) => ({
        name: a.name,
        observedTypes: [...a.observedTypes].sort(),
        sampleValues: a.sampleValues,
      })).sort((x, y) => x.name.localeCompare(y.name)),
    })).sort((x, y) => y.count - x.count),
  };
}

/**
 * --check-budget: prove the access key is being picked up and the query budget
 * is usable, without spending a full probe.
 */
async function checkBudget() {
  const headers = { 'content-type': 'application/json', 'user-agent': 'semantic-arkiv-probe/1.0.0' };
  const key = process.env.ARKIV_ACCESS_KEY;
  if (key) headers['x-api-key'] = key;

  const res = await fetch(RPC, {
    method: 'POST', headers,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'arkiv_query',
      params: ["project = str('mandi_board_v1')", { select: { key: true }, limit: '0x1' }],
    }),
  });
  const body = await res.json().catch(() => ({}));

  console.log(`key present     : ${key ? `yes (${key.length} chars, prefix ${key.slice(0, 8)}...)` : 'NO  <-- not picked up'}`);
  console.log(`HTTP            : ${res.status}`);
  console.log(`ratelimit       : ${res.headers.get('ratelimit')}`);
  console.log(`retry-after     : ${res.headers.get('retry-after')}`);
  console.log(`arkiv-cost      : ${res.headers.get('arkiv-cost')}`);
  console.log(`quota-used-pct  : ${res.headers.get('arkiv-quota-used-percent')}`);
  console.log(`body            : ${JSON.stringify(body).slice(0, 180)}`);

  if (body?.error === 'ANON_COST_LIMITED' || !key) {
    console.log('\nFAIL: still on the anonymous tier. The key is not being accepted.');
    process.exit(1);
  }
  console.log('\nOK: query budget is usable.');
  process.exit(0);
}

if (process.argv.includes('--check-budget')) {
  await checkBudget();
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  const out = { rpc: RPC, probedAt: new Date().toISOString(), projects: {} };

  for (const project of ANCHORS) {
    process.stderr.write(`\n== probing ${project}\n`);
    const expr = `project = str('${project}')`;
    const { snapshot, rows, pages } = await fetchAll(expr);
    const schema = buildSchema(project, rows);
    schema.snapshotBlock = snapshot;
    schema.snapshotBlockNumber = Number(BigInt(snapshot));
    schema.pages = pages;
    out.projects[project] = schema;
    process.stderr.write(`  ${rows.length} entities, ${pages} pages, block ${snapshotNumber(snapshot)}\n`);
    await sleep(500);
  }

  out.rpcCallsThisRun = rpcCalls;
  out.cachedResponses = cacheLog.length;
  out.chainWideCount = await rpc('arkiv_getEntityCount', []);

  await writeFile(path.join(DATA_DIR, 'anchor-schemas.json'), JSON.stringify(out, null, 2));

  // human-readable summary
  const lines = [`# Anchor namespace schemas`, ``, `Probed: ${out.probedAt}`, `Chain-wide entity count: ${out.chainWideCount}`, ``];
  for (const [p, s] of Object.entries(out.projects)) {
    lines.push(`## ${p} — ${s.entityCount} entities @ block ${s.snapshotBlockNumber}`, ``);
    for (const et of s.entityTypes) {
      lines.push(`### entity_type = ${et.entityType}  (${et.count})`, ``);
      lines.push(`| attribute | type(s) | sample |`, `| --- | --- | --- |`);
      for (const a of et.attributes) {
        const amb = a.observedTypes.length > 1 ? ' **AMBIGUOUS**' : '';
        lines.push(`| ${a.name} | ${a.observedTypes.join(', ')}${amb} | \`${String(a.sampleValues[0]).slice(0, 40)}\` |`);
      }
      lines.push(``);
    }
  }
  await writeFile(path.join(DATA_DIR, 'anchor-schemas.md'), lines.join('\n'));
  process.stderr.write(`\nwrote data/anchor-schemas.json + .md  (rpc calls this run: ${rpcCalls})\n`);
}

const snapshotNumber = (h) => Number(BigInt(h));

main().catch((e) => {
  process.stderr.write(`FATAL ${e.message}\n`);
  process.exit(1);
});
