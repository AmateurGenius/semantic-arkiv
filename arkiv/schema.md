# Arkiv schema — what is actually on Tiramisu

Derived from a live walk of `arkiv_query ["*"]` on
`https://rpc.tiramisu.db-chain.testnet.arkiv.network`, chain `7738577`, 2026-10-16.
Coverage: 45 pages × 200 = 9,000 rows of a 10,100-entity chain (~89%).

Machine-readable: `data/global-vocabulary.json`. Ontology: `ontology/arkiv-vocab.ttl`.

## 1. There is no global schema

Arkiv gives you three scoping attributes and no more:

| Attribute | Purpose | Authentication? |
| --- | --- | --- |
| `project` | Application namespace | **No** — anyone can copy the value |
| `entity_type` | Entity kind within a project | **No** |
| `$creator` | Original publisher | Yes, for provenance |
| `$owner` | Current mutation authority | Yes, but changes on transfer |

`project` and `entity_type` are conventions, not a schema registry. 33 projects
have each invented their own attribute vocabulary independently.

## 2. Observed project namespaces

33 total. Largest by observation count:

| project | entities |
| --- | --- |
| arkiv-chain-indexer-baseload | 842 |
| tolmol | 599 |
| bhaiyaplease | 128 |
| mandi_board_v1 | 97 |
| arkivate | 82 |
| underthetable | 77 |
| slotbazaar | 52 |
| arkivtrace | 50 |
| arkognito-demo-sketch | 42 |
| safestay_v1 | 29 |
| youva_demo_v1 | 15 |
| globalpay | 14 |
| arkiv-witness | 11 |
| ghostwallet | 10 |

`arkiv-chain-indexer-baseload` is a synthetic load generator: it writes
`random_number_0_<hex>` / `random_string_0_<hex>` attributes (1,684 of the 2,191
distinct names). Exclude it when studying real usage.

## 2.5 The discriminator is usually `type`, not `entity_type`

This is the single most consequential finding, and it was discovered the hard
way — by building a resolver that emitted `entity_type` and watched it return
zero rows.

| Attribute | Observations (9,000-row walk) |
| --- | --- |
| `type` | **5,425** |
| `entity_type` | 185 |

`type` is the real discriminator in practice. Measured per namespace:

| project | discriminator | values (entity counts) |
| --- | --- | --- |
| mandi_board_v1 | `type` | `price_report` (63), `price_vote` (34) |
| underthetable | `type` | `report` (76), `attestation` (1) |
| bhaiyaplease | `type` | `delivery` (40), `request` (40), `receipt` (39), `shop` (5), `attestation` (3), `complaint` (1) |

None of the three uses `entity_type` at all.

### 2.5.1 Attributes are scoped to the discriminator value

Within one project, different `type` values carry **different attributes**. This
is the trap that produced empty intersections during development:

```text
project = str('mandi_board_v1') AND type = str('price_vote')   -> 34
project = str('mandi_board_v1') AND price >= dec(0)            -> 63
project = str('mandi_board_v1') AND type = str('price_vote') AND price >= dec(0) -> 0
```

`price` belongs to the 63 `price_report` entities; the 34 `price_vote` entities
do not have it. A schema that flattens a project's attributes across all its
`type` values will generate filters whose terms never co-occur.

**Rule:** scope attributes to `(project, type-value)`, not to `project`.

## 3. Observed entity types

25 total: `receipt`, `slot`, `trigger`, `completion`, `booking`, `deposit_terms`,
`evidence_log`, `deposit_outcome`, `acceptance`, `sealed`, `mandate`, `reveal`,
`notice_observation`, `worker`, `publication`, `attendance_state`,
`circuit_release`, `revocation_root`, `issuer`, `landlord_profile`, `follow`,
`community`, `revocation`, `project_state`, `project_root`.

Note what is **absent**: `listing`, `profile`, `certification`, `mentor`,
`expert`. The build plan's example schema does not exist on chain.

## 4. Attribute vocabulary

507 real application attributes. The most frequently observed:

| attribute | observations | type(s) |
| --- | --- | --- |
| app | 6394 | str |
| type | 5425 | str |
| v | 3920 | **i32, u64** |
| src | 3489 | str |
| batch | 3473 | str |
| exp_ym | 3212 | u64 |
| rid | 3006 | **bytes32, str** |
| class | 2999 | str |
| exp_ok | 2999 | bool |
| lab | 2999 | str |
| pname | 2999 | str |
| ptok | 2999 | str |
| kind | 2828 | str |
| project | 2105 | str |
| district | 1636 | str |
| contaminant | 1178 | str |

### 4.1 The 29 type-ambiguous names

An attribute name that carries more than one type is a silent-wrong-answer
generator. A typed predicate matches **only** cells stored with that exact type,
so a single-type filter misses every project that encoded it differently.

| attribute | observations | types |
| --- | --- | --- |
| v | 3920 | i32, u64 |
| rid | 3006 | bytes32, str |
| schema_version | 884 | i32, u64 |
| schema | 316 | bytes32, i32 |
| run | 252 | key, str |
| period | 201 | i32, str |
| day | 167 | i32, str |
| observed_at | 119 | i32, u64 |
| target | 116 | key, str |
| schema_v | 72 | str, u64 |
| epoch | 58 | **i32, str, u64** |
| trigger | 54 | key, str |
| shop | 46 | key, str |
| severity | 44 | str, u64 |
| version | 37 | **i32, str, u64** |
| sha256 | 23 | bytes32, str |
| subject | 22 | addr, key |
| size | 21 | dec, u64 |
| site | 18 | key, str |
| wallet | 17 | addr, str |
| publisher | 16 | addr, str |
| valid_until | 16 | i32, u64 |
| seq | 15 | i32, u64 |
| sequence | 14 | i32, u64 |
| terms_key | 11 | key, str |
| org | 9 | addr, str |
| revision | 8 | i32, u64 |
| amount | 4 | dec, u64 |
| corrects | 2 | key, str |

`epoch` also shows **value-shape** drift inside the `str` encoding: both a plain
hex string and `"create:0x…"`.

## 5. Query patterns that actually work

```text
# namespace scope
project = str('mandi_board_v1')

# namespace + entity type
project = str('mandi_board_v1') AND entity_type = str('booking')

# numeric range on a type-ambiguous attribute (widen across observed types)
(amount >= dec(0) OR amount >= u64(0))

# creator scope (provenance) — $owner is mutation authority, not provenance
$creator = addr(0xc7bd0b3731ed69a3c769050668cdbf4edb609ea9)

# prefix match (INFIX — the function form is rejected)
project STARTSWITH str('arkiv')

# negation (there is no != operator)
NOT project = str('tolmol')

# exact string value
entity_type = str('receipt')
```

### Literal constructors

| Type | Correct form | Rejected form |
| --- | --- | --- |
| str | `str('text')` | `"text"` |
| dec | `dec(4.5)` | `dec('4.5')`, `4.5` |
| u64 | `u64(0)` | `0` on a u64 cell |
| i32 | `i32(10)` | — |
| addr | `addr(0x…)` | `addr("0x…")` |
| bool | `true` / `false` | `bool(true)` |

### System attributes

| Attribute | Type | Predicate form |
| --- | --- | --- |
| `$key` | key | `$key = key(0x…)` |
| `$owner` | addr | `$owner = addr(0x…)` |
| `$creator` | addr | `$creator = addr(0x…)` |
| `$createdAt` | u64 | `$createdAt >= u64(0)` |
| `$expiresAt` | u64 | `$expiresAt >= u64(0)` |
| `$contentType` | str | `$contentType = str('application/json')` |

`$updatedAt`, `$creationFlags` and `$payload` appear in results but are **not**
usable as predicates.

## 6. Constraints that shape any application

- **No `ORDER BY`.** Server returns newest-first by creation block. Top-N
  requires fetching every page at one pinned block and sorting a copy.
- **No aggregates.** A filtered count exists via `arkiv_getEntityCount`; there
  is no `GROUP BY`, `SUM` or `AVG`.
- **No joins.** `key` attributes reference other entities but are not traversed
  server-side. Multi-hop resolution is client-side.
- **Page size ≤ 200.** A short page does not prove completion; check the cursor.
- **Pin the block.** Follow a cursor only at the same `atBlock`, or the node
  returns `-32005 cursor belongs to a different query, block or select`.
- **Query cost is metered.** `arkiv_query` consumes a budget; the anonymous
  tier is 10,000 units and `eth_blockNumber` is free. See `arkiv/friction.md`.
