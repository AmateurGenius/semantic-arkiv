/**
 * Cost-aware Arkiv RPC client.
 *
 * Findings this module encodes (all confirmed live 2026-10-16):
 *   - arkiv_query is COST-metered, not just count-metered.
 *   - The anonymous budget is 10,000 units; exhausting it returns HTTP 429
 *     with body { error: "ANON_COST_LIMITED" } and a Retry-After in seconds.
 *   - eth_blockNumber is NOT cost-limited.
 *   - Response headers expose: RateLimit, Retry-After, Arkiv-Quota-Used-Percent,
 *     Arkiv-Cost.
 *
 * Therefore: every response is cached to disk, every request is paced, and the
 * client refuses to start a query when the remaining budget is too low.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { NETWORK } from './grammar.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'rpc-cache');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Hash the FULL params. A truncated prefix collides: every query expression
// begins with `["project = str('`, so a short prefix maps distinct queries
// onto one cache entry and silently returns the wrong project's rows.
const cacheKey = (method, params) =>
  `${method}-${createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 32)}.json`;

export class BudgetExhausted extends Error {
  constructor(retryAfter, body) {
    super(`arkiv_query budget exhausted (ANON_COST_LIMITED); retry in ${retryAfter}s`);
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

export function createClient({ apiKey = process.env.ARKIV_ACCESS_KEY, paceMs = 1200, useCache = true } = {}) {
  const stats = { requests: 0, cacheHits: 0, cacheWrites: 0, cost: 0, quotaUsedPercent: null, budgetExhausted: 0 };

  async function raw(method, params, { retries = 4 } = {}) {
    const key = cacheKey(method, params);
    const file = path.join(CACHE_DIR, key);
    if (useCache && existsSync(file)) {
      stats.cacheHits++;
      return JSON.parse(await readFile(file, 'utf8'));
    }

    const headers = { 'content-type': 'application/json', 'user-agent': 'semantic-arkiv/1.0.0' };
    if (apiKey) headers['x-api-key'] = apiKey;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const res = await fetch(NETWORK.rpc, {
        method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      stats.requests++;

      const cost = res.headers.get('arkiv-cost');
      if (cost) stats.cost += Number(cost);
      const quota = res.headers.get('arkiv-quota-used-percent');
      if (quota) stats.quotaUsedPercent = Number(quota);

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 0);
        const body = await res.json().catch(() => ({}));
        if (body?.error === 'ANON_COST_LIMITED' || retryAfter > 300) {
          stats.budgetExhausted++;
          throw new BudgetExhausted(retryAfter, body);
        }
        await sleep(Math.min(30_000, 1500 * 2 ** attempt));
        continue;
      }

      const body = await res.json();
      if (body.error) {
        const e = new Error(body.error.message);
        e.code = body.error.code;
        throw e;
      }
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(file, JSON.stringify(body.result));
      stats.cacheWrites++;
      await sleep(paceMs);
      return body.result;
    }
    throw new Error(`rate limited after ${retries} retries: ${method}`);
  }

  return {
    stats,
    raw,
    blockNumber: () => raw('eth_blockNumber', []),
    async query(expression, { atBlock, limit = 200, select, cursor } = {}) {
      const snapshot = atBlock ?? (await raw('eth_blockNumber', []));
      const opts = {
        atBlock: snapshot,
        select: select ?? { key: true, creator: true, createdAt: true, expiresAt: true, attributes: true },
        limit: `0x${Number(limit).toString(16)}`,
      };
      if (cursor) opts.cursor = cursor;
      return raw('arkiv_query', [expression, opts]);
    },
    count: (expression) => raw('arkiv_getEntityCount', [{ query: expression }]),
    /** Walk every page at a pinned block. Returns rows + completeness. */
    async queryAll(expression, { pageSize = 200, maxPages = 25 } = {}) {
      const snapshot = await raw('eth_blockNumber', []);
      const rows = [];
      let cursor, pages = 0, complete = false;
      for (;;) {
        if (pages >= maxPages) break;
        const page = await this.query(expression, { atBlock: snapshot, limit: pageSize, cursor });
        pages++;
        rows.push(...(page.data ?? []));
        cursor = page.cursor;
        if (!cursor) { complete = true; break; }
      }
      return { snapshot, rows, pages, complete };
    },
    async cacheSize() {
      if (!existsSync(CACHE_DIR)) return 0;
      return (await readdir(CACHE_DIR)).length;
    },
  };
}
