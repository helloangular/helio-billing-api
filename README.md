# Marine Cargo Quote-to-Bind — Tomcat release demo

A deliberately small application whose GitHub Actions workflow mirrors the
sixteen stages of the **Marine Cargo Quote-to-Bind** release in Helio,
so the release orchestrator can be exercised end to end against a real pipeline.

The build produces a Java WAR with the Helio release version embedded in it.
The production job runs on the repository-scoped `helio-tomcat` runner, verifies
the WAR SHA-256, retains it in an immutable local artifact store, and hot-deploys
it to Apache Tomcat. A rollback dispatch selects the previously approved digest
from that store and deploys the exact prior WAR without rebuilding it.

The live application exposes:

- `/marine-cargo/` — Hello World page with the serving version and WAR digest
- `/marine-cargo/health` — Tomcat health and release identity
- `/marine-cargo/artifact-digest` — the exact serving WAR SHA-256
- `/marine-cargo/version` — the version embedded at build time

Job names match Helio stage names exactly. That is the point of the repo: when a
stage dispatches, the job it maps to is obvious in both UIs without a lookup
table.

Four stages are **approval gates** and have no automated decision — they are
decided by a human in Helio (Security Gate, CAB Approval, App Owner Sign-off,
Prod Release Gate).

## Every stage is real

| Stage | What runs | Where |
|---|---|---|
| Build & Package | `mvn clean package`, WAR SHA-256 recorded, uploaded as `package-<release>` | GitHub-hosted |
| Unit Tests | `mvn test` + `npm test` | GitHub-hosted |
| SAST Scan | SonarQube scanner against the on-premise SonarQube; stage fails on the quality gate | on-premise runner |
| SCA / Dependency | Trivy vulnerability + secret scan, CycloneDX SBOM; fails on HIGH/CRITICAL | on-premise runner |
| Deploy to Test / UAT / PreProd | the exact release WAR (digest-verified) into its own Tomcat context | on-premise runner |
| QA Automated Tests | HTTP end-to-end tests against `/marine-cargo-test` | on-premise runner |
| Policy Evaluation | `policies/release_gate.rego` evaluated by the on-premise OPA server with facts from SonarQube, Trivy and the UAT digest | on-premise runner |
| Smoke + Perf Tests | health, identity and a measured p95 latency budget against `/marine-cargo-preprod` | on-premise runner |
| Deploy to Prod / Post-Deploy Verify | digest-verified WAR into `/marine-cargo`, GitHub deployment evidence, health + digest check | on-premise runner |

The four gates (Security Gate, CAB Approval, App Owner Sign-off, Prod Release
Gate) remain human decisions in Helio.

### On-premise prerequisites for the runner host

- Apache Tomcat (Homebrew) on `127.0.0.1:8080`
- SonarQube on `127.0.0.1:9000` (Helio repo: `docker compose up -d sonarqube sonar-db`) and a
  user token in `~/.helio-release-secrets/sonar-token.txt` (or `SONAR_TOKEN`)
- OPA server on `127.0.0.1:8181` (Helio repo: `docker compose up -d opa`)
- Trivy CLI, Docker (for the SonarQube scanner image), Maven, JDK 21, Node 20, `jq`, `gh`
- The GitHub Actions runner registered with labels `self-hosted, helio-tomcat`

Scripts under `scripts/` run the same way from a shell as from the workflow, so
each stage can be rehearsed locally before a release.
