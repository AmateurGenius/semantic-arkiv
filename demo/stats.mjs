#!/usr/bin/env node
/** Print the benchmark numbers in a video-legible block. Reads benchmark/results.json. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const d = JSON.parse(await readFile(path.join(ROOT, 'benchmark', 'results.json'), 'utf8'));
const s = d.summary;

const pad = (x, n) => String(x).padEnd(n);
const row = (label, a, b) => console.log(`  ${pad(label, 26)} ${pad(a, 12)} ->  ${b}`);

console.log('');
row('metric', 'markdown-only', 'ontology');
console.log(`  ${'-'.repeat(26)} ${'-'.repeat(12)}    ${'-'.repeat(12)}`);
row('grammar-valid', `${s.A.grammarValidRate}%`, `${s.B.grammarValidRate}%`);
row('silent-zero risk', `${s.A.silentZeroRate}%`, `${s.B.silentZeroRate}%`);
row('prompts returning rows', `${s.A.liveRowsRate}%`, `${s.B.liveRowsRate}%`);
row('rejected by the node', `${s.A.parseErrorRate}%`, `${s.B.parseErrorRate}%`);
row('guidance bytes', s.guidanceBytes.bytes.toLocaleString(), s.B.totalGuidanceBytes.toLocaleString());
console.log('');
const reduction = (1 - s.B.totalGuidanceBytes / s.guidanceBytes.bytes) * 100;
console.log(`  guidance reduction: ${reduction.toFixed(1)}%`);
console.log(`  prompts: ${s.prompts}   live RPC cost this run: ${s.rpcStats.cost}`);
console.log('');
