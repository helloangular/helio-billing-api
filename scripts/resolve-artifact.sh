#!/usr/bin/env bash
# Resolve the immutable WAR a deployment stage must install.
#
# Order of precedence:
#   1. A digest Helio pinned (rollback / redeploy): the WAR must already be in
#      the local immutable store; nothing is downloaded.
#   2. The on-premise Nexus repository, the release artifact system of record:
#      the WAR published for this release version is downloaded and its
#      sha256 must equal the checksum Nexus recorded.
#   3. The GitHub artifact package-<release key> uploaded by the build stage,
#      only when NEXUS_URL is explicitly empty (cloud-only rehearsal).
#
# Prints key=value lines for $GITHUB_OUTPUT; diagnostics go to stderr.
#
# Usage: scripts/resolve-artifact.sh <release-key> [pinned-digest] [release-version]
# Env:   NEXUS_URL (default http://127.0.0.1:8081; set to "" to skip Nexus)
#        NEXUS_REPOSITORY (default helio-releases), NEXUS_TOKEN / NEXUS_TOKEN_FILE
#        GH_TOKEN, GITHUB_REPOSITORY, RUNNER_TEMP (from the workflow)
set -euo pipefail

release_key="${1:?release key (Helio release id or GitHub run id) is required}"
pinned_digest="${2:-}"
release_version="${3:-${RELEASE_VERSION:-}}"
nexus_url="${NEXUS_URL-http://127.0.0.1:8081}"
repository="${NEXUS_REPOSITORY:-helio-releases}"
token_file="${NEXUS_TOKEN_FILE:-$HOME/.helio-release-secrets/nexus-ci.token}"
work_dir="${RUNNER_TEMP:-$(mktemp -d)}/package-${GITHUB_RUN_ID:-local}-$$"

resolve_from_nexus() {
  [[ -n "$release_version" ]] || { echo "Release version is required to resolve from Nexus" >&2; return 1; }
  if [[ -z "${NEXUS_TOKEN:-}" ]]; then
    [[ -r "$token_file" ]] || { echo "No Nexus credential: set NEXUS_TOKEN or provide $token_file" >&2; return 1; }
    NEXUS_TOKEN="$(tr -d '[:space:]' < "$token_file")"
  fi
  local record source expected
  record="$(curl --silent --fail --user "$NEXUS_TOKEN" --get "$nexus_url/service/rest/v1/search/assets" \
    --data-urlencode "repository=$repository" --data-urlencode "name=billing-api" \
    --data-urlencode "version=$release_version" \
    | jq -c '[.items[] | select(.path | endswith(".war"))] | .[0] // empty')"
  if [[ -z "$record" ]]; then
    echo "Nexus has no artifact for billing-api $release_version in $repository" >&2
    return 1
  fi
  source="$(jq -r '.downloadUrl' <<<"$record")"
  expected="$(jq -r '.checksum.sha256 // empty' <<<"$record")"
  if [[ ! "$expected" =~ ^[0-9a-f]{64}$ ]]; then
    echo "Nexus recorded no sha256 for billing-api $release_version" >&2
    return 1
  fi
  mkdir -p "$work_dir"
  package_path="$work_dir/billing-api.war"
  curl --silent --show-error --fail --user "$NEXUS_TOKEN" --output "$package_path" "$source"
  digest="sha256:$(shasum -a 256 "$package_path" | awk '{print $1}')"
  if [[ "$digest" != "sha256:$expected" ]]; then
    echo "Downloaded WAR $digest does not match the registry checksum sha256:$expected" >&2
    return 1
  fi
  echo "Resolved billing-api $release_version from Nexus -> $digest" >&2
}

resolve_from_github() {
  if [[ ! "$release_key" =~ ^([0-9a-fA-F-]{36}|[0-9]+)$ ]]; then
    echo "Release artifact key is invalid: $release_key" >&2
    exit 2
  fi
  : "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required to locate the package artifact}"
  local artifact_name="package-$release_key" artifact_id
  artifact_id="$(gh api \
    "repos/$GITHUB_REPOSITORY/actions/artifacts?name=$artifact_name&per_page=100" \
    --jq '.artifacts | map(select(.expired == false)) | sort_by(.created_at) | last | .id // empty')"
  if [[ -z "$artifact_id" ]]; then
    echo "No unexpired GitHub artifact named $artifact_name was found" >&2
    exit 3
  fi
  mkdir -p "$work_dir"
  gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact_id/zip" > "$work_dir/package.zip"
  unzip -q "$work_dir/package.zip" -d "$work_dir/unpacked"
  package_path="$(find "$work_dir/unpacked" -type f -name 'billing-api.war' | head -n 1)"
  if [[ -z "$package_path" ]]; then
    echo "Artifact $artifact_name does not contain billing-api.war" >&2
    exit 3
  fi
  digest="sha256:$(shasum -a 256 "$package_path" | awk '{print $1}')"
  echo "Resolved $artifact_name (GitHub artifact $artifact_id) -> $digest" >&2
}

if [[ -n "$pinned_digest" ]]; then
  digest="$pinned_digest"
  package_path=""
  echo "Using the digest pinned by Helio: $digest" >&2
elif [[ -n "$nexus_url" ]]; then
  resolve_from_nexus
else
  resolve_from_github
fi

if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Artifact digest is not an immutable SHA-256: $digest" >&2
  exit 4
fi
printf 'artifact_digest=%s\npackage_path=%s\n' "$digest" "$package_path"
