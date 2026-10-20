# Progress

- Phase: 1 (spec and plan), in progress. Lead runs `exo:spec`; writing goes to subagents.
- Landed: phase 0 facts (`docs/facts.md` + sources), `docs/request.md` (answers), `docs/request-original.md`, `docs/review-senior-ai.md`.
- Running: probes P1 (allowedTools vs control_request), P2 (kill + resume, orphan child), P4 (cache TTL after idle), P5 (real spec questions + hand-off stop) → `test/fixtures/probes/p6-p9*`, appended to `docs/probe-results.md`.
- Next: (1) `docs/PLAN.md`, `docs/decisions.md`, `tests.json` (writer subagent). (2) After probes: phase 2 brief at `docs/specs/phase-2-mvp.md`, checked with `plan-check.mjs --loop`. (3) Hand off: `exo:build docs/specs/phase-2-mvp.md`.
- User decisions: all in `docs/request.md`. Review open points 2-5 closed by lead as changeable defaults (see `docs/decisions.md`).
- Open: P3 (`exo run` from a linked worktree, Land modes) needs the user's terminal, phase 3. exo-side limit park is a separate exo session, needed by phase 4.
