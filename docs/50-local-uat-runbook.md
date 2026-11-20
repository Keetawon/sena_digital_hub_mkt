# Monday 23 November local UAT

Owner walkthrough remains NOT RUN. This runbook prepares the existing isolated
H1 simulation; it never connects to the hosted VPS, warehouse, hosted Auth or R2.
Use [the 61-case pack](49-unified-workspace-uat.md) and record each actual outcome.
The owner-approved fast lane places the one combined full gate after UAT fixes,
before Wednesday rollout. Security/public-output checks remain mandatory.

## Start and finish

The lead checks process inventory, Windows ports and the Linux measurement lane,
then takes the sole local test lease. Do not run another gate while this retained
session is open. Use final main with W9.1 and 0094, its frozen lockfiles and a
matching offline production admin build. The runtime manifest refuses changed
reviewed inputs; reconcile it explicitly after any UAT fix.

From the repository root, in an interactive operator terminal:

```powershell
node artifacts/unified-workspace/w8/monday-20261123/runtime/retained-h1.mjs --source-dir D:/Personal/workspace/sena_digital_hub_mkt --run-id monday-20261123 --lease-id lead-monday-local
```

This command creates its own fresh synthetic database, Auth, storage and loopback
ports. Use the admin origin printed in the safe `ready` event; no fixed port or
hosted URL is implied. The lead uses `persona editor`, `persona publisher`,
`persona viewer`, `persona admin`, `persona online`, `persona agency-kin` or
`persona agency-combay` to open separately authenticated synthetic sessions.
Actual `/me` authority is checked. No password/token/OTP is put in receipts or
screenshots. Do not redirect an interactive session that might display an OTP;
the planned rehearsal uses no `otp` command.

Use `inspect` to verify the generation and `finish` to restore clock/settings,
close owned processes and discard that generation. `reset monday-20261123`
does the same cleanup and starts fresh. Never manually delete an active database
or stop an unrelated process. Cleanup failure retains the lease until resolved.

## Finite scenes

| Scene | Existing controls / source | Use |
| --- | --- | --- |
| Common shell and source pages | `persona editor`, `inspect`; seeded project and brand from the actual picker | U01–U10 and P1 observations; capture actual public IDs rather than guessed routes |
| BUD scope/reference/history | `clock t0`, `bud-prepare`, `bud install`, `bud-profile u24`, `bud-pagination-prepare`, `bud-history-prepare` | Real 101-reference/198-effect scene; restore with `bud-matrix-restore` |
| BUD transitions | New generation; t0 preparation then the fixed day/cutoff presets and `bud move` controls | U20–U25; choose exactly one finite branch per generation |
| Confirmed phases | New generation; t0, `bud-prepare`, `multiphase-prepare`, `bud install`, `bud-profile u25`; day1 `bud move` | Four `multiphase-observe` width/theme controls; controlled late application JSON, not a network-delay claim |
| Writing aid | Separate generation; `writing-prepare`, `writing-inspect`, `writing-restore` | Stub only, opt-in defaults and normal draft flow; no live budget/provider |
| Publication | Separate generation; `publication-prepare`, `publication-inspect`, `publication-restore` | Ordinary source approval and independent publishing identities; no direct insertion of approvals/releases |
| Uploads | `uploads/manifest.json` and ordinary project/media forms | W9.1 files below; retain actual category/object authority and separate publisher |

Never mix the writing/publication restorers with the BUD matrix owner. Reuse
the reviewed recipes in `w8-retained-combined-v6/README.md`; the Monday derivative
includes the reviewed fresh-translation/seed-certificate correction. No grant
or missing readiness prerequisite is silently added when setup fails.

The runtime/fixtures do not replace every case's preparation. Seven-level FAQ,
promotion contributor/LEGAL variants, the 41-file legacy batch, private-destination
sentinels, writing orphan/error controls and pending-invite limitations remain
mapped to their existing focused engineering fixtures in the pack/checklist.
If the exact retained case is unavailable, mark that step BLOCKED with its missing
fixture; do not call an engineering test or neighboring scene owner acceptance.

## W9.1 files and observations

The finite generator is `.local/operations/prepare-w8-upload-fixtures.py`; run it
serially only after the current test lane is released. The manifest records real
bytes, hashes and pre-decode header outcomes. File generation/header admission
does not claim full processing, rendering quality, capacity or UAT success.

- JPEG: 24 MP (6000×4000) and 100 MP; 24 MP output must retain a 4096-pixel long
  edge. PNG 8-bit/16-bit and WebP: 24 MP. Over-limit and PQ/HLG negatives are
  explicitly marked; header-only negatives are never positive visual examples.
- PDF: ten distinct 24 MP objects (240 MP) in a visible brochure; one 24 MP object
  shared across eleven pages; eleven separate objects rejected at 264 MP;
  per-image/mask/depth negatives. Keep 50 MiB, 200 pages and stored 20 MiB bounds.
- Both upload flows: one processing job; competing request gets 429/Retry-After;
  show Thai waiting status and retry for at most 60 seconds. Check retry-success,
  expiry error with file/text retained, non-429 no-retry and supervised cleanup.
  Use existing controlled browser/processing evidence for contention, not a VPS test.

Preserve legal/private-exact rules, rights/provenance and historical bytes. Use
the approved Thai messages verbatim from docs/47 section 8.5. Worst-case resource
evidence remains the W9.1 Linux receipt: noisy PDF peak 930.51 MiB, 9.13% below
the 1024 MiB reference; no hosted capacity/deadline acceptance.

## Recording

Capture 1280 and 390, light/dark, plus U29's 1024 layout and keyboard review.
Record source commit, scene/generation, persona authority, exact synthetic object
IDs, clock preset, steps/result and screenshot paths. No personal data, raw GPS,
credential, cookie or authorization header. All 61 rows start NOT RUN.

Home 0094 is an accepted interim improvement: 112 context-cell matches and 144
ordinary full-home comparisons; observed 7.74 seconds versus old 15-second timeout.
The under-five-second 300-project target stays OPEN after UAT. Do not make it
an unapproved acceptance claim or omit a real home failure during the walkthrough.

Runtime rehearsal/cleanup, build, generated-file totals and current commit will
be added below from actual execution. Monday owner acceptance remains separate.


## Preparation result - 20 November

Source `ab7a7bf`: offline production build passed; 17 synthetic files and their
header outcomes verified; 20 runtime syntax checks and seven pure scripts passed.
Real synthetic login and home responses, fixed-clock restoration, reset and
owned cleanup were rehearsed. The BUD scene prepared 101 references and 198
effects (99 gains/99 losses), then restored its original grants/scopes. Writing
and publication setup/restoration passed in separate fresh generations.

Two fixture synchronization corrections were required: navigation network-idle
waits capped at 15 seconds before the unchanged five-second quiescence guard,
and bounded port-closure settling before the original false-listener assertion.
No assertion, expected value, permission rule or product timeout changed.
The earlier cleanup failure remains failed; native review found no owned
process left, and the corrected lifecycle passed fresh. Safe structured events
exclude OTP output. Full authority metadata is kept in the local safe receipt
instead of repeatedly flooding the terminal.

Evidence: `artifacts/unified-workspace/w8/monday-20261123/`, including
`runtime-receipts/`, `preparation-receipt.json`, `final-validation.json` and
`uploads/manifest.json`. Runtime source pins and helper hashes are recorded.
All owner UAT cases remain NOT RUN; case-specific limitations above remain open.
The rehearsal generations were disposed, so launch fresh for Monday rather
than using their expired loopback URLs or object IDs.
