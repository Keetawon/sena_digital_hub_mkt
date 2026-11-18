# W9 handoff to the orchestrator — 17 November 2026

**W9 is delivered to `origin/main`. Hosted TEST is unchanged.**

- Product: [`c9791afda7a67724a7611a0ad6253316ceae757e`](https://github.com/Keetawon/sena_digital_hub_mkt/commit/c9791afda7a67724a7611a0ad6253316ceae757e), exactly 74 reviewed paths.
- Delivery receipt: [`45ca77662501a6200ea9fa6805feaf684d3d04bd`](https://github.com/Keetawon/sena_digital_hub_mkt/commit/45ca77662501a6200ea9fa6805feaf684d3d04bd).
- Both commits were pushed normally and the remote head verified. No history
  rewriting, worktree deletion or hosted operation occurred.
- Full narrative and measurements: [docs/48 delivery receipt](48-unified-workspace-log.md#w9-delivered-locally-with-approved-stage-reuse--17-november-2026).

## Owner decision: keep the tested files

The owner explicitly approved keeping three extra blank lines at file ends and
asked that this note be available to the orchestrator through GitHub. Preserve
the exact tested bytes and migration hash. This is a one-time formatting
exception for only these warnings:

| File | Reported line | Warning |
| --- | ---: | --- |
| `apps/api/tests/test_upload_permission_inventory.py` | 97 | new blank line at EOF |
| `supabase/migrations/202611130093_upload_optimization.sql` | 665 | new blank line at EOF |
| `supabase/tests/upload_optimization.sql` | 374 | new blank line at EOF |

The staged whitespace check returned exit 2; do not describe it as clean.
The earlier working-tree check had omitted then-untracked files and the index
check had run empty. The later staged check correctly stopped delivery before
any commit. All 74 staged blobs were then reverified against the tested freeze.
Only the three exact warnings were accepted after owner approval. No source,
permission, API contract, timeout, migration hash or Git configuration changed
to accommodate them. Future gates must check new files before source freeze.

Migration 0093 SHA-256 remains:
`184f33d3dec7fcb4a9f5e8076d6790bf69b9b0c04754a22ccc4c86e4b994b9b6`.
Migrations 0089–0092 remain unchanged.

## Accepted verification

| Suite | Origin | Result |
| --- | --- | --- |
| Typecheck and offline build | Fresh | Passed |
| Production imports/isolation | Fresh | 4 passed |
| Complete browser, 1280 | Fresh | 737 passed |
| Complete browser, 390 | Fresh | 737 passed |
| Credential and broad scans | Fresh | Passed; no credential files read |
| API | Reused with owner approval | 2,840 passed; 11 existing skips; 13 warnings; 822 subtests |
| Database | Reused with owner approval | 95 Node checks; 46 SQL suites; 25 concurrency scenarios |
| Local H1 | Reused with owner approval | 69 Node checks; 10 smoke checks; 87 browser checks (77/3/7) |

Nine fresh stages plus three verified reused stages satisfy the owner's narrow
[docs/11 exception](11-local-development.md). Reuse followed only two non-H1
browser-spec corrections and delivery-document changes. Source, dependencies,
backend/H1 tests, shared helpers, fixtures, harnesses and profile were unchanged.
Runtime continuity uses locked inputs, prior log/trace metadata, sampled file
timestamps and the sole-lead attestation; historical executable hashes were not
recorded. Current runtime files were pinned and rechecked. Failed prior runs
remain failed and preserved. The four final readiness assertions retain every
original spec line; their focused checks passed seven tests at each width.

## Next work and active boundaries

1. Interim TEST protections after fresh permitted admission, an owner-approved
   quiet interval, and the owner's normal demo-page visits with API, admin,
   media-worker and broker PID/cgroup/current/peak/event evidence before/after.
   Local Linux experiments are no longer a cap
   admission prerequisite (owner correction, 18 November).
2. W9.1 memory reduction and the approved home composition implementation.
   Local W9.1 measurements are separately authorized now, before hosted caps.
3. W8 UAT, then a separately approved hosted rollout.

The owner released the 17 November swap STOP. [Docs/46](46-hosted-content-rollout.md)
now records the calibrated 3.84 GiB available-memory reserve, 64 MiB swap-growth
and 100 MiB/five-minute swap-out thresholds, plus stalls/reclaim, PSI, cgroup
events, kernel OOM and warehouse-health STOPs. Smaller deltas are recorded.
The 18 November 07:37 Bangkok passive sample passed: 13.81 GiB available,
zero swap-out/stalls/reclaim/cgroup increments, swap use down 8 MiB, warehouse
healthy, no retained kernel OOM match. PSI is unavailable. This short sample
is not a maintenance-window admission.

Caps remain conditionally approved and unapplied. Admin's lifetime peak is
199.7 MiB; the owner-operated demo interval still needs before/after readings
and a peak no greater than its proposed 256 MiB MemoryHigh. No quiet interval
has been admitted. The owner approved reserving **19 November 09:40–09:59
Bangkok** for normal page reading only: six-minute sequence, five-minute tail,
one-minute reserve. Slow pages may take up to 60 seconds each, without retries;
stop on the second over-60-second page or the six-minute overall budget. Record
unvisited routes rather than claiming complete peak acceptance. The required
twelve-minute gap after prior settling may not fit the 15–16-minute health
cadence; skip if fresh clearance is insufficient. No cap application in that
session; its own window needs approval. The latest journal review pairs 2,599 runs without
unmatched starts, but background cron completion and the moving health timer
still require clearance before an executable interval.

The owner accepted Ubuntu-24.04 setup with the approved account-wide 12 GiB
WSL ceiling and zero swap. Existing systemd/cgroup v2 work, frozen W9 lock
versions are installed, 63 production imports and four isolation tests passed.
All 72 exported product files remain unchanged. No credentials were copied.

Initial serial Linux measurements are recorded in the latest docs/48 entry.
Every probe used four CPUs, MemoryMax=2304M and swap=0. Unprofiled 24 MP peaks:
JPEG 399.92 MiB, noisy JPEG 338.31, SDR16 558.93, PQ16 1157.49, HLG16 919.88.
A bounded HDR-cache scratch candidate reduced PQ24 to 881.44 MiB (9.073s local),
but PQ100 still timed out at 30s. The unchanged PQ100 baseline was OOM-killed
at 2304 MiB. A 200-page PDF with 128 distinct 24 MP JPEG payloads also timed out
unprofiled. Thirteen successful HDR candidate/baseline output comparisons were
equal; this is not the full fidelity suite. Two kill/reap probes left no child
processes, and subsequent image probes passed. API parent/IPC/whole-request
costs, the aggregate PDF envelope and the full acceptance matrix remain open.
These are laptop measurements, **not hosted deadline or capacity acceptance**.
No product code, migration, timeout, acceptance rule or hosted setting changed.

Summary receipt: `/home/keetawatw/w9-1-lab/receipts/initial-measurements-20261118.json`,
SHA-256 `464395df89b12a5e61e3a398a0f2052d86c536b5fadf7c3435c21baf036151fb`.
The local Markdown report is
`.local/hosted-capacity-w9-20261116/interim/w9-1-initial-linux-measurements-20261118.md`.
Do not use the shared VPS for load, stress, upload-processing or failure
experiments; its warehouse is production and remains read-only.

The unfiltered 103-project home timeout is still OPEN. W8's 61 cases remain
NOT_RUN. Windows upload measurements and mocked screenshots are not Linux,
hosted-capacity or UAT acceptance. Do not infer that W6 onward is deployed.

Local detailed evidence is under
`artifacts/unified-workspace/w9-full-reuse-20261117/` (ignored artifacts are not
available through GitHub). Authoritative final status: `delivery-final-state.json`.
The original pre-commit STOP states remain intact. Source-freeze SHA-256:
`3c65eed7ff916861b621b287e9a1e57d0a2817d07e776341a7bb6d62ff16f1d6`.
Combined verification SHA-256:
`614cf9c018a5deab83f55b02207b61c9d7b69a55999128109c083f23f21ba2cf`.
Approved exception/resume evidence SHA-256:
`db1148907ff58905115c4e4dc1b1a851b3dc7a9564fddbeef53e92544cb3c38e`.
