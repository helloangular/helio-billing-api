#!/usr/bin/env bash
# Resolve the immutable WAR a deployment stage must install.
#
# Either Helio pinned a digest (rollback / redeploy of an artifact already in
# the local store), or this release's build stage uploaded the package as a
# GitHub artifact named package-<release key>, which is downloaded and
# digested here. Prints shell-style key=value lines for $GITHUB_OUTPUT;
# diagnostics go to stderr.
#
# Usage: scripts/resolve-artifact.sh <release-key> [pinned-digest]
# Env:   GH_TOKEN, GITHUB_REPOSITORY, RUNNER_TEMP (from the workflow)
set -euo pipefail

release_key="${1:?release key (Helio release id or GitHub run id) is required}"
pinned_digest="${2:-}"

if [[ -n "$pinned_digest" ]]; then
  digest="$pinned_digest"
  package_path=""
else
  if [[ ! "$release_key" =~ ^([0-9a-fA-F-]{36}|[0-9]+)$ ]]; then
    echo "Release artifact key is invalid: $release_key" >&2
    exit 2
  fi
  : "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required to locate the package artifact}"
  artifact_name="package-$release_key"
  artifact_id="$(gh api \
    "repos/$GITHUB_REPOSITORY/actions/artifacts?name=$artifact_name&per_page=100" \
    --jq '.artifacts | map(select(.expired == false)) | sort_by(.created_at) | last | .id // empty')"
  if [[ -z "$artifact_id" ]]; then
    echo "No unexpired GitHub artifact named $artifact_name was found" >&2
    exit 3
  fi
  work_dir="${RUNNER_TEMP:-$(mktemp -d)}/package-${GITHUB_RUN_ID:-local}-$$"
  mkdir -p "$work_dir"
  gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact_id/zip" > "$work_dir/package.zip"
  unzip -q "$work_dir/package.zip" -d "$work_dir/unpacked"
  package_path="$(find "$work_dir/unpacked" -type f -name 'billing-api.war' | head -n 1)"
  if [[ -z "$package_path" ]]; then
    echo "Artifact $artifact_name does not contain billing-api.war" >&2
    exit 3
  fi
  digest="sha256:$(shasum -a 256 "$package_path" | awk '{print $1}')"
  echo "Resolved $artifact_name (artifact $artifact_id) -> $digest" >&2
fi

if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Artifact digest is not an immutable SHA-256: $digest" >&2
  exit 4
fi
printf 'artifact_digest=%s\npackage_path=%s\n' "$digest" "$package_path"
