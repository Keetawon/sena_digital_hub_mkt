# Staging supervisor preparation - 24 November

**Preparation sealed; not armed.** The sealed release and all earlier operator
versions and receipts are unchanged. No hosted call or service start occurred.

The v3 successor retains diagnostics when a child exits during cleanup or its
kill, wait or pipe close fails. The original child failure, elapsed time and
output hashes survive. A successfully reaped exit race is distinguished from
incomplete cleanup; the latter remains STOP. Independent read-only review found
no further critical issue in this correction.

The retained red3 control exits 1 with ProcessLookupError. The final green1 run
passes **58 pure cases, exit 0**, under fresh local process admission and the
shared serial lock. These are mocked preparation checks, not runtime or hosted
capacity acceptance. No assertion was removed to obtain the pass.

| Evidence | SHA-256 |
| --- | --- |
| v3 supervisor | `b78265e7ce979c59aa71968b3f183f0735db304b64ea1e3c3919ae4597d596d3` |
| v3 preparation seal | `dc2b2d9432e67bf7b9bf15b933f7125f7c8d1677bc3db1f1396bdb26c38df4ed` |
| Preserved v2 supervisor | `61c4dc3cab97c6b0ad2f8a7c8ab95e792462ef259412b4496b7712af577bd644` |

Local files and original outputs are under
`.local/hosted-content-rollout/marketing-20261124/staging-self-checks-v3/`.
The template has the final source hash, execution_authorized=false and
owner_go=false. Templates and a preparation seal are not execution authority.

## Requirement clarification

Earlier preparation notes treated a separate local root-to-service identity
rehearsal as a mandatory gate. That was an implementation-review interpretation,
not an explicit owner requirement. The accepted local bounded run already
executed the unchanged imports, API/worker self-checks and native checks:
**258.74 MiB peak, zero high/max/OOM events, 36.33 seconds**. Those results remain
separate from the 58 pure supervisor checks.

Do not add another owner sudo rehearsal solely for this identity transition.
Its local runtime coverage remains unmeasured and disclosed. During the staging
window, actual service UID/GID, single-helper membership, effective/kernel caps,
OOM scores, read-only policy, child results and memory events must verify live.
Any mismatch remains STOP. The frozen entrypoints run serially as direct children
inside the existing 376/320 MiB helper; no uncapped sibling service is launched.

This clarification does not waive the owner's explicit complete LOCAL_FIXTURE
boundary/capture/transport integration, measured complete operation budget,
genuine live checks before migration commit, or staging's outer admission,
package checks, scan and five-minute pressure/job tail. Those remain independent
prerequisites. No extra capacity acceptance or hosted authority is inferred.
