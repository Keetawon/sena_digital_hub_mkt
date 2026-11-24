# Owner page findings: source review and isolated icon correction

Result: the four reported failures match previously retained W1-W5 timeout
symptoms. Today's HTTP codes and query timings are **not measured**. No new
hosted request, database read, load test, source/configuration change or release
switch was made for this investigation.

The owner clarified that all ten pages were visited, each settled in less than
twenty seconds, and none remained loading at the cutoff. Home, brand overview,
publishing and approvals displayed errors. This does not prove successful-page
memory coverage; cap admission remains unresolved as recorded in
[the outcome receipt](20261124-owner-page-outcome-stop.md).

## Error and performance trace

| Screen | Existing path and evidence | Prepared-release difference / open work |
| --- | --- | --- |
| Home | `/v1/admin/content/home` calls `hub.workspace_home`. Schema 88 composes FAQ per project/unit before task filtering and pagination. Retained hosted read: 15.843 s, cancelled. | 0094 replaces full composition with the private missing-fact projection; 0092 removes discarded FAQ-response construction and guards business lookups. These are already sealed in the candidate, not deployed. |
| Approvals | `/home?task=approval` uses the same Home endpoint. The filter is applied after aggregate work. Retained hosted read: 15.847 s, cancelled. | Shares the Home improvements. Do not change totals, early-filter authority-sensitive work or raise the timeout as a shortcut. |
| Brand overview | Workspace page, readiness and history projections use FAQ visibility/rule resolution. Retained FLEXI read: 15.992 s, cancelled; second large brand: 15.815 s. | 0089 already guards expensive rule lookups behind cheap predicates. This addresses the measured local rule-resolution cost; it does not establish exclusive attribution of today's error. |
| Publishing | The screen loads publication queue and web workspace together. `publication_queue_read` composes each visible web page and release candidates before returning; it also calls `web_workspace`. Retained queue read: 15.889 s, cancelled. | Shared resolver improvements may help. Per-page composition and duplicate web-workspace work remain profiling candidates. No exact-output optimization or new cache has been implemented. |

Retained hosted evidence: docs/46, "Requested checks and demo limitation" and
"Read-only diagnosis and options" (11 November). Each old timeout cancelled and
recovered serially with healthy API and no remaining active runtime query,
idle-in-transaction session or lock wait. That historical result is not a fresh
24 November session/lock check.

Both deployed-source and current-source proxy code bound ordinary upstream calls
at fifteen seconds; API connection command timeout is also fifteen seconds.
The hosted proxy maps a failed upstream connection/timeout to a generic 503
message. The reported sub-twenty-second settles are consistent with that path,
but the UI text alone cannot distinguish timeout from another backend failure.
No timeout, cache policy, account, scope or permission rule changed.

The existing local Phase A evidence in docs/52 is reusable for prioritization:
Home p95 691 ms, approvals 659 ms, brand 1535 ms and publication queue 255 ms on
the small synthetic corpus; all measured responses were 200. It is Windows,
warm synthetic-data evidence, not hosted acceptance. At 300 projects, current
0094 whole-Home SQL took 7.9-9.9 s, so the below-five-second target remains open.
The profile attributes more time to repeated permission/readiness/media work
than to the missing-fact helper. Catalogue duplication (three 329,990-byte
responses) and per-item workflow reads remain the ranked frontend candidates.

Next diagnostic evidence should distinguish each failed route using sanitized
status/error-code/duration and nested query plans on representative local data.
Any hosted log read needs its own admitted route/window; no new call is implied
by this source review. Retain exact ordered outputs and all scope/agency/viewer
denials before adopting query, cache or payload changes.

## Separate cap prerequisite still pending

The unchanged docs/51 cap procedure separately requires local socket/dependency
rehearsal evidence before arming its operator. No completed receipt was located
in the reviewed cap handoff/proposal folders; the 24 November handoff still lists
it as pending. The namespace component proof and extraction rehearsal do not
exercise normal socket start, failure with queued traffic, or explicit restart.
No cap operator is armed. The failed-page coverage must not obscure this separate
unfinished prerequisite. This is a preparation gap, not a new hosted STOP event.

## Compact information icon prepared separately

Root cause: `project-content.css` draws the entire 44 px hit target as a circle,
unchanged between deployed W1-W5 and the sealed candidate. The isolated
`ws/page-review-20261124` worktree now draws a 14 px icon inside the preserved
44 px target, tightens label spacing, and uses existing theme tokens for hover,
active and visible keyboard focus. Native details/summary behavior and all Thai
labels remain unchanged. One CSS file changed, +6/-1 lines.

Worktree: `C:/Users/keetawatw/.codex/worktrees/42a1/sena_digital_hub_mkt`, based on
`423804dd3ec07adbb79ee3b502738c52eec61494`. CSS SHA-256:
`0765eb3e93171d2887d2888d5f589109d0f16d51bd40ca2057c2a68a348fe74d`.
The correction is **uncommitted and not merged**; main product source and sealed
release `f07f7cb-media-dd33d4d7f14b` remain unchanged.

Focused validation: eight before/after component renders at 1280 and 390 px,
light and dark. Actual FieldInfo/ContentLabel source was rendered with its CSS;
click, Space/Enter, open text, accessible name, focus, target size and horizontal
fit passed, with zero console errors. No app server, database or network request
was used. This is not whole-app, API or hosted acceptance. Existing Playwright
was used because the Browser plugin was unavailable. No new dependency.

Evidence: `.local/owner-page-review-20261124/render-check.json`, twelve screenshots
(`before-*`, `after-*`, `after-*-open-keyboard.png`) and `field-info.patch`.
The 390 px light before/after and 1280 px dark keyboard-open captures were
visually inspected. Fresh Windows and Linux serial lease checks were clear;
the browser closed after the run. No permanent test suite was added for this
CSS-only change.

Including this correction in the sealed release would require a refreshed
source manifest, final-source gate and package. Keeping it as the next follow-up
preserves the current release evidence. No such integration decision is assumed.
