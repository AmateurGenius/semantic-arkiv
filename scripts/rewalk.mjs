#!/usr/bin/env node
/**
 * Re-walk the live chain and rebuild data/global-vocabulary.json.
 *
 * Walks every known project namespace via `project = str('...')` queries —
 * each is cheap (1-2 pages) and avoids the expensive full-chain
 * `$createdAt >= u64(0)` query, which the RPC 504s on when overloaded.
 *
 * Aggregates into the exact shape the rest of the repo consumes:
 *   projects      {name: entityCount}
 *   entityTypes   {name: entityCount}
 *   attributes    {name: {observations, observedTypes[]}}
 *   baseloadNoiseCount
 *   counts        {distinctProjects, distinctEntityTypes,
 *                  distinctAttributeNamesTotal, realAttributes,
 *                  baseloadNoise, ambiguousAttributes}
 *
 * Entity types are grouped by the REAL discriminator (`type`, falling back to
 * `entity_type`), matching the anchor probe's finding.
 *
 * Usage: node scripts/rewalk.mjs [--dry] [--max-pages N]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createClient } from '../src/rpc.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(DATA, 'global-vocabulary.json');
const CACHE = path.join(DATA, 'global-vocabulary.json.bak');

const args = process.argv.slice(2);
const maxPages = Number(args.find((a, i) => args[i - 1] === '--max-pages') ?? 0) || 0;
const dry = args.includes('--dry');

const SELECT = { key: true, creator: true, createdAt: true, expiresAt: true, contentType: true, attributes: true };
const PAGE_SIZE = 200;

/** Attributes written by the load-generator indexer, not by real projects. */
const isBaseload = (name) => name.startsWith('random_');

async function main() {
  if (dry) {
    const v = JSON.parse(await readFile(OUT, 'utf8'));
    console.log(`current capture: ${v.walkedRows.toLocaleString()} rows, ${v.pages} pages`);
    console.log(`  projects ${Object.keys(v.projects).length}, entity types ${Object.keys(v.entityTypes).length}`);
    console.log(`  attributes ${Object.keys(v.attributes).length}, ambiguous ${v.counts.ambiguousAttributes}`);
    return;
  }

  // Back up the current capture
  const prev = await readFile(OUT, 'utf8');
  await writeFile(CACHE, prev);

  const client = createClient({ useCache: true, paceMs: 400 });

  // Pin a block a few behind the tip
  const SAFE_OFFSET = 10;
  const tip = await client.blockNumber();
  const tipNum = Number(BigInt(tip));
  const snapshot = '0x' + (tipNum - SAFE_OFFSET).toString(16);

  // Discover namespaces: start with known ones from the previous capture,
  // then also walk a sample of the full chain to find new ones.
  // The full-chain query can 504 when the RPC is overloaded — fall back to
  // known projects only rather than failing the whole walk.
  const knownProjects = Object.keys(JSON.parse(prev).projects ?? {});
  let sampleProjects = new Set();
  let discoveryFailed = false;
  let sampleCursor;
  let discoveryRows = [];

  process.stderr.write('discovering namespaces from a chain sample...\n');
  try {
    // Walk up to 10 pages of the full chain to discover new namespaces.
    // The full-chain query can 504 when the RPC is overloaded — catch and
    // fall back to known projects only.
    for (let sp = 0; sp < 10; sp++) {
      const samplePage = await client.query('$createdAt >= u64(0)', { atBlock: snapshot, limit: PAGE_SIZE, cursor: sampleCursor, select: SELECT });
      discoveryRows.push(...(samplePage.data ?? []));
      for (const r of (samplePage.data ?? [])) {
        const proj = r.attributes?.find((a) => a.name === 'project')?.value;
        if (proj) sampleProjects.add(proj);
      }
      sampleCursor = samplePage.cursor;
      process.stderr.write(`  discovery page ${sp + 1}: ${(samplePage.data ?? []).length} rows\n`);
      if (!sampleCursor) break;
    }
  } catch (e) {
    process.stderr.write(`  discovery skipped: ${e.message.slice(0, 60)}\n`);
    discoveryFailed = true;
  }

  const allProjects = [...new Set([...knownProjects, ...sampleProjects])].sort();
  process.stderr.write(`\nwalking ${allProjects.length} project namespaces...\n`);

  // ---- walk each project -----------------------------------------------
  let rows = [];
  let pages = 0;
  const t0 = Date.now();

  for (const proj of allProjects) {
    let cursor;
    for (;;) {
      if (maxPages && pages >= maxPages) {
        process.stderr.write(`  --max-pages ${maxPages} reached\n`);
        break;
      }
      const page = await client.query(`project = str('${proj}')`, { atBlock: snapshot, limit: PAGE_SIZE, cursor, select: SELECT });
      pages++;
      rows.push(...(page.data ?? []));
      cursor = page.cursor;
      if (!cursor) break;
    }
    const cost = client.stats.cost;
    process.stderr.write(
      `  ${proj.padEnd(30)} ${String(rows.length).padStart(6)} rows  ` +
      `cost ${String(cost).padStart(6)}  ${((Date.now() - t0) / 1000).toFixed(0)}s\n`
    );
  }

  // Also count the sample rows' projects
  const projectSet = new Set(allProjects);
  const totalInProjects = rows.length;

  // Combine the per-project walk with the unaffiliated sample rows.
  const allRows = [...rows, ...discoveryRows];
  process.stderr.write(`\nwalked ${allRows.length.toLocaleString()} entities (${rows.length} in projects + ${discoveryRows.length} unaffiliated sample) over ${pages} pages\n`);

  // ---- aggregate --------------------------------------------------------
  const projects = new Map();
  const entityTypes = new Map();
  const attributes = new Map();
  let baseloadNoise = 0;

  for (const r of allRows) {
    const attrs = Object.fromEntries((r.attributes ?? []).map((a) => [a.name, a]));

    const proj = attrs.project?.value ?? '<unaffiliated>';
    projects.set(proj, (projects.get(proj) ?? 0) + 1);

    const discAttr = attrs.entity_type ? 'entity_type' : (attrs.type ? 'type' : null);
    const et = discAttr ? attrs[discAttr].value : '<untyped>';
    entityTypes.set(et, (entityTypes.get(et) ?? 0) + 1);

    for (const [name, a] of Object.entries(attrs)) {
      if (isBaseload(name)) { baseloadNoise++; continue; }
      if (!attributes.has(name)) attributes.set(name, { name, observations: 0, observedTypes: new Set() });
      const slot = attributes.get(name);
      slot.observations++;
      slot.observedTypes.add(a.type);
    }
  }

  const realAttrs = [...attributes.values()];
  const ambiguous = realAttrs.filter((a) => a.observedTypes.size > 1);
  const counts = {
    distinctProjects: projects.size,
    distinctEntityTypes: entityTypes.size,
    distinctAttributeNamesTotal: realAttrs.length + baseloadNoise,
    realAttributes: realAttrs.length,
    baseloadNoise,
    ambiguousAttributes: ambiguous.length,
  };

  const out = {
    source: 'arkiv-rewalk.out',
    probedAt: new Date().toISOString(),
    snapshotBlock: snapshot,
    walkedRows: rows.length,
    pages,
    note: `aggregated from a live ${pages}-page walk of ${allProjects.length} project namespaces; baseload-indexer noise (random_*) separated out`,
    projects: Object.fromEntries([...projects.entries()].sort((a, b) => b[1] - a[1])),
    entityTypes: Object.fromEntries([...entityTypes.entries()].sort((a, b) => b[1] - a[1])),
    attributes: Object.fromEntries(
      realAttrs
        .sort((a, b) => b.observations - a.observations)
        .map((a) => [a.name, { observations: a.observations, observedTypes: [...a.observedTypes].sort() }])
    ),
    baseloadNoiseCount: baseloadNoise,
    counts,
  };

  await writeFile(OUT, JSON.stringify(out, null, 2));

  process.stderr.write(`\nwrote ${OUT}\n`);
  process.stderr.write(`  projects ${counts.distinctProjects}, entity types ${counts.distinctEntityTypes}\n`);
  process.stderr.write(`  attributes ${counts.realAttributes} real + ${counts.baseloadNoise} noise\n`);
  process.stderr.write(`  ambiguous ${counts.ambiguousAttributes}\n`);
  process.stderr.write(`  type observed ${out.attributes.type?.observations ?? 'n/a'} times\n`);
  process.stderr.write(`  entity_type observed ${out.attributes.entity_type?.observations ?? 'n/a'} times\n`);
  process.stderr.write(`  total cost ${client.stats.cost} units, quota ${client.stats.quotaUsedPercent}%\n`);
}

main().catch((e) => {
  process.stderr.write(`FATAL ${e.message}\n`);
  process.exit(1);
});
