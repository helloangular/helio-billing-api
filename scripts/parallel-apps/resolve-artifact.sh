#!/usr/bin/env bash
# Resolve exactly one app/version WAR from Nexus; never select a latest artifact.
# A pinned rollback digest is resolved only from this app's immutable local store.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/identity.sh"
release_key="${1:?release key is required}"
pinned_digest="${2:-}"
version="${3:-${RELEASE_VERSION:-}}"
package_path=""
if [[ -n "$pinned_digest" ]]; then
  digest="$pinned_digest"
else
  [[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ ]] || { echo "Invalid version" >&2; exit 2; }
  nexus_url="${NEXUS_URL:-http://127.0.0.1:8081}"
  repository="${NEXUS_REPOSITORY:-helio-releases}"
  token_file="${NEXUS_TOKEN_FILE:-$HOME/.helio-release-secrets/nexus-ci.token}"
  if [[ -z "${NEXUS_TOKEN:-}" ]]; then
    [[ -r "$token_file" ]] || { echo "No Nexus credential" >&2; exit 2; }
    NEXUS_TOKEN="$(tr -d '[:space:]' < "$token_file")"
  fi
  artifact_path="io/helio/$APP_SLUG/$version/$APP_SLUG-$version.war"
  expected="$(curl --silent --show-error --fail --connect-timeout 5 --max-time 30 \
    --user "$NEXUS_TOKEN" --get "$nexus_url/service/rest/v1/search/assets" \
    --data-urlencode "repository=$repository" --data-urlencode "name=$APP_SLUG" \
    --data-urlencode "version=$version" | jq -er --arg path "$artifact_path" '
      if .continuationToken != null then error("Unexpected paginated registry result") else . end |
      [.items[] | select(.path == $path)] |
      if length == 1 then .[0].checksum.sha256 else error("Expected exactly one artifact") end')"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo "Registry checksum missing" >&2; exit 3; }
  work_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/helio-parallel-artifact.XXXXXX")"
  package_path="$work_dir/$APP_SLUG.war"
  # Construct a same-registry URL; do not send credentials to a returned URL or redirects.
  curl --silent --show-error --fail --connect-timeout 5 --max-time 120 --user "$NEXUS_TOKEN" \
    --output "$package_path" "$nexus_url/repository/$repository/$artifact_path"
  digest="sha256:$(shasum -a 256 "$package_path" | awk '{print $1}')"
  [[ "$digest" == "sha256:$expected" ]] || { echo "Registry/download digest mismatch" >&2; exit 4; }
fi
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Invalid immutable digest" >&2; exit 4; }
printf 'artifact_digest=%s\npackage_path=%s\n' "$digest" "$package_path"
