#!/usr/bin/env bash
set -euo pipefail

execution_id="${1:-}"
release_id="${2:-}"
stage_id="${3:-}"
workflow_revision="${4:-}"
executing_revision="${5:-}"
expected_stage="${6:-}"
deployment_only="${7:-false}"

uuid_re='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}'
segmented_execution_re="helio-release-${uuid_re}-stage-${uuid_re}-lease-${uuid_re}"

[[ "$release_id" =~ ^${uuid_re}$ ]] \
  || { echo "helio_release_id must be a UUID" >&2; exit 1; }
[[ "$execution_id" =~ ^${uuid_re}$ \
   || "$execution_id" =~ ^${segmented_execution_re}$ \
   || "$execution_id" =~ ^bny-rollback-${uuid_re}$ ]] \
  || { echo "helio_execution_id must be a valid Helio correlation id" >&2; exit 1; }
[[ "$workflow_revision" =~ ^[0-9a-f]{40}$ && "$workflow_revision" == "$executing_revision" ]] \
  || { echo "workflow_revision must equal the executing commit" >&2; exit 1; }

if [[ "$deployment_only" == "true" && "$expected_stage" == "deploy-to-prod" ]]; then
  [[ -z "$stage_id" || "$stage_id" == "$expected_stage" ]] \
    || { echo "rollback dispatch targets an unexpected stage" >&2; exit 1; }
else
  [[ "$stage_id" == "$expected_stage" ]] \
    || { echo "helio_stage_id '$stage_id' must equal '$expected_stage'" >&2; exit 1; }
fi
