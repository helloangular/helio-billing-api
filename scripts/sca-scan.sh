#!/usr/bin/env bash
# Real SCA stage: Trivy scans the dependency manifests and source tree of this
# checkout, writes a CycloneDX SBOM, and fails on unresolved HIGH/CRITICAL
# vulnerabilities or committed secrets.
#
# Runs on the on-premise runner with the locally installed Trivy CLI. The
# first run downloads the vulnerability database; later runs use the cache.
#
# Usage: scripts/sca-scan.sh
# Env:   SCA_OUTPUT_DIR (default target/sca)
#        SCA_MAX_HIGH   (default 0) tolerated unresolved HIGH findings
set -euo pipefail

out="${SCA_OUTPUT_DIR:-target/sca}"
max_high="${SCA_MAX_HIGH:-0}"
for tool in trivy jq; do
  command -v "$tool" >/dev/null || { echo "$tool is required on this runner" >&2; exit 2; }
done
mkdir -p "$out"

echo "Trivy $(trivy --version | head -n 1 | sed 's/Version: //')"
trivy fs --quiet --format cyclonedx --output "$out/sbom.cdx.json" .
trivy fs --quiet --scanners vuln,secret --ignore-unfixed \
  --format json --output "$out/trivy-fs.json" .

count_severity() {
  jq --arg sev "$1" \
    '[.Results[]?.Vulnerabilities[]? | select(.Severity == $sev)] | length' \
    "$out/trivy-fs.json"
}
critical="$(count_severity CRITICAL)"
high="$(count_severity HIGH)"
secrets="$(jq '[.Results[]?.Secrets[]?] | length' "$out/trivy-fs.json")"
components="$(jq '.components // [] | length' "$out/sbom.cdx.json")"

jq -n --argjson critical "$critical" --argjson high "$high" \
      --argjson secrets "$secrets" --argjson components "$components" \
      --arg scanned_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{scanner: "trivy", scanned_at: $scanned_at, components: $components,
        unresolved: {critical: $critical, high: $high}, secrets: $secrets}' \
  > "$out/summary.json"

echo "SBOM components: $components"
echo "Unresolved vulnerabilities: CRITICAL=$critical HIGH=$high (limit HIGH<=$max_high)"
echo "Secrets detected: $secrets"
if (( critical + high + secrets > 0 )); then
  echo "Findings:"
  jq -r '.Results[]? as $r
         | ($r.Vulnerabilities[]? | select(.Severity == "CRITICAL" or .Severity == "HIGH")
            | "  \(.Severity)\t\(.VulnerabilityID)\t\(.PkgName)@\(.InstalledVersion)\tfixed: \(.FixedVersion // "-")\t\($r.Target)"),
           ($r.Secrets[]? | "  SECRET\t\(.RuleID)\t\($r.Target):\(.StartLine)")' \
    "$out/trivy-fs.json"
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'critical=%s\nhigh=%s\nsecrets=%s\ncomponents=%s\n' \
    "$critical" "$high" "$secrets" "$components" >> "$GITHUB_OUTPUT"
fi
if (( critical > 0 || high > max_high || secrets > 0 )); then
  echo "SCA policy not met: failing the SCA stage" >&2
  exit 1
fi
