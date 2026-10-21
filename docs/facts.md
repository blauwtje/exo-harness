# Facts (phase 0, checked 2026-10-20)

Detail and file:line evidence: `exo-findings.md` (exo code, exo 0.136.0 at `1c3dbef8`), `probe-results.md` (live `claude` probes), `library-versions.md` (npm registry). Raw probe output: `test/fixtures/probes/`.

Environment: macOS, Node v24.22.0, `claude` 2.1.305 at `~/.local/bin/claude`, `exo` launcher at `~/.local/bin/exo`, `~/.claude/exo/plugin-root` = the exo checkout.

## Subscription and auth

- `claude auth status --json` reports `authMethod: "claude.ai"` (Max plan). Fixture: `p0-auth-status.json` (email and org redacted).
- With `ANTHROPIC_API_KEY` unset, every probe's `system/init` shows `apiKeySource: "none"`.
- `CLAUDECODE=1` changes nothing for `claude -p`. Only `exo run` and `exo approve` refuse it (`run-session.mjs:38`, `Boolean(env.CLAUDECODE)`). `exo status` and `exo wait` work inside Claude Code.
- exo passes `ANTHROPIC_API_KEY` through to its inner sessions when the provider is `claude` (`run-session.mjs:330` deletes it only for other providers). The deck must strip it from the `exo run` environment too.

## Usage limits (verify_first 1 and 2)

- **Live signal exists.** Every `claude -p` model call emits one `rate_limit_event` before `result`:
  `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1792533000,"rateLimitType":"five_hour","overageStatus":"rejected",...,"unifiedWindows":{"five_hour":{"utilization":0.04,"resetsAt":...},"seven_day":{"utilization":0.3,"resetsAt":...}}}}`
  Fields are camelCase; `utilization` is a fraction; `resetsAt` is epoch seconds. Fixture: `p1-inventory.jsonl`.
- **Second source:** exo's status line caches the same windows from interactive sessions at `~/.cache/exo/statusline-rate-limits.json` (`lib/statusline.mjs`, `cacheFile`): `{"cached_at":…,"five_hour":{"resets_at":…,"used_percentage":5},"seven_day":{…,"used_percentage":30}}`. The gauge can show real numbers before the deck's first job.
- **Limit hit (inferred from the CLI binary, not observed live):** `status` moves `allowed` → `allowed_warning` → `rejected`; a refused call yields an assistant message with `api_error: "usage_limit_reached"`, `api_error_status: 429`, `api_error_params.rate_limit_info`, then `result.is_error: true`. Reset time is structured (`resetsAt`). Evidence: `limit-strings.txt`. Capture one real hit as a fixture before relying on event order.
- **exo has no limit detection** (no match for rate_limit / usage limit / 429 in run code). A limit hit inside `exo run` shows as failed tasks, then `no progress` or attempt cap, and the run ends `stopped`. The raw events sit in `<runRoot>/.exo/run-plan/<plan-id>/<time>/iter-*.log`.
- `total_cost_usd` / `sessions.jsonl costUsd` are list-price estimates, not a bill.

## Skills as `-p` prompts (verify_first 3)

- `-p "/exo:spec …"`, `/exo:find-cause …`, `/exo:build …` each expand into the skill. No `Skill` tool_use appears; the evidence is the model running that skill's scripts. Fixtures: `p3a-spec.jsonl`, `p3b-find-cause.jsonl`, `p3c-build.jsonl`.
- `exo run` does not use this path: it sends `run-task-prompt.md` on stdin with `--disable-slash-commands` (`run-session.mjs:294`). `CONTRIBUTING.md:81` is stale on this.

## Questions and permissions (verify_first 4)

- Plain `-p`: `AskUserQuestion` is not available; the model asks in text. A denial shows `system/permission_denied`, a `tool_result` with `is_error: true`, and `result.permission_denials[]`; result subtype stays `success`.
- **Relay works** with `--input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio`: stdout gets `{"type":"control_request","request_id":…,"request":{"subtype":"can_use_tool","tool_name":…,"input":…,"tool_use_id":…}}` (AskUserQuestion adds `requires_user_interaction: true`). Reply on stdin with `control_response` → `{"behavior":"allow","updatedInput":{…,"answers":{"<question>":"A"}}}` or `{"behavior":"deny","message":…}`. The model saw the answer; a deny message became the tool error. Fixtures: `p4c-*.jsonl` with their `.stdin.jsonl`.
- **Security:** this user's default `permissionMode` is `bypassPermissions` (7 of 11 probe inits). A child without an explicit `--permission-mode` inherits it. The deck must always pass one. exo's own sessions pass `--permission-mode dontAsk --permission-prompts none` plus `--allowedTools` (`run-session.mjs:287`).

## Session behavior

- `--session-id <uuid>` then `--resume <uuid>` works in `-p` (fixtures `p5a`, `p5b`).
- `--max-turns 1` still allows one tool round; hitting the cap ends `result.subtype: "error_max_turns"`, exit 1, no result text. Treat as paused, not crashed.
- Unknown events occur in normal runs: `system/hook_*` (from SessionStart hooks) before `init`, `system/thinking_tokens`. The parser must pass unknown types through.

## exo runs

- Phases: `starting, build, verify, landing, passed, landed, parked, stopped, refused, crashed`. Terminal: the last six. Exit codes: 0 passed/landed, 1 stopped/crashed, 2 refused, 3 parked; `exo wait` 0, 1, or 124 on timeout.
- `state.json` (`<checkout>/.exo/run/<id>/`): `id, plan, root, flags, detach, pid, phase, stage, log, startedAt, updatedAt, exitCode`, later `runRoot, branch, reason, task{n,subject}, landed, total`. No cost field. Id `YYYYMMDDTHHMMSS-xxxx` (UTC).
- `exo status` prints text only; no `--json`. The deck reads `state.json` itself and checks pid liveness: a killed run leaves a non-terminal phase with a dead pid.
- `landed`, `passed`, `refused` move to `.exo/kept/<id>/`; `parked`, `stopped`, `crashed` stay in `.exo/run/`. `exo status` cannot see kept runs; `exo wait` can.
- Session logs and `sessions.jsonl` live under `state.runRoot` (may be `.worktrees/<branch>`), not under `.exo/run/<id>/`.
- Lock: `.exo/run/lock` holds `<id>\n` in the checkout root (`git rev-parse --show-toplevel`); a dead holder is taken over. `--detach` refuses a tracked-dirty tree and a plan `Branch:` equal to the default branch.
- No `--max-turns` on `exo run`; turns come from each agent file's `maxTurns`. `--max-run-usd <x>` and `--max-budget-usd <x>` exist (`run-plan.mjs:32`).
- Gates: `gates.md` lines `- open: land: <action> (<reason>)`; `exo approve <id>` approves all open gates and resumes.
- No `exo --version` and no minimum-version check; version is in `package.json` / `plugin.json`.
- `budget` values: `fast`, `balanced`, `quality`, and `off`. `settings.mjs set` writes only `--scope project|local`.
- `Land:` in a plan's `## Plan basis` must match `/^Land: (local|pr|push-main)$/m` (`lib/plan-tasks.mjs:261`); `Land:` is optional for a run plan (`plan-check.mjs:386`). `Land gate:` is `/^Land gate: (.+)$/m`.
- `exo run` makes no worktree and runs no `git switch` for the branch itself. When the runRoot is a linked worktree, `land-run.mjs` is not in place (`inPlace` = runRoot equals the checkout root, `land-run.mjs:115`). For `Land: local` it rebases, re-checks and squashes in the runRoot, then needs the main checkout clean (`status --porcelain --untracked-files=no`) and on the base branch, else parks with gate `main checkout dirty or not on the default branch`.
- In place (run started from the main checkout), `land-run.mjs:185` runs `git switch <base>`; failure parks with reason `cannot switch to <base>` (action `switch <root> to <base>`), after the squash. `exo approve` only repeats the switch (phase 3 decision 92 finishes it from the deck).
- Gate lines in `gates.md`: `- <status>: <source>: <action> (<reason>)`, status `open` or `used` (`run-state.mjs` `GATE_LINE`); land gates have source `land`. Other land reasons: `no branch`, `unknown Land mode`, `no Commit: line`, `bad Commit: line`, `rebase conflict`, `re-check failed after rebase: <check>`, `push of <branch> failed`.
- Fast-forward refusal: `refused: could not fast-forward <base> to origin/<base>: <error>` (`exo-cli.mjs:157`), also `refused: <base> and origin/<base> have diverged; ...`. The run ends `refused` with that text as `reason`.
- `env` setting (`skills/configure/schema.json`): `ask` (default), `copy`, `never`; whether a run copies the main checkout's local env files into its worktree. Read from `.claude/exo.local.json`, then `.claude/exo.json`.
- No exo setup step for a project: `exo setup` only installs the `exo` launcher (`exo-cli.mjs:180`). Installing dependencies in a new worktree is the deck's job.
- Iter logs: `<runRoot>/.exo/run-plan/<plan basename>/<utc stamp>/iter-<n>-task-<n>.log`, also `iter-<n>-plan.log` and `iter-<n>-repair-<k>.log` (`run-plan.mjs:257,470,600,683`).
- `remove-worktree.mjs` exit codes: 0 removed (prints a report), 1 a `RemoveWorktreeError` (removed nothing, e.g. report or patch absent, kept dir move failed), 2 usage error; messages go to stderr as `remove-worktree: <message>`.
- `exo run config` with no argument prints one `<key> = <json> (run.json|catalog)` line per leaf, so the provider line is `defaults.provider = "claude" (catalog)` by default (`exo-cli.mjs:236`).
- `report.md` (`exo-cli.mjs:368`) carries `Reason: <reason>` (newlines folded) only for phases `refused`, `stopped` and `crashed`; `exo wait` prints `Reason:` then `Next:` (`exo-cli.mjs:569`).

## Libraries (verify_first 5)

Matches: `motion` 14.4.0, `@xyflow/react` 12.12.0, Tauri 2.12 (`@tauri-apps/cli` 2.12.3). Changed: Electron 44.9.2; TypeScript 7.0.2; Base UI is now `@base-ui/react` 1.9.0 (old name deprecated). Magic UI has no npm package (copy-in registry). Fonts Geist, Geist Mono, Space Grotesk, JetBrains Mono: OFL-1.1. `node:sqlite` loads unflagged on Node 24; confirm on 22 before use.
