# Progress

- Phase: 1 (spec and plan), nearly done. Stopped by the user on 2026-10-20 to continue the next day.
- Landed: phase 0 facts (`docs/facts.md` + sources), `docs/request.md` (all user answers), `docs/request-original.md`, `docs/review-senior-ai.md`, `docs/PLAN.md`, `docs/decisions.md` (58 decisions), `tests.json` (105 entries, all fail), round 2 probes (p6-p9 fixtures, `docs/probe-results.md`).
- Brief: `docs/specs/phase-2-mvp.md` (local only, gitignored), 26 tasks, `plan-check --loop` passes.
- Next, in order:
  1. Confirm with the user the 5 picks the brief writer made (decisions.md 48-58): API key notice once per launch; no-remote project keyed `local/<folder>` on its local default branch; spec wall timeout 60 min replaces decision 16's 45 min; outside-project paths denied in code (plugin-root allowed); live eval on Sonnet, 3 runs per case.
  2. `exo:spec` step 8: dispatch `exo:find-open-points` on the brief, rerun plan-check.
  3. Hand off: `exo:build docs/specs/phase-2-mvp.md` from a session started in the exo-harness repo. Task 23 (UI) starts with design-ui: the user picks one of 2-3 static deck directions.
- Open: P3 (`exo run` from a linked worktree, Land modes) needs the user's terminal, phase 3. exo-side limit park is a separate exo session, needed by phase 4.
