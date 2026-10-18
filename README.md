# Semantic Arkiv

A deterministic semantic resolution layer for Arkiv queries.

Arkiv's `query_entities` / `arkiv_query` accepts SQL-like filter expressions.
That interface is syntactic: an agent asked for "high-reputation mentors" has no
formal way to know whether `reputationScore`, `reputation_score` or `rep` is the
real attribute name — or whether any of them exist. It reads prose documentation
probabilistically and guesses.

This project compiles the **live on-chain Arkiv vocabulary** into a validated
ontology and serves it over MCP, so an agent translates natural language into a
filter that is correct by construction.

## The problem, measured

A 48-page walk of the Tiramisu testnet (5,773 rows) found:

| Fact | Value |
| --- | --- |
| Distinct project namespaces | 37 |
| Distinct `entity_type` values | 100 |
| Distinct attribute names | 2,783 (2,368 are indexer noise → **415 real**) |
| Attribute names carrying **more than one type** across projects | **20** |
| Global schema | **none** |

There is no shared schema. Attribute names are per-project and often cryptic
(`na`, `of`, `lb`, `pc`, `pnl_bps`, `exp_ym`, `ptok`, `rstate`).

Worse, the failure is **silent**. Three traps produce a query that parses,
succeeds, and returns an empty set with no error:

1. **Uppercase attribute names.** `reputationScore = 1` parses on the read path
   (count=0). The write path rejects uppercase with `outside the name charset`
   (`Ident32InvalidByte`, `0x276f7798`). Such a name can never match a stored cell.
2. **Bare numeric literals.** `price >= 0` is an `i32` predicate. It silently
   misses every `u64`, `u256` and `dec` cell.
3. **Type ambiguity.** `v` is stored as both `i32` and `u64` across projects. A
   single-type predicate misses half the data.

An agent without an ontology emits queries that run and return nothing. That is
worse than a query that errors.

## What this repo does

```
natural language
      │
      ▼
 ontoskill  (MCP tool)
      │  grounds every name against ontology/arkiv-vocab.ttl
      │  widens type-ambiguous attributes with OR
      │  validates the result against the grammar contract
      ▼
 grammar-valid Arkiv filter expression
      │
      ▼
 arkiv_query  →  Tiramisu
```

The ontology is **not speculative**. Every project, entity type and attribute in
it is traceable to an observation count captured from a real walk of the live
chain. The resolver refuses to invent a name it cannot attest — it reports the
gap instead.

## Installation

### npm (recommended)

```bash
npm install -g semantic-arkiv

# CLI — resolve natural language to a valid Arkiv filter
ontoskill "mandi potato price reports"
# Output: project = str('mandi_board_v1') AND type = str('price_report') AND crop = str('potato') AND price >= dec(0)

# MCP server — add to any MCP client
# Command: node /path/to/semantic-arkiv/src/mcp-server.mjs
```

### Local

```bash
git clone https://github.com/your-org/semantic-arkiv.git
cd semantic-arkiv

# CLI
node src/cli.mjs "mandi potato price reports"

# MCP server
node src/mcp-server.mjs

# Resolve library import
node -e "import('./src/resolve.mjs').then(m => m.resolve('mandi potato price reports')).then(r => console.log(r.expression))"
```

No dependencies. Node.js 18+ required.

### MCP tools

| Tool | Purpose |
| --- | --- |
| `ontoskill` | natural language → grammar-valid Arkiv filter |
| `validate_filter` | check any expression against the grammar contract |
| `arkiv_vocabulary` | inspect attested projects / entity types / attributes |
| `arkiv_query` | execute a filter against Tiramisu (cost-aware, cached) |

## Integration examples

### 1. MCP Server (recommended)

Add to any MCP client (Claude, Cursor, etc.):

```json
{
  "mcpServers": {
    "semantic-arkiv": {
      "command": "node",
      "args": ["/path/to/semantic-arkiv/src/mcp-server.mjs"]
    }
  }
}
```

Four tools become available:
- `ontoskill` — natural language → grammar-valid Arkiv filter
- `validate_filter` — check any expression against the grammar contract
- `arkiv_vocabulary` — inspect attested projects / entity types / attributes
- `arkiv_query` — execute a filter against Tiramisu

### 2. CLI

```bash
# Install
npm install -g semantic-arkiv

# Resolve natural language to a valid filter
ontoskill "mandi potato price reports"
# Output: project = str('mandi_board_v1') AND type = str('price_report') AND crop = str('potato') AND price >= dec(0)

# Pipe input
echo "delivery receipts in tdr3c1" | ontoskill
```

### 3. Library import

```js
import { resolve } from 'semantic-arkiv/src/resolve.mjs';
import { loadVocabulary } from 'semantic-arkiv/src/vocab.mjs';

// Resolve natural language to a filter
const result = await resolve('mandi potato price reports');
console.log(result.expression);
// project = str('mandi_board_v1') AND type = str('price_report') AND crop = str('potato') AND price >= dec(0)

// Inspect the live vocabulary
const vocab = await loadVocabulary();
console.log(vocab.attributes.get('price'));
// { observations: 74, observedTypes: ['dec'] }
```

## What can be built on & with Semantic Arkiv

Semantic Arkiv is infrastructure — a resolution layer between natural language and Arkiv's query grammar. Here is what each group can build with it.

### Everyday Arkiv users

- **Natural language → Arkiv queries.** Pipe questions into the CLI or MCP server, get a valid filter back. No grammar lookup, no vocabulary browsing.
- **Query validation.** Run `validate_filter` on any expression before sending it to the node. Catches silent-zero traps (camelCase names, bare decimals, wrong discriminator) before they return empty.
- **Vocabulary inspection.** Use `arkiv_vocabulary` to browse attested projects, entity types, and attributes. Discover what exists on chain without walking it yourself.

### Agent builders

- **MCP tool integration.** Add the server to any MCP client and give agents the ability to query Arkiv. Four tools: `ontoskill`, `validate_filter`, `arkiv_vocabulary`, `arkiv_query`.
- **Library import.** Embed `resolve()` and `loadVocabulary()` into custom tools. The resolver is framework-agnostic — no MCP required.
- **Custom resolvers.** Fork `src/resolve.mjs` and add project-specific synonyms or domain logic. The vocabulary is the guardrail; the resolver is the extension point.

### UI and dashboard builders

- **Vocabulary explorer.** Render `data/global-vocabulary.json` as a browsable catalog of what exists on chain.
- **Query debugger.** Build a side-by-side view of natural language input, resolved filter, and node response — the split-pane pattern from the demo site.
- **Ontology visualizer.** Show the Turtle ontology as a graph: projects → entity types → attributes, with type ambiguity highlighted.

### The Arkiv community

- **Upstream integration.** The four friction reports (#58–#61) are filed against `Arkiv-Network/skills`. The grammar contract in `references/grammar-contract.md` is ready to merge into the official skills repo.
- **SDK validation.** `src/grammar.mjs` exports `validateFilter` — a standalone function that checks any expression against the empirical grammar. Usable without the rest of the project.
- **Documentation fixes.** The STARTSWITH infix form, the `type` discriminator, and the cost model are all documented here with live evidence. These can be lifted into the public docs.

### The Semantic Arkiv project itself

- **Wider vocabulary coverage.** The re-walk script (`scripts/rewalk.mjs`) refreshes the ontology as new projects appear on chain.
- **Write path.** This project is read-only. A natural extension is a write-side resolver that grounds mutations in the same vocabulary.
- **Multi-chain support.** The grammar contract is Tiramisu-specific. Porting to other Arkiv chains means re-probing the grammar and re-walking the vocabulary.

## Layout

```
data/global-vocabulary.json      live-captured vocabulary (5,773 rows)
data/anchor-schemas.json         per-namespace schemas (see Limitations)
data/rate-limit-evidence.json    the ANON_COST_LIMITED finding
ontology/arkiv-vocab.ttl         the OWL 2 ontology (2,705 triples)
ontology/arkiv-grammar.shacl.ttl SHACL shapes for emitted expressions
src/grammar.mjs                  the empirical grammar contract + validator
src/resolve.mjs                  the resolver
src/mcp-server.mjs               the MCP server
src/cli.mjs                      the CLI wrapper
examples/                        integration examples (MCP, CLI, library)
benchmark/results.json           measured benchmark output
arkiv/schema.md                  entity types, attributes, query patterns
arkiv/friction.md                the friction report (camelCase trap first)
arkiv/skill-feedback.md          gaps filed back to the Arkiv skills repo
```

## Benchmark

10 prompts, two conditions, both validated then executed against the live RPC.
Full output in `benchmark/results.json`.

| Metric | A: markdown-only | B: ontology |
| --- | --- | --- |
| Grammar-valid expressions | **0%** | **100%** |
| Silent-zero risk | **70%** | **0%** |
| **Prompts returning real rows** | **0%** | **90%** |
| Prompts rejected by the node | **100%** | **0%** |
| Guidance bytes the agent must read | 52,534 | **2,367** |

**95.5% guidance reduction** (52,534 → 2,367 bytes), against an 88% target.

Condition A was rejected by the node on **all 10** prompts. Condition B returned
real entities on **9 of 10**; the single miss is prompt b1, which targets the
build plan's fictional schema and is therefore *correctly* refused.

### Honest scope

- **Condition A is a simulated baseline.** It encodes the documented failure
  modes of markdown-only resolution (SQL operators, double-quoted literals,
  `bool(true)`, camelCase names, invented attributes, bare decimals, `LIKE`,
  subqueries). It is not a live LLM sample. Its expression *text* is simulated;
  its *validation outcome* is measured by the same validator used on B.
- **Per-namespace coverage is 3 of 33 projects.** `data/anchor-schemas.json`
  covers mandi_board_v1, underthetable and bhaiyaplease. The remaining 30 fall
  back to the global vocabulary, which is complete but not type-scoped.
- **Condition A's expression text is simulated** (see above); its rejection is
  measured by the live node.

## Known limitations

- The synonym tables in `src/vocab.mjs` are hand-seeded. A synonym pointing at
  an unattested name is reported as a gap, never emitted.
- The resolver does not handle multi-hop relations (joins). Arkiv `key`
  attributes are captured as types but not traversed.
- `recent`-style intents resolve to an ordering instruction, not a predicate,
  because Arkiv has no server-side time window.
- No write path. This project is read-only by design.

## Build log — what measurement caught that inspection missed

Three defects in this project were found by running against live data, not by
reading code. They are recorded because they make the same argument the project
makes about agents: syntax without semantics returns nothing, and you cannot
tell until you look.

| # | Defect | How it presented | Root cause |
| --- | --- | --- | --- |
| 1 | Cache-key collision | Three anchor projects reported identical counts (97/97/97) from one cached response | The cache key truncated the params hash to 16 bytes, and every query expression begins with `["project = str('` |
| 2 | Wrong discriminator grouping | A compound filter returned 0 while both of its terms returned non-zero — looked like data sparsity | The probe grouped entities by `entity_type`, which these projects do not use, merging distinct logical entity types into a single attribute map |
| 3 | Client auth silently not applied | Every probe returned `ANON_COST_LIMITED` despite an exported key | A module-level header constant captured at import time never saw the environment variable |

Defects 1 and 2 both produced **plausible output**. The cache collision looked
like three coincidentally-equal projects. The grouping bug looked like sparse
data. Neither raised an error. Both were caught only by counting each term of a
filter separately and comparing the parts against the total.

That is the empty-intersection probe, and it is now the first diagnostic in
`arkiv/schema.md`.

## Filed back

Seven friction findings from this work; four filed as issues against
[Arkiv-Network/skills](https://github.com/Arkiv-Network/skills) **before**
submission. Full evidence: `arkiv/friction.md`.

| Issue | Finding |
| --- | --- |
| [#58](https://github.com/Arkiv-Network/skills/issues/58) | **F-7** — `entity_type` is documented as the discriminator; `type` is used 5.8× more often |
| [#59](https://github.com/Arkiv-Network/skills/issues/59) | **F-1** — camelCase attribute names parse on read and can never match a stored cell |
| [#60](https://github.com/Arkiv-Network/skills/issues/60) | **F-6** — 20 attribute names carry multiple types across projects (`epoch` carries three) |
| [#61](https://github.com/Arkiv-Network/skills/issues/61) | **STARTSWITH** — infix syntax undocumented; the function form is rejected |

Filed 2026-10-16 against Tiramisu, SDK `@arkiv-network/sdk` 0.8.1, chain
`7738577` (`0x7614d1`).

## License
