#!/usr/bin/env bash
# Publish the built WAR to the on-premise Sonatype Nexus repository, the
# release artifact system of record. Nexus computes and stores the checksums;
# Helio's artifact-registry control later verifies that exactly one artifact
# exists for the release version and records its sha256.
#
# Layout (maven2 hosted repository, mixed version policy):
#   io/helio/billing-api/<version>/billing-api-<version>.war
#
# Usage: scripts/publish-artifact.sh <release-version> <war-path>
# Env:   NEXUS_URL        (default http://127.0.0.1:8081)
#        NEXUS_REPOSITORY (default helio-releases)
#        NEXUS_TOKEN or NEXUS_TOKEN_FILE (default ~/.helio-release-secrets/nexus-ci.token, "user:secret")
set -euo pipefail

version="${1:?release version is required}"
war="${2:?war path is required}"
nexus_url="${NEXUS_URL:-http://127.0.0.1:8081}"
repository="${NEXUS_REPOSITORY:-helio-releases}"
token_file="${NEXUS_TOKEN_FILE:-$HOME/.helio-release-secrets/nexus-ci.token}"
group_path="io/helio/billing-api"
artifact="billing-api"

if [[ -z "${NEXUS_TOKEN:-}" ]]; then
  [[ -r "$token_file" ]] || { echo "No Nexus credential: set NEXUS_TOKEN or provide $token_file" >&2; exit 2; }
  NEXUS_TOKEN="$(tr -d '[:space:]' < "$token_file")"
fi
[[ -f "$war" ]] || { echo "WAR not found: $war" >&2; exit 2; }
[[ "$version" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$ ]] || { echo "Release version is not a safe path segment: $version" >&2; exit 2; }

digest="sha256:$(shasum -a 256 "$war" | awk '{print $1}')"
target="$nexus_url/repository/$repository/$group_path/$version/$artifact-$version.war"

# The registry's own record of the artifact, through the same search API
# Helio's artifact-registry control uses. Empty when nothing is published.
registry_sha256() {
  curl --silent --fail --user "$NEXUS_TOKEN" --get "$nexus_url/service/rest/v1/search/assets" \
    --data-urlencode "repository=$repository" --data-urlencode "name=$artifact" \
    --data-urlencode "version=$version" \
    | jq -r '[.items[] | select(.path | endswith(".war"))] | .[0].checksum.sha256 // empty'
}

# Publish once: a release version is immutable in the registry. If the same
# bytes are already there this is a no-op; different bytes are refused by
# the repository's ALLOW_ONCE write policy and by the check below.
existing="$(registry_sha256)"
if [[ -n "$existing" ]]; then
  if [[ "sha256:$existing" == "$digest" ]]; then
    echo "Already published: $target ($digest)"
  else
    echo "Refusing to publish: $version already exists in $repository with digest sha256:$existing, built $digest" >&2
    exit 3
  fi
else
  http_code="$(curl --silent --show-error --user "$NEXUS_TOKEN" --upload-file "$war" \
    --output /dev/null --write-out '%{http_code}' "$target")"
  if [[ "$http_code" != "201" && "$http_code" != "200" ]]; then
    echo "Nexus refused the upload (HTTP $http_code): $target" >&2
    exit 4
  fi
  echo "Published $target"
fi

# Read back what the registry holds: the identity Helio will verify.
stored=""
for _ in 1 2 3 4 5; do
  stored="$(registry_sha256)"
  [[ -n "$stored" ]] && break
  sleep 2
done
if [[ "sha256:$stored" != "$digest" ]]; then
  echo "Registry digest sha256:$stored does not match the built WAR $digest" >&2
  exit 5
fi
echo "Registry digest verified: $digest"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'artifact_digest=%s\nartifact_url=%s\n' "$digest" "$target" >> "$GITHUB_OUTPUT"
fi
