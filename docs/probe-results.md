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
