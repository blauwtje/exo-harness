# Progress

- Phase: 1 (spec and plan) done on 2026-10-21. Waiting on the user's build start.
- Landed: phase 0 facts, `docs/request.md`, `docs/request-original.md`, `docs/review-senior-ai.md`, `docs/PLAN.md`, `docs/decisions.md` (70 decisions), `tests.json` (105 entries, all fail), round 2 probes (`docs/probe-results.md`).
- Brief: `docs/specs/phase-2-mvp.md` (local only, gitignored), 26 tasks, `plan-check --loop` passes, open points step done (8 assumptions, no open point).
- 2026-10-21 user answers: silent env scrub (59), no wall timeout for any stage (60), Bash outside-project paths allowed (61), live eval on each stage's own model (62); 48 confirmed.
- 2026-10-21 senior AI engineer fixes (63-70): exact spec tool lists and wrapper prompt in Task 10, live eval on the production path with `--effort`, $10 spend cap and 200 total-turn cap per job, build guard passes 3 of 3. Notes: `.exo/phase-2/senior-ai-review.md`.
- Next: `exo:build docs/specs/phase-2-mvp.md`. Task 23 (UI) starts with design-ui: the user picks one of 2-3 static deck directions.
- Open: P3 (`exo run` from a linked worktree, Land modes) needs the user's terminal, phase 3. exo-side limit park is a separate exo session, needed by phase 4.
