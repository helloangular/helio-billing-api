# Billing API release policy.
#
# Evaluated by the on-premise OPA server during the policy-evaluation stage.
# The pipeline gathers every fact below from the system of record (SonarQube,
# Trivy, the digest actually serving in the source environment) and asks for
# a decision; nothing here is asserted by the pipeline itself.
#
# Queried at: helio/release/decision
package helio.release

import rego.v1

# Tolerated unresolved HIGH vulnerabilities before production.
max_high_findings := 0

allowed_environments := {"test", "uat", "preprod", "production"}

default allow := false

allow if {
	count(deny) == 0
}

deny contains msg if {
	not is_string(input.scans.sast.quality_gate)
	msg := "SAST quality gate result is missing"
}

deny contains msg if {
	input.scans.sast.quality_gate != "OK"
	msg := sprintf("SonarQube quality gate is %v, not OK", [input.scans.sast.quality_gate])
}

deny contains msg if {
	not is_number(input.scans.sca.critical)
	msg := "SCA findings are missing"
}

deny contains msg if {
	input.scans.sca.critical > 0
	msg := sprintf("%v unresolved CRITICAL vulnerabilities", [input.scans.sca.critical])
}

deny contains msg if {
	input.scans.sca.high > max_high_findings
	msg := sprintf("%v unresolved HIGH vulnerabilities exceeds the limit of %v", [input.scans.sca.high, max_high_findings])
}

deny contains msg if {
	not regex.match(`^sha256:[0-9a-f]{64}$`, input.artifact.digest)
	msg := "artifact is not pinned to an immutable sha256 digest"
}

deny contains msg if {
	not allowed_environments[input.target.environment]
	msg := sprintf("unknown target environment %v", [input.target.environment])
}

deny contains msg if {
	trim_space(input.release.id) == ""
	msg := "release has no identity"
}

decision := {
	"allow": allow,
	"violations": deny,
	"policy": "helio.release",
	"evaluated": {
		"release": input.release.id,
		"artifact": input.artifact.digest,
		"target": input.target.environment,
	},
}
