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
