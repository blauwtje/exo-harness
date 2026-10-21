# Decisions made without the user

Each line: the choice, then the reason. User answers live in `request.md`; review item ids refer to `review-senior-ai.md`. Every value here stays changeable; numbers marked "default" live in a config or settings file, not in code.

## Stack and process

1. Daemon in plain Node ESM `.mjs`, tests with `node:test`, no TypeScript: matches exo, avoids TS 7 tooling risk.
2. UI in React 19 plus Vite, `.jsx` files: a maintained stack the user knows, no compile step beyond Vite.
3. npm as the package manager: matches exo.
4. Transport: HTTP JSON for commands, Server-Sent Events from daemon to UI; no websocket dependency: SSE covers one-way streaming with the standard library.
5. Daemon binds 127.0.0.1 only, checks `Host` and `Origin`, requires a per-launch token passed in the printed URL fragment: any web page could otherwise reach a localhost service that runs Claude with write access.
6. State as JSON files written tmp file plus rename, plus per-job `events.jsonl`; no SQLite (X10): enough for one user, exo's own pattern, avoids the open `node:sqlite` on Node 22 question.
7. Data dir `~/Library/Application Support/exo-harness/`, mode 0700, overridable by `EXO_HARNESS_DATA` for tests (S14): raw tool output can hold secrets, and `~/Documents` may be synced.
8. Each child spawned in its own process group: Stop and reconcile kill the session with every tool process it started.
9. The daemon generates each session id and passes `--session-id <uuid>`, recorded before spawn: a crash between spawn and `init` still leaves a resumable id.
10. exo state polled at 1 s (exo's `POLL_MS`), not `fs.watch`: exo writes `state.json` by tmp plus rename, which breaks a watch.
11. Fake `claude` executable replays recorded fixtures; daemon `--fixtures` mode is the only mode allowed under `CLAUDECODE`: tests never spend limits, and a Claude Code session cannot start real jobs.
12. `--live-check` flag forces every stage to Haiku with a low turn cap: the one live check per phase costs little.
13. Tests: `node:test` for the daemon, `@playwright/test` for design screenshots: one runner per need, both on the version list.

## Config and settings

14. Versioned `config/stages.json` holds per stage: model, effort, permission mode, allowed and disallowed tools, max turns, wall timeout (M5): one file to review and diff.
15. Starting stage models: Opus for `spec`, Sonnet for `build`, `verify`, `find-cause`, `ship`, Haiku for scout triage: the request's defaults.
16. Starting caps (default): stall after 10 quiet minutes, wall timeout 45 minutes for `spec` and `find-cause`, 20 for `ship`: long enough for a real spec, short enough to catch a hung Bash call; tuned from phase-2 job durations.
17. User settings live in `settings.json` in the data dir, editable in the Settings screen: the user asked that budget, concurrency and scouts stay easy to change.
18. Settings defaults: ceilings 80% of the 5-hour window and 70% of the week; hard stop 92% of the 5-hour window; concurrency 2; landing global default `pr` with per-project override; scouts manual; scouts read owner-only issues.
19. The 70% weekly ceiling applies to every seven-day window seen (`seven_day`, `seven_day_opus`, `seven_day_sonnet`): one rule until the user asks for more.
20. Minimum exo version kept in `config/stages.json`, checked against `package.json` under `~/.claude/exo/plugin-root`: exo has no version command or gate, so "too old" needs a deck-side floor.
21. Huge tool output (default above 64 KB) stored as its own file, shown as head and tail with "load full": keeps the timeline fast without losing data.

## Sessions and questions

22. Interactive stages run one long-lived stream-json process; `--resume` only when the process is gone (M1): a reply hits a warm process and cache.
23. Question relay primary path parses exo's text question shape (`skills/route-skills/references/question.md`); the control protocol serves tool permissions and the `AskUserQuestion` fallback (M1, X5): exo never uses a question tool.
24. The deck never takes exo's recommended option without a click; "OK" is one click: an answer the user did not give can approve an outward write.
25. Stage wrapper system prompt is the same for every job of a stage, card text goes in the user message (S2): keeps the cached prefix shared.
26. Card summaries come from `report.md` head and the last message, no model (X4): scout triage stays the only model step.
27. `exo run` gets no deck-level retry or loop detection (X1): exo already stops on no progress and its attempt cap.
28. Verify action only for branches built outside `exo run` (X3): an exo run already passes its verify phase.

## Git, GitHub and files

29. Worktrees at `<repo>/.worktrees/<slug>`, created `--detach` at `origin/<default>`, excluded through `.git/info/exclude` (M3, S7): exo's folder, exo makes the branch, no tracked `.gitignore` edit.
30. Worktree removal only through exo's `remove-worktree.mjs --kept`, after archiving run evidence (M10): plain `git worktree remove` deletes `.exo/` with exit 0.
31. `gh` called only through one wrapper module with an allowlist, plus a source check in `npm test` (M6): the token has `delete_repo` scope.
32. Clone delete moves the folder to the macOS Trash, after listing local-only work (M11); the trash command is chosen at build time, Finder via `osascript` as fallback: the one irreversible local action.
33. exo repo lands `local` from its main checkout; other repos land `pr` from deck worktrees; a per-project `local` override is offered only after probe P3 shows it does not park (M3, request.md).
34. Project identity is GitHub `nameWithOwner` plus local path, local mapping only through one projects folder plus added paths (S10): no migration in phase 5, no disk crawl.
35. Add by partial clone `--filter=blob:none`: large histories download fast.
36. exo `budget` dial written with `--scope local` only (S11): a tracked edit makes `exo run --detach` refuse.

## UI

37. Libraries per `library-versions.md`, re-checked at install: `motion` 14.4.0, `@xyflow/react` 12.12.0, `@base-ui/react` 1.9.0, Geist plus Geist Mono through `@fontsource-variable/*` pending the design pick.
38. UI copy uses exo's words (brief, plan, task, stage, helper, direction), never "subagent": the user asked for the same words.
39. Plain CSS with custom properties, no Tailwind, until the design pick asks otherwise: fewer dependencies to maintain.
40. No drag library in phase 2 (native pointer events for lane moves); phase 5 re-checks `@dnd-kit/react`, which is pre-1.0: avoid an unstable dependency for one gesture.
41. Metrics show n, median and the job list; percentiles only once a slice has 20 jobs (X6): with a few jobs a day, p95 is the maximum.
42. COULD items C1-C5 of the review are not scheduled; revisit after phase 6: not needed for any success criterion.

## Closed review open points

43. Open point 1, land mode: answered by the user (`request.md`), see 33.
44. Open point 2, hard stop: 92% of the 5-hour window, changeable in Settings.
45. Open point 3, auto-accepting the recommended option: never; see 24.
46. Open point 4, crew panel and card split: both kept because the user asked for them; crew panel edges only from real job, card and helper links; merge and split in phase 5.
47. Open point 5, scouts reading other users' issues: owner-only by default, a setting widens it, untrusted text quoted (S12).

## Phase 2 (lead, 2026-10-20)

48. Phase-2 live check runs on a scratch repo with no remote, on Haiku, with a fully specified card: no external write, little spend, and a card that needs no question still reaches a brief. A project with no `origin` gets key `local/<folder name>` and its worktree starts at the local default branch.
49. The 70% weekly ceiling covers every weekly window (`seven_day`, `seven_day_opus`, `seven_day_sonnet`); the 92% hard stop applies to the 5-hour window only: restates 18, 19 and 44 as one rule.
50. Minimum exo version 0.136.0 (`minExoVersion` in `config/stages.json`): the version every probe ran against.
51. Stall after 10 minutes with no event; `spec` wall timeout 60 minutes, replacing the 45 of 16 for `spec`: probe p9 showed a spec turn waiting on a backgrounded helper.
52. Probe p6: `--allowedTools` entries skip `control_request`, except a listed Bash prefix whose path leaves the project (`blocked_path`), so the daemon answers those by code too: plugin-root paths allowed, other outside paths denied.
53. Probe p9: a `result` does not mean idle; stdin stays open and the turn is classified only once background tasks are drained, because closing stdin early answered later permission asks with "Stream closed".
54. Probe p9: `Agent` calls bring no `control_request`, so build dispatch is caught from the `tool_use` `subagent_type` (helper allowlist) or a `Skill` call naming `exo:build`, and the session is stopped.
55. Probe p7: a killed `claude` leaves its tool processes running and a dead parent leaves the child running, so Stop, Stop all and restart reconcile kill the whole process group before any `--resume`.
56. Probe p7: `--resume` needs an explicit user message and may repeat a side-effecting tool, so the resume message says the last tool may not have finished and to check its effect before repeating a writing command.
57. Probe p9: a question title carries an `n/total` prefix (`**1/1 ...?**`); the parser reads it and the card shows it.
58. Probe p8: `FORCE_PROMPT_CACHING_5M` stays unset (and scrubbed) so sessions get the 1-hour TTL; a reply after 10 idle minutes then reads the cached prefix instead of rewriting it.

## Phase 2 (user, 2026-10-21)

59. The env scrub is silent: no API key notice in the terminal or the deck (user). 48 confirmed by the user.
60. No stage has a wall timeout: a job runs until done, Stop, its turn cap or a usage ceiling; stall only marks a job after 10 quiet minutes (user). Replaces the wall timeouts of 14, 16 and 51.
61. A Bash `blocked_path` outside the project is allowed, not denied (user). Replaces the deny half of 52.
62. The live wrapper eval runs on each stage's own model (Opus for `spec`), 3 runs per case, pass at 2 of 3: an eval on another model says nothing about the stage's model.

## Phase 2 (senior AI engineer for the user, 2026-10-21)

63. The `spec` tool lists are pinned in the brief: allowed = `Read`, `Glob`, `Grep`, read-only git subcommands and `node` on `<plugin-root>/skills/spec/scripts/*` and the print-only `skills/route-skills/scripts/next-stage.mjs` only; disallowed = exo's `DENY_RULES` plus `mcp__*`; never `Bash(git:*)` or `Bash(node:*)`, because p6 showed a listed tool skips the daemon, so with 61 these lists are the real boundary.
64. The wrapper system prompt is the p9 line verbatim, and the resume message of 56 is fixed text; a sha256 of the system prompt plus the user-message template is stored with the eval fixtures, and `npm test` fails when it differs, so no prompt change ships untested.
65. The live wrapper eval spawns through `session.mjs` with the production `buildArgs`, so it tests the argv that ships (tool lists, prompt, model, effort, scrub).
66. The `spec` stage sets `effort` `medium` and passes `--effort`; effort is stamped on each job and each eval run, with the `init` model id and the versions.
67. Each `spec` job gets a spend cap through `--max-budget-usd` (starting value 10); a tripped cap gives outcome `budget`. Amends 60.
68. The daemon sums `num_turns` across a job's results; at the total-turn cap (starting value 200) it sends no further message and raises a Needs-you card (Continue or Stop), never a kill, because `--max-turns` counts per user message (p9). Amends 60.
69. `caffeinate` is released when every running job is stalled and taken again on the next event, so one hung job does not keep the Mac awake.
70. Wrapper eval pass bar: the hand-off case's guard grader must pass 3 of 3 (its prompt-level count is reported as k/3), the other cases 2 of 3; each run ends once graded; the first live runs are saved as the fixtures. Amends the pass bar of 62.

## Phase 3 (lead, 2026-10-21)

71. Land for this phase: `local`, squash onto `main` (user).
72. Probe P3 needs the user's terminal (`CLAUDECODE` refusal): `scripts/probe-p3.mjs` builds a scratch repo with a local bare origin, a one-task plan and a linked worktree, runs `exo run` with `Land: local` then `Land: none`, writes `## Probe P3` to `docs/facts.md`, refuses under `CLAUDECODE`, and takes `--exo <cli>` for the fake; `scripts/phase-status.mjs` proves F-3-01 from that `docs/facts.md` section, as it does F-2-22 from a file.
73. Fake exo CLI committed at `test/fake-claude/plugin-root/skills/build/scripts/exo-cli.mjs`, driven by `FAKE_EXO_SCENARIO` (JSON): it writes `state.json`, the kept dir, `report.md`, `gates.md`, `denied.txt` and iter logs, and prints exo's detach line or refusal text (stderr, exit 2); the e2e fixture, the shape-flow test and `scripts/accept.mjs` copy the committed plugin root instead of writing their own `plan-check.mjs` stubs.
74. Brief approval gate (M2): Shape done raises a Needs-you `brief` item; Approve is the one approval that starts the run; Reject leaves the card Shaped.
75. Approve reads the plan's `Branch:` and checks for a collision (local branch, `origin` remote branch, `git worktree list`); a collision is stored on the card, answers 409 and creates no job (S-19).
76. Then `exo run config` must print provider `claude` (`defaults.provider = "claude"`), else a refusal card; then the setup step: the project's `setup` override, else from the lockfile (`package-lock.json` → `npm ci`, `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`, `yarn.lock` → `yarn install --frozen-lockfile`, none → skip); `.env*` copied from the main checkout only when exo's `env` setting (`.claude/exo.local.json`, then `.claude/exo.json`, key `env`, default `ask`) is `copy`, copying top-level git-ignored `/^\.env/` files absent from the worktree; a setup failure is a `setup` card with the output tail and Retry, outcome `setup`, never a bug card (S-18).
77. Start: `node <plugin-root>/skills/build/scripts/exo-cli.mjs run <brief> --detach --max-run-usd <x> --max-budget-usd <y>` in the card's worktree, caps from the `config/stages.json` `run` stage, env scrub kind `exo-run` (drops `CLAUDECODE` and `CLAUDE_CODE_*` too); the run id is parsed from the detach line.
78. Refusals: lock held (detach stderr, exit 2) → job `queued` behind the holder, retried when the holder's phase is final or its pid is dead (S-07); dirty tree or another detach refusal → refusal card with exo's exact text and Retry; a `refused` run whose `reason` starts `could not fast-forward` → card with exo's text plus `git -C <main checkout> status --porcelain`, nothing touched there (S-17).
79. Watch: poll `.exo/run/<id>/state.json`, then `.exo/kept/<id>/state.json`, every 1 s, with pid liveness (`process.kill(pid, 0)`); `job.run` = `{ id, phase, stage, runRoot, branch, task, landed, total, reason }`; tail the newest `<runRoot>/.exo/run-plan/<plan basename>/<utc stamp>/iter-*.log` dir started after the run's `startedAt` through `parseLine` into the job's `events.jsonl`, tagged with the log name; `checkInit` on each log's `init` (`apiKeySource` none, `cwd` = runRoot); a mismatch sends SIGTERM to the run's group and opens an invariant card.
80. Parked → Needs-you `gate` item: open `gates.md` lines, `git diff --stat <base>...<branch>`, a per-file diff on click, `report.md` head (15 lines), `denied.txt`; Approve calls `exo approve <id>` and watching resumes (except the Decision 22 land-finish gate); Reject discards the job, puts the card back to Shaped and leaves the run parked.
81. Conflict gate (reason `rebase conflict`): the card lists conflicting files from `git merge-tree --write-tree --name-only --no-messages <target> <branch>` in runRoot, touching no worktree, and offers Find cause (a find-cause job in that worktree) or Manual (shows the worktree path; the user rebases, then Approves) (S-06).
82. Final phases: landed → card Done; passed → card Review; stopped, crashed or refused → `run-failed` card with `Reason:` and Resume (`exo run --resume <id>`), Retry (a new detached run) and Discard; a non-final phase with a dead pid gets one automatic `--resume` per job, the second time a `run-failed` card (X1); no other retry.
83. Every final phase archives `.exo/run/<id>/` or `.exo/kept/<id>/` and the run-plan dir into `<data>/jobs/<jobId>/run/` (M10); worktree removal calls `remove-worktree.mjs --worktree <path> --run <checkout> --kept` only after the archive; `scripts/validate.mjs` fails on `git worktree remove` anywhere in `src/`.
84. Outcomes: parked → `question`, stopped with a `budget:` reason → `budget`, `hit --max-turns` → `max_turns`, init mismatch → `invariant`, setup failure → new outcome `setup`, refused → `refused`, crashed or other stopped → `crashed`; the failure inbox lists exo-run jobs; card summary = `report.md` head plus the last assistant text of the last iter log (X4, S-05).
85. Find cause stage: a `config/stages.json` `find-cause` entry (Sonnet, long-lived stream-json like `spec`, read-only allow list, push, commit and `gh` denied, build-dispatch guard), card action Find cause on Inbox cards and from the conflict gate; done = a `done` turn, summary = its last text.
86. exo repo exception: project realpath equal to the plugin root realpath → the run starts from the project's main checkout with the brief's absolute path; the brief must say `Land: local`, else a refusal card (F-3-13).
87. Lanes: the daemon writes `card.lane` Approved on Approve, Review on passed or parked, Done on landed; Queued and Running stay derived from the live job; no lane-move route.
88. UI: only the new Needs-you kinds (`brief`, `gate`, `conflict`, `run-failed`, `setup`, `refusal`, `land`), the collision text on the card, the Find cause action and the run fields in the job view; no restyle.
89. Phase-2 fixes: the health reconcile is serialized (one in-flight reconcile, sessions claimed before any await), red test first; the `?token=` e2e test loads a real `http://127.0.0.1:<port>/?token=<token>` URL.
90. C-04: an e2e test counts clicks card → Shape → (answers) → Approve brief → landed with `Land: local` in the fake exo: at most 3 clicks plus approvals.
91. Every new test name contains the `tests.json` ids it proves (F-3-xx, S-xx, C-04), so `scripts/phase-status.mjs --phase 3` flips them.
92. The deck finishes exo's last land step (user): from a deck worktree, `Land: local` parks with the gate reason `cannot switch to <base>` after exo has already rebased, re-checked and squashed the branch in the runRoot (exo land-run.mjs:144-185), and `exo approve` only repeats that switch; so that gate is no gate card: when the main checkout's `git status --porcelain --untracked-files=no` is empty and its `symbolic-ref --short HEAD` is `<base>`, the deck runs `git -C <main checkout> merge --ff-only <branch>` and treats the job as landed (card Done, archive, worktree removal, `job.run.landed` = the `<old>..<new>` range); a dirty or off-base main checkout is a `land` Needs-you card with `clean <main checkout> and switch it to <base>` and Retry; a failed fast-forward is that card with git's text, with nothing changed in the main checkout.

## Phase 4 (lead, 2026-10-21)

Numbers are those of `docs/specs/phase-4-budget.md` (local only), so "Decision n" inside the text refers to this section.

1. Land for this phase: `push-main`, onto `main` (user).
2. Blocked: F-4-09 (auto-resume of a limit-only gate after `resetsAt` plus jitter, M8). It needs the exo-side change "`exo run` parks with its reset time on a limit hit", and exo 0.136.0 at `/Users/thomash/Documents/Code/personal/plugins/exo` (what `~/.claude/exo/plugin-root` points to) has no such code: no match for `resetsAt`, `usage_limit` or `rate_limit` in `skills/build/scripts/` (`run-session.mjs`, `run-plan.mjs`, `exo-cli.mjs`, `land-run.mjs`); the only `parked` gates are the land gates of `land-run.mjs` (lines 103-107, `no branch` and the like) and `docs/facts.md` already records "exo has no limit detection". No task builds F-4-09; Task 12 builds the part of M8 that does not need exo (S-16: never auto-approve a mixed gate, list every open gate) and leaves the limit-only branch off. F-4-09 is unblocked when an installed exo writes a reset time into `state.json` or `gates.md`; then its task is: read that field, and call `exo approve <id>` only after `resetsAt` plus jitter when every open gate line is the limit gate.
3. `src/daemon/settings.mjs` keeps the user settings in `<data>/settings.json` (tmp plus rename) with these keys and defaults: `ceilings` `{ fiveHour: 0.8, sevenDay: 0.7 }`, `hardStopFiveHour` 0.92, `maxConcurrent` 2, `landDefault` `"local"`, `landByProject` `{}`, `scouts` `{ enabled: false }`, `overageAllowed` false; the file is rewritten whole, unknown keys are dropped, and a value out of range answers 400.
4. `src/daemon/usage-sources.mjs` merges three sources into `{ [rateLimitType]: { utilization, resetsAt, status, observedAt } }`, freshest `observedAt` wins per `rateLimitType`: events parsed by `parseRateLimitEvent` from `-p` job streams, `iter-*.log` lines of running exo runs, and `~/.cache/exo/statusline-rate-limits.json` (fraction and epoch seconds; the file's keys are read as found, and a missing or unparsable file is skipped). Every `rateLimitType` is kept, so `seven_day_opus` and `seven_day_sonnet` are separate entries.
5. Each stage in `config/stages.json` names its limit windows in a `windows` array: `spec` `["five_hour", "seven_day", "seven_day_opus"]`, `build`, `verify`, `find-cause`, `ship` `["five_hour", "seven_day", "seven_day_sonnet"]`, `scout-triage` `["five_hour", "seven_day"]`, `run` `["five_hour", "seven_day"]`; admission checks only those windows, so an Opus window pauses only Opus stages (S1).
6. Admission (`src/daemon/admission.mjs`): a job is admitted when for each of its stage's windows `utilization + p75(stage)` stays at or under the ceiling (the ceiling is `ceilings.fiveHour` for `five_hour` and `ceilings.sevenDay` for the other windows), no overage is active, the queue is not paused and fewer than `maxConcurrent` top-level jobs run. The p75 comes from the per-stage ledger of observed utilization change per finished job (Task 4); with fewer than 5 samples the stage's `seedP75` from `config/stages.json` is used (`spec` 0.04, `build` 0.06, `verify` 0.03, `find-cause` 0.04, `ship` 0.02, `scout-triage` 0.01, `run` 0.10; changeable there).
7. Overage is active when any event has `isUsingOverage` true or an `overageStatus` other than `rejected` (M7): no new job is admitted, running jobs drain, the gauge shows overage, and only the Needs-you `overage` item's explicit toggle (a POST that sets `overageAllowed` true for the current session) lifts it; the toggle resets to false when the daemon restarts.
8. Hard stop (F-4-05): when the `five_hour` utilization reaches `hardStopFiveHour`, each running exo run gets `stopAtBoundary`: the daemon waits for the next `Plan-task:` commit on the run branch (the run's `landed` count rising in `state.json`), then sends SIGTERM to the run's process group; the job becomes `stopped` with outcome `hard-stop`, resumable by `--resume`. `-p` jobs are not killed by the hard stop; they drain.
9. A limit hit in a `-p` job is a `rate_limit_event` with `status` `rejected`, or an `api_error` `usage_limit_reached` assistant message (facts: inferred from the CLI binary, not observed live). It sets `queue.paused = { reason: 'limit', rateLimitType, resetsAt }`, marks the job `queued` with `limitHit`, and a timer resumes the queue at `resetsAt` plus a jitter of 5 to 60 seconds; a restart reads the pause back from `state.json`. Only windows named in the job's stage pause stages: a `seven_day_opus` limit holds `spec` jobs and still admits `build`.
10. `-p` retries (X1) are in `src/daemon/retry.mjs`: a job whose stream ends with no `result` event, or with an `overloaded_error`, is retried at most twice with 2 s then 10 s waits (override via `retryWaitsMs`); each failing line is stored on the job as `failures[]`; the same failing line twice, or a third failure, makes a bug card (S-09) with that line. A result with `is_error` from the model, a permission denial and a limit hit are never retried. An `exo run` is never retried by the deck: a `stopped` run with `no progress` or an attempt-cap `Reason:` in `report.md` is a bug card showing that `Reason:` (S-09).
11. The budget dial (F-4-11) is `exo settings set budget <value> --scope local` through `<plugin-root>/skills/configure/scripts/settings.mjs` in the project's main checkout; before writing, `git check-ignore .claude/exo.local.json` must exit 0, else the write is refused with a card naming the file (S11). Values are exo's own list as printed by `settings.mjs --help`; the deck offers only those.
12. The budget raise gate (F-4-12): the dial moving to a more expensive value, or a ceiling raised above the default, creates a Needs-you `budget` item with Approve and Reject; Approve applies the write, Reject leaves the old value. Lowering applies at once.
13. Token ledger (F-4-13): per job `ledger[]` rows `{ at, input, output, cacheRead, cacheCreation1h, cacheCreation5m, costUsd, estimate: true }` from each `result` event (`parseResultUsage` imported unchanged, the other usage fields read in `ledger.mjs`); a row whose `cacheCreation1h + cacheCreation5m` is over 20000 tokens and whose gap since the previous row is over 300 s is flagged `idleCacheWrite: true`. Every `costUsd` shows with the word "estimate".
14. Offline (F-4-14) is a failed fetch of `https://api.anthropic.com` HEAD every 15 s (configurable `offlineProbeMs`; injectable `fetch`) 2 times in a row; while offline `queue.paused = { reason: 'offline' }`, running jobs continue, the deck stays usable, and the queue resumes on the first success.
15. Stop all (F-4-15) stops every job and sets `queue.paused = { reason: 'stopped' }`, which only the Resume queue button clears. A pause with several causes keeps them in `queue.pauses[]` and resumes only when none is left.
16. The queue (F-4-07) is an ordered list `queue.order[]` of job ids plus `projectPriority[]` (project ids; earlier is higher); the next job is the first of the highest-priority project; reorder is `POST /api/queue/reorder` with the full id list, 400 for ids that are not queued. An exo-run lock refusal job (`queued.holder`, Phase 3) stays in the same list.
17. Test fixtures: `test/fake-claude/bin/claude` gains a `FAKE_CLAUDE_LIMIT` scenario (JSON `{ type, resetsAt, afterTurns }`) that emits a `rejected` event or the `usage_limit_reached` message; `test/fake-exo` runs keep `FAKE_EXO_SCENARIO`; a statusline-cache file is written by tests into a temp `HOME`.

