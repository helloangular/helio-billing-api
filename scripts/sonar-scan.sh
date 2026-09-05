#!/usr/bin/env bash
# Real SAST stage: analyse this checkout with the SonarQube scanner, wait for
# the server-side compute-engine task, then pass or fail on the project's
# quality gate as SonarQube reports it.
#
# Runs on the on-premise runner. SonarQube itself is the local Docker instance
# (docker compose service "sonarqube" in the Helio repo), reached over the
# host network; the scanner runs from its official container image, or an
# explicitly configured, administrator-installed official host CLI.
#
# Usage: scripts/sonar-scan.sh <project-version>
# Env:   SONAR_HOST_URL (default http://127.0.0.1:9000)
#        SONAR_TOKEN or SONAR_TOKEN_FILE (default ~/.helio-release-secrets/sonar-token.txt)
#        SONAR_SCANNER_IMAGE (default: digest-pinned CLI 8.0.1)
#        SONAR_SCANNER_BIN (optional host CLI executable; no Docker scanner)
#        SONAR_SCANNER_JAVA_OPTS (default -Xms64m -Xmx512m)
set -euo pipefail

project_version="${1:-unversioned}"
sonar_host="${SONAR_HOST_URL:-http://127.0.0.1:9000}"
token_file="${SONAR_TOKEN_FILE:-$HOME/.helio-release-secrets/sonar-token.txt}"
scanner_image="${SONAR_SCANNER_IMAGE:-sonarsource/sonar-scanner-cli@sha256:23ca0f137965d9dff2198074043fd48d386280bc5d0ccac8c8349cea4cf096a9}"
# Budget both JVMs rather than relying on sizing from the shared Docker VM.
# Memory pressure can starve the JavaScript bridge until its 300-second
# startup timeout. Heap budgets do not replace adequate runner capacity.
export SONAR_SCANNER_OPTS="${SONAR_SCANNER_OPTS:--Xms32m -Xmx128m}"
export SONAR_SCANNER_JAVA_OPTS="${SONAR_SCANNER_JAVA_OPTS:--Xms64m -Xmx512m}"
export SONAR_HOST_URL="$sonar_host"

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  if [[ ! -r "$token_file" ]]; then
    echo "No SonarQube token: set SONAR_TOKEN or provide $token_file" >&2
    exit 2
  fi
  SONAR_TOKEN="$(tr -d '[:space:]' < "$token_file")"
fi
export SONAR_TOKEN
for tool in curl jq; do
  command -v "$tool" >/dev/null || { echo "$tool is required on this runner" >&2; exit 2; }
done
if [[ -n "${SONAR_SCANNER_BIN:-}" ]]; then
  command -v "$SONAR_SCANNER_BIN" >/dev/null || { echo "Configured SONAR_SCANNER_BIN is unavailable" >&2; exit 2; }
  scanner_command=("$SONAR_SCANNER_BIN")
else
  command -v docker >/dev/null || { echo "docker is required on this runner" >&2; exit 2; }
  scanner_command=(docker run --rm --network host
    -e SONAR_HOST_URL -e SONAR_TOKEN -e SONAR_SCANNER_OPTS -e SONAR_SCANNER_JAVA_OPTS
    -v "$PWD:/usr/src" "$scanner_image")
fi
if [[ ! -d target/classes ]]; then
  echo "Compile before analysis (target/classes is missing): mvn test-compile" >&2
  exit 2
fi

status="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 10 "$sonar_host/api/system/status" | jq -r .status || echo DOWN)"
if [[ "$status" != "UP" ]]; then
  echo "SonarQube at $sonar_host is $status" >&2
  exit 3
fi

scan_log="$(mktemp)"
trap 'rm -f "$scan_log"' EXIT
"${scanner_command[@]}" \
  -Dsonar.projectVersion="$project_version" \
  -Dsonar.javascript.node.maxspace=512 \
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
  task="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 -u "$SONAR_TOKEN:" "$sonar_host/api/ce/task?id=$task_id")"
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
gate="$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 -u "$SONAR_TOKEN:" \
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
