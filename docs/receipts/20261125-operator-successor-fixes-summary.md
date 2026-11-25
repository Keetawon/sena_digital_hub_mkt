# 2026-11-25 Operator Successor Fixes Summary (Unarmed / Offline Verified)

Date: 2026-11-25  
Scope: Offline successor packages fixing two runtime compatibility defects observed on 2026-11-25 against hosted TEST (`hosted_calls: 0`, zero SSH, zero armed packets).  
Product code impact: None (`apps/`, `supabase/`, `scripts/` untouched).

## Root Causes Addressed

1. **7-digit ISO-8601 subsecond timestamps on Python < 3.11**:
   PowerShell `.ToString('o')` emits 7 fractional second digits (e.g. `.1234567+00:00`), which Python < 3.11 `datetime.fromisoformat()` rejects. Normalized fractional subseconds before parsing.
2. **`.socket` unit inspection under systemd 255**:
   Socket units (such as `sena-hub-test-image-broker.socket`) do not expose `MainPID`, `ExecMainStartTimestampMonotonic`, or `NRestarts` in the same way as `.service` units. Updated generation and state comparison helpers to handle `.socket` units cleanly without requiring `MainPID`.

## Unarmed Successor Packages

### 1. `caps-final-v2`
- **Local workspace path**: `.local/hosted-content-rollout/marketing-20261125/caps-final-v2`
- **Fixes**: Normalized 7-digit ISO-8601 parsing across `cap_apply.py`, `observer_adapter.proposed.py`, `caller.proposed.py`, and `transport.proposed.py`, plus 2 regression tests (`test_observer.py`, `test_transport_caller.py`).
- **Offline verification (`20261125-caps-v2-checks.json`)**:
  - `status`: `LOCAL_OFFLINE_CHECKS_PASSED`
  - `tests`: `122`, `failures`: `0`, `errors`: `0`, `skips`: `0`
  - `actual_exit_code`: `0`, `hosted_calls`: `0`, `source_unchanged`: `true`
- **Safe no-SSH inspection (`caller.proposed.py`)**:
  - `status`: `PREPARED_NOT_ARMED`
  - `source_pins_verified`: `true`
  - `hosted_calls`: `0`
  - `proposal_status`: `SEALED_PREPARED_PENDING_OWNER_GO`
  - Exit code: `0`
- **State**: Unarmed (`owner_go: false`, `execution_authorized: false`)
- **Verified SHA-256**:
  - `cap-source-seal.proposed.json`: `8f6921390947807f646c4672c07df7550934fcfedacc137385d3c8b79f2562d4`
  - `cap-application.reviewed.json` (unarmed): `6064810c7ec08417a3a48220977e4dda4ff5210f4f70e1bdfe426a27bdf8f633`
  - `caps-iso-fix.proposed.patch`: `9f975f64a9a2bfbeaa78fd60a99947d94a44ae888eedf5a0768e287c75db3ec5`

### 2. `staging-final-v2`
- **Local workspace path**: `.local/hosted-content-rollout/marketing-20261125/staging-final-v2`
- **Fixes**: Updated `common.py` (`stamp`) for 7-digit ISO-8601 subseconds and `checkpoint.py` (`generations`, `same`) for `.socket` units without `MainPID`; split regression coverage in `test_staging.py` (`test_stamp_accepts_seven_digit_subseconds` and `test_socket_generations_and_same_without_mainpid`).
- **Offline verification (`20261125-staging-v2-checks.json`)**:
  - `status`: `LOCAL_OFFLINE_CHECKS_PASSED`
  - `tests`: `74`, `failures`: `0`, `errors`: `0`, `skips`: `0`
  - `actual_exit_code`: `0`, `hosted_calls`: `0`, `source_unchanged`: `true`
- **State**: Unarmed (`owner_go: false`, `execution_authorized: false`)
- **Verified SHA-256**:
  - `final-seal.json`: `5693feb7b9c2844b83ce2d2b7c852fa1f3a02a93e40323f3bda450cce610469f`
  - `source-seal.json`: `13c2c4106d21877bc4f9e13bf419864a40d10fe91ec3a648cde10ed4fef52afd`
  - `staging.reviewed.json` (unarmed): `c1c56ddc14ce2382b596b82bc867cd226ce6c1f6859504c5e0c77b8a9c2022ef`
  - `staging-socket-iso-fix.proposed.patch`: `cc1382433a9cc17add61f54f521eb20ba22285ae0bd0c4907117cb03df0c1f3b`

### 3. `boundary-successor-v2`
- **Local workspace path**: `.local/hosted-content-rollout/marketing-20261125/boundary-successor-v2`
- **Fixes**: Applied 7-digit ISO-8601 subsecond normalization and `.socket` `MainPID` handling across 7 files (`boundary-core.py`, `boundary-guard.py`, `boundary-remote_mapping.py`, `boundary-thin_launcher.py`, `caller.py`, `switch.py`, `thin_launcher.py`).
- **Offline verification (`20261125-boundary-v2-checks.json`)**:
  - `status`: `LOCAL_OFFLINE_CHECKS_PASSED`
  - `tests`: `4` (suite covering all 38+ boundary contracts, AST parse across all 12 Python sources, `.socket` `MainPID`, and 7-digit ISO-8601 timestamps)
  - `failures`: `0`, `errors`: `0`, `skips`: `0`
  - `actual_exit_code`: `0`, `hosted_calls`: `0`
- **State**: Unarmed
- **Verified SHA-256**:
  - `boundary-socket-iso-fix.proposed.patch`: `0fe596c165ae64521aad149a0d59a61cc16043c6a8768f206f5811c9818eda90`

## Receipt Files in Repository

- `docs/receipts/20261125-operator-successor-fixes-summary.md`
- `docs/receipts/20261125-caps-v2-iso-fix.proposed.patch`
- `docs/receipts/20261125-caps-v2-checks.json`
- `docs/receipts/20261125-staging-v2-socket-iso-fix.proposed.patch`
- `docs/receipts/20261125-staging-v2-checks.json`
- `docs/receipts/20261125-boundary-v2-socket-iso-fix.proposed.patch`
- `docs/receipts/20261125-boundary-v2-checks.json`

## Pending Owner Approvals Before Next Hosted TEST Window

1. **Approve the 3 unarmed successor packages** (`caps-final-v2`, `staging-final-v2`, `boundary-successor-v2`) to replace the prior blocked packets.
2. **Approve Decision 2 (`migration manifest binding`)** for schema/migration verification.
3. **Confirm next maintenance/deploy window date & time** (with explicit `GO` starting with `caps-final-v2`) and confirm the **pre-maintenance baseline wrapper** requirement before execution.
