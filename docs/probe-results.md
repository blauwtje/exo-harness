# claude CLI probe results

Date: 2026-10-20. CLI: `claude` 2.1.305 (Mach-O binary at `~/.local/share/claude/versions/2.1.305`). Model for all calls: `haiku` (resolves to `claude-haiku-5-5`). 11 live calls total. Every call ran with `env -u ANTHROPIC_API_KEY`, in a fresh scratch git repo `/tmp/exo-deck-probe-<n>/`, with `CLAUDECODE=1` inherited from the parent shell (unchanged). Fixtures: `test/fixtures/probes/<probe>.jsonl` (raw stdout), `<probe>.cmd.txt` (exact command and exit code), `<probe>.stdin.jsonl` (what the driver wrote on stdin, probe 4c only). Drivers live in `/tmp/exo-deck-probe-scripts/` (`run.sh`, `drive.mjs`). Secret scan of the fixtures (OAuth/bearer/sk-ant/email/orgId) was clean; the email, orgId and orgName in `p0-auth-status.json` are redacted.

Ambient fact worth knowing: this user's settings make the default `permissionMode` `bypassPermissions` (the `init` event of probes 1, 3, 4a shows it). Anything that must observe permission prompts has to pass `--permission-mode default` explicitly.

## Probe 0: auth

Command: `claude auth status` and `claude auth status --json` (identical JSON output; `--json` is accepted and is the default format). Fixture: `p0-auth-status.json`.

```
{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "analyticsDisabled": false,
 "projectsDirectory": "~/.claude/projects", "configDirectory": "~/.claude", "email": "REDACTED",
 "orgId": "REDACTED", "orgName": "REDACTED", "subscriptionType": "max"}
```

Verdict: `authMethod` is `claude.ai` (subscription, `subscriptionType: max`). Probes proceeded. `init.apiKeySource` is `"none"` in every run, which confirms no API key was used.

## Probe 1: event inventory

Command: `claude -p "Reply with the single word ok." --output-format stream-json --verbose --model haiku --max-turns 1`. Fixture: `p1-inventory.jsonl` (8 lines), exit 0.

Event order and keys (`type/subtype`):

| event | keys |
|---|---|
| `system/hook_started` (x2) | type, subtype, hook_id, hook_name, hook_event, uuid, session_id |
| `system/hook_response` (x2) | the above plus output, stdout, stderr, exit_code, outcome |
| `system/init` | type, subtype, cwd, session_id, tools, mcp_servers, model, permissionMode, slash_commands, terminal_slash_commands, apiKeySource, claude_code_version, output_style, agents, skills, plugins, capabilities, analytics_disabled, product_feedback_disabled, uuid, original_cwd, additional_directories, messaging_socket_path, fast_mode_state, fast_mode_disabled_reason, per_turn_effort_active, view_mode |
| `assistant` | type, message, parent_tool_use_id, session_id, uuid, timestamp, request_id (also thinking_duration_ms, thinking_display, wire_tool_inputs, wire_ingest_context in other runs) |
| `rate_limit_event` | type, rate_limit_info, uuid, session_id |
| `result/success` | duration_api_ms, stop_reason, session_id, total_cost_usd, usage, modelUsage, permission_denials, terminal_reason, fast_mode_state, fast_mode_disabled_reason, subagent_stats, safety_stops, is_error, num_turns, subtype, api_error_status, result, ttft_ms, type, duration_ms, uuid, ttft_stream_ms, time_to_request_ms, first_content_frame_ms, queued_turn_count, result_index |

Other events seen in later probes: `system/thinking_tokens` (estimated_tokens, estimated_tokens_delta), `system/permission_denied` (tool_name, tool_use_id, message), `user` (tool results; extra keys timestamp, tool_use_result, tool_result_meta), `control_request/can_use_tool` (probe 4c), `result/error_max_turns` (adds `errors`, drops `result`).

Live rate-limit signal, present in every run, emitted after the assistant message and before `result`:

```
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1792533000,"rateLimitType":"five_hour",
 "overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,
 "unifiedWindows":{"five_hour":{"utilization":0.04,"resetsAt":1792533000},"seven_day":{"utilization":0.3,"resetsAt":1792908000}}},
 "uuid":"...","session_id":"..."}
```

- `resetsAt` is unix epoch seconds (1792533000 = 2026-10-20 21:50:00 UTC, 39 minutes after the call; seven_day 1792908000 = 2026-10-25 06:00 UTC).
- `utilization` is a fraction (0.04 = 4 %, 0.3 = 30 %), not a percentage.
- Not present: `rate_limits`, `used_percentage`, snake_case `resets_at`. Names are camelCase (`resetsAt`, `rateLimitType`, `unifiedWindows`) and the window keys are `five_hour` / `seven_day`.
- Overage: `overageStatus` ("rejected" here), `overageDisabledReason` ("org_level_disabled"), `isUsingOverage`.
- A later call (p4c-write-deny) shows five_hour utilization 0.05, so the value moves between calls. The bundle says events fire when a window's rounded percentage or reset time moves; each short run emitted exactly one.

`init` details: `model` `claude-haiku-5-5`; `permissionMode` `bypassPermissions` (user default); `apiKeySource` `"none"`; `claude_code_version` `2.1.305`; `slash_commands` (71 entries, includes `exo:spec`, `exo:build`, `exo:find-cause`, ... and `terminal_slash_commands`: doctor, color, focus, reload-plugins); `skills` (35, same `exo:*` names); `plugins` `[{name:"exo", path:".../plugins/exo", source:"exo@blauwtje", version:"0.136.0"}, {name:"csharp-lsp", ...}]`; `agents` (15); `tools` (62, no `AskUserQuestion` in plain `-p`); `capabilities` (12 strings); `mcp_servers`; `messaging_socket_path`.

`result` details: `total_cost_usd` 0.00163 (a list-price notional on a subscription), `usage` (input/output/cache tokens, `iterations`, `service_tier`), `modelUsage` per model (with `contextWindow` 1000000), `permission_denials` `[]`, `session_id`, `terminal_reason` `completed`, `num_turns` 1, `is_error` false, `result` "ok".

Verdict: a live rate-limit signal exists and is cheap. Every run reports five-hour and seven-day utilization and reset times in `rate_limit_event`.

## Probe 2: limit-hit shape (bundle search, not observed live)

Method: `strings -n 8` on the 273 MB Mach-O (bun-bundled JS), then searched. Saved snippets: `limit-strings.txt` (about 90 lines). The bundle embeds the SDK zod schemas with long descriptions, which is the best source.

**Inferred from bundle, not observed live:**

- `rate_limit_event.rate_limit_info.status` is `"allowed" | "allowed_warning" | "rejected"`. `allowed_warning` fires when a window crosses a warning threshold (`surpassedThreshold` field exists); `rejected` means the limit is hit.
- `rateLimitType` is one of `five_hour | seven_day | seven_day_opus | seven_day_sonnet | seven_day_overage_included | overage` and names the limiting window. Top-level `resetsAt` (epoch seconds) is that window's reset. `unifiedWindows` always carries both `five_hour` and `seven_day` (and `seven_day_overage_included` for some accounts). The doc says it is absent for API-key, Bedrock and Vertex sessions, so a subscription session is the case where it is present.
- Overage fields: `overageStatus` (same three values), `overageResetsAt`, `overageDisabledReason` (`org_level_disabled`, `org_level_disabled_until`, `out_of_credits`, `overage_not_provisioned`, ...), `isUsingOverage`, `overageInUse`, `limitScope` (`service | channel | group_pool`), `canUserPurchaseCredits`, `rateLimitGraceActive`, `errorCode: "credits_required"`.
- Source headers: `anthropic-ratelimit-unified-5h-utilization`, `-5h-reset`, `-7d-utilization`, `-7d-reset`, `-status`, `-reset`, `-representative-claim`, `-overage-*`, `-fallback`.
- When a request is refused, the stream most likely carries (a) a `rate_limit_event` with `status:"rejected"`, (b) an `assistant` message with `is_api_error_message: true`, `api_error_status: 429`, `error: "rate_limit"` (the SDK assistant `error` enum includes `rate_limit`), `api_error: "usage_limit_reached"` and `api_error_params.rate_limit_info` (same shape as the event; "status is rejected and isUsingOverage false ... resetsAt is when it resets"), and (c) a `result` with `is_error: true` and `api_error_status: 429`. The schema notes this embedded `rate_limit_info` "is that refusal's record and is never updated, so compare resetsAt with the clock before calling the limit current."
- The human text is composed by the client as "You've hit your ... limit" plus a reset time; the reset time lives structurally in `resetsAt` (epoch seconds), so the app should not parse the text.
- `api_error` also has `usage_limit_reached` siblings that do NOT carry `rate_limit_info` (org policy, temporary server throttle, capacity switch-off, API-key 429), so a 429 without `rate_limit_info` is not a plan limit.

Verdict: the reset time is a structured epoch-seconds field (`resetsAt`), reliable for scheduling a resume. The exact refusal sequence is inferred only; capture a real one when it happens (record the raw stream) before relying on field placement in (b) and (c).

## Probe 3: slash command in `-p`

Commands (3 calls, haiku, `--max-turns 1`, stream-json, verbose): `-p "/exo:spec add a hello script"`, `-p "/exo:find-cause the hello script prints nothing"`, `-p "/exo:build docs/none.md"`. Fixtures: `p3a-spec`, `p3b-find-cause`, `p3c-build`. Exit code 1 for all, because `result.subtype` is `error_max_turns` (see below).

Evidence:

- `init.slash_commands` and `init.skills` list `exo:spec`, `exo:find-cause`, `exo:build` (the plugin loads in `-p`).
- No `Skill` tool_use and no `command-name` / "Base directory for this skill" text anywhere in the stream (grep count 0 in all three). The expanded prompt is not echoed as a `user` event either: the only `user` events are tool results.
- The model's first action followed the skill body, so the slash command was expanded locally into the prompt before the first model call:
  - spec: `Bash` `node ".../skills/spec/scripts/repo-map.mjs"` then `Read` `skills/spec/references/brief.md` and `.../task-list.md`.
  - find-cause: `Bash` `node ".../skills/find-cause/../../lib/scratch-exclude.mjs"` plus repo state checks.
  - build: `Bash` `test -f docs/none.md && echo EXISTS || echo MISSING` -> `MISSING`.
- `--max-turns 1` is not "one model call": each run did one model turn plus the tool round, then ended `result/error_max_turns`, `num_turns: 2`, `is_error: true`, `errors: ["Reached maximum number of turns (1)"]`, `terminal_reason: "max_turns"`, no `result` text, CLI exit code 1.

Verdict: `-p "/exo:<skill> args"` works and expands into the skill; the app should send the slash command as the plain prompt text and treat tool_use of `Skill` as not-expected. The stream gives no echo of the expansion, so a UI that wants to show "skill X started" must derive it from the prompt it sent.

## Probe 4a: AskUserQuestion in plain `-p`

Command: `-p "Use the AskUserQuestion tool to ask me whether I prefer A or B. Do nothing else." --output-format stream-json --verbose --model haiku --max-turns 2`. Fixture: `p4a-askuser.jsonl`.

- `init.tools` has 62 tools and no `AskUserQuestion`. The model called `ToolSearch select:AskUserQuestion` -> tool_result "No matching deferred tools found", then replied in plain text: "AskUserQuestion isn't available in this session, so I'm asking in plain text. Do you prefer A or B? - A - B".
- `result`: success, `permission_denials: []`.

Verdict: without the control protocol, AskUserQuestion does not exist; questions degrade to plain assistant text (and the turn ends, so the answer arrives as the next user turn via `--resume`).

## Probe 4b: permission denial in plain `-p`

Command: `-p "Create a file named x.txt containing hi using the Write tool." ... --max-turns 2 --permission-mode default`. Fixture: `p4b-write-denied.jsonl`.

- `assistant` `tool_use` Write `{file_path:"/private/tmp/exo-deck-probe-7/x.txt", content:"hi\n"}`.
- `system/permission_denied`: `{tool_name:"Write", tool_use_id, message:"Claude requested permissions to write to ... x.txt, but you haven't granted it yet."}`.
- `user` `tool_result` with `is_error: true`, same text.
- `result.permission_denials`: `[{"tool_name":"Write","tool_use_id":"toolu_...","tool_input":{"file_path":"...","content":"hi\n"}}]`; `result.subtype` still `success`, `is_error` false. The file was not created.

Verdict: a denial is non-fatal; the model sees the error text and tells the user. The app learns of it from `system/permission_denied` live and `result.permission_denials` at the end (which carries the full tool_input, enough to replay it after approval).

## Probe 4c: control protocol (`--input-format stream-json --permission-prompt-tool stdio`)

Driver: `/tmp/exo-deck-probe-scripts/drive.mjs`. Full command (in each `.cmd.txt`): `claude -p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio --model haiku --max-turns 3 --permission-mode default`; user message written as `{"type":"user","message":{"role":"user","content":"..."}}`; stdin closed after the `result` event, process exited 0 each time. Note: help also lists `--permission-prompts host|none` (`none` = auto-deny anything that would prompt). Fixtures: `p4c-askuser-allow`, `p4c-askuser-deny`, `p4c-write-deny` (each with `.stdin.jsonl`).

`control_request` as received on stdout:

```
{"type":"control_request","request_id":"df840a3f-...","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion",
 "display_name":"AskUserQuestion","input":{"questions":[{"question":"Do you prefer A or B?","header":"Preference",
 "options":[{"label":"A","description":"Choose option A"},{"label":"B","description":"Choose option B"}],"multiSelect":false}]},
 "tool_use_id":"toolu_...","requires_user_interaction":true}}
```

For Write: `request` has `tool_name:"Write"`, `input:{file_path, content}`, `description:"x.txt"`, `permission_suggestions:[{"type":"setMode","mode":"acceptEdits","destination":"session"}]`, `tool_use_id`. No `requires_user_interaction`.

Allow with answers (reply exactly as sent, accepted):

```
{"type":"control_response","response":{"subtype":"success","request_id":"df840a3f-...",
 "response":{"behavior":"allow","updatedInput":{<original input>,"answers":{"Do you prefer A or B?":"A"}}}}}
```

Result: `user` tool_result content `Your questions have been answered: "Do you prefer A or B?"="A". You can now continue with these answers in mind.`, plus `tool_use_result` `{questions, answers}` and `tool_result_meta[].permission_decision {decision:"accept", source:"user_temporary"}`. The model then said "You chose A." So the model does see the answer. The `answers` map is keyed by the exact question text, value = option label (free text presumably works for "Other"; not tested). `result.permission_denials: []`.

Deny (`{"behavior":"deny","message":"probe deny"}`), both tools: `user` tool_result `{is_error:true, content:"probe deny"}`; the model reported the denial and did not retry (it asked in text instead); `result.success` and `result.permission_denials` lists the tool with full `tool_input`. No `system/permission_denied` event in this mode (only in the non-stdio path of 4b). File not created in the Write case. Deny message text is what the model sees, so it can carry instructions (for example "user declined; ask differently").

Timing: the `control_request` arrives after the `assistant` tool_use and `rate_limit_event`; the process blocks until the reply (no timeout hit within the 60 s window; not tested beyond that).

Verdict: control protocol works as specified. This is the way to relay both questions (AskUserQuestion, with `answers`) and permission prompts (any tool) to a UI, and AskUserQuestion only exists in this mode.

## Probe 5: CLAUDECODE guard, session ids

- `CLAUDECODE=1` was set in the environment of every call, and none refused or behaved differently (no stderr output at all, normal results). `claude -p` itself has no such guard; any refusal comes from exo's own `exo run` guard, which was not worked around or exercised. `init` has no field reflecting CLAUDECODE.
- `--session-id <uuid>` in `-p` mode: works. Command: `-p "Remember the code word pineapple. Reply with the single word ok." --session-id 94b45d0a-ae61-4175-92c6-965c34c4e819 ...` -> all events carry that `session_id`, result "ok" (fixture `p5a-session-id.jsonl`).
- `--resume <uuid>` in `-p` mode: works. Command: `-p "What was the code word? Reply with one word." --resume 94b45d0a-...` -> result "pineapple", same `session_id` in every event, so the transcript was reloaded and the id is stable (fixture `p5b-resume.jsonl`). Both ran in the same cwd (sessions are stored per project directory).

Verdict: an app can assign its own session id up front and resume later across processes (run in the same cwd).

## Design implications for an app that drives `claude -p`

1. Live limit signal: yes. Parse `rate_limit_event.rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization (0-1 fraction), resetsAt (epoch seconds)}`; `status` goes `allowed` -> `allowed_warning` -> `rejected`. It arrives once per model call (after the assistant message), so a meter updates per turn, not continuously. A stalled/rejected run should read `resetsAt` for scheduling resumption (inferred from bundle, not observed live: the refusal also produces an assistant error with `api_error: "usage_limit_reached"` and an `is_error` result with `api_error_status: 429`; compare `resetsAt` with the clock).
2. Questions and permissions: use `--input-format stream-json --permission-prompt-tool stdio` and answer `control_request/can_use_tool` on stdin with a `control_response`. Match on `request_id`; answer AskUserQuestion with `behavior:"allow"` plus `updatedInput.answers` keyed by question text. Plain `-p` has no AskUserQuestion tool at all, and denies silently into `permission_denials`.
3. Set `--permission-mode` explicitly: the user's default here is `bypassPermissions`, in which case no prompts appear.
4. `--max-turns N` counts the tool round: a run that stops on it returns `error_max_turns` with exit code 1 and no `result` text; treat that as "paused/limit", not a crash.
5. Slash commands in the prompt expand to skills with no echo; do not look for `Skill` tool_use.
6. `result.total_cost_usd` is populated on a subscription (notional list price); do not show it as money spent.
7. Hooks (`SessionStart`) add four `system/hook_*` events before `init`; the consumer must ignore unknown `type`/`subtype` values (also `thinking_tokens`).

# Round 2 probes (harness review P1, P2, P4, P5)

Same date and CLI (`claude` 2.1.305). 10 more live sessions (P1 2, P2a 3, P2b 2, P4 2, P5 1), all `env -u ANTHROPIC_API_KEY`, explicit `--permission-mode default`, `--max-turns` set, a deadline on every child (60-900 s in the Node driver; no GNU timeout), each in a fresh scratch git repo `/tmp/exo-harness-probe-<n>/`. Drivers: `/tmp/exo-harness-probe-scripts/` (`lib.mjs`, `p6.mjs`, `p6b.mjs`, `p7a.mjs`, `p7a2.mjs`, `p7b.mjs`, `p7b-parent.mjs`, `p8.mjs`, `p9.mjs`). Fixture names follow the order of the task: p6 = review P1, p7 = P2, p8 = P4, p9 = P5. Each has `.cmd.txt`, `.jsonl` (raw stdout) and, where a driver wrote to stdin, `.stdin.jsonl`. Secret scan (tokens, emails, org ids) of the new fixtures was clean; the only `@` strings are plugin ids (`exo@blauwtje`).

## Probe p6 (review P1, M5): do `--allowedTools` entries skip `control_request`?

Command (fixture `p6-allowedtools`): `--permission-mode default --permission-prompt-tool stdio --model haiku --max-turns 8 --allowedTools Read "Bash(ls:*)"`, prompt: Read README.md, run `ls`, Write x.txt. Driver denied every `control_request`.

| tool_use | control_request? | `tool_result_meta.permission_decision` |
|---|---|---|
| Read README.md (inside cwd) | no | accept, source `config`, reason_type `rule` |
| Bash `ls` | no | accept, `config`, `rule` |
| Write x.txt | yes (`permission_suggestions: setMode acceptEdits`) | reject, `user_reject` |

Contrast run (fixture `p6b-allowedtools-contrast`, same flags): Read `/etc/hosts` (outside cwd) ran with no request (rule `Read` has no path). Bash `ls -la /tmp` did produce a request, although `Bash(ls:*)` is listed: the target is outside the project, and the request carries `blocked_path: "/private/tmp"` and `permission_suggestions` (`addRules` for the exact command, and `Read //private/tmp/**` for the session). Bash `date` ran with no request (`decision accept, source config, reason_type subcommandResults`, a built-in read-only command, not on the allow list). `result.permission_denials` lists the denied tool with its input; `result.subtype` stays `success`.

Verdict: yes, entries on `--allowedTools` skip the `control_request` under default + stdio. A prompt still appears for a listed Bash prefix when a path argument leaves the project (`blocked_path`), so the stage table cannot assume "prefix listed = never asks"; the daemon must answer those by code too. Some read-only commands (`date`) never ask, listed or not.

## Probe p7 (review P2, M9): kill -9 mid-tool, and a dead parent

### 7a: `kill -9` the claude process, then `--resume`

Fixtures `p7a-killed`, `p7a-resumed`, `p7a-resumed-continue`. Haiku, `--allowedTools "Bash(sleep:*)"`, told to run `sleep 20`. Driver sent SIGKILL to claude 3 s after the Bash `tool_use` event (session `450eeff5-...`). The stream ends at `rate_limit_event`; exit `null SIGKILL`.

- The tool's process tree is not killed: after the kill the `/bin/zsh -c ... eval 'sleep 20'` shell and `sleep 20` were reparented to pid 1 and kept running (still there 7 s later). A harness must kill the whole process group (or the descendants) itself.
- `--resume <id>` with "what was the last command and its outcome? Do not run tools": result in 2.0 s, same `session_id`, answer "The last command was `sleep 20` through Bash, and its outcome is unknown because the session ended before the result was recorded." So it remembers; the unfinished tool_use is handled without an API error. Usage: `cache_creation_input_tokens` 463 (all `ephemeral_1h`), `cache_read_input_tokens` 18412.
- Second resume with "Please continue where you left off.": it re-issued `Bash sleep 20` (a fresh run, not a resume of the old one), `system/task_started` at +5.7 s and `system/task_notification` at +22.7 s, final text "finished", result at 24.0 s. Usage: `cache_creation` 310, `cache_read` 37864.
- Both resumes ran in the same cwd (needed for the session lookup, see probe 5).

Verdict: kill -9 plus `--resume` works and the model remembers, but it does not continue the tool by itself; it needs a user message, and it repeats the call. A repeated side-effecting call is therefore possible after a crash, and the cache cost of a resume within the 1 h TTL is small (a few hundred creation tokens against a full read).

### 7b: parent killed with SIGKILL while a stream-json child runs

Parent = Node script (`p7b-parent.mjs`) that spawns claude (stdin pipe held open, prompt "run `sleep 15` via Bash"); the orchestrator SIGKILLs only the parent pid 2.5 s after the Bash `tool_use` line appeared, then polls `ps` every 0.5 s for 40 s. Fixtures `p7b-parent-kill-pipe` (child stdout is a pipe the parent read) and `p7b-parent-kill-file` (child stdout goes to a file fd).

| variant | child state after parent SIGKILL | gone after | what the fixture shows |
|---|---|---|---|
| stdout pipe | kept running, ppid became 1 | 16.9 s | stream stops at `rate_limit_event`; the tool result and `result` were never written |
| stdout file | kept running | 14.4 s | the full turn finished: `user` tool_result, `assistant` "finished", `result/success`, then exit |

`sleep 15` survivors after the child exited: none (its shell ended with the tool). Timeline lines are in each `.cmd.txt`.

Verdict: a dead parent does not stop the child. The child finishes the in-flight tool and exits around the end of its turn (file case: after the `result`, when it reads stdin EOF); with a pipe stdout it exits at the first write after the parent's read end is gone (EPIPE/SIGPIPE; the tool result never reached the transcript stream). Either way it is an orphan for the length of the running tool (here 12-15 s; with a real build, minutes). On daemon restart, reconcile by listing `claude` pids whose ppid is 1 (or by recording pids and process group ids in state), kill those, then `--resume`. Do not resume while the old child may still be writing to the same session.

## Probe p8 (review P4, S2): cache after 10 minutes idle

Fixtures `p8-5m` (`FORCE_PROMPT_CACHING_5M=1`) and `p8-default` (unset). Haiku, two parallel sessions with distinct ~2300-word lorem contexts, `--max-turns 3`. Turn 1 sent at t=0, stdin held open, turn 2 ("Reply with the single word ok again.") sent 600 s after turn 1's `result` (second `result` at +604.5 s / +604.9 s).

| session | turn 1 cache_creation / read | turn 2 cache_creation | turn 2 cache_read |
|---|---|---|---|
| default (unset) | 24251 (all `ephemeral_1h`) / 0 | 172 (`ephemeral_1h`) | 24251 |
| `FORCE_PROMPT_CACHING_5M=1` | 24391 (all `ephemeral_5m`) / 0 | 24470 (`ephemeral_5m`) | 0 |

Verdict: confirmed. Unset gives the 1-hour TTL (`usage.cache_creation.ephemeral_1h_input_tokens`), and a reply after 10 minutes reads the whole 24k prefix from cache; with the 5-minute flag the prefix expired and the whole 24k was written again. `result.usage.cache_creation` splits the TTL, so the harness can see which TTL a session got. Note: even a one-word prompt carries a 24k prefix (system prompt, tools, plugins), so this matters for every idle gap above 5 minutes. Turn 1 of both sessions had `cache_read` 0, so the two sessions did not share a warm prefix.

## Probe p9 (review P5, M1, M2): `/exo:spec` on Sonnet, "ok" replies, hand-off

Fixture `p9-spec` (+ `p9-turn<N>-last-text.txt`, `p9-turn<N>-all-text.txt`, `p9-tool-uses.json`). Command in `.cmd.txt`: `--permission-mode default --permission-prompt-tool stdio --model sonnet --max-turns 12 --allowedTools Read Glob Grep "Bash(git:*)" "Bash(node:*)" --append-system-prompt "<workflow-driver line>"`; scratch repo `/tmp/exo-harness-probe-9` (package.json + index.js with `add`, one commit, branch `master`). Prompt `/exo:spec add a greeting feature` sent as a stream-json user message (the slash command expands locally here too). Driver: Write/Edit allowed only under `<cwd>/docs/`, everything else denied with a message; on a question-shaped last text, reply `ok`.

Sequence:

1. Turn 1 (10.3 s): the model read `question.md`, mapped the repo, read the two files, then asked. `result/success`, last text saved in `p9-turn1-last-text.txt`.
2. Reply `ok`. Turn 2 (to 37.4 s): read the spec references, a compound Bash (`git remote -v; ...; cat .gitignore ...`) got a `control_request` and was denied (`Bash(git:*)` does not cover a compound command), `Write docs/specs/greeting.md` allowed, `plan-check.mjs` run by the model, an `Edit` allowed, then an `Agent` tool_use of `exo:find-open-points` (backgrounded, `task_started.is_backgrounded: true`). The turn's `result` arrived with that agent still running ("I'm waiting on the open-points review before handing off").
3. The agent finished and its `system/task_notification` started a third turn with no user message. The driver had already closed stdin at the brief, so the model's two `Edit` calls got `control_request` answers of "Stream closed" and failed (`permission_denials` of that result lists both Edits). Final text asked nobody anything: "Next: build with `exo:build` on `docs/specs/greeting.md`. The caller starts it."

Question text shape (turn 1, verbatim):

```
**1/1 What should the greeting feature do?**
The code is a tiny library with one `add` function and a demo line.

- **(A) Function**: `greet(name)` returns "Hello, name!" for other code.
- **(B) Command line**: running the file with a name prints a greeting.
- **(C) Both**: the function, plus a command line that uses it.

Recommended: (A), because it is the smallest change that fits.
```

Parser notes: the bold title is `**<n>/<total> <question>?**` (a progress prefix, `1/1` here), then a free sentence, then `- **(X) Label**: text` lines, then `Recommended: (X), because ...`. Only one question turn occurred; the second reply `ok` produced the brief directly.

Brief: `/private/tmp/exo-harness-probe-9/docs/specs/greeting.md` (written in the `Write` of turn 2). Build tried? No `Skill` tool_use at all in the stream, and no `Agent` tool_use with `build-task` or `run-unit`; the only Agent dispatch was `exo:find-open-points` (spec's own review step). The model named `exo:build` only as a next step for the caller. Hand-off with the workflow line therefore worked: no question, no build.

`plan-check` (run after the session, from the main plugin checkout): `node /Users/thomash/Documents/Code/personal/plugins/exo/skills/spec/scripts/plan-check.mjs --plan docs/specs/greeting.md --root /private/tmp/exo-harness-probe-9 --loop --run` printed `plan-check: ok, 1 tasks, largest Task 1 (0 lines)` and `Task 1: about 100 tokens of task text and Files:`; exit 0.

Other facts for the harness:

- `result` does not mean idle. With a backgrounded Agent, `system/background_tasks_changed`, `task_started`, `task_progress`, `task_updated` and `task_notification` events follow, and a new turn (new `result`) starts on its own. Closing stdin after the first `result` breaks that turn (permissions answered "Stream closed"). Keep stdin open until background tasks are empty and no further turn follows.
- The `Agent` dispatch gave no `control_request` (Agent is not permission-gated here), so a denial policy cannot stop a build dispatch: detect it by `tool_use` name/`subagent_type` and stop the session. Whether an Agent call from spec is a build dispatch is readable from `input.subagent_type`.
- `num_turns` is per `result` here (7, 12, 3), and `--max-turns 12` was reached exactly in turn 2 yet reported `success` (no `error_max_turns`); the third turn then started anyway, so the limit looks per user message, not per process.
- Question turn used plain text (no `AskUserQuestion` call), consistent with `question.md`.
