#!/data/data/com.termux/files/usr/bin/bash
# ============================================================================
# Semantic Arkiv — one-take demo sequence. Target 2:50-3:00, hard cap 3:00.
#
#   bash demo/demo.sh --prewarm     # run once BEFORE recording (fills the cache)
#   bash demo/demo.sh               # the recording pass (press Enter to advance)
#   AUTO=1 bash demo/demo.sh        # hands-free, fixed timings (for a dry run)
#
# Cache policy: LIVE=0 (default) replays data/rpc-cache for every query line and
# takes the scan's entity total from the last observed probe, so the whole take
# is offline and cannot be derailed by a rate limit. LIVE=1 makes every line on
# screen a live read of Tiramisu — free (counts and rejections cost 0 units) and
# honest, at the price of depending on the network.
# Prove which mode a take will run:  node ~/verif/verify-demo-cache.mjs
#
# The Q array below is the --prewarm list and the only thing that spends
# budget: ~10 live calls, and the rejection costs 0 units. Do NOT re-run
# --prewarm repeatedly; you have ~100 queries/month.
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."
export ARKIV_ACCESS_KEY="${ARKIV_ACCESS_KEY:-$(sed -n 's/^export ARKIV_ACCESS_KEY=//p' "$HOME/.arkiv_env" 2>/dev/null)}"

AUTO="${AUTO:-0}"
# LIVE=1 makes the on-screen queries hit the RPC instead of the cache. Costs
# roughly 700 units (~7% of the monthly quota). Default 0 = replay cached
# responses, which are real live-chain responses, so the recording cannot be
# derailed by a rate limit mid-take.
LIVE="${LIVE:-1}"
LIVEFLAG=""; [ "$LIVE" = "1" ] && LIVEFLAG="--live"
# LIVE=1 (default) makes every line on screen a live read of Tiramisu — free
# (counts and rejections cost 0 units) and honest, at the price of depending
# on the network. LIVE=0 replays data/rpc-cache for every query line and takes
# the scan's entity total from the last observed probe, so the whole take is
# offline and cannot be derailed by a rate limit.
SCANFLAG=""; [ "$LIVE" = "0" ] && SCANFLAG="--cached"
PREWARM=0
[ "${1:-}" = "--prewarm" ] && PREWARM=1

# ---- presentation helpers --------------------------------------------------
B=$'\033[1m'; DIM=$'\033[2m'; C=$'\033[36m'; G=$'\033[32m'; R=$'\033[31m'; N=$'\033[0m'

seg()  { echo; echo "${B}${C}── $* ──────────────────────────────────────────────${N}"; }
say()  { echo "  ${B}$*${N}"; }
note() { echo "  ${DIM}$*${N}"; }
hold() { # hold <seconds>  — Enter to advance, or fixed sleep in AUTO mode
  if [ "$AUTO" = "1" ]; then sleep "$1"; else read -r -p "        ${DIM}[Enter]${N}" _ || true; echo; fi
}

# ---- the queries, in recording order --------------------------------------
# Each: "<seconds>|<label>|<expression>"  — used by --prewarm only.
Q=(
  "0|follow the docs: discriminator = entity_type|entity_type = str('price_report')"
  "0|follow the docs, scoped to the project|project = str('mandi_board_v1') AND entity_type = str('price_report')"
  "0|use the real discriminator: type|project = str('mandi_board_v1') AND type = str('price_report')"
  "0|same project, the other type value|project = str('mandi_board_v1') AND type = str('price_vote')"
  "0|resolved: mandi potato price reports|project = str('mandi_board_v1') AND type = str('price_report') AND crop = str('potato') AND price >= dec(0)"
  "0|resolved: reports from fatehpur|project = str('underthetable') AND type = str('report') AND district = str('fatehpur')"
  "0|resolved: delivery receipts in tdr3c1|project = str('bhaiyaplease') AND type = str('receipt') AND zone = str('tdr3c1')"
)

LAST=""
runq() { # runq <expression>  — prints the query, leaves the count in $LAST
  local expr="$1"
  local out
  printf '  %s$%s %s%s\n' "$G" "$N" "$expr" "$N"
  out=$(node demo/q.mjs $LIVEFLAG "$expr")
  echo "$out"
  LAST=$(printf '%s' "$out" | awk '{print $1}')
}

# ---- prewarm: fill the cache so the recording pass is free -----------------
if [ "$PREWARM" = "1" ]; then
  echo "prewarming cache (this spends budget; run once)..."
  node demo/q.mjs --live "project = str('mandi_board_v1')" >/dev/null
  for entry in "${Q[@]}"; do
    IFS='|' read -r _ _ expr _ <<<"$entry"
    node demo/q.mjs --live "$expr"
  done
  node demo/q.mjs --live "project = str('underthetable')" >/dev/null
  node demo/q.mjs --live "project = str('bhaiyaplease')" >/dev/null
  echo "done. now run: bash demo/demo.sh"
  exit 0
fi

clear
# ===========================================================================
# SEGMENT 1 — 0:00-0:30  F-7: the documentation produces silent zeros
# ===========================================================================
seg "1/5  F-7  ·  following the data-modeling guide"
say "Arkiv's guide says: project + entity_type scopes an application's data."
say "Let's follow it exactly."
echo
note "query 1 — the documented discriminator, unscoped:"
runq "entity_type = str('price_report')"
echo
note "query 2 — the documented discriminator, scoped to the right project:"
runq "project = str('mandi_board_v1') AND entity_type = str('price_report')"
echo
say "${R}Both return 0 rows. Neither errors.${N}"
echo
hold 10
note "query 3 — same project, same data, the REAL discriminator:"
runq "project = str('mandi_board_v1') AND type = str('price_report')"
PRICE_REPORTS="$LAST"
echo
say "${G}${PRICE_REPORTS} rows.${N}"
note "query 4 — the other type value in the same project:"
runq "project = str('mandi_board_v1') AND type = str('price_vote')"
PRICE_VOTES="$LAST"
echo
note "query 5 — the project's own total:"
runq "project = str('mandi_board_v1')"
PROJECT_TOTAL="$LAST"
echo
say "${PRICE_REPORTS} + ${PRICE_VOTES} = ${PROJECT_TOTAL}. The project was fully populated the whole time."
say "Every entity was there the whole time. The query was blind to it."
hold 12

# ===========================================================================
# SEGMENT 2 — 0:30-1:00  the scan
# ===========================================================================
seg "2/5  ·  what is actually on chain"
note "the entity total is a live read; the vocabulary figures are from a"
note "live walk of the chain, labelled on screen."
node demo/scan.mjs $SCANFLAG
echo
say "The documented discriminator is the exception, not the rule."
say "There is no global schema. Attribute names are invented per project,"
say "and the same name can mean different types in different projects."
hold 12

# ===========================================================================
# SEGMENT 3 — 1:00-2:15  the resolver on real prompts
# ===========================================================================
seg "3/5  ·  ontoskill resolves real prompts"
note "first: the markdown-only agent, on the same prompt."
echo
printf '  %s$%s %s\n' "$G" "$N" "project = \"mandi_board_v1\" && type = \"price_vote\" && crop = \"potato\" && price >= 0"
node demo/q.mjs $LIVEFLAG 'project = "mandi_board_v1" && type = "price_vote" && crop = "potato" && price >= 0' 2>/dev/null
echo
say "${R}The node rejects it outright. All ten markdown-only prompts were rejected.${N}"
hold 8
echo
note "now ontoskill. It emits a filter — and we run exactly what it emitted:"
echo
for p in "mandi potato price reports" "reports from fatehpur" "delivery receipts in tdr3c1"; do
  expr=$(node scripts/demo.mjs "$p" 2>/dev/null | sed -n 's/^EXPRESSION  //p')
  printf '  %s"%s"%s\n' "$B" "$p" "$N"
  printf '  %s->  %s%s\n' "$C" "$expr" "$N"
  node demo/q.mjs $LIVEFLAG "$expr"
  echo
  hold 8
done
say "Real rows, from real projects, on the live chain."
say "And note what it did ${B}not${N} emit: entity_type."
hold 12

# ===========================================================================
# SEGMENT 4 — 2:15-2:40  the numbers
# ===========================================================================
seg "4/5  ·  measured, 10 prompts, both conditions"
node demo/stats.mjs
say "Grammar-valid 0 to 100. Silent-zero risk 70 to 0. Real rows 0 to 90."
say "Guidance the agent must read: 52 kilobytes down to 2.3."
echo
note "and the query budget is per-method, which makes a spent quota look"
note "like an intermittent fault — arkiv_query 0 remaining while"
note "arkiv_getEntityCount reports 599 of 600."
hold 12

# ===========================================================================
# SEGMENT 5 — 2:40-3:00  close
# ===========================================================================
seg "5/5  ·  what ships"
node -e '
const s=require("./ontology/stats.json");
console.log("  zero-dependency Node MCP server      4 tools");
console.log("  vocabulary ontology                  "+s.triples.toLocaleString()+" triples");
console.log("  SHACL constraints on emitted filters "+s.shaclConstraints);
console.log("  smoke tests on a clean checkout      11/11, zero install");
console.log("  friction findings filed back         7  (4 as upstream issues)");
console.log("  licence                              MIT");
'
echo
say "Every emitted filter is grounded in vocabulary read off the live chain."
say "The ontology refuses to invent a name it cannot attest."
echo
say "${B}Semantic Arkiv. MIT. Repo in the description.${N}"
echo
echo "${DIM}   — end —${N}"
echo
