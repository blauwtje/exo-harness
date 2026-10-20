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
