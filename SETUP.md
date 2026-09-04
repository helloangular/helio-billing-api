# Setup sheet — running this workflow in your own environment

What this repository is: a **tested reference implementation** of a GitHub Actions pipeline
that Helio can govern. It is not a drop-in production workflow. Runner labels, deployment
targets, artifact handling and environment protection rules must be adapted to your controls.
The Helio-specific correlation and evidence steps are optional instrumentation; the workflow
runs unchanged from GitHub without Helio.

## 1. GitHub plan and repository

| Item | Requirement |
|---|---|
| Environments and environment secrets on a private repo | GitHub Pro, Team or Enterprise |
| Required reviewers / wait timers on a private repo | GitHub Enterprise |
| Custom deployment protection rules (Helio's gates) on a private repo | GitHub Enterprise (feature is in public preview) |
| Public repositories | all of the above on every plan |

## 2. Environments and protection rules

Create four environments: `test`, `uat`, `preprod`, `production`. Then decide who decides each gate:

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

## 5. Helio side

Register the GitHub Actions integration (PAT for dispatch, or the GitHub App for gates), Nexus
(`https://…`, config `repository`, `component`) and, if used, Datadog (`token`, `app_key`,
`monitor_tags`). Helio only accepts `https` integration URLs. Tool integrations activate through
**Test Connection**; a failed test blocks them.

## 6. Supply-chain notes already applied in the workflow

- Every action is pinned to a full commit SHA (the `# vN` comment is informational).
- `deployments: write` is granted only to the production job.
- Per-environment concurrency groups serialise deployments to the same target without cancelling.
- Governed runs validate that `workflow_revision` equals the commit being executed.
- Post-deployment verification compares the serving digest and version with the approved artifact.
