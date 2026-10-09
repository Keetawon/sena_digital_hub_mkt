# Permissions implementation log

Owner programme: 9 October 2026. Starting commit: `12772c3` on `main`.
Local execution only. Push is deferred until the final full suite passes. Each phase must pass typecheck, offline build, DB, API, UI and loopback H1 gates before the next begins. No owner testing between phases.

## Working database preservation

Before any new migration: native PostgreSQL custom-format `pg_dump` saved to `.local/backups/permissions-before-20261009/sena_hub_local.dump` (6,297,298 bytes). Ignored baseline metadata is alongside it. Baseline: BNA7 exists once in `staging.rem_projects`; eight existing Hub accounts. BNA7 is staged REM source data, not an existing Hub project draft. Working cluster: `.local/postgres`. Test databases are separate disposable clusters. Final verification pending.

## Phase status

| Phase | Status | Commit | API / UI / DB / H1 gates |
|---|---|---|---|
| A — responsive sidebar | Passed | This phase commit (hash recorded by Phase 0) | Typecheck/build passed; API 1,444 passed + 11 skipped; DB 51 reported checks + 7 Node cases; H1 11 + 38 passed; UI 213 passed (208 → 213); sidebar rerun 13 passed |
| 0 — baseline manifests | Not started | — | — |
| 1 — foundations | Not started | — | — |
| 2 — content core | Not started | — | — |
| 3 — publication and knowledge | Not started | — | — |
| 4 — registry | Not started | — | — |
| 5 — finance, operations, archive | Not started | — | — |
| 6 — shared and residual authority | Not started | — | — |
| C — account grid and feature onboarding | Not started | — | — |
| UAT — synthetic personas and owner pack | Not started | — | — |

Counts are recorded from executed gates, not inferred from the prior report. Previously reported baseline: API 1,444 passed / 11 skipped, UI 208 passed, H1 11 protocol + 38 browser; current DB count to be measured.

## Phase A

Implemented desktop expanded/64px rail with guarded browser persistence, tablet rail with native modal overlay, unchanged mobile drawer, focus/hover labels, rail count badges, assistant icon entry and removal of sidebar footer text. Saved group state now takes precedence over the active page; collapsed active groups are marked. No sidebar transitions.

### Decisions taken for owner review

- Tablet overlays close on viewport changes and are not persisted open; a fresh tablet page defaults to the rail. Desktop collapse preference is persisted independently.
- Use the existing native dialog for the tablet overlay, including focus containment and Escape. No new dependencies.
- Tooltips supplement explicit accessible names; counts remain available to screen readers.

### Validation / deviations

Typecheck passed. Automated sidebar cases added for persistence, active-group collapse, keyboard tooltips, badges, tablet focus return and outside close, and 1280/1024/400px page overflow. API passed: 1,444 + 11 pre-existing opt-in skips (289.42s); DB passed: 51 reported SQL/concurrency checks + 7 Node cases; loopback H1 passed: 11 protocol + 38 browser. UI 213 passed (208 → 213); sidebar rerun 13 passed. Offline build uses the documented `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` hook and `--webpack`; default Turbopack cannot resolve that existing mock and was not used for the successful gate. No migrations applied to the working database.

## Conversion report

Pending phase 0 action manifest and permission conversion. No authorization changes made yet.

## Resume

Phase A gates are complete. Commit Phase A, then begin Phase 0 baseline manifests. Do not push until the final full programme gates pass. Restore the preserved working services after tests.

Phase A full UI gate: 213 passed in 6.5 minutes, no skips/retries/failures. All 13 sidebar cases passed. Screenshot review prompted an explicit overlay-visible wait; the focused sidebar rerun passed all 13 cases in 19.2 seconds. Artifacts: `artifacts/permissions/sidebar-{1280,1024,400}.png`, `sidebar-rail-1280.png`, `sidebar-overlay-1024.png`. No authorization SQL changed in this phase, so permission-specific DB deny additions start with the permissions phases.
