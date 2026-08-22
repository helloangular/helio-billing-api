# Marine Cargo Quote-to-Bind — demo

A deliberately small application whose GitHub Actions workflow mirrors the
sixteen stages of the **Marine Cargo Quote-to-Bind v3.4.2** release in Helio,
so the release orchestrator can be exercised end to end against a real pipeline.

Job names match Helio stage names exactly. That is the point of the repo: when a
stage dispatches, the job it maps to is obvious in both UIs without a lookup
table.

Four stages are **approval gates** and have no automated job — they are decided
by a human in Helio (Security Gate, CAB Approval, App Owner Sign-off, Prod
Release Gate). They appear here as `gate-*` jobs that record the handoff and
then wait for Helio, so the YAML still represents the whole pipeline.
