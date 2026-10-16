# Ready-to-file issues — Arkiv-Network/skills

`gh` is not installed on this machine, so these were not filed automatically.
File each one at https://github.com/Arkiv-Network/skills/issues/new

Verified against Tiramisu, SDK 0.8.1, chain 7738577, 2026-10-16.
Full evidence: `arkiv/friction.md`, `arkiv/skill-feedback.md`.

---

## Issue 1 — arkiv-query: STARTSWITH syntax is never shown, and the obvious form is rejected

**Title:** `arkiv-query`: document STARTSWITH as infix (function form returns -32001)

**Body:**

`arkiv-query/SKILL.md` describes STARTSWITH as "a string prefix operator" but
never shows its syntax. The form a reader will guess is rejected:

| Attempt | Result |
| --- | --- |
| `STARTSWITH(project, str('arkiv'))` | `-32001 unexpected character` |
| `startswith(project, str('arkiv'))` | `-32001 unexpected character` |
| `project STARTSWITH str('arkiv')` | accepted — 1063 rows |
| `project STARTSWITH 'arkiv'` | `-32002 untagged strings are only valid for system attributes` |

Suggest adding to the predicates section:

```text
STARTSWITH is INFIX. The right operand must be a tagged string literal.

  project STARTSWITH str('arkiv')        # correct
  STARTSWITH(project, str('arkiv'))      # -32001 unexpected character
  project STARTSWITH 'arkiv'             # -32002 untagged strings ...
```

---

## Issue 2 — camelCase attribute names parse on read and can never match (silent zero)

**Title:** Uppercase attribute names return count=0 with no error, but the write path rejects them

**Body:**

`arkiv-data-modeling` correctly requires lowercase names, but presents the
rejection as a **write** constraint. The read path behaves differently and
dangerously — it accepts the name and returns `0`:

```bash
curl -s -X POST https://rpc.tiramisu.db-chain.testnet.arkiv.network \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_getEntityCount","params":[{"query":"reputationScore = 1"}]}'
# -> {"result":0}          no error

curl -s ... -d '{"...":{"query":"SCORE = 1"}}'
# -> {"result":0}          no error
```

But writing that name is rejected:

```
outside the name charset
decoded: Ident32InvalidByte 0x276f7798
```

So the name can never match a stored cell, yet the query succeeds and returns an
empty set. An agent cannot distinguish "no values" from "impossible query".

Suggested addition to `arkiv-query`:

```text
An attribute name containing an uppercase letter parses on the READ path and
returns 0. It can never match a stored cell: the write path rejects uppercase
with 'outside the name charset' (Ident32InvalidByte 0x276f7798). Treat a
zero-count result on an uppercase name as a query defect, not an empty set.
```

This is the highest-impact finding: it converts a detectable error into a silent
wrong answer.

---

## Issue 3 — type ambiguity is stated but never illustrated cross-project

**Title:** `arkiv-query`: type ambiguity is present in current data, not only legacy migrations

**Body:**

`arkiv-query/SKILL.md` line 24 states the rule correctly but illustrates it only
with `price_minor`, a legacy-migration case within one project. That makes it
easy to read as historical cleanup.

Measured live on a 9,000-row walk: **29 attribute names currently carry multiple
types across different projects on the same chain.**

| attribute | observations | types |
| --- | --- | --- |
| `v` | 3920 | i32, u64 |
| `rid` | 3006 | bytes32, str |
| `epoch` | 58 | i32, str, u64 |
| `version` | 37 | i32, str, u64 |
| `amount` | 4 | dec, u64 |

```text
v >= 1        -> 0                     (bare 1 is i32)
v >= u64(1)   -> matches u64 cells only
```

Neither returns the full set. Suggest adding a cross-project example and the
widening idiom:

```text
  (v >= i32(1) OR v >= u64(1))
```

---

## Issue 4 — `entity_type` is documented as the discriminator, but `type` is what is used

**Title:** `arkiv-data-modeling`: `type` is the conventional discriminator, and attributes are scoped per (project, type)

**Body:**

`arkiv-data-modeling/SKILL.md` line 25 says:

> `project` plus `entity_type` scopes an application's data.

Agents follow this and emit `entity_type`. Measured live:

| Attribute | Observations (9,000-row walk) |
| --- | --- |
| `type` | **5,425** |
| `entity_type` | 185 |

```text
project = str('mandi_board_v1') AND entity_type = str('price_report')  -> 0
project = str('mandi_board_v1') AND type = str('price_report')         -> 63
```

The three largest non-synthetic projects use `type` exclusively:

| project | discriminator | values |
| --- | --- | --- |
| mandi_board_v1 | `type` | price_report (63), price_vote (34) |
| underthetable | `type` | report (76), attestation (1) |
| bhaiyaplease | `type` | delivery (40), request (40), receipt (39), shop (5), attestation (3), complaint (1) |

**Compounding:** attributes are scoped to the `type` value, not the project.
Flattening them produces filters whose terms never co-occur:

```text
project = str('mandi_board_v1') AND type = str('price_vote')                     -> 34
project = str('mandi_board_v1') AND price >= dec(0)                              -> 63
project = str('mandi_board_v1') AND type = str('price_vote') AND price >= dec(0) -> 0
```

Suggest describing `type` as the conventional discriminator, `entity_type` as a
rarer valid alternative, and stating that the attribute set is scoped per
`(project, type)` pair.

---

## Optional — protocol note

`arkiv-query` presents `ARKIV_ACCESS_KEY` as optional. It is a hard
prerequisite in practice:

```
arkiv_query            ratelimit: limit=10000, remaining=0, reset=1579
arkiv_getEntityCount   ratelimit: limit=600,   remaining=599, reset=60
eth_blockNumber        not limited
```

The budgets are per-method, so the count method reports healthy while queries
are spent. The failure presents as an intermittent fault rather than a quota
until the body is read (`{"error":"ANON_COST_LIMITED"}`).
