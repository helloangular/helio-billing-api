#!/usr/bin/env bash
# Install an immutable WAR into one Apache Tomcat context and wait until that
# context serves exactly the expected digest and version.
#
# Contexts: marine-cargo (production, default), marine-cargo-test,
# marine-cargo-uat, marine-cargo-preprod. All live on the same persistent
# on-premise Tomcat; each keeps its own serving-digest state file.
#
# Usage: scripts/deploy-tomcat.sh <sha256 digest> [candidate war]
# Env:   TOMCAT_CONTEXT (default marine-cargo), TOMCAT_BASE_URL (default http://127.0.0.1:8080)
#        HELIO_TOMCAT_STATE_DIR (default ~/.helio-tomcat), CATALINA_HOME
set -euo pipefail

expected_digest="${1:?expected sha256 digest is required}"
candidate_war="${2:-}"
context="${TOMCAT_CONTEXT:-marine-cargo}"
base_url="${TOMCAT_BASE_URL:-http://127.0.0.1:8080}"
state_root="${HELIO_TOMCAT_STATE_DIR:-$HOME/.helio-tomcat}"
tomcat_home="${CATALINA_HOME:-$(brew --prefix tomcat)/libexec}"
webapps="$tomcat_home/webapps"
artifact_hex="${expected_digest#sha256:}"
artifact_store="$state_root/artifacts"
stored_war="$artifact_store/$artifact_hex.war"

if [[ ! "$expected_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Expected digest is not an immutable SHA-256: $expected_digest" >&2
  exit 2
fi
if [[ ! "$context" =~ ^marine-cargo(-(test|uat|preprod))?$ ]]; then
  echo "Refusing to deploy to an unknown Tomcat context: $context" >&2
  exit 2
fi
if [[ ! -d "$webapps"
      || ("$webapps" != */tomcat/libexec/webapps
          && "$webapps" != */Cellar/tomcat/*/libexec/webapps) ]]; then
  echo "Refusing to deploy outside a Homebrew Tomcat webapps directory: $webapps" >&2
  exit 2
fi
if [[ "$context" == "marine-cargo" ]]; then
  state_file="$state_root/current-digest.txt"
else
  state_file="$state_root/current-digest-$context.txt"
fi

mkdir -p "$artifact_store"
if [[ -n "$candidate_war" ]]; then
  actual_digest="sha256:$(shasum -a 256 "$candidate_war" | awk '{print $1}')"
  if [[ "$actual_digest" != "$expected_digest" ]]; then
    echo "WAR digest mismatch: expected $expected_digest, got $actual_digest" >&2
    exit 3
  fi
  if [[ ! -f "$stored_war" ]]; then
    install -m 0444 "$candidate_war" "$stored_war"
  fi
elif [[ ! -f "$stored_war" ]]; then
  echo "Immutable WAR is not present in the local artifact store: $stored_war" >&2
  exit 4
fi

stored_digest="sha256:$(shasum -a 256 "$stored_war" | awk '{print $1}')"
if [[ "$stored_digest" != "$expected_digest" ]]; then
  echo "Stored WAR failed digest verification" >&2
  exit 5
fi
target_version="$(unzip -p "$stored_war" WEB-INF/classes/release.properties \
  | awk -F= '$1 == "release.version" {print $2}')"
if [[ -z "$target_version" ]]; then
  echo "Stored WAR does not contain an immutable release version" >&2
  exit 5
fi

if ! curl --silent --fail --max-time 2 "$base_url/" >/dev/null; then
  echo "The persistent Apache Tomcat service is not running at $base_url" >&2
  exit 6
fi
rm -rf "${webapps:?}/$context"
rm -f "$webapps/$context.war"
install -m 0644 "$stored_war" "$webapps/$context.war"
printf '%s\n' "$expected_digest" > "$state_file.tmp"
mv "$state_file.tmp" "$state_file"

health_url="${TOMCAT_HEALTH_URL:-$base_url/$context/health}"
digest_url="${TOMCAT_DIGEST_URL:-$base_url/$context/artifact-digest}"
version_url="${TOMCAT_VERSION_URL:-$base_url/$context/version}"
for attempt in $(seq 1 60); do
  observed_digest="$(curl --silent --fail --max-time 2 "$digest_url" 2>/dev/null || true)"
  observed_version="$(curl --silent --fail --max-time 2 "$version_url" 2>/dev/null || true)"
  if [[ "$observed_digest" == "$expected_digest" && "$observed_version" == "$target_version" ]]; then
    curl --silent --fail --max-time 5 "$health_url" >/dev/null
    printf 'deployed_version=%s\n' "$observed_version"
    printf 'artifact_digest=%s\n' "$observed_digest"
    printf 'context=%s\n' "$context"
    printf 'url=%s/%s/\n' "$base_url" "$context"
    exit 0
  fi
  sleep 1
done

echo "Tomcat did not serve the expected digest in context $context within 60 seconds" >&2
exit 7
