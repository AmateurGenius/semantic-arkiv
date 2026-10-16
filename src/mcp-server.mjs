#!/usr/bin/env node
/**
 * ontoskill — MCP server exposing the Arkiv Vocabulary Ontology.
 *
 * Transport: MCP stdio, newline-delimited JSON-RPC 2.0. Implemented with zero
 * dependencies on purpose: the Rust path in the original plan needs multiple GB
 * to fetch and compile an RDF stack, and the official TS SDK pulls a large
 * dependency tree. Neither is required — MCP stdio is a simple line protocol.
 *
 * Tools:
 *   ontoskill          natural language -> grammar-valid Arkiv filter
 *   validate_filter    check an arbitrary expression against the grammar contract
 *   arkiv_vocabulary   inspect the attested vocabulary
 *   arkiv_query        execute a filter against Tiramisu (cost-aware, cached)
 *
 * Usage: node src/mcp-server.mjs        (speaks MCP on stdin/stdout)
 */
import { createInterface } from 'node:readline';
import { loadVocabulary } from './vocab.mjs';
import { resolve } from './resolve.mjs';
import { validate, NETWORK } from './grammar.mjs';
import { createClient, BudgetExhausted } from './rpc.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'ontoskill', version: '1.0.0' };

const vocab = await loadVocabulary();
const client = createClient();

const TOOLS = [
  {
    name: 'ontoskill',
    description:
      'Translate a natural-language request into a grammar-valid Arkiv filter expression, grounded in a live-derived ontology of the Arkiv Tiramisu vocabulary. ' +
      'Every emitted attribute, project and entity_type is attested on chain; the tool reports a gap rather than inventing a name. ' +
      'Type-ambiguous attributes are widened across their observed types. Returns the expression plus disambiguation notes and warnings. ' +
      'Call this FIRST, then pass the returned expression to arkiv_query.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: 'Natural-language request, e.g. "highest-volume mandi listings".' },
      },
      required: ['intent'],
    },
  },
  {
    name: 'validate_filter',
    description:
      'Validate an Arkiv filter expression against the empirically established grammar contract. ' +
      'Detects the silent-zero class: constructs that PARSE and SUCCEED but can never match a stored cell (uppercase attribute names, bare numeric literals against typed cells).',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
  },
  {
    name: 'arkiv_vocabulary',
    description:
      'Inspect the attested Arkiv vocabulary: project namespaces, entity types and attributes with their observed types. ' +
      'Use to check whether a name exists before writing a query against it.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['projects', 'entity_types', 'attributes', 'ambiguous', 'stats'] },
        filter: { type: 'string', description: 'Optional substring filter on the name.' },
        limit: { type: 'number' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'arkiv_query',
    description:
      'Execute an Arkiv filter expression against the Tiramisu testnet and return entities. ' +
      'Cost-aware: responses are cached to disk, requests are paced, and the client refuses to run when the anonymous query budget is exhausted. ' +
      'Requires at least one filter predicate.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string' },
        limit: { type: 'number', description: 'Page size, max 200.' },
        all: { type: 'boolean', description: 'Walk every page at one pinned block.' },
      },
      required: ['expression'],
    },
  },
];

const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });

async function callTool(name, args) {
  switch (name) {
    case 'ontoskill': {
      const r = resolve(args.intent, vocab);
      return text({
        expression: r.expression,
        confidence: r.confidence,
        grammarValid: r.validation.ok,
        resolved: r.resolved,
        projections: r.projections,
        disambiguation: r.disambiguation,
        warnings: r.warnings,
        postProcessing: r.postProcessing,
        violations: r.validation.violations,
        nextStep: r.expression
          ? 'Pass `expression` to arkiv_query.'
          : 'No attested filter could be built. Read `warnings` and choose an attested namespace, or record the gap.',
      });
    }
    case 'validate_filter': {
      const v = validate(args.expression ?? '');
      return text({ ok: v.ok, violations: v.violations, note: v.ok ? 'No rejected syntax and no silent-zero risk detected.' : 'Do not send this expression; it will either error or silently return nothing.' });
    }
    case 'arkiv_vocabulary': {
      const { kind, filter, limit = 60 } = args;
      const f = (filter ?? '').toLowerCase();
      if (kind === 'projects') return text([...vocab.projects.keys()].filter((n) => n.includes(f)).slice(0, limit));
      if (kind === 'entity_types') return text([...vocab.entityTypes.keys()].filter((n) => n.includes(f)).slice(0, limit));
      if (kind === 'attributes') {
        return text([...vocab.attributes.entries()]
          .filter(([n]) => n.includes(f))
          .slice(0, limit)
          .map(([n, a]) => ({ name: n, observedTypes: a.observedTypes, observations: a.observations })));
      }
      if (kind === 'ambiguous') {
        return text(vocab.ambiguous().map(([n, a]) => ({ name: n, observedTypes: a.observedTypes, observations: a.observations })));
      }
      return text({ ...vocab.meta, network: NETWORK });
    }
    case 'arkiv_query': {
      const expr = args.expression ?? '';
      const v = validate(expr);
      if (!expr.trim()) throw new Error('A query needs at least one filter predicate.');
      try {
        if (args.all) {
          const { rows, pages, complete, snapshot } = await client.queryAll(expr, { maxPages: 25 });
          return text({ expression: expr, snapshot, pages, complete, count: rows.length, entities: rows.slice(0, 50), truncated: rows.length > 50 });
        }
        const page = await client.query(expr, { limit: Math.min(args.limit ?? 50, 200) });
        return text({ expression: expr, blockNumber: page.blockNumber, count: page.data?.length ?? 0, hasCursor: Boolean(page.cursor), entities: page.data, warnings: v.ok ? undefined : v.violations });
      } catch (e) {
        if (e instanceof BudgetExhausted) {
          return text({ expression: expr, error: 'BUDGET_EXHAUSTED', retryAfterSeconds: e.retryAfter, detail: e.message, remedy: 'Set ARKIV_ACCESS_KEY to a key from https://hub.arkiv.network, or wait for the anonymous budget to reset. Responses already fetched are served from data/rpc-cache.' });
        }
        throw e;
      }
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: 'Call ontoskill first to translate an intent into a grammar-valid Arkiv filter, then arkiv_query to execute it.',
      });
    case 'notifications/initialized':
      return null;
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      try {
        const result = await callTool(params?.name, params?.arguments ?? {});
        return reply(result);
      } catch (e) {
        return reply({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    case 'ping':
      return reply({});
    default:
      return fail(-32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { return; }
  const out = await handle(msg);
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
});
