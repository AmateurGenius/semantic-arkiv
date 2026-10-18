#!/usr/bin/env node
/**
 * Semantic Arkiv CLI — resolve natural language to a valid Arkiv filter.
 *
 * Usage:
 *   node src/cli.mjs "mandi potato price reports"
 *   node src/cli.mjs "delivery receipts in tdr3c1"
 *   echo "reports from fatehpur" | node src/cli.mjs
 *
 * Outputs the resolved filter expression and exits 0.
 * On failure, prints warnings to stderr and exits 1.
 */
import { resolve } from './resolve.mjs';
import { loadVocabulary } from './vocab.mjs';

const args = process.argv.slice(2);
let intent = args.join(' ');

// Support piped input
if (!intent && !process.stdin.isTTY) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  intent = Buffer.concat(chunks).toString('utf8').trim();
}

if (!intent) {
  console.error('usage: ontoskill "<natural language query>"');
  process.exit(1);
}

try {
  const vocab = await loadVocabulary();
  const result = await resolve(intent, vocab);
  if (result.expression) {
    console.log(result.expression);
    process.exit(0);
  } else {
    console.error('Could not resolve:');
    for (const w of result.warnings ?? []) {
      console.error('  -', w.kind + ':', w.detail?.slice(0, 100));
    }
    process.exit(1);
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
