#!/usr/bin/env bash
# Real policy-evaluation stage: gather the release facts from their systems
# of record, load this repository's policy into the on-premise OPA server,
# and require an allow decision before the release may move on.
#
# Facts gathered here (never asserted by hand):
#   - SonarQube quality gate status for the project (SonarQube API)
#   - unresolved CRITICAL/HIGH vulnerabilities (fresh Trivy scan)
#   - the artifact digest, as observed in the source environment by the caller
#
# Usage: scripts/opa-policy-check.sh <artifact-digest> <release-id> [target-env] [release-version]
# Env:   OPA_URL (default http://127.0.0.1:8181)
#        SONAR_HOST_URL, SONAR_TOKEN / SONAR_TOKEN_FILE as for sonar-scan.sh
set -euo pipefail

artifact_digest="${1:?artifact digest is required}"
release_id="${2:?release id is required}"
target_env="${3:-preprod}"
release_version="${4:-unversioned}"
opa_url="${OPA_URL:-http://127.0.0.1:8181}"
sonar_host="${SONAR_HOST_URL:-http://127.0.0.1:9000}"
token_file="${SONAR_TOKEN_FILE:-$HOME/.helio-release-secrets/sonar-token.txt}"
policy_file="policies/release_gate.rego"
policy_id="helio-marine-cargo-release"
out="${POLICY_OUTPUT_DIR:-target/policy}"

for tool in curl jq trivy; do
  command -v "$tool" >/dev/null || { echo "$tool is required on this runner" >&2; exit 2; }
done
if [[ -z "${SONAR_TOKEN:-}" ]]; then
  [[ -r "$token_file" ]] || { echo "No SonarQube token: set SONAR_TOKEN or provide $token_file" >&2; exit 2; }
  SONAR_TOKEN="$(tr -d '[:space:]' < "$token_file")"
fi
[[ -f "$policy_file" ]] || { echo "Policy file $policy_file is missing" >&2; exit 2; }
mkdir -p "$out"

if ! curl --fail --silent --max-time 5 "$opa_url/health" >/dev/null; then
  echo "OPA server at $opa_url is not healthy" >&2
  exit 3
fi

project_key="$(sed -n 's/^sonar.projectKey=//p' sonar-project.properties)"
quality_gate="$(curl --fail --silent --show-error -u "$SONAR_TOKEN:" \
  "$sonar_host/api/qualitygates/project_status?projectKey=$project_key" \
  | jq -r '.projectStatus.status // "NONE"')"

trivy fs --quiet --scanners vuln --ignore-unfixed --format json --output "$out/trivy.json" .
critical="$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "CRITICAL")] | length' "$out/trivy.json")"
high="$(jq '[.Results[]?.Vulnerabilities[]? | select(.Severity == "HIGH")] | length' "$out/trivy.json")"

jq -n --arg release_id "$release_id" --arg version "$release_version" \
      --arg digest "$artifact_digest" --arg env "$target_env" \
      --arg gate "$quality_gate" --arg project "$project_key" \
      --argjson critical "$critical" --argjson high "$high" \
      '{release: {id: $release_id, version: $version},
        artifact: {digest: $digest},
        target: {environment: $env},
        scans: {sast: {tool: "sonarqube", project: $project, quality_gate: $gate},
                sca: {tool: "trivy", critical: $critical, high: $high}}}' \
  > "$out/input.json"

# The policy is versioned with the code it governs; publish this revision to
# the shared OPA server, then ask for the decision.
curl --fail --silent --show-error -X PUT -H 'Content-Type: text/plain' \
  --data-binary "@$policy_file" "$opa_url/v1/policies/$policy_id" >/dev/null
jq -n --slurpfile input "$out/input.json" '{input: $input[0]}' \
  | curl --fail --silent --show-error -X POST -H 'Content-Type: application/json' \
      --data-binary @- "$opa_url/v1/data/helio/release/decision" \
  > "$out/decision.json"

allow="$(jq -r '.result.allow // false' "$out/decision.json")"
echo "Policy helio.release for release $release_id -> $target_env: allow=$allow"
echo "  SonarQube quality gate: $quality_gate   Trivy unresolved: CRITICAL=$critical HIGH=$high"
echo "  Artifact: $artifact_digest"
jq -r '.result.violations[]? | "  VIOLATION\t\(.)"' "$out/decision.json"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'allow=%s\nquality_gate=%s\ncritical=%s\nhigh=%s\n' \
    "$allow" "$quality_gate" "$critical" "$high" >> "$GITHUB_OUTPUT"
fi
if [[ "$allow" != "true" ]]; then
  echo "Policy denied the release: failing the policy-evaluation stage" >&2
  exit 1
fi
