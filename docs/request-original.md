# Build exo deck: a desktop command deck for exo

(Original request, verbatim except the name. The app is now named exo-harness; see `request.md` for the answers and scope changes.)

You are the lead engineer on a new personal app. You design it, plan it and build it over several sessions. I am the only user. I steer, and AI engineers (Claude Code sessions running exo) do the building. I want to run my projects the way a founder runs a small software company: I pick what matters, approve the few decisions that need me, and watch the work happen on one clear screen. Today I do this by prompting in a terminal again and again.

The app is done when I can open it, see every project and what each one is doing, turn a card on a project's board into a built and verified change with two or three clicks, and leave it running without spending past the limits I set. It also has to recover on its own from the failures in `<situations>`.

<context_about_me>
- I have a Claude Max 20x plan and no API key. Every model call in the app goes through that subscription.
- My projects live in separate git repos. Current ones are exo, newdata os, airpods fix and roblox kit, and more will follow. Ask me for their paths. Do not search my disk for them.
- I use macOS, Node 22+ and git. exo's own code is Node with no Rust, so pick a stack I can maintain.
- I care about less thinking per action, a clear overview, and a UI that feels made with care and doesn't look like a generic dashboard.
</context_about_me>

<about_exo>
exo is my Claude Code plugin, an exoskeleton that turns Claude into a stronger engineer. The app drives exo. It does not reimplement exo. Every behavior exo already has (planning, building, verifying, model routing for helpers, run locks, gates) stays in exo, and the app starts it, watches it and shows it. If the app copied that logic, the two would drift apart and I would maintain two versions.

Read these before you design anything. The exo checkout is at `/Users/thomash/Documents/Code/personal/plugins/exo`, and it is read-only for this project:
- `README.md` and `ABOUT.md` explain what exo is and the words it uses (brief, plan, task, stage, direction, helper). Use the same words in the UI.
- `CONTRIBUTING.md`, especially "Unattended runs" and "How a skill dispatches work".
- `skills/build/scripts/exo-cli.mjs` and `run-state.mjs` define the run phases and the files under `.exo/run/<id>/`.
- `lib/model-kinds.json` and `skills/configure/scripts/settings.mjs` define the `budget` setting (`fast`, `balanced`, `quality`), which sets the model and effort for each helper.

Facts to build on. Check each one against the code before you rely on it:
- Stages: `spec` writes a brief, `build` lands its tasks, `verify` checks the branch, `ship` pushes or merges. A bug goes to `find-cause` first. `design-ui` designs a page, and `refactor` restructures code without changing behavior.
- Headless runs: `exo run <plan> --detach` starts a detached run and writes `.exo/run/<id>/state.json` (pid, phase, log). After that, `exo status [<id>]`, `exo wait <id>`, `exo approve <id>` (for a parked run's `gates.md`) and `exo run --resume <id>` work on it. Phases are `starting, build, verify, landing, passed, landed, parked, stopped, refused, crashed`. A run writes `report.md`, `sessions.jsonl` (per-session `costUsd`) and logs. Finished runs move to `.exo/kept/<id>/`. Each checkout gets one run at a time, enforced by `.exo/run/lock`.
- `exo run` refuses to start when `CLAUDECODE` is set, which means inside a Claude Code session. The app's backend therefore has to run from my terminal or a login item. Leave the guard alone and don't strip the variable to get around it. It keeps a session from starting runs it can't supervise.
- `~/.claude/exo/plugin-root` holds the path of the loaded exo copy. The CLI lives at `skills/build/scripts/exo-cli.mjs` under that root, or on `PATH` as `exo` after `/exo:run-plan setup`.
- The app reads `.exo/` files and changes them only through exo commands, because exo owns their format.
</about_exo>

<verified_facts>
These come from first-party docs, checked on 2026-10-20.

Subscription-only access:
- Spawn the unmodified `claude` CLI: `claude -p --output-format stream-json --input-format stream-json --verbose`. By default it authenticates with the subscription OAuth login from `/login`.
- Never pass `--bare`, because it skips OAuth and the keychain.
- In `-p` mode, a present `ANTHROPIC_API_KEY` always wins, and that would bill an API account. Delete it from every child's environment. Before the first spawn of each app launch, run `claude auth status` and require `authMethod` to be `claude.ai`. On any other value, stop and show me the fix.
- Useful flags: `--session-id <uuid>`, `--resume`, `--max-turns`, `--model opus|sonnet|haiku`, `--permission-mode`, `--allowedTools`, `--mcp-config`, `--append-system-prompt`.
- Policy: personal use of the unmodified binary with my own subscription is allowed. Offering claude.ai login to others or routing my credentials for other users is not. So the app stays single-user and local: bind to `127.0.0.1` only, no remote access, no accounts, no distribution.
- Use the CLI, not the Agent SDK. The CLI path is verified for subscription use, and the SDK path is not.

Limits and cost:
- My plan has a 5-hour window and a weekly limit. No first-party API reports the remaining usage.
- Statusline input JSON carries `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage` and `resets_at`, but only after the first response.
- Cost levers: Sonnet for most coding, Opus for architecture and briefs, Haiku for simple helper work. Each helper adds requests. `/compact` costs a large request and `/clear` is free. A cache miss follows idle time past the cache lifetime. `MAX_THINKING_TOKENS` lowers thinking.

Desktop shell and UI:
- Tauri 2.12 (MIT/Apache-2.0) supports sidecars that stream stdout events and accept stdin writes, and it builds small binaries.
- Electron 44.9.1 is heavier. Its `utilityProcess` rejects stdin, so it would have to use main-process `child_process`.
- shadcn/ui (MIT) is copy-in and defaults to the Base UI base. Unstyled primitives are Base UI v1.x or Radix (MIT), and React Aria (Apache-2.0) covers deep accessibility.
- Animation: `motion` 14.4.0, imported from `motion/react`. Agent and task graphs: `@xyflow/react` 12.12.0. The old `reactflow` package is not the same thing.
- Magic UI (MIT) is fine for a few decorative effects. Aceternity has a custom license, so use it sparingly. HeroUI's license label conflicts between sources, so leave it out unless the license checks out.
</verified_facts>

<verify_first>
These are unverified. Settle each one with one cheap probe (Haiku, `--max-turns 1`) or by reading code. Record the result in `docs/facts.md` and save the raw output as a test fixture before you build on it:
1. Whether `rate_limits` or any limit event shows up in `-p` stream-json output. Dump every event type from one probe. If none does, the usage gauge becomes an estimate built from the app's own token and `costUsd` ledger plus parsed limit-hit messages, labeled as an estimate in the UI.
2. What a limit-hit looks like in stream-json (event, text, reset time), so the queue can pause until the reset.
3. Whether `/exo:<skill> <args>` as the prompt of a `-p` session starts that skill. `run-plan.mjs` relies on this for `/exo:build`. Check `spec` and `find-cause` too.
4. How a question from a skill (`AskUserQuestion`) and a permission denial show up in `-p` stream-json mode, so the app can relay them to me as cards and reply on stdin.
5. The current versions and licenses of every library you install. The facts above are dated, so check them at install time.
</verify_first>

<product>
Core objects:
- Project: a git repo I add, with its exo `budget` dial, its board, its jobs and its health (auth, exo loaded, tree clean, run lock).
- Card: one item on a project's board. Its kind is feature, improvement or bug. Its lane is Inbox, Shaped (brief written), Approved, Queued, Running, Review or Done. Cards come from me, from scout passes that I trigger or schedule, and from failures: a stopped run or a failing check becomes a bug card that links its log. I can drag cards across lanes, merge or split them, reorder them, and retag them. Restructuring the board should take one gesture.
- Job: one `claude -p` session or one detached `exo run` tied to a card. It has a stage, a model, a worktree, a live timeline, a token ledger and an outcome.

Card actions map to exo stages: Shape runs `spec` and produces a brief I approve, Build runs `build` (an `exo run --detach` for an approved plan), Find cause runs `find-cause`, Verify runs `verify`, and Ship runs `ship`. You choose the session shape for each stage, based on what you find in exo's code.

Screens: a command deck overview (all projects, running jobs, limit gauges, items waiting on me), a project board, a job view (live timeline, the raw transcript one click away, approve and stop buttons) and settings. The overview answers "what needs me now?" before anything else.
</product>

<harness_design>
Use the simplest pattern that works: a deterministic orchestrator in code, with model sessions as workers. Routing, queueing, retries and budgeting are plain code. Only work that needs judgment goes to a model, because code is cheaper, testable and predictable.

- Process supervisor: a backend daemon owns every child process, so closing the UI never kills a job. It streams stdout line by line, writes each raw line to `jobs/<id>/events.jsonl`, and parses only the event types it knows. When it sees an unknown event or a malformed line, it logs it, shows it raw, and keeps going, because CLI updates will add new events.
- Persistence: app state lives in its own data dir (SQLite or JSON files) and records every job's pid, session id, worktree, stage and last event. On start, it reconciles that state with live pids and `.exo/run/*/state.json`, then resumes each `claude -p` job with `--resume <session-id>` and each exo run with `exo run --resume <id>`.
- Isolation: every job that writes code runs in its own git worktree. Two jobs never edit the same repo tree. exo's lock already stops two runs in one checkout, so surface that refusal instead of working around it.
- Model routing: the app chooses only the top-level session model for each stage, and exo's `budget` setting routes the helpers. Starting defaults: Haiku for scout triage and card summaries, Opus for `spec`, Sonnet for top-level `build`, `verify` and `find-cause` sessions. Keep the table in one versioned config file. Move a step to a cheaper model only when that model passes the step's eval (see `<working_method>`).
- Budget: I set a ceiling for each window (default: stop starting new jobs at 80% of the 5-hour window and 70% of the weekly limit, so I keep room for my own use). Every job gets `--max-turns`, and exo runs get `--max-run-usd` as a spend proxy. On a subscription, `costUsd` is an estimate and not a bill, so label it that way. When the ceiling or a limit-hit arrives, the queue pauses, running jobs finish their current task, and the deck shows when work resumes.
- Concurrency and queue: by default at most 2 top-level jobs across all projects, because each exo build already fans out helpers. Excess jobs wait in a visible, reorderable FIFO queue with per-project priority.
- Approval gates: ask me only where a mistake is expensive or leaves my machine. That means approving a brief before its build, anything that pushes, merges or opens a PR, an exo parked gate, a budget raise, and deleting a worktree that holds unmerged work. Everything else runs without asking: queued builds of approved cards, retries within the cap, and scouting within budget. Each gate is a card in "Needs you" with a one-line summary, the diff or brief, and Approve or Reject.
- Retries: retry a failed job at most twice, and only after recording the failing line. If the same failing line shows up twice, stop and create a bug card. Retrying the same failure costs limits and teaches nothing.
- Permissions: spawned sessions get `--permission-mode` and `--allowedTools` scoped to their worktree. Never use `--dangerously-skip-permissions`. The daemon accepts requests only from its own UI. It checks `Host` and `Origin` and requires a per-launch token, because any web page I visit could otherwise reach a localhost service that runs Claude with write access.
- Observability: each job keeps its raw transcript, a timeline (tool calls, files touched, tests run, denials) and a ledger (tokens, estimated cost, duration, model). The deck shows p95 job duration, tokens per finished card, failure rate, denial count and limit share used, per project and per day. Raw transcripts sit one click from every number, because a number alone doesn't show why a job failed.
</harness_design>

<situations>
Each row is a required behavior and a test case. Each needs a fixture-driven test.
| Situation | App does |
|---|---|
| `claude` missing, logged out, or `authMethod` is not `claude.ai` | Blocks spawning and shows the exact fix command |
| `ANTHROPIC_API_KEY` set in my shell | Strips it from children and shows a one-time notice |
| Limit hit mid-job | Pauses the queue, records the reset time, resumes on its own after the reset |
| App or daemon crash, Mac sleeps or reboots | Reconciles on start, resumes or marks each job, loses no card |
| exo run `parked` / `stopped` / `crashed` / `refused` | Shows `report.md` and the reason. Parked becomes a gate card, the others become a bug card with resume, retry or discard |
| Merge or rebase conflict | Parks the job with the conflicting files and offers a `find-cause` or manual route |
| Dirty tree or another run holds the lock | Shows exo's refusal text and queues the job behind the lock |
| Offline | Queues jobs, keeps the UI fully usable, resumes when back online |
| Job loops (same failing line twice, no new commits) | Stops it and turns it into a bug card |
| Project folder moved or deleted | Marks the project missing and asks me to relocate it |
| Unknown or malformed stream event | Logs it raw, keeps the job alive |
| exo not loaded or too old | Shows how to install or update it |
| Huge tool output | Stores it on disk and shows a trimmed view with a "load full" button |
</situations>

<design_direction>
The look is an exoskeleton: a precise mechanical frame around a powerful core. Use structure, joints and load paths as the visual language, not sci-fi cliches.
- Start from this direction and refine it with `exo:design-ui`. Layout: a command deck with a project rail on the left, the board or job in the center, and a live crew panel (running agents linked to their cards by React Flow edges like linkage struts) on the right, with limit gauges across the top. Color: graphite and titanium neutrals, one hot signal accent for "needs you", and muted status hues that stay readable for colorblind users. Type: one sharp grotesk for UI and one monospace for telemetry and numbers. Candidates are Geist with Geist Mono, or Space Grotesk with JetBrains Mono, all OFL, but check the license. Motion: mechanical and damped, as if parts actuate and lock into place. Use short springs without overshoot, motion that shows state change, and full `prefers-reduced-motion` support.
- Avoid purple-gradient AI dashboards, glassmorphism everywhere, and decoration that carries no state. Every visual element should tell me something.
- Before you build UI, show me 2 or 3 directions as static screenshots of the deck screen and let me pick one.
- Design review after each UI phase: Playwright screenshots of each screen at 1440 and 1024 widths, plus empty, busy and error states. Then look at them yourself, and ask a fresh helper to critique them against the direction and this checklist: hierarchy (what needs me is found in under 2 seconds), contrast at WCAG AA, alignment, motion, and consistency. Fix what it finds and keep the screenshots in `docs/design/`.
</design_direction>

<working_method>
Investigate before you answer. Read the exo code a claim depends on and open the file before you describe it. If you haven't checked something, say so.

Phases. Finish each one before starting the next:
0. Investigation: read the exo files above (send broad reads to a helper so your context stays clean), run the `<verify_first>` probes, and write `docs/facts.md`.
1. Spec and plan: write a short spec (goal, users, screens, harness, the situations table, success criteria) and a phased plan in `docs/PLAN.md`. Use `exo:spec` if exo is loaded in this session. Then ask me only the decisions that are really open, at most five at a time, each with your recommended default and its reason. Expected ones: app name and repo path (default: a new repo beside my projects, outside the exo checkout), shell (default: a Node daemon plus a React UI in the browser for the MVP, wrapped in a Tauri 2 window later, so the logic stays in the language exo uses), budget ceilings, the concurrency cap, and whether scouts run on a schedule. Make every other choice yourself and log it in `docs/decisions.md`.
2. MVP vertical slice: one project, a board with manual cards, Shape on one card starting a real `claude -p` `spec` session in a worktree, the live timeline streaming into the UI, Stop working, the auth guard enforced, and state that survives a daemon restart mid-job. This slice carries the riskiest parts end to end, so it comes before breadth.
3. Detached `exo run` supervision with gates and approvals.
4. Budget, queue, concurrency and routing.
5. Multi-project deck, board restructuring and scouts.
6. Design polish, the full situations table and the design review.
7. Optional packaging.

State across sessions. This build spans many sessions, and each new one starts with no memory of the last:
- `docs/progress.md` holds the current phase, what landed, the next step and open problems. Update it before each commit and whenever your context gets long.
- `tests.json` lists every feature and situation with a pass/fail field. Add entries and flip their status. Never delete an entry or edit a test just to make it pass, because a test changed to fit the code proves nothing. If a test is wrong, say why in the commit.
- Commit with git after each working step, one purpose per commit. A fresh session resumes from `docs/progress.md`, `tests.json` and `git log`.

Testing without spending my limits:
- Automated tests never call the real model. Build a fake `claude` executable that replays recorded stream-json fixtures (normal run, limit-hit, crash mid-stream, malformed line, question, denial) and a fake exo state dir for every run phase. The daemon accepts `--fixtures` mode and may run under `CLAUDECODE` only in that mode.
- Live checks: one per phase, on Haiku with `--max-turns` set. I launch the daemon from my terminal for them, because your session sets `CLAUDECODE`. Tell me the exact command and what I should see.
- Write general code. Don't special-case a fixture to pass a test. If a requirement looks wrong or a test can't pass, tell me instead of working around it.
- Any model step in the app (scout triage, card summaries) gets a fixed set of 20 or more hand-labeled cases and a code grader, run 3 times per model. Report the spread, not one number. Route the step to the cheapest model that passes.

Scope:
- Build what the current phase needs. Don't add abstractions, plugins or settings for needs that don't exist yet, because every extra part is code I maintain alone. Three similar lines are better than a premature framework.
- Use parallel tool calls for independent reads and checks. Use helpers for broad discovery, for the design critique, and for UI components that don't share files. Never put two helpers on the same files.
- Your own session also spends my limits. Use Sonnet helpers for routine edits, and keep Opus for design, architecture and review.
</working_method>

<success_criteria>
- With my API key set in the shell, no child process sees it, and `claude auth status` gates every launch (test plus one live check).
- Every row of `<situations>` passes its fixture test. `tests.json` shows them all passing.
- Killing the daemon mid-job and restarting it resumes or correctly marks every job, with no lost card or orphaned process.
- From card to approved brief to a landed exo run takes no more than 3 clicks plus my approvals.
- The queue never starts a job past my budget ceiling (fixture test with a simulated limit state).
- The design review checklist passes on all screens at both widths, and the screenshots are saved.
- `docs/progress.md` lets a fresh session continue without asking me anything.
</success_criteria>

Start with phase 0. When it's done, reply with the `docs/facts.md` summary, any `<verify_first>` result that changes this plan, and your phase 1 questions. Write no app code before I answer them.
