# Setup sheet — running this workflow in your own environment

What this repository is: a **tested reference implementation** of a GitHub Actions pipeline
that Helio can govern. It is not a drop-in production workflow. Runner labels, deployment
targets, artifact handling and environment protection rules must be adapted to your controls.
The native workflow can be rehearsed manually without Helio. The segmented
`billing-api.yml` workflow is deliberately Helio-only: every provider stage
requires a correlated, revision-pinned Helio dispatch.

## Choose one execution mode

| Workflow | Use when | Approval owner |
|---|---|---|
| `.github/workflows/billing-api-native.yml` | The provider pipeline should run continuously as one workflow | GitHub environment rules, optionally backed by the Helio GitHub App |
| `.github/workflows/billing-api.yml` | Helio should dispatch provider jobs separately and insert its own controls and approval stages | Helio |

Do not configure both workflows as the launch binding for one pipeline.

## 1. GitHub plan and repository

| Item | Requirement |
|---|---|
| Environments and environment secrets on a private repo | GitHub Pro, Team or Enterprise |
| Required reviewers / wait timers on a private repo | GitHub Enterprise |
| Custom deployment protection rules (Helio's gates) on a private repo | GitHub Enterprise (feature is in public preview) |
| Public repositories | all of the above on every plan |

## 2. Environments and protection rules

For the native workflow, create four environments: `test`, `uat`, `preprod`,
`production`. Then decide who decides each gate:

- **Helio decides** (default for a governed release): install the Helio GitHub App on the repository
  and let Helio register its custom deployment protection rule on each environment. Signature
  policy (one signature for test/uat/preprod, two for production, separation of duties, eligible
  roles) is configured in Helio, **not in this workflow**. The counts quoted in the workflow comments
  are documentation of that policy, not enforcement by GitHub.
- **GitHub decides**: add required reviewers to the environment instead. GitHub's rule is satisfied
  by any one listed reviewer; it cannot express a two-person production rule on its own.
- **Administrator bypass**: leave "Allow administrators to bypass configured protection rules"
  enabled if you need an operator path when Helio is unavailable; disable it if your control
  framework forbids bypass. GitHub audits either choice.
- **Deployment branches**: restrict each environment to `main` (or your release branch pattern).

For the segmented workflow, the four approvals are Helio nodes between
provider runs. GitHub environment protections may still be used as an
additional control, but they are separate approvals and should not be mistaken
for the Helio signatures.

## 3. Repository variables (Settings › Variables › Actions)

| Variable | Default in the workflow | Meaning |
|---|---|---|
| `HELIO_RUNNER_LABEL` | `helio-tomcat` | Label of the on-premise runner group that can reach Nexus, SonarQube, OPA and the deployment targets |
| `ONPREM_TOMCAT` | `http://127.0.0.1:8080` | Base URL of the deployment target as seen from the runner |
| `NEXUS_URL` | `http://127.0.0.1:8081` | Internal artifact repository (Nexus) |
| `KEEP_GITHUB_ARTIFACTS` | unset (off) | Set to `true` only if binaries, SBOMs and policy decisions may leave the on-premises boundary as GitHub Actions artifacts. Off by default: Nexus is the system of record. |

## 4. Runner host prerequisites

Self-hosted runner registered with the label above (repository or organisation runner group),
outbound HTTPS to GitHub only. On the host: Docker (SonarQube scanner image), Maven, JDK 21,
Node 20+, Trivy, `jq`, `gh`, the deployment target, and the Nexus credential in
`~/.helio-release-secrets/nexus-ci.token` (`user:secret`) or `NEXUS_TOKEN` in the runner's
environment. Never put registry or scanner credentials in this repository.

### SonarQube scanner resources

`scripts/sonar-scan.sh` is shared by the native and segmented workflows. Its
default scanner is CLI 8.0.1, pinned to Docker manifest digest
`sha256:23ca0f137965d9dff2198074043fd48d386280bc5d0ccac8c8349cea4cf096a9`.
The launcher heap is capped at 128 MiB, scanner-engine heap at 512 MiB, and
JavaScript old-space at 512 MiB. These are heap budgets, **not** a total-memory
limit. Size the runner for native overhead and concurrent services as well.
`SONAR_SCANNER_OPTS` and `SONAR_SCANNER_JAVA_OPTS` may be explicitly overridden
for larger projects; validate resource changes against a real full analysis.

Keep headroom in the Docker VM for the scanner **in addition to** SonarQube,
Nexus and other services. An 8 GiB VM with a Kubernetes harness can exhaust both
memory and swap. A JavaScript bridge startup timeout followed by a missing
module error is not sufficient evidence of a missing npm dependency: inspect
memory pressure and the bundled analyzer before changing dependencies.
Do not exclude JavaScript, add `continue-on-error`, or relax the quality gate to
work around infrastructure failures. The script fails on scanner errors and
accepts only `OK` from the quality gate for the exact completed analysis.

For a Docker Desktop host with insufficient VM headroom, an administrator can
install the official host CLI and set `SONAR_SCANNER_BIN` to its absolute
executable path in the runner environment, then restart the idle runner. This
is an explicit selection, not an automatic fallback after a failed scan. It
uses the same sources, SonarQube server, analyzers and exact-analysis quality
gate; SonarQube itself stays in Docker. A missing configured executable fails
closed. The local Billing API runner uses this mode.

Verified host distribution: [SonarScanner CLI 8.0.1.6346, requires JDK](https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-8.0.1.6346.zip),
SHA-256 `8fbfb1eb546b734a60fc3e537108f06e389a8ca124fbab3a16236a8a51edcc15`.
Compare against SonarSource's published `.zip.sha256` before extracting; do
not download or install binaries during each release. For larger projects,
provision a suitably sized dedicated runner rather than relying on a crowded
demo VM. See [SonarSource scanner documentation](https://docs.sonarsource.com/sonarqube-server/analyzing-source-code/scanners/sonarscanner).

## 5. Helio side

Register the GitHub Actions integration (PAT for dispatch, or the GitHub App for gates), Nexus
(`https://…`, config `repository`, `component`) and, if used, Datadog (`token`, `app_key`,
`monitor_tags`). Helio only accepts `https` integration URLs. In **Admin › Integrations**, the Nexus and Datadog cards
offer **Test Connection**; a tool integration is created inactive and that test is what activates it
(a failed test blocks it).

The Nexus form requires repository and artifact component. The Datadog form
requires an API key, application key and monitor-tag selector. Test Connection
activates Datadog only after the selector returns at least one monitor.

## 6. Supply-chain notes already applied in the workflow

- Every action is pinned to a full commit SHA (the `# vN` comment is informational).
- `deployments: write` is granted only to the production job.
- Per-environment concurrency groups serialise deployments to the same target without cancelling.
- Governed runs validate that `workflow_revision` equals the commit being executed.
- Every segmented stage validates its Helio execution ID, release ID and exact stage ID.
- The segmented workflow has no push path; an uncorrelated manual dispatch cannot deploy.
- Post-deployment verification compares the serving digest and version with the approved artifact.
