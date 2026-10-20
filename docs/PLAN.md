# exo-harness: spec and phased plan

Sources: `request-original.md` (goal, screens, harness, situations, phases, success criteria), `request.md` (answers, GitHub-wide scope, landing), `facts.md` (verified facts), `review-senior-ai.md` (items M1-M11, S1-S15, X1-X10; every MUST and SHOULD adopted below, cuts X1-X7 and X10 adopted, X8 and X9 kept at the user's request). Choices made without the user: `decisions.md`. Test list: `../tests.json` (ids `F-<phase>-<nn>`, `S-<nn>`, `C-<nn>`, used below).

UI copy uses exo's words: brief, plan, task, stage, helper, direction. Never "subagent" or "spec doc".

## Goal

One local app where the user sees every project and what each one is doing, turns a card into a built and verified change with two or three clicks plus approvals, and leaves it running without spending past the limits set. It drives exo and never reimplements it: planning, building, verifying, helper routing, run locks and gates stay in exo; the harness starts, watches and shows them, and recovers on its own from every row in Situations.

## User

One person (owner `blauwtje`), on macOS, Claude Max 20x subscription, no API key. Single-user and local: no accounts, no remote access, no distribution. Projects are any of the user's GitHub repos, added and removed at will.

## Screens

- **Deck overview.** Answers "what needs me now?" first: the Needs-you column (gates, question cards, permission asks, invariant kills, failure cards) sits top-left with the one hot accent. Below and beside it: project rail, running jobs, queue, limit gauges across the top with reset times, and the crew panel (running jobs and their helpers, linked to their cards).
- **Project board.** Lanes Inbox, Shaped, Approved, Queued, Running, Review, Done. Card kinds feature, improvement, bug. Card actions: Shape (`spec`), Build (`exo run --detach` on an approved plan), Find cause (`find-cause`), Verify (`verify`, only for branches built outside `exo run`, X3), Ship (`ship`). Restructuring (drag, reorder, retag, merge, split) takes one gesture each.
- **Job view.** Live timeline (tool calls, files touched, tests run, denials), the raw transcript one click away, ledger (tokens, estimated cost, duration, model, versions), Stop, and Approve or Reject on any open gate with its diff and brief.
- **Settings.** Budget ceilings and hard stop, concurrency cap, landing default plus per-project override, scouts, overage toggle, stage table view, projects folder, per-project setup command.
- **Project picker.** The user's GitHub repos (own and orgs) from `gh`, with local clone status; add (partial clone or map an existing clone) and remove.

## Harness

Deterministic orchestrator in code, model sessions as workers. Routing, queueing, retries and budgeting are plain code.

**Supervisor**
- One daemon owns every child, each in its own process group; closing the UI kills nothing.
- stdout read line by line, every raw line appended to `jobs/<id>/events.jsonl`; known types parsed, unknown or malformed lines logged, shown raw, job kept alive.
- Interactive stages (`spec`, `find-cause`, `ship`) run as one long-lived `claude -p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio` process; a reply is the next user message on stdin; `--resume <session-id>` only when the process is gone (M1).
- At each `result`, code classifies the turn: done, question, or other (M1). Each finished job gets one outcome: done, question, max_turns, timeout, limit, auth, crashed, refused, invariant (S5).
- `caffeinate -i -w <daemon pid>` while any job runs; no event for N minutes marks a job stalled, then the stage wall timeout kills its group (S13, M5).
- Stop (one job) and Stop all (every group, then queue paused) (M5).

**Persistence**
- JSON state files written tmp file plus rename, plus per-job `events.jsonl`; no SQLite (X10).
- Data dir `~/Library/Application Support/exo-harness/`, mode 0700, outside synced folders (S14).
- Per job: pid, process start time, process group, session id, worktree, stage, last event, `claude_code_version`, exo version, resolved model (M9, S4).
- Project key: GitHub `nameWithOwner` plus local path, from phase 2 on, so phase 5 needs no migration (S10).
- Restart reconcile: a job is dead only when its pid is gone or its start time differs; alive means kill its group, then resume; never two writers on one session (M9). exo runs reconcile from `state.json` plus pid liveness.
- On a run's final phase, copy its `.exo/run/<id>/` or `.exo/kept/<id>/` and its `runRoot` `.exo/run-plan/<plan-id>/<time>/` into the data dir before any worktree removal (M10).

**Isolation**
- Every job that writes code gets `<repo>/.worktrees/<slug>`, created `git worktree add --detach <path> origin/<default>`; exo creates the plan's `Branch:` (M3, S7). Excluded through `.git/info/exclude`.
- Each worktree has its own `.exo/run/lock`, so runs per repo can run side by side without working around exo (M3); a lock refusal is shown, not bypassed.
- Fresh worktree runs a setup step derived from the lockfile, overridable per project; `.env*` copied only when the project's exo `env` setting is `copy` (S7).
- Branch-name collision checked at Approve against local and remote branches and `git worktree list` (S15).
- exo fast-forwards the default branch in the main checkout before a run; a refusal there is surfaced (M3).
- Worktree removal only through exo's `remove-worktree.mjs --kept`, after archive (M10); GC when the card is Done and its PR merged, read from PR state (S7).
- exo repo exception: its runs start from its main checkout, where exo makes its own worktree and `Land: local` works (M3).

**Routing**
- `config/stages.json` (versioned) sets per stage: model, effort, permission mode, allowed and disallowed tools, max turns, wall timeout. Starting table: Opus `spec`; Sonnet `build`, `verify`, `find-cause`, `ship`; Haiku scout triage.
- The harness picks only the top-level model; exo's `budget` setting routes helpers. The budget dial writes `--scope local` only (S11).
- `--append-system-prompt` text is identical for every job of a stage; card text and worktree go in the user message; `--exclude-dynamic-system-prompt-sections` passed; `FORCE_PROMPT_CACHING_5M` left unset for interactive stages (S2).
- A step moves to a cheaper model only after it passes that step's eval.

**Budget**
- Usage read from three sources, freshest wins: deck streams' `rate_limit_event`, `iter-*.log` in running exo runs, `~/.cache/exo/statusline-rate-limits.json` (S1).
- Every `rateLimitType` tracked, including `seven_day_opus` and `seven_day_sonnet`, so an Opus window pauses only Opus stages (S1).
- Admission: current utilization plus the stage's p75 projected change stays under the ceiling (80% of 5-hour, 70% of week) (S1).
- Hard stop at 92% of the 5-hour window: exo runs are stopped at the next task boundary (`landed` rises, then SIGTERM), resumable from `Plan-task:` commits (S1).
- Overage active (`isUsingOverage` true, or `overageStatus` not `rejected`) admits no new job and drains running ones until the user flips an explicit toggle (M7).
- `-p` jobs get `--max-turns` plus a wall timeout; exo runs get `--max-run-usd` and `--max-budget-usd` (X2). `costUsd` is labeled an estimate everywhere.
- Per turn, cache read and write tokens recorded; a large cache write after an idle gap is flagged (S2).

**Queue**
- At most 2 top-level jobs across all projects (setting); excess waits in a visible, reorderable FIFO with per-project priority.
- Ceiling, hard stop, overage or limit hit pauses the queue; the deck shows when work resumes.
- Retries: `exo run` gets no deck-level retry or loop logic; a dead pid with a non-final phase gets one `--resume`, a limit park follows M8, everything else is a bug card with exo's `Reason:` (X1). `-p` jobs retry only infrastructure failures (no `result`, overload), at most twice, after recording the failing line; the same line twice makes a bug card.

**Gates**
- Gate cards in Needs-you, each with a one-line summary, evidence and Approve or Reject: brief approval (after plan-check passes, M2), push, merge or PR, exo parked gate, budget raise, overage toggle (M7), worktree deletion with unmerged work, clone delete with local-only work (M11).
- Land, push and PR gates show `git diff --stat <base>...<branch>`, per-file diff on click, `report.md` head and `denied.txt` (S9).
- `exo approve` approves every open gate at once, so the deck calls it by itself only when every open line is the limit gate and `resetsAt` plus jitter has passed (M8).
- exo's recommended option is never taken without a click; "OK" is a one-click button.

**Permissions**
- Every child gets an explicit `--permission-mode` (user default is `bypassPermissions`); never `--dangerously-skip-permissions`.
- Stage permission table in `config/stages.json`; the daemon answers each `can_use_tool` `control_request` in code: deny-list match is denied with a message, anything else is a Needs-you card with allow once or deny (M5). `spec` and `find-cause` get no `git push`, `git commit` or `gh`; only `ship` gets push and `gh pr`.
- Child env scrubbed of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `FORCE_PROMPT_CACHING_5M`; `exo run` children also lose `CLAUDECODE` and `CLAUDE_CODE_*` (M4).
- Every `system/init` checked: `apiKeySource == "none"`, `permissionMode` as passed, `plugins` holds exo, `cwd` is the worktree; mismatch kills the group before the first tool result is accepted. exo runs: `init` of each `iter-*.log`, and `exo run config` provider `claude` (M4).
- Shape sessions are told they are driven by a workflow, so spec returns instead of starting a build (`hand-off.md:7`); a Shape session that dispatches build work is stopped (M2).
- Text from other GitHub users enters a card quoted in tags with its author and never moves a lane (S12).
- Daemon binds 127.0.0.1, checks `Host` and `Origin`, requires a per-launch token.

**Observability**
- Per job: raw transcript, timeline, ledger. exo run timelines come from `iter-*.log` through the same parser, polled at 1-2 s (S6).
- Failure inbox: every non-done job with its last 20 events and a typed one-word tag; streams with `status != "allowed"`, an `api_error` or a 429 saved to `test/fixtures/inbox/` (S5).
- Metrics per project and per day: n, median duration and the job list (percentiles once a slice has 20 jobs, X6), tokens per finished card, failure rate, denial count, limit share used; raw transcripts one click from every number.
- Metrics split on claude, exo and model versions; a version change shows a banner and offers the probe suite (S4).
- Card summaries come from the `report.md` head and the session's last message, no model step (X4).
- Crew panel edges come only from real links: job to card, and helper to job via `parent_tool_use_id` (X8 kept).

**GitHub and git**
- `gh` only through one wrapper with an allowlist (`repo list`, `repo clone`, `repo view`, `pr list`, `pr view`, `api` GET, `auth status`); a check fails the build on `repo delete`, `-X DELETE` or `--method DELETE` elsewhere (M6).
- Discovery: `gh repo list blauwtje --limit 500 --json ...` plus each org from `gh api user/orgs`; cached, refreshed on demand, archived and forks hidden by default. Local mapping: one projects folder plus added paths, matched by normalized `origin` URL; no disk crawl (S10). Add = partial clone `--filter=blob:none`.
- Lanes derived from git and GitHub: Running = live job, Review = passed run with unmerged branch or open PR, Done = PR merged or squash commit on default; manual drags only for Inbox, Shaped, Approved, Queued (S8). Open deck PRs show checks, review decision and mergeability.
- Landing: global default `pr`, per-project override; `local` offered for a project only after probe P3 shows it does not park (request.md, M3).
- Remove project = remove from the harness; deleting the clone lists what would be lost and moves the folder to the macOS Trash (M11). No repo-deleting call, ever.
- No force push except exo's gated `--force-with-lease`; commit signing config respected; no staging, rebase or branch-graph UI.

## Situations

Each row is a required behavior with a fixture-driven test (fake `claude`, fake exo state dir).

| id | Situation | App does | Phase |
|---|---|---|---|
| S-01 | `claude` missing, logged out, or `authMethod` not `claude.ai` | Blocks spawning, shows the exact fix command | 2 |
| S-02 | `ANTHROPIC_API_KEY` set in the shell | Strips it (and M4's list) from every child including `exo run`, shows a one-time notice | 2 |
| S-03 | Limit hit mid-job | Pauses the queue, records the reset time, resumes on its own after the reset | 4 |
| S-04 | App or daemon crash, Mac sleeps or reboots | Reconciles by pid plus start time, resumes or marks each job, loses no card, leaves no orphan | 2 |
| S-05 | exo run `parked` / `stopped` / `crashed` / `refused` | Shows `report.md` and the reason; parked becomes a gate card, the others a bug card with resume, retry or discard | 3 |
| S-06 | Merge or rebase conflict | Parks the job with the conflicting files, offers a `find-cause` or manual route | 3 |
| S-07 | Dirty tree or another run holds the lock | Shows exo's refusal text, queues the job behind the lock | 3 |
| S-08 | Offline | Queues jobs, keeps the UI fully usable, resumes when back online | 4 |
| S-09 | Job loops (same failing line twice, no new commits) | `exo run`: exo's no-progress or attempt-cap stop becomes a bug card with its `Reason:`; `-p`: stops at the second identical failing line, bug card | 4 |
| S-10 | Project folder moved or deleted | Marks the project missing, asks the user to relocate it | 5 |
| S-11 | Unknown or malformed stream event | Logs it raw, keeps the job alive | 2 |
| S-12 | exo not loaded or too old | Shows how to install or update it | 2 |
| S-13 | Huge tool output | Stores it on disk, shows a trimmed view with "load full" | 6 |
| S-14 | `init` invariant mismatch (M4) | Kills the process group before the first tool result is accepted, Needs-you card naming the field | 2 |
| S-15 | Overage active (M7) | Admits no new job, drains running ones, gauge shows overage, waits for the explicit toggle | 4 |
| S-16 | Mixed gates: limit gate plus another open gate (M8) | No auto-approve; gate card listing every open gate | 4 |
| S-17 | Main checkout fast-forward refused (M3) | Shows exo's refusal and the main checkout's local edits as a card; touches nothing there | 3 |
| S-18 | Worktree missing deps (S7) | Runs the setup step before the job; a setup failure is a setup card, not a code bug card | 3 |
| S-19 | Branch-name collision (S15) | Caught at Approve, shown on the card, not queued | 3 |
| S-20 | Stalled session (S13) | Marks stalled after N quiet minutes, then the wall timeout kills the group, outcome `timeout` | 2 |
| S-21 | Clone delete with local-only work (M11) | Lists uncommitted, ignored, stashed, unpushed, worktrees and live runs; approval; folder to Trash | 5 |

## Phases

Each phase ends with its `tests.json` entries passing under `npm test` (fixtures only, never the real model), its live check seen by the user, and `docs/progress.md` updated so C-07 holds. Live checks run on Haiku with `--max-turns` set, from the user's terminal, because Claude Code sets `CLAUDECODE`.

### Phase 0: investigation (done)

`facts.md`, `exo-findings.md`, `probe-results.md`, `library-versions.md`, probe fixtures in `test/fixtures/probes/`.

### Phase 1: spec and plan (this document)

- This plan, `decisions.md`, `tests.json`.
- Phase 2 brief at `docs/specs/phase-2-mvp.md` after probes P1, P2, P4, P5 land in `probe-results.md`.
- Exit: the brief passes `plan-check.mjs --loop`. Live check: none; the user reads this plan.

### Phase 2: MVP vertical slice

Riskiest parts end to end: one project, manual cards, Shape to a real `spec` session in a worktree.

- F-2-01 Daemon on 127.0.0.1 with `Host` and `Origin` checks and a per-launch token; HTTP JSON plus SSE.
- F-2-02 Data dir (S14) with `EXO_HARNESS_DATA` override; JSON state by tmp plus rename; per-job `events.jsonl`.
- F-2-03 Data model: project keyed by `nameWithOwner` plus local path (S10), cards, jobs; one project added by local path.
- F-2-04 `gh` wrapper with allowlist and the source check in `npm test` (M6).
- F-2-05 Fake `claude` replaying fixtures; `--fixtures` is the only mode allowed under `CLAUDECODE`.
- F-2-06 Auth guard: `claude auth status --json` before the first spawn per launch.
- F-2-07 Env scrub (M4 list) and one-time API key notice.
- F-2-08 `init` invariants (M4) and version stamps per job (S4).
- F-2-09 Stream parser: known types, unknown passthrough, malformed lines logged.
- F-2-10 `config/stages.json` with the `spec` entry; explicit `--permission-mode`; stable system prompt, `--exclude-dynamic-system-prompt-sections` (S2).
- F-2-11 `control_request` answered by code from the `spec` permission table; other asks become allow-once or deny cards (M5).
- F-2-12 Shape: detached worktree at `origin/<default>`, `.git/info/exclude`, long-lived `/exo:spec` session (M1).
- F-2-13 Turn classifier and question-card parser for exo's text question shape (`question.md`), with real and edge-case fixtures (two questions, `1/3` prefix, non-English, no recommendation line); letter buttons, OK, free-text reply (M1).
- F-2-14 Shape done-state: new brief file plus `plan-check.mjs --plan <brief> --root <worktree> --loop --run` exit 0; workflow-caller framing; build dispatch stops the session; health requires `specs` = `docs` or `both` (M2).
- F-2-15 Live timeline over SSE; raw transcript one click away.
- F-2-16 Stop and Stop all: SIGTERM the process group, SIGKILL after a grace period.
- F-2-17 Restart reconcile with pid, start time and process group (M9), using probe P2 fixtures.
- F-2-18 Outcome enum, failure inbox list, limit-stream capture to `test/fixtures/inbox/` (S5).
- F-2-19 `rate_limit_event` parsing including overage fields (M7 parse) and cache token fields (S2).
- F-2-20 Stall detection, wall timeout, `caffeinate` (S13).
- F-2-21 Health: `claude` present, auth, exo loaded and at least the minimum version, tree state.
- F-2-22 Design directions: 2-3 static screenshots of the deck screen; the user picks one before any UI is built.
- F-2-23 Board (one project, manual cards) and job view in the picked direction, React 19 plus Vite.
- F-2-24 Three wrapper eval cases (S3): vague feature asks; specified one-liner does not ask; `ok` to hand-off starts no build.

Exit: all phase-2 and S-01, S-02, S-04, S-11, S-12, S-14, S-20 tests pass; C-01 and C-03 pass.

Live check (user's terminal, a scratch clone as the project):
```
cd /Users/thomash/Documents/Code/personal/exo-harness
ANTHROPIC_API_KEY=sk-ant-dummy npm start -- --live-check
```
Expect: the one-time API key notice; a printed `http://127.0.0.1:<port>/#token=...` URL; add the project, add a card, click Shape; the timeline streams; the job view shows `apiKeySource none` and the passed permission mode; `ps eww -o command= -p <child pid> | grep -c ANTHROPIC_API_KEY` prints 0. Press Ctrl-C mid-job, rerun the command: the job resumes or is marked, no `claude` orphan in `ps`. Stop ends the job.

### Phase 3: detached exo run supervision, gates and approvals

- F-3-01 Probe P3 first: `exo run` from a linked worktree with `Land: local` and `Land: none`, scratch repo with a local bare origin; result in `facts.md` (M3).
- F-3-02 Approve brief starts `exo run --detach <plan>` in the card's worktree with `--max-run-usd` and `--max-budget-usd`; env scrub adds `CLAUDECODE` and `CLAUDE_CODE_*`; `exo run config` provider check (M4, X2).
- F-3-03 Branch-name collision check at Approve (S15).
- F-3-04 Worktree setup step from the lockfile, per-project override, `.env*` copy per exo `env` setting (S7).
- F-3-05 `state.json` polled at 1 s with pid liveness; lock and dirty-tree refusals shown; job queued behind the lock.
- F-3-06 exo run timeline from `iter-*.log` with the same parser; `init` check per log (S6, M4).
- F-3-07 Parked run becomes a gate card with diff stat, per-file diff, `report.md` head, `denied.txt`; Approve calls `exo approve <id>` (S9).
- F-3-08 Final phases: bug card with `Reason:` and resume, retry or discard; dead pid with non-final phase gets one `--resume` (X1).
- F-3-09 Archive run evidence on final phase (M10); removal only through `remove-worktree.mjs --kept`.
- F-3-10 Find cause stage: long-lived session shape (M1) and its permission table (M5).
- F-3-11 Conflict route: parked job lists conflicting files, offers Find cause or manual.
- F-3-12 Main checkout fast-forward refusal shown as a card (M3).
- F-3-13 exo repo exception: runs from its main checkout with `Land: local`.
- F-3-14 Failure inbox and outcomes cover exo runs (S5); card summary from `report.md` head and last message (X4).

Exit: phase-3 and S-05, S-06, S-07, S-17, S-18, S-19 tests pass; one card goes card to approved brief to landed run in 3 clicks plus approvals (C-04, fixtures).

Live check: the P3 scratch repo with a one-task plan, `npm start -- --live-check`, approve the brief; expect phases `starting`, `build`, `verify`, then `landed` or `parked` with `report.md` shown, and the archived run under the data dir's `jobs/`.

### Phase 4: budget, queue, concurrency and routing

Depends on the exo-side change (separate exo session, user approved): `exo run` parks with its reset time on a limit hit. F-4-09 waits on it.

- F-4-01 Full stage table in `config/stages.json`; routing per stage.
- F-4-02 User settings file and Settings screen: ceilings, hard stop, concurrency, landing default and per-project override, scouts, overage toggle.
- F-4-03 Usage from three sources, freshest wins, every `rateLimitType` tracked (S1).
- F-4-04 Admission on projected cost: per-stage utilization ledger, p75 projection under the ceiling (S1).
- F-4-05 Hard stop at the task boundary for exo runs (S1).
- F-4-06 Overage guard enforced, explicit toggle as a gate (M7).
- F-4-07 Queue: visible, reorderable FIFO, per-project priority, concurrency cap.
- F-4-08 Limit hit in a `-p` job: queue paused, reset recorded, resume after the reset.
- F-4-09 Auto-resume only for limit-only gates after `resetsAt` plus jitter (M8).
- F-4-10 `-p` retries on infrastructure failures only, at most twice, failing line recorded (X1).
- F-4-11 Budget dial writes `--scope local`, local file checked git-ignored (S11).
- F-4-12 Budget raise gate.
- F-4-13 Token ledger per job with cache fields and the idle cache-write flag; `costUsd` labeled an estimate (S2).
- F-4-14 Offline detection: queue holds, UI usable, resumes when back.
- F-4-15 Limit gauges with resume time; Stop all pauses the queue.

Exit: phase-4 and S-03, S-08, S-09, S-15, S-16 tests pass; C-05 passes.

Live check: in Settings set the 5-hour ceiling below the current reading, queue two cards; expect neither starts and the gauge names the ceiling and the resume time. Restore the ceiling; expect at most 2 jobs running.

### Phase 5: multi-project deck, board restructuring and scouts

- F-5-01 Project picker: own and org repos from `gh`, cached, archived and forks hidden by default (S10).
- F-5-02 Projects folder setting; local mapping by normalized `origin` URL; no disk crawl.
- F-5-03 Add project by partial clone or existing clone.
- F-5-04 Remove project; delete local clone after the M11 checks, to the Trash.
- F-5-05 Deck overview: Needs-you first, project rail, running jobs, queue, gauges.
- F-5-06 Health adds `gh auth status`, archived on GitHub, default branch, `specs` and `ship` settings (S10).
- F-5-07 Board restructuring: drag, reorder, retag, merge and split, one gesture each.
- F-5-08 Lanes derived from git and GitHub; PR checks, review and mergeability for open deck PRs (S8).
- F-5-09 Ship stage: session shape (M1), permission table with push and `gh pr` only (M5), landing setting per project.
- F-5-10 Verify action for branches built outside `exo run` (X3).
- F-5-11 Worktree GC when Done and PR merged, after archive (S7, M10).
- F-5-12 Manual scouts on added projects; untrusted text boundary, owner-only issues by default (S12).
- F-5-13 Scout triage eval: 20+ hand-labeled cases, code grader, 3 runs per model, spread reported; cheapest passing model.
- F-5-14 Scheduled scouts, offered only after the triage eval passes, each with a turn and spend cap (X7).
- F-5-15 Crew panel: running jobs and helpers linked to cards by React Flow edges from real links only (X8 kept).
- F-5-16 Missing project: marked missing, relocate flow.

Exit: phase-5 and S-10, S-21 tests pass.

Live check: open the picker, add one repo by clone into the projects folder; it appears on the rail with health. Make a scratch clone with an untracked `.env`, remove it with "also delete local clone"; expect the loss list, an approval, and the folder in the Trash.

### Phase 6: design polish, full situations table, design review

- F-6-01 Polish against the picked direction: damped motion without overshoot, `prefers-reduced-motion`, colorblind-safe status hues.
- F-6-02 Design review: Playwright screenshots of each screen at 1440 and 1024, empty, busy and error states; fresh critique helper on hierarchy (Needs-you in under 2 s), WCAG AA contrast, alignment, motion, consistency; fixes; screenshots in `docs/design/`.
- F-6-03 Huge tool output: stored on disk, trimmed view, "load full".
- F-6-04 Metrics view (X6) with raw transcripts one click from every number.
- F-6-05 Version banner and the probe suite diffing event types and keys against `test/fixtures/probes/` (S4).
- F-6-06 Full wrapper eval set: 8 cases, 3 runs each, pass counts per case (S3).

Exit: every phase 2-6 `tests.json` entry passes; C-02 and C-06 pass.

Live check: `npm start`, open each screen at both widths; compare with `docs/design/`.

### Phase 7: optional packaging

- F-7-01 Tauri 2 window around the UI; logic stays in the Node daemon.
- F-7-02 Login item (launchd) starting the daemon outside Claude Code.

Exit: phase-7 tests pass. Live check: log out and in; the daemon is up and the window opens the deck.

## Success criteria

- C-01 With the API key set in the shell, no child process sees it, and `claude auth status` gates every launch (test plus one live check).
- C-02 Every Situations row passes its fixture test; `tests.json` shows them all passing.
- C-03 Killing the daemon mid-job and restarting it resumes or correctly marks every job, with no lost card or orphaned process.
- C-04 From card to approved brief to a landed exo run takes no more than 3 clicks plus approvals.
- C-05 The queue never starts a job past the budget ceiling (fixture test with a simulated limit state).
- C-06 The design review checklist passes on all screens at both widths, and the screenshots are saved.
- C-07 `docs/progress.md` lets a fresh session continue without asking the user anything.
