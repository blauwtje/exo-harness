# Library versions and licenses

Date: 2026-10-20

Command: `npm view <pkg> version license repository.url time.modified --json` (read-only, nothing installed). Extra read-only checks: `npm view <pkg> deprecated`, `npm view <pkg> license`, `node -e "require('node:sqlite'); console.log('ok')"`, `node --version`.

Node in this environment: v24.22.0. `node:sqlite` loads unflagged with no experimental warning.

"Last publish" is the registry `time.modified` value.

| package | version | license | last publish | note |
|---|---|---|---|---|
| react | 19.3.1 | MIT | 2026-10-20 | |
| react-dom | 19.3.1 | MIT | 2026-10-20 | |
| vite | 8.3.4 | MIT | 2026-10-08 | |
| @vitejs/plugin-react | 6.1.2 | MIT | 2026-10-05 | |
| typescript | 7.0.2 | Apache-2.0 | 2026-10-20 | TS 7 line, check build tooling compatibility |
| motion | 14.4.0 | MIT | 2026-10-19 | matches expected 14.4.0 |
| @xyflow/react | 12.12.0 | MIT | 2026-10-11 | matches expected 12.12.0 |
| reactflow | 11.11.4 | MIT | 2024-06-20 | old package name, superseded by @xyflow/react; not deprecated on npm, do not use |
| @base-ui/react | 1.9.0 | MIT | 2026-10-09 | current Base UI package |
| @base-ui-components/react | 1.0.0-rc.0 | MIT | 2026-07-15 | deprecated: "Package was renamed to @base-ui/react"; do not use |
| @radix-ui/react-dialog | 1.3.1 | MIT | 2026-10-14 | |
| react-aria-components | 1.22.1 | Apache-2.0 | 2026-10-09 | |
| @tauri-apps/cli | 2.12.3 | Apache-2.0 OR MIT | 2026-10-14 | Tauri 2.12 line |
| @tauri-apps/api | 2.12.4 | Apache-2.0 OR MIT | 2026-10-14 | Tauri 2.12 line |
| @tauri-apps/plugin-shell | 2.5.0 | MIT OR Apache-2.0 | 2026-10-14 | |
| geist | 1.8.1 | SIL OPEN FONT LICENSE | 2026-10-19 | license string is not SPDX `OFL-1.1`; the package is Vercel's Geist font under OFL, repo github.com/vercel/geist-font |
| @fontsource/space-grotesk | 5.3.0 | OFL-1.1 | 2026-07-19 | font license confirmed via npm license field |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 | 2026-07-19 | font license confirmed via npm license field |
| @fontsource-variable/geist | 5.3.0 | OFL-1.1 | 2026-07-19 | font license confirmed via npm license field |
| @fontsource-variable/geist-mono | 5.3.0 | OFL-1.1 | 2026-07-19 | font license confirmed via npm license field |
| playwright | 1.64.1 | Apache-2.0 | 2026-10-20 | |
| @playwright/test | 1.64.1 | Apache-2.0 | 2026-10-20 | |
| better-sqlite3 | 13.0.3 | MIT | 2026-08-05 | native addon; alternative to `node:sqlite` |
| ws | 8.22.0 | MIT | 2026-09-26 | |
| zod | 4.6.7 | MIT | 2026-10-12 | |
| tailwindcss | 4.3.3 | MIT | 2026-10-19 | |
| @dnd-kit/core | 6.3.1 | MIT | 2024-12-05 | last publish 2024, older line; @dnd-kit/react is the newer API |
| @dnd-kit/react | 0.5.1 | MIT | 2026-10-15 | pre-1.0 |
| electron | 44.9.2 | MIT | 2026-10-20 | expected 44.9.1, registry has 44.9.2 |
| magicui | not found | n/a | n/a | npm returns E404 for `magicui`; package does not exist under that name |
| @heroui/react | 3.2.6 | MIT | 2026-09-17 | |

Notes on problems and surprises:

1. `magicui` is not on npm (E404). `@base-ui-components/react` is deprecated and renamed to `@base-ui/react`. `reactflow` is the old name for `@xyflow/react`.
2. Electron latest is 44.9.2, not the expected 44.9.1. Tauri 2.12 matches (`@tauri-apps/cli` 2.12.3, `@tauri-apps/api` 2.12.4). motion and @xyflow/react match expected versions.
3. `geist` reports its license as "SIL OPEN FONT LICENSE" rather than SPDX `OFL-1.1`. The four `@fontsource` packages report `OFL-1.1`. The local Node is v24.22.0, not 22; `node:sqlite` loads unflagged here, but confirm the behavior on Node 22.
