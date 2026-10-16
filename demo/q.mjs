#!/usr/bin/env node
/**
 * Demo query helper. Prints a single line: <count>  <expression>
 *
 * Default: served from data/rpc-cache (free, instant, deterministic).
 * --live : bypasses the cache and hits the RPC (spends budget — use sparingly).
 *
 * Usage:
 *   node demo/q.mjs "project = str('mandi_board_v1')"
 *   node demo/q.mjs --live "project = str('mandi_board_v1')"
 */
import { createClient } from '../src/rpc.mjs';

const args = process.argv.slice(2);
const live = args.includes('--live');
const expr = args.filter((a) => a !== '--live').join(' ');

if (!expr.trim()) {
  console.error('usage: node demo/q.mjs [--live] "<expression>"');
  process.exit(2);
}

const client = createClient({ useCache: !live, paceMs: 1200 });

try {
  const n = await client.count(expr);
  const src = live ? 'LIVE' : 'cache';
  console.log(`${String(n).padStart(5)}  ${expr}   [${src}]`);
} catch (e) {
  console.log(`${'node'.padStart(5)}  rejected: ${e.message?.slice(0, 78)}   [${live ? 'LIVE' : 'cache'}]`);
  process.exit(1);
}
