# Admin performance: Phase A, 20 November 2026

Measurement only. No performance change is approved or implemented by this
report. Preview usability corrections are a separate owner-approved slice.
Monday review and the earlier hosted rollout take priority over optimization.

## Method and limits

Source `0d493b5`, before the preview corrections, with its offline production
admin build. Fresh local synthetic H1 database/Auth/storage; no hosted request.
Windows 11, eight physical/sixteen logical CPU cores, Node 24.19.0. No CPU or
memory cgroup was imposed on this Windows baseline. These are local estimates,
not Linux/VPS capacity acceptance or a hosted deadline guarantee.

Five fresh browser contexts per page, with warm server/database state. A visible
page selector followed by network settling is measured, not interaction-ready
time. All 55 page observations reached their selectors. The generic live-region
count was retained separately and is not an error-free UI acceptance result.
Thirty-nine distinct observed JSON GET endpoints produced 44 endpoint/persona
pairs. Each pair received one discarded warm-up and twenty retained samples
through each of the admin proxy and direct API: **1,760 measured responses,
all HTTP 200**, with no transport failures. Raw response/auth/SQL contents were
not recorded. SQL-driver time includes driver/transport/decoding and pool setup;
it is not database-engine execution time. The separate Home300 EXPLAIN below
provides engine execution time. Pool times overlap SQL and must not be added.

The initial page set covers Home, six project tabs, brand, business data,
publishing and approvals. Project Promotions remains a separate pending
measurement after the pre-rollout gate releases the local lease; it is not
silently counted in the original baseline or allowed to delay the gate.

## API and first-load observations

Direct API, twenty samples per row; milliseconds, rounded. All other endpoint
and proxy timings remain in the local JSON summary.

| Read | HTTP p50 | HTTP p95 | SQL-driver p95 | Maximum JSON bytes |
| --- | ---: | ---: | ---: | ---: |
| Home | 600 | 691 | 681 | 24,168 |
| Project workspace summary | 428 | 465 | 452 | 15,871 |
| Project history | 2,765 | 2,921 | 2,903 | 38,043 |
| Brand workspace summary | 1,455 | 1,535 | 1,519 | 3,077 |
| Business workspace summary | 2,037 | 2,145 | 2,133 | 1,736 |
| Publication queue | 228 | 255 | 237 | 6,740 |
| Approval-filtered Home | 577 | 659 | 646 | 24,168 |
| Content field catalogue | 75 | 92 | 42 | 329,990 |

| Page | Selector-ready p50 / p95 ms | Settled p50 / p95 ms | Median total requests | Encoded / decoded script bytes |
| --- | ---: | ---: | ---: | ---: |
| Home | 1,639 / 1,678 | 1,741 / 1,894 | 29 | 266,087 / 925,568 |
| Project overview | 1,136 / 1,662 | 2,632 / 2,668 | 56 | 421,752 / 1,581,712 |
| Project data | 1,139 / 1,633 | 2,636 / 2,745 | 60 | 421,752 / 1,581,712 |
| Project unit types | 1,132 / 1,628 | 2,374 / 2,537 | 57 | 421,752 / 1,581,712 |
| Project media | 1,110 / 1,129 | 2,546 / 2,692 | 64 | 421,752 / 1,581,712 |
| Project FAQ | 1,132 / 1,153 | 2,558 / 2,628 | 62 | 421,752 / 1,581,712 |
| Project history | 1,109 / 1,149 | 9,161 / 9,362 | 106 | 421,752 / 1,581,712 |
| Brand | 2,674 / 2,688 | 3,393 / 3,551 | 52 | 421,752 / 1,581,712 |
| Business data | 3,170 / 3,691 | 3,787 / 3,875 | 45 | 421,752 / 1,581,712 |
| Publishing | 368 / 398 | 1,238 / 1,345 | 31 | 275,431 / 958,481 |
| Approvals | 1,597 / 1,618 | 1,602 / 1,622 | 31 | 266,087 / 925,568 |

The publishing heading can precede queue completion; use its settled measure.
With five page observations, p95 is the slowest observation, not a population
estimate. These byte counts measure scripts actually loaded with an empty
browser cache, not the entire build output or a marketing site's public bundle.

Project Overview made **three field-catalogue reads** and **four per-item
workflow reads**, plus its inventory call. This confirms the reported duplicate
catalogue and per-asset/model pattern. The catalogue accounts for 989,970 decoded
JSON bytes across three identical-sized reads. The new pending-question badge
adds one existing question-bank read only on an authorized overview containing
held FAQ tasks; that necessary UX read is not present in this baseline.

## Memory and build

250 ms samples of the newly owned process trees; Windows working set, not private
commit. A sampled maximum is a lower bound and can miss short peaks.

| Process group | Idle median MiB | Measured peak MiB | Proposed high / hard MiB |
| --- | ---: | ---: | ---: |
| API | 142.04 | 158.78 | 1024 / 1280 |
| Admin Next server | 125.20 | 249.60 | 256 / 384 |
| Disposable local PostgreSQL | 126.64 | 489.31 | Not the external TEST database or production warehouse |

Offline build passed; its aggregate process-tree peak was **1,648.53 MiB**.
This exceeds the 376 MiB maintenance-helper budget in the local measurement;
it does not prove a Linux build peak. Before any capped hosted build, the rollout
plan must select a measured, bounded Linux build method or an approved external
Linux build/artifact path. Do not exempt a build from warehouse protection or
raise limits silently. Admin's Windows peak is close to 256 MiB, so the approved
real page check remains necessary. No cap has been applied by this work.

## Home300 profile and the five-second target

A separate rollback-only corpus retained the untouched seed and added valid
fixtures: **300 projects, 70 FAQs, 80 question-catalogue rows, nine units and
309 project/unit contexts**. The distribution is deliberately synthetic
(68 corporate text FAQs and two fact FAQs), not a performance-equivalent copy
of the accumulated 103/70/112 corpus or the ordinary 49-precondition proof.

Three unfiltered current-0094 whole-Home SQL calls took **7,924.909,
8,477.788 and 9,872.892 ms** under unchanged fifteen-second bounds. These include
role/actor setup and complete result decoding, not HTTP/browser time. All three
returned identical payload hashes, 300 total projects, 609 tasks, 25 project
rows and 25 task rows per page; compact API-shaped JSON was 572,345 bytes.
The under-five-second target remains **OPEN: zero of three observations met it**.

Separate engine EXPLAIN execution: 9,225.569 ms, 637,890 shared-buffer hits,
zero shared reads or temporary reads/writes. The top Result plan does not expose
nested function statements, so it cannot establish a missing index.

| Profile component | Calls | Self ms | Total ms |
| --- | ---: | ---: | ---: |
| Permission predicate `can` | 12,169 | 2,176.951 | 2,565.011 |
| Media checklist before scope wrapper | 300 | 1,651.628 | 1,980.721 |
| Whole Home own work | 1 | 1,218.275 | 9,225.542 |
| Scope project projection | 732 | 445.929 | 445.929 |
| Missing-fact helper | 309 | 321.364 | 694.107 |
| Full FAQ composer | 0 | 0 | 0 |

Nested total times overlap and must not be summed. Even eliminating the entire
measured missing-fact helper component would save less than 0.7 seconds in that
profile; a set-based FAQ projection alone is unlikely to reach five seconds.
Readiness, media checks, repeated authority work and Home accumulation deserve
priority. No permission cache or rule adjustment is approved. Definition,
owner/ACL/attributes, audit/gap counts stayed unchanged; fixture rollback and
owned-runtime cleanup completed. The probe's one pytest pass means its
measurement/safety assertions passed, not that the timing target passed.

## Ranked candidates for owner selection

Expected gains below are hypotheses or removable measured work, not delivered
speedups. Only separately approved pure-performance changes with exact-output
proof may join the one pre-rollout full gate. Higher-risk items can follow the
rollout; none may delay marketing review.

| Rank | Candidate | Expected gain | Risk and exact-output proof |
| --- | --- | --- | --- |
| 1 | Share identical field-catalogue reads within the current authorized page | Three reads to one; avoid 659,980 duplicated decoded JSON bytes and two DB/parse operations. Parallel latency is not additive. | Low–medium. Key by account/capability/scope and catalogue revision; clear on revocation. Compare full payloads, errors, controls and invalidation under role/scope changes. No cross-user cache. |
| 2 | Mount the persistent project editor only when first needed, then retain it across tab changes | Avoid initial hidden data/version/catalogue/asset/workflow work on Overview; measure the exact eliminated call set. | Medium. Preserve unsaved drafts, dirty guards, workflow refresh and tab navigation after first activation. Exact visible data, requests on active tabs and permission denial tests. |
| 3 | Parallelize independent detail/version reads | Remove the avoidable sequential wait; project version direct p95 was 188 ms. | Low–medium. Both endpoints retain independent authorization and error handling; compare all rendered versions, stale-state handling and denial/revocation results. |
| 4 | Remove repeated rich projections inside history reads | Targets the measured 2.9 s history path and possible summary overhead. Savings require profiling the individual calls. | Medium–high. Compare ordered history pages, cursors, actor labels, before/after fields, actions, staged invalidation, deletes and every scope/agency/viewer denial. Keep row visibility before pagination. |
| 5 | Batch workflow reads for visible asset/model rows if still dominant | Replace per-row request growth; four reads were observed on the small Overview fixture. | Medium–high. Existing inventory is not an interchangeable workflow snapshot. Exact hashes, authors, exposure, staged state, errors and authority must match per item. A new contract needs owner approval. |
| 6 | Set-based Home readiness/task projection, then missing-fact work where useful | Largest scale opportunity: repeated media/authority/accumulation dominates the current 7.9–9.9 s corpus. FAQ-only component is under 0.7 s in the diagnostic profile. | High. Full ordered Home JSON including every page, totals, links, filters, dates, ties and permissions must match; reuse 112-context and 144 ordinary comparisons, all grant shapes and live revocation tests. No early pagination that changes totals and no authority-result reuse across requests. |
| 7 | Load tab-specific client bundles on demand | Entity pages load 421,752 encoded script bytes versus Home's 266,087. Actual removable bytes require chunk attribution. | Medium. Preserve navigation, focus, errors, drafts, hydration and interaction behavior at both widths; compare exact page data and UI outcomes. |

Index review found existing unique `(faq_id, version_no)` and
`(project_id, fact_key, grain)` indexes. No missing index is established by the
current evidence. Whole-row JSON containment in workflow identity lookup and
audit-candidate selection are further plan-inspection candidates; do not add
redundant indexes based only on a sequential scan over a small fixture.

Local evidence root:
`D:/Personal/workspace/sena_hub_wt/performance-review-20261120/artifacts/performance-phase-a/`.
See `baseline-summary.json`, `baseline-report.md`, `evidence/baseline-01/`, its
frozen `harness-snapshot/`, build/runtime memory streams, `home300-01.ndjson`,
and `harness/README.md`, `HOME300.md`, `HISTORY.md` for exact commands, source
references, diagnostic limitations and proof plans. No hosted capacity claim,
UAT case result, import or product optimization is recorded.
