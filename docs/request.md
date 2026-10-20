# Request and answers

The user's original request (2026-10-20) is kept verbatim in `request-original.md`. This file records the answers that change it.

## Phase 1 answers (2026-10-20)

1. Name: **exo-harness** (not exo-deck). Repo: `/Users/thomash/Documents/Code/personal/exo-harness`.
2. Shell: Node daemon + React UI in the browser, Tauri 2 window later. Accepted.
3. Budget: stop starting new jobs at 80% of the 5-hour window and 70% of the week; at most 2 top-level jobs. Accepted.
4. Scouts: manual in the MVP, schedule in phase 5. Accepted.
5. Limit hits inside `exo run`: a small exo change (separate session) makes a run park with its reset time; the harness reads it. Accepted.
- 2-5 must stay easy to change afterwards (settings in the UI, not hardcoded).

## Scope change: projects

Projects are not a fixed list of four. The harness sees **all of the user's GitHub repos** and lets them add, remove and work on any project with ease. It must feel very modern with git.

Facts: `gh` 2.95.0 is logged in as `blauwtje` (keyring), 51 repos visible via `gh repo list`. Token scopes include `delete_repo`, so the harness must never call a repo-deleting API; "remove project" means remove it from the harness (and, after an unmerged-work check and approval, its local clone).
