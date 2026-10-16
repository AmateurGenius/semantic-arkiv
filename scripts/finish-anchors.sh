#!/data/data/com.termux/files/usr/bin/bash
# Finish the anchor capture and complete the benchmark's live-row column.
#
# Run this once the arkiv_query cost budget has reset, or with ARKIV_ACCESS_KEY
# set to a key from https://hub.arkiv.network. Idempotent: probe responses are
# cached under data/rpc-cache, so a partial run resumes rather than restarts.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Semantic Arkiv: completing anchor capture =="
echo

echo "--- 1/3 anchor probe ---"
if node scripts/probe.mjs 2>&1 | tail -8; then
  echo "probe: OK"
else
  echo "probe: FAILED (budget still exhausted? set ARKIV_ACCESS_KEY and retry)"
  exit 1
fi
echo

echo "--- 2/3 rebuild ontology from captured data ---"
node scripts/build-ontology.mjs
echo

echo "--- 3/3 benchmark with live rows ---"
node benchmark/run.mjs 2>/dev/null | sed -n '/=== SUMMARY ===/,/=== PER PROMPT ===/p' | head -45
echo

echo "--- artifacts ---"
for f in data/anchor-schemas.json data/anchor-schemas.md benchmark/results.json; do
  if [ -f "$f" ]; then
    printf '  %-32s %s bytes\n' "$f" "$(wc -c < "$f")"
  else
    printf '  %-32s MISSING\n' "$f"
  fi
done
echo
echo "Done. Re-read arkiv/schema.md to fold the per-namespace tables in."
