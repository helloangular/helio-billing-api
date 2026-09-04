#!/usr/bin/env bash
# Print the sha256 the on-premise Nexus repository recorded for one release
# version of billing-api, prefixed "sha256:". Exit 1 when nothing is
# published. Used wherever a stage must know the expected artifact without
# downloading it (post-deployment verification in the segmented workflow).
#
# Usage: scripts/registry-digest.sh <release-version>
# Env:   NEXUS_URL (default http://127.0.0.1:8081), NEXUS_REPOSITORY (default helio-releases)
#        NEXUS_TOKEN or NEXUS_TOKEN_FILE (default ~/.helio-release-secrets/nexus-ci.token)
set -euo pipefail

release_version="${1:?release version is required}"
nexus_url="${NEXUS_URL:-http://127.0.0.1:8081}"
repository="${NEXUS_REPOSITORY:-helio-releases}"
token_file="${NEXUS_TOKEN_FILE:-$HOME/.helio-release-secrets/nexus-ci.token}"
command -v jq >/dev/null || { echo "jq is required on this runner" >&2; exit 2; }
if [[ -z "${NEXUS_TOKEN:-}" ]]; then
  [[ -r "$token_file" ]] || { echo "No Nexus credential: set NEXUS_TOKEN or provide $token_file" >&2; exit 2; }
  NEXUS_TOKEN="$(tr -d '[:space:]' < "$token_file")"
fi

digest="$(curl --silent --fail --user "$NEXUS_TOKEN" --get "$nexus_url/service/rest/v1/search/assets" \
  --data-urlencode "repository=$repository" --data-urlencode "name=billing-api" \
  --data-urlencode "version=$release_version" \
  | jq -r '[.items[] | select(.path | endswith(".war"))] | .[0].checksum.sha256 // empty')"
if [[ ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Nexus has no artifact for billing-api $release_version in $repository" >&2
  exit 1
fi
echo "sha256:$digest"
