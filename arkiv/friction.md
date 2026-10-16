# Friction report — Arkiv Tiramisu query surface

Environment for every finding below:

| | |
| --- | --- |
| Network | Tiramisu testnet |
| RPC | `https://rpc.tiramisu.db-chain.testnet.arkiv.network` |
| Chain ID | `7738577` (`0x7614d1`) |
| SDK | `@arkiv-network/sdk` 0.8.1 |
| Skills revision | `github.com/Arkiv-Network/skills` @ 2026-10-16 |
| Probe date | 2026-10-16 |
| Agent model | `meituan/longcat-2.5-preview:free` |
| Evidence | `data/rate-limit-evidence.json`, `benchmark/results.json` |

Every finding was produced by a live `arkiv_getEntityCount` or `arkiv_query`
call. The reproduction command is given for each.

---

## F-1 — The camelCase silent-zero trap (highest severity)

**Expected.** An attribute name that is not valid on the write path should be
rejected on the read path, or at least flagged.

**Actual.** It parses, succeeds, and returns `0` with no error.

```bash
curl -s -X POST https://rpc.tiramisu.db-chain.testnet.arkiv.network \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_getEntityCount","params":[{"query":"reputationScore = 1"}]}'
# -> {"jsonrpc":"2.0","id":1,"result":0}      <-- no error

curl -s -X POST https://rpc.tiramisu.db-chain.testnet.arkiv.network \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_getEntityCount","params":[{"query":"SCORE = 1"}]}'
# -> {"jsonrpc":"2.0","id":1,"result":0}      <-- no error
```

But the write path rejects the same name:

```
outside the name charset
decoded: Ident32InvalidByte 0x276f7798
```

**Why it matters.** Uppercase names can *never* match a stored cell. The query
is syntactically valid, semantically impossible, and returns a clean empty
result. An agent cannot distinguish "no results" from "impossible query". In the
benchmark, 3 of 10 markdown-only expressions carried this defect (70% carried at
least one silent-zero defect overall).

**Impact on the original plan.** The plan's own example filter —
`... && type = "Profile" && is_mentor = true` — mixes this trap with two others
and returns zero rows with no error. It would have shipped as "working".

**Suggested fix.** Reject `[A-Z]` in a predicate attribute name on the read path
with the same error the write path uses, or emit a warning field in the
`arkiv_query` result when a predicate references a name that the write path
would refuse.

---

## F-2 — C-style symbol operators were removed

**Expected.** `&&` and `||` are what the Arkiv Hub documentation and every SQL
example use. An agent will reach for them.

**Actual.** Rejected `-32001`:

```
symbol operators (&& || ~) were removed — use AND, OR, STARTSWITH
```

```bash
curl -s -X POST https://rpc.tiramisu.db-chain.testnet.arkiv.network \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"arkiv_getEntityCount","params":[{"query":"project = str(\"a\") && project = str(\"b\")"}]}'
# -> -32001 symbol operators (&& || ~) were removed
```

Also removed: `!` for negation (`unexpected '!' — negation is written NOT`) and
`!=` (`!= is not part of the query language — write NOT (attr = value) for that`).

**Why it matters.** All 10 of 10 markdown-only benchmark expressions used `&&`.
None were executable. This is the single highest-frequency grammar failure.

**Suggested fix.** The `arkiv-query` skill documents `and`, `or`, `not` as SDK
builder functions but does not state that the *symbol* forms are removed at the
wire level. Add an explicit "removed syntax" table.

---

## F-3 — STARTSWITH is infix only, and the syntax is undocumented

**Expected.** A prefix operator is documented as "a string prefix operator"
(`arkiv-query/SKILL.md`), which reads like a function.

**Actual.** The function form is rejected; only the infix form works.

```bash
# REJECTED
curl -s ... -d '{"...":{"query":"STARTSWITH(project, str(\"arkiv\"))"}}'
# -> -32001 unexpected character

# ACCEPTED
curl -s ... -d '{"...":{"query":"project STARTSWITH str(\"arkiv\")"}}'
# -> 1063

# REJECTED — right operand must be tagged
curl -s ... -d '{"...":{"query":"project STARTSWITH \"arkiv\""}}'
# -> -32002 untagged strings are only valid for system attributes
```

**Why it matters.** An agent has a 1-in-3 chance of guessing the correct form,
and the skill provides no example.

**Suggested fix.** Add one worked line to `arkiv-query/SKILL.md`:
`project STARTSWITH str('arkiv')`.

---

## F-4 — Literal constructors are inconsistent across types

**Expected.** A single literal convention.

**Actual.** Four different rules, none of them stated together:

| Attempt | Result |
| --- | --- |
| `dec(4.5)` | accepted (74 rows) |
| `dec('4.5')` | `-32003 dec expects decimal digits` |
| `4.5` | `-32001 unexpected character` |
| `bool(true)` | `-32003 bool takes no wrapper — write the literal true or false` |
| `active = true` | accepted |
| `$createdAt >= 0` | `-32002 this system attribute holds u64 — write u64(0)` |
| `$createdAt >= u64(0)` | accepted (10,100 rows) |
| `str("x")` | `-32003 str takes a single-quoted string, e.g. str('Bob')` |

**Why it matters.** `dec()` takes bare digits while `str()` requires quotes —
the opposite convention. `bool()` is an SDK constructor that is invalid as query
syntax. System u64 attributes require an explicit constructor that ordinary u64
attributes do not. Each is a separate trip-hazard.

**Suggested fix.** One consolidated literal table in `arkiv-query/SKILL.md`.

---

## F-5 — The query budget is cost-metered and undocumented

**Expected.** Read-only queries against a testnet are effectively free, or
rate-limited by request count.

**Actual.** `arkiv_query` is metered by **cost**, with a 10,000-unit anonymous
budget. Exhausting it returns:

```
HTTP/2 429
ratelimit: limit=10000, remaining=0, reset=2464
retry-after: 2464
access-control-expose-headers: RateLimit, Retry-After, Link,
                               Arkiv-Quota-Used-Percent, Arkiv-Cost

{"error":"ANON_COST_LIMITED",
 "message":"unauthenticated query budget exhausted; get an API key at
            https://hub.arkiv.network for a monthly quota"}
```

The budgets are **per-method**, which is what makes this genuinely confusing.
Measured on the same connection at the same moment:

| Method | `ratelimit` header |
| --- | --- |
| `arkiv_query` | `limit=10000, remaining=0, reset=1579` |
| `arkiv_getEntityCount` | `limit=600, remaining=599, reset=60` |
| `eth_blockNumber` | not limited |

So `arkiv_getEntityCount` reports a healthy budget while `arkiv_query` is fully
exhausted. The failure presents as an intermittent fault on one method rather
than a spent quota, until the response body is read.

**Why it matters.** A 45-page reconnaissance walk consumed the entire anonymous
budget. Any realistic development or benchmarking session will too. The Arkiv
Hub access key is therefore a hard prerequisite, not an optimisation — and the
`arkiv-query` skill presents `ARKIV_ACCESS_KEY` as optional.

**Suggested fix.** Document the cost model, the anonymous budget, the
`Arkiv-Cost` header, and the `ANON_COST_LIMITED` error in `arkiv-query`, and
recommend a key for anything beyond interactive exploration.

---

## F-6 — Type-ambiguous attribute names (29 of them)

**Expected.** An attribute name has one type.

**Actual.** 29 names carry multiple types across projects. Full table in
`schema.md` §4.1.

```bash
# 'v' is stored as both i32 and u64
curl -s ... -d '{"...":{"query":"v >= 1"}}'      # -> 0   (bare 1 is i32)
curl -s ... -d '{"...":{"query":"v >= u64(1)"}}'  # -> matches the u64 cells only
```

Neither query returns the full set. `epoch` and `version` each carry three types.

**Why it matters.** A typed predicate matches only cells stored with that exact
type. An agent that picks one type silently loses every other project's rows.
The `arkiv-query` skill states the rule but gives no cross-project example, so
the consequence is easy to underestimate.

**Suggested fix.** Add a worked example using a real ambiguous name, and
recommend widening: `(v >= i32(1) OR v >= u64(1))`.

---

## F-7 — `entity_type` is documented as the discriminator, but `type` is what is used

**Expected.** `arkiv-data-modeling` says:

> `project` plus `entity_type` scopes an application's data.

An agent reads that and emits `entity_type = str('...')` for every query.

**Actual.** `type` is 29× more common than `entity_type`, and the three largest
non-synthetic projects use `type` exclusively.

```bash
curl -s ... -d '{"...":{"query":"project = str(\"mandi_board_v1\") AND entity_type = str(\"price_report\")"}}'
# -> 0
curl -s ... -d '{"...":{"query":"project = str(\"mandi_board_v1\") AND type = str(\"price_report\")"}}'
# -> 63
```

| Attribute | Observations |
| --- | --- |
| `type` | 5,425 |
| `entity_type` | 185 |

Per namespace: mandi_board_v1 uses `type` (`price_report`, `price_vote`),
underthetable uses `type` (`report`, `attestation`), bhaiyaplease uses `type`
(`delivery`, `request`, `receipt`, `shop`, `attestation`, `complaint`). None
uses `entity_type`.

**Compounding trap.** Within one project, attributes are scoped to the `type`
value, not the project. Flattening them produces filters whose terms never
co-occur:

```text
project = str('mandi_board_v1') AND type = str('price_vote')                     -> 34
project = str('mandi_board_v1') AND price >= dec(0)                              -> 63
project = str('mandi_board_v1') AND type = str('price_vote') AND price >= dec(0) -> 0
```

**Why it matters.** Following the documented convention yields a query that
parses, succeeds, and returns nothing — F-1's failure mode again, reached by
following the guidance correctly.

**Suggested fix.** `arkiv-data-modeling` should describe `type` as the
conventional discriminator, note that `entity_type` is a valid but much rarer
alternative, and state that attributes must be scoped per `(project, type)`
pair rather than per project.

---

## Summary

| ID | Finding | Node response | Severity |
| --- | --- | --- | --- |
| F-1 | camelCase parses, can never match | silent `count=0` | **Critical** |
| F-2 | `&&` `\|\|` `!` `!=` removed | `-32001` / `-32002` | High |
| F-3 | STARTSWITH infix only, undocumented | `-32001` | Medium |
| F-4 | Inconsistent literal constructors | `-32001` / `-32003` | Medium |
| F-5 | Cost-metered anonymous budget | `429 ANON_COST_LIMITED` | High |
| F-6 | 29 type-ambiguous names | silent partial results | **Critical** |
| F-7 | `type` vs `entity_type` discriminator | silent `0` rows | **Critical** |

F-1, F-6 and F-7 are the dangerous trio: each produces a query that succeeds
with wrong or missing data, and none surfaces an error.
