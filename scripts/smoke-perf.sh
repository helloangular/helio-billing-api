#!/usr/bin/env bash
# Real smoke + performance stage against a deployed environment: the
# application must be up with the expected release identity, and the measured
# p95 latency over a run of sequential requests must be inside the budget.
#
# Usage: scripts/smoke-perf.sh <base-url> [expected-version]
# Env:   PERF_SAMPLES (default 40), PERF_P95_BUDGET_MS (default 500)
set -euo pipefail

base_url="${1:?base url is required}"
expected_version="${2:-}"
samples="${PERF_SAMPLES:-40}"
budget_ms="${PERF_P95_BUDGET_MS:-500}"
base_url="${base_url%/}"
command -v jq >/dev/null || { echo "jq is required on this runner" >&2; exit 2; }

health="$(curl --fail --silent --show-error --max-time 5 "$base_url/health")"
status="$(jq -r .status <<<"$health")"
version="$(jq -r .version <<<"$health")"
digest="$(curl --fail --silent --show-error --max-time 5 "$base_url/artifact-digest" | tr -d '[:space:]')"
if [[ "$status" != "UP" ]]; then
  echo "Smoke: $base_url/health reports status $status" >&2
  exit 1
fi
if [[ -n "$expected_version" && "$version" != "$expected_version" ]]; then
  echo "Smoke: $base_url serves $version, expected $expected_version" >&2
  exit 1
fi
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Smoke: $base_url/artifact-digest is not an immutable digest: $digest" >&2
  exit 1
fi
echo "Smoke: $base_url is UP serving $version ($digest)"

times_file="$(mktemp)"
trap 'rm -f "$times_file"' EXIT
for _ in $(seq 1 "$samples"); do
  curl --silent --show-error --output /dev/null --max-time 5 \
    --write-out '%{time_total}\n' "$base_url/health" >> "$times_file"
done
read -r p50 p95 max < <(sort -n "$times_file" | awk '
  { a[NR] = $1 * 1000 }
  END {
    i50 = int(NR * 0.50 + 0.999); if (i50 < 1) i50 = 1
    i95 = int(NR * 0.95 + 0.999); if (i95 < 1) i95 = 1
    printf "%.1f %.1f %.1f\n", a[i50], a[i95], a[NR]
  }')
echo "Performance: $samples requests to /health  p50=${p50}ms  p95=${p95}ms  max=${max}ms  budget p95<=${budget_ms}ms"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'p50_ms=%s\np95_ms=%s\nmax_ms=%s\nversion=%s\n' "$p50" "$p95" "$max" "$version" >> "$GITHUB_OUTPUT"
fi
if awk -v p="$p95" -v b="$budget_ms" 'BEGIN { exit !(p > b) }'; then
  echo "Performance budget exceeded: p95 ${p95}ms > ${budget_ms}ms" >&2
  exit 1
fi
