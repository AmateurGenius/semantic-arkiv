# Skill feedback — Arkiv-Network/skills

Three documentation gaps found while building a resolver against the live
Tiramisu node. Each is a place where the skill is *correct but incomplete*, and
the incompleteness produces a silent failure.

Filed against: `github.com/Arkiv-Network/skills` @ 2026-10-16
Verified against: Tiramisu, SDK 0.8.1, chain 7738577

---

## 1. `arkiv-query` — STARTSWITH syntax is never shown

**File:** `skills/arkiv-query/SKILL.md`

**Current text (line 146):**

> `STARTSWITH` is a string prefix operator, not full-text search or SQL LIKE.

and (line 144):

> Use SDK `eq`, numeric `gt/gte/lt/lte`, `and`, `or`, `not` and string `startsWith`.

**Problem.** Both read as function calls. The node accepts only the infix form,
and rejects the function form with `-32001 unexpected character`:

| Attempt | Result |
| --- | --- |
| `STARTSWITH(project, str('arkiv'))` | `-32001 unexpected character` |
| `startswith(project, str('arkiv'))` | `-32001 unexpected character` |
| `project STARTSWITH str('arkiv')` | **accepted — 1063 rows** |
| `project STARTSWITH 'arkiv'` | `-32002 untagged strings are only valid for system attributes` |

**Proposed change.** Add to the predicates section:

```text
STARTSWITH is INFIX. The right operand must be a tagged string literal.

  project STARTSWITH str('arkiv')        # correct
  STARTSWITH(project, str('arkiv'))      # -32001 unexpected character
  project STARTSWITH 'arkiv'             # -32002 untagged strings ...
```

---

## 2. `arkiv-query` / `arkiv-data-modeling` — no camelCase read/write asymmetry warning

**Files:** `skills/arkiv-query/SKILL.md`, `skills/arkiv-data-modeling/SKILL.md`

**Current text.** `arkiv-data-modeling` correctly says lowercase names are
required and notes the write-path rejection:

> Use lowercase `snake_case` application names ... `outside the name charset` /
> decoded `Ident32InvalidByte`

**Problem.** This is presented as a *write* constraint. The read path behaves
differently and dangerously: it accepts the name and returns `count=0`.

```json
{"method":"arkiv_getEntityCount","params":[{"query":"reputationScore = 1"}]}
{"result":0}
```

No error. No warning. The same name cannot exist on chain, because the write
path refuses it. An agent therefore cannot distinguish "this attribute has no
values" from "this attribute is impossible".

**Proposed change.** Add a read-path note to `arkiv-query`:

```text
An attribute name containing an uppercase letter parses on the READ path and
returns 0. It can never match a stored cell: the write path rejects uppercase
with 'outside the name charset' (Ident32InvalidByte 0x276f7798). Treat a
zero-count result on an uppercase name as a query defect, not an empty set.
```

This is the finding with the highest practical impact — it converts a
detectable error into a silent wrong answer.

---

## 3. `arkiv-query` — type ambiguity rule stated but never illustrated

**File:** `skills/arkiv-query/SKILL.md` (line 24)

**Current text:**

> A typed predicate matches only cells stored with that type. `gte('price_minor',
> u256(0n))` also excludes legacy `i32` prices; a bare-number predicate does the
> reverse.

**Problem.** The rule is correct and important, but the only example is
`price_minor`, a *legacy migration* case within one project. It does not convey
that **29 distinct attribute names currently carry multiple types across
different projects on the same chain**, so the trap fires today, not just
against legacy data.

Real examples measured live:

| attribute | observations | types |
| --- | --- | --- |
| `v` | 3920 | i32, u64 |
| `rid` | 3006 | bytes32, str |
| `epoch` | 58 | i32, str, u64 |
| `version` | 37 | i32, str, u64 |
| `amount` | 4 | dec, u64 |

**Proposed change.** Add a cross-project example and the widening idiom:

```text
Type ambiguity is present in the shared database, not only in legacy data.
Measured 2026-10-16: 29 attribute names carry more than one type across
projects ('v' is i32 in one and u64 in another; 'epoch' is i32, str and u64).

Widen explicitly when you cannot scope to a single project:

  (v >= i32(1) OR v >= u64(1))
```

---

## 4. `arkiv-data-modeling` — `entity_type` documented as the discriminator, but `type` is what is used

**File:** `skills/arkiv-data-modeling/SKILL.md` (line 25)

**Current text:**

> `project` plus `entity_type` scopes an application's data.

**Problem.** Agents follow this and emit `entity_type`. Measured on the live
shared database, `type` is 29× more common and the three largest non-synthetic
projects use `type` exclusively:

| Attribute | Observations (9,000-row walk) |
| --- | --- |
| `type` | **5,425** |
| `entity_type` | 185 |

```text
project = str('mandi_board_v1') AND entity_type = str('price_report')  -> 0
project = str('mandi_board_v1') AND type = str('price_report')         -> 63
```

**Compounding problem.** Attributes are scoped to the `type` value, not the
project. A model that flattens a project's attributes across its `type` values
generates filters whose terms never co-occur:

```text
project = str('mandi_board_v1') AND type = str('price_vote')                     -> 34
project = str('mandi_board_v1') AND price >= dec(0)                              -> 63
project = str('mandi_board_v1') AND type = str('price_vote') AND price >= dec(0) -> 0
```

**Proposed change.** Describe `type` as the conventional discriminator,
`entity_type` as a rarer valid alternative, and state explicitly that the
attribute set is scoped per `(project, type)` pair.

---

## Additional finding (protocol, not documentation)

`arkiv-query` presents `ARKIV_ACCESS_KEY` as an optional local convenience. It
is a hard prerequisite in practice: `arkiv_query` is cost-metered, the anonymous
budget is 10,000 units, and exhausting it returns `429` with
`{"error":"ANON_COST_LIMITED"}` and a `Retry-After` measured in tens of minutes.
`eth_blockNumber` is unaffected, so the failure presents as an intermittent
fault rather than a spent quota.

Suggest documenting the cost model, the `Arkiv-Cost` and
`Arkiv-Quota-Used-Percent` response headers, and the `ANON_COST_LIMITED` error
body in the query skill.

---

## Status

| # | Gap | Impact |
| --- | --- | --- |
| 1 | STARTSWITH syntax undocumented | 1-in-3 guess rate |
| 2 | camelCase read/write asymmetry unwarned | silent wrong answer |
| 3 | Type ambiguity not illustrated cross-project | silent partial results |
| 4 | `entity_type` documented instead of `type` | silent `0` rows |
| — | Access key presented as optional | hard blocker mid-session |
