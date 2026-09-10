#!/usr/bin/env bash
# Prepare/update this runner's private Trivy DB before the security scan.
# Never share a writable cache among concurrent runner processes.
set -euo pipefail
command -v trivy >/dev/null || { echo 'trivy is required on this runner' >&2; exit 2; }
repositories=(ghcr.io/aquasecurity/trivy-db:2 mirror.gcr.io/aquasec/trivy-db:2 ghcr.io/aquasecurity/trivy-db:2)
for attempt in 1 2 3; do
  started=$SECONDS
  echo "Trivy DB pre-download attempt $attempt/3 (timeout 3m)"
  if trivy image --download-db-only --skip-db-update=false --timeout 3m \
      --db-repository "${repositories[$((attempt - 1))]}" --no-progress; then
    echo "Trivy DB ready; preparation took $((SECONDS - started))s on attempt $attempt"
    exit 0
  fi
  echo "Trivy DB preparation failed after $((SECONDS - started))s on attempt $attempt" >&2
  if (( attempt < 3 )); then sleep "$((attempt * 10))"; fi
done
echo '::error title=Trivy vulnerability database unavailable::Database pre-download failed after 3 bounded attempts. Dependency scanning did not run; check registry connectivity and runner cache. This is not a vulnerability finding.'
exit 2
