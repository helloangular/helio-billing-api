#!/usr/bin/env bash
# Post-deployment verification: the context must be UP and must be serving
# exactly the expected artifact. "Something shaped like a digest" is not
# enough; the serving digest is compared with the digest that was approved,
# and the version with the release version unless this is a rollback.
#
# Usage: scripts/verify-deployment.sh <base-url> <expected-digest> [expected-version]
set -euo pipefail

base_url="${1:?base url is required}"
expected_digest="${2:?expected sha256 digest is required}"
expected_version="${3:-}"
base_url="${base_url%/}"
command -v jq >/dev/null || { echo "jq is required on this runner" >&2; exit 2; }

if [[ ! "$expected_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Expected digest is not an immutable SHA-256: $expected_digest" >&2
  exit 2
fi

health="$(curl --fail --silent --show-error --max-time 5 "$base_url/health")"
status="$(jq -r .status <<<"$health")"
serving_digest="$(curl --fail --silent --show-error --max-time 5 "$base_url/artifact-digest" | tr -d '[:space:]')"
serving_version="$(curl --fail --silent --show-error --max-time 5 "$base_url/version" | tr -d '[:space:]')"

if [[ "$status" != "UP" ]]; then
  echo "Verification failed: $base_url/health reports status $status" >&2
  exit 1
fi
if [[ "$serving_digest" != "$expected_digest" ]]; then
  echo "Verification failed: $base_url serves $serving_digest, expected $expected_digest" >&2
  exit 1
fi
if [[ -n "$expected_version" && "$serving_version" != "$expected_version" ]]; then
  echo "Verification failed: $base_url serves version $serving_version, expected $expected_version" >&2
  exit 1
fi
echo "Verified: $base_url is UP serving $serving_version ($serving_digest)"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'serving_digest=%s\nserving_version=%s\n' "$serving_digest" "$serving_version" >> "$GITHUB_OUTPUT"
fi
