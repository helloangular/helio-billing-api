# Billing API — Tomcat release demo

A deliberately small application whose GitHub Actions workflow mirrors the
sixteen stages of the **Billing API** release in Helio,
so the release orchestrator can be exercised end to end against a real pipeline.

The build produces a Java WAR with the Helio release version embedded in it.
The build and production jobs run on the repository-scoped `helio-tomcat`
runner. The build publishes the WAR to an immutable Nexus repository; every
deployment resolves it from Nexus and verifies its SHA-256 before deploying it
to Apache Tomcat. A rollback dispatch deploys the exact previously approved
digest without rebuilding it.

The live application exposes:

- `/billing-api/` — service page with the serving version and WAR digest
- `/billing-api/health` — Tomcat health and release identity
- `/billing-api/artifact-digest` — the exact serving WAR SHA-256
- `/billing-api/version` — the version embedded at build time

Job names match Helio stage names exactly. That is the point of the repo: when a
stage dispatches, the job it maps to is obvious in both UIs without a lookup
table.

The execution mode determines who owns the four approval gates. In the
segmented workflow they are Helio stages. In the native workflow they are
GitHub environment protection rules, which can call the Helio GitHub App.

## Every stage is real

| Stage | What runs | Where |
|---|---|---|
| Build & Package | `mvn clean package`, WAR SHA-256 recorded, published once to Nexus | on-premise runner |
| Unit Tests | `mvn test` + `npm test` | GitHub-hosted |
| SAST Scan | SonarQube scanner against the on-premise SonarQube; stage fails on the quality gate | on-premise runner |
| SCA / Dependency | Trivy vulnerability + secret scan, CycloneDX SBOM; fails on HIGH/CRITICAL | on-premise runner |
| Deploy to Test / UAT / PreProd | the exact release WAR (digest-verified) into its own Tomcat context | on-premise runner |
| QA Automated Tests | HTTP end-to-end tests against `/billing-api-test` | on-premise runner |
| Policy Evaluation | `policies/release_gate.rego` evaluated by the on-premise OPA server with facts from SonarQube, Trivy and the UAT digest | on-premise runner |
| Smoke + Perf Tests | health, identity and a measured p95 latency budget against `/billing-api-preprod` | on-premise runner |
| Deploy to Prod / Post-Deploy Verify | digest-verified WAR into `/billing-api`, GitHub deployment evidence, health + digest check | on-premise runner |

### On-premise prerequisites for the runner host

- Apache Tomcat (Homebrew) on `127.0.0.1:8080`
- SonarQube on `127.0.0.1:9000` (Helio repo: `docker compose up -d sonarqube sonar-db`) and a
  user token in `~/.helio-release-secrets/sonar-token.txt` (or `SONAR_TOKEN`)
- OPA server on `127.0.0.1:8181` (Helio repo: `docker compose up -d opa`)
- Trivy CLI, Docker (for the SonarQube scanner image), Maven, JDK 21, Node 20, `jq`, `gh`
- The GitHub Actions runner registered with labels `self-hosted, helio-tomcat`

Scripts under `scripts/` run the same way from a shell as from the workflow, so
each stage can be rehearsed locally before a release.

## Two ways Helio can run this pipeline

| Workflow | Runs as | Gates |
|---|---|---|
| `billing-api.yml` | one correlated GitHub run **per provider stage**; it has no push trigger and refuses dispatches without the complete Helio envelope | Helio approval stages between runs |
| `billing-api-native.yml` | **one** GitHub run started by Helio or manually for a rehearsal | GitHub environment protection rules on `test`, `uat`, `preprod`, `production`; those rules may call Helio's deployment-protection app |

Both files run the same scripts on the same runners. The native variant needs
a Helio GitHub App installed on the repository (custom deployment protection
rules cannot be registered with a personal access token).

See [`SETUP.md`](SETUP.md) before importing either workflow. The repository is
a reference implementation, not a zero-configuration production deployment.
