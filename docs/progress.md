# Progress

- Phase: 2 (MVP: deck, Shape stage, supervision) built on 2026-10-21; `node scripts/phase-status.mjs --phase 2` flips the proved `tests.json` entries.
- Landed: phase 0 facts, `docs/request.md`, `docs/request-original.md`, `docs/review-senior-ai.md`, `docs/PLAN.md`, `docs/decisions.md` (70 decisions), `tests.json` (105 entries, all fail), round 2 probes (`docs/probe-results.md`).
- Brief: `docs/specs/phase-2-mvp.md` (local only, gitignored), 26 tasks, `plan-check --loop` passes, open points step done (8 assumptions, no open point).
- 2026-10-21 user answers: silent env scrub (59), no wall timeout for any stage (60), Bash outside-project paths allowed (61), live eval on each stage's own model (62); 48 confirmed.
- 2026-10-21 senior AI engineer fixes (63-70): exact spec tool lists and wrapper prompt in Task 10, live eval on the production path with `--effort`, $10 spend cap and 200 total-turn cap per job, build guard passes 3 of 3. Notes: `.exo/phase-2/senior-ai-review.md`.
- Phase 3 (detached `exo run` supervision, gates, approvals) built on 2026-10-21; `node scripts/phase-status.mjs --phase 3` flipped 20 of 21 entries. Decisions 71-92 in `docs/decisions.md`, exo 0.136.0 run facts in `docs/facts.md`.
- Phase 4 (budget, queue, concurrency, routing) built on 2026-10-21; `node scripts/phase-status.mjs --phase 4` flips the proved entries. Decisions in `docs/decisions.md` (Phase 4 section), probes in `docs/facts.md`.
- Next: phase 5
- Open: F-3-01 (`## Probe P3` in `docs/facts.md`) needs `node scripts/probe-p3.mjs` run in the user's terminal (`CLAUDECODE` refusal). exo-side limit park is a separate exo session, needed by phase 4.
- Blocked: F-4-09 (auto-resume of a limit-only gate) waits on the exo change "`exo run` parks with its reset time on a limit hit"; exo 0.136.0 has none (Decision 2). Open: the live limit-event probe and the Phase 4 live check need the user's terminal.
