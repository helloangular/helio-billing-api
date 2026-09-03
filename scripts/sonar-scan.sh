#!/usr/bin/env bash
# Real SAST stage: analyse this checkout with the SonarQube scanner, wait for
# the server-side compute-engine task, then pass or fail on the project's
# quality gate as SonarQube reports it.
#
# Runs on the on-premise runner. SonarQube itself is the local Docker instance
# (docker compose service "sonarqube" in the Helio repo), reached over the
# host network; the scanner runs from its official container image.
#
# Usage: scripts/sonar-scan.sh <project-version>
# Env:   SONAR_HOST_URL (default http://127.0.0.1:9000)
#        SONAR_TOKEN or SONAR_TOKEN_FILE (default ~/.helio-release-secrets/sonar-token.txt)
#        SONAR_SCANNER_IMAGE (default sonarsource/sonar-scanner-cli:latest)
set -euo pipefail

project_version="${1:-unversioned}"
sonar_host="${SONAR_HOST_URL:-http://127.0.0.1:9000}"
token_file="${SONAR_TOKEN_FILE:-$HOME/.helio-release-secrets/sonar-token.txt}"
scanner_image="${SONAR_SCANNER_IMAGE:-sonarsource/sonar-scanner-cli:latest}"

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  if [[ ! -r "$token_file" ]]; then
    echo "No SonarQube token: set SONAR_TOKEN or provide $token_file" >&2
    exit 2
  fi
  SONAR_TOKEN="$(tr -d '[:space:]' < "$token_file")"
fi
for tool in docker curl jq; do
  command -v "$tool" >/dev/null || { echo "$tool is required on this runner" >&2; exit 2; }
done
if [[ ! -d target/classes ]]; then
  echo "Compile before analysis (target/classes is missing): mvn test-compile" >&2
  exit 2
fi

status="$(curl --fail --silent --show-error --max-time 5 "$sonar_host/api/system/status" | jq -r .status || echo DOWN)"
if [[ "$status" != "UP" ]]; then
  echo "SonarQube at $sonar_host is $status" >&2
  exit 3
fi

scan_log="$(mktemp)"
trap 'rm -f "$scan_log"' EXIT
docker run --rm --network host \
  -e SONAR_HOST_URL="$sonar_host" \
  -e SONAR_TOKEN="$SONAR_TOKEN" \
  -v "$PWD:/usr/src" \
  "$scanner_image" \
  -Dsonar.projectVersion="$project_version" \
  -Dsonar.scm.disabled=true 2>&1 | tee "$scan_log"

# The scanner reports its compute-engine task in the log; the container's
# working directory is not reliably writable from the host mount.
task_id="$(sed -n 's#.*/api/ce/task?id=\([A-Za-z0-9_-]*\).*#\1#p' "$scan_log" | tail -n 1)"
project_key="$(sed -n 's/^sonar.projectKey=//p' sonar-project.properties)"
dashboard="$(sed -n 's#.*ANALYSIS SUCCESSFUL, you can find the results at: \(.*\)$#\1#p' "$scan_log" | tail -n 1)"
if [[ -z "$task_id" ]]; then
  echo "The scanner did not report a compute-engine task id" >&2
  exit 4
fi

task_status=PENDING
for _ in $(seq 1 90); do
  task="$(curl --fail --silent --show-error -u "$SONAR_TOKEN:" "$sonar_host/api/ce/task?id=$task_id")"
  task_status="$(jq -r .task.status <<<"$task")"
  case "$task_status" in
    SUCCESS) break ;;
    FAILED|CANCELED)
      echo "SonarQube analysis task $task_id ended as $task_status" >&2
      exit 5 ;;
  esac
  sleep 2
done
if [[ "$task_status" != "SUCCESS" ]]; then
  echo "Timed out waiting for SonarQube analysis task $task_id" >&2
  exit 5
fi

analysis_id="$(jq -r .task.analysisId <<<"$task")"
gate="$(curl --fail --silent --show-error -u "$SONAR_TOKEN:" \
  "$sonar_host/api/qualitygates/project_status?analysisId=$analysis_id")"
gate_status="$(jq -r .projectStatus.status <<<"$gate")"

echo "SonarQube quality gate for $project_key @ $project_version: $gate_status"
jq -r '.projectStatus.conditions[]?
       | "  \(.status)\t\(.metricKey)\tactual=\(.actualValue // "-")\tthreshold=\(.errorThreshold // "-")"' <<<"$gate"
echo "Dashboard: $dashboard"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'quality_gate=%s\nanalysis_id=%s\nproject_key=%s\n' \
    "$gate_status" "$analysis_id" "$project_key" >> "$GITHUB_OUTPUT"
fi
if [[ "$gate_status" != "OK" ]]; then
  echo "Quality gate is $gate_status: failing the SAST stage" >&2
  exit 6
fi
