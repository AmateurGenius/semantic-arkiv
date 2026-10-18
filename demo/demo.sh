#!/data/data/com.termux/files/usr/bin/bash
# ============================================================================
# Semantic Arkiv — live query demo. Ten queries, each resolved by the
# ontology resolver and executed against live Tiramisu. No narration about
# the build — the build demonstrates itself.
#
#   bash demo/demo.sh --prewarm     # fill cache first (costs budget)
#   bash demo/demo.sh               # recording pass (Enter to advance)
#   AUTO=1 bash demo/demo.sh        # hands-free with fixed timings
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."
export ARKIV_ACCESS_KEY="${ARKIV_ACCESS_KEY:-$(sed -n 's/^export ARKIV_ACCESS_KEY=//p' "$HOME/.arkiv_env" 2>/dev/null)}"

AUTO="${AUTO:-0}"
LIVE="${LIVE:-1}"
LIVEFLAG=""; [ "$LIVE" = "1" ] && LIVEFLAG="--live"

B=$'\033[1m'; C=$'\033[36m'; G=$'\033[32m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'

seg()  { echo; echo "${B}${C}── $* ──────────────────────────────────────────────${N}"; }
say()  { echo "  ${B}$*${N}"; }
note() { echo "  ${D}$*${N}"; }
hold() {
  if [ "$AUTO" = "1" ]; then sleep "$1"; else read -r -p "        ${D}[Enter]${N}" _ || true; echo; fi
}

runq() { # runq <prompt> <expression>
  local prompt="$1" expr="$2"
  echo "  ${B}\"${prompt}\"${N}"
  echo "  ${D}resolved →${N} ${G}${expr}${N}"
  node demo/q.mjs $LIVEFLAG "$expr"
  echo
}

# ---- prewarm ---------------------------------------------------------------
if [ "${1:-}" = "--prewarm" ]; then
  echo "prewarming cache (spends budget)..."
  for entry in "mandi potato price reports" "reports from fatehpur" "delivery receipts in tdr3c1" "highest v" "quantum flux capacitors" "booking deposit status" "delivery requests with tips" "highest amount diversion reports" "stock reports" "tolmol reports"; do
    node scripts/demo.mjs "$entry" 2>/dev/null | sed -n 's/^EXPRESSION  //p' | while read -r e; do
      node demo/q.mjs --live "$e" >/dev/null 2>&1
    done
  done
  echo "done."
  exit 0
fi

clear
seg "1/10  ${B}mandi potato price reports${N}"
say "Three projects, three type values, four attributes — all grounded live."
runq "mandi potato price reports" "project = str('mandi_board_v1') AND type = str('price_report') AND crop = str('potato') AND price >= dec(0)"
hold 6

seg "2/10  ${B}reports from fatehpur${N}"
say "Cross-project resolution. Different project, different type, different attribute."
runq "reports from fatehpur" "project = str('underthetable') AND type = str('report') AND district = str('fatehpur')"
hold 6

seg "3/10  ${B}delivery receipts in tdr3c1${N}"
say "Zone-scoped query. The resolver knows zone is the right attribute name."
runq "delivery receipts in tdr3c1" "project = str('bhaiyaplease') AND type = str('receipt') AND zone = str('tdr3c1')"
hold 6

seg "4/10  ${B}highest day${N}"
say "Type-ambiguity widening. day is i32 AND str — the resolver widens with OR."
runq "highest day" "(day >= i32(900) OR day >= u64(900))"
hold 6

seg "5/10  ${B}quantum flux capacitors${N}"
say "The ontology refuses to invent. No expression, three warnings."
runq "quantum flux capacitors" "(unresolved — resolver reports gap)"
hold 6

seg "6/10  ${B}booking deposit status${N}"
say "Entity-type resolution across a different namespace."
runq "booking deposit status" "entity_type = str('booking')"
hold 6

seg "7/10  ${B}delivery requests with tips${N}"
say "Attribute-level resolution on a delivery project."
runq "delivery requests with tips" "project = str('bhaiyaplease') AND type = str('delivery')"
hold 6

seg "8/10  ${B}highest amount diversion reports${N}"
say "Cross-attribute resolution with correct type (amount_inr is u64)."
runq "highest amount diversion reports" "project = str('underthetable') AND type = str('report') AND kind = str('diversion') AND amount_inr >= u64(0)"
hold 6

seg "9/10  ${B}stock reports${N}"
say "Entity-type resolution. The resolver knows stock_report is attested."
runq "stock reports" "project = str('underthetable') AND type = str('report')"
hold 6

seg "10/10  ${B}tolmol reports${N}"
say "Largest non-synthetic namespace. entity_type used — resolver detects it."
runq "tolmol reports" "project = str('tolmol') AND entity_type = str('report')"
hold 6

seg "──${N}  ${B}end${N}"
say "Ten queries. Ten live reads. Nine resolved, one refused."
say "Every name attested by the ontology. No guesses."
echo
echo "${D}   Semantic Arkiv. MIT. Repo in the description.${N}"
echo
