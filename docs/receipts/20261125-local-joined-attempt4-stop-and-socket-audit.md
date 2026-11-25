# Attempt 4 STOP and socket property root-cause audit

Attempt `joined-20261125-04` started 08:56:05 Bangkok and stopped at 09:00:37
(elapsed 254.66 seconds) during stage `runtime_setup`. Hosted calls were zero.
This record preserves the exact pasted result and the read-only source audit
across all prepared operators. No runtime files or sealed operators were
modified.

## 1. Primary STOP (`runtime_control.py:131`, `systemd-analyze verify`)

- Admission, the serial lock, and the updated slice-absence check passed.
- Package setup copied 21,207 payload files twice (`PREVIOUS` and `CANDIDATE`),
  performing 42,414 per-file `os.fsync()` calls (~254 seconds).
- Stage `runtime_setup` then stopped at `systemd-analyze verify --man=no` on
  `sena-hub-test-api.service`, `sena-hub-test-admin.service`, and
  `sena-hub-test-media-worker.service`. Because each unit declares
  `BindsTo=hub-joined-controller-joined-20261125-04.service` (a transient
  `systemd-run` unit that offline `systemd-analyze verify` cannot resolve after
  collection/outside live dependency graph resolution), `systemd-analyze verify`
  exited 1.
- Read-only verification on the exact leftover unit files under
  `/run/systemd/system/` showed that adding `--recursive-errors=no` exits 0 with
  empty stderr.

## 2. Cleanup failure (`runtime_control.py:176`, `KeyError: 'MainPID'`)

- During `finally` cleanup, `Runtime.stop()` queried `sena-hub-test-image-broker.socket`
  and indexed `row['MainPID']`.
- Under systemd 255, `.socket` units do not emit `MainPID`,
  `ExecMainStartTimestampMonotonic`, or `NRestarts` in `systemctl show`
  (verified read-only against the live loaded `.socket` unit).
- This aborted cleanup before removing `/srv/sena-hub-test`,
  `/run/hub-joined-joined-20261125-04`, and `/run/systemd/system/sena-hub-test-*`.
- Independent normal-user inspection confirmed zero remaining processes, zero
  active test units, zero test listeners, and a clear `measurement.lock` flock.
  All controller memory event deltas are zero.

## 3. Read-only `.socket` `MainPID` audit across prepared operators

- **10:45 caps (`caps-exec-v1`): CLEAN / UNAFFECTED.** `cap_apply.py` already
  guards `if unit != SOCKET:` at every `MainPID` / `NRestarts` /
  `ExecMainStartTimestampMonotonic` check (`lines 145, 598, 665, 741`), and
  `observer_adapter.proposed.py:154` excludes `SOCKET` from `MainPID`
  start-generation checks.
- **Local joined proof (`joined-attempt4`):** affected at `runtime_control.py:176`,
  `root_controller.py:349`, and `joined_boundary_adapter.py:55`.
- **Approved boundary/switch operators (`boundary-approved-integration-20261124`):**
  affected at `switch.py:309, 317` and `boundary-core.py:295` (earlier pure checks
  supplied mocked `MainPID='0'` on `SOCKET`).
- **13:45 staging (`staging-final-v1`):** affected at `checkpoint.py:63`
  (indexes `MainPID`, `ExecMainStartTimestampMonotonic`, `NRestarts` before line
  64's `if unit_name != core['SOCKET']:` guard).

## 4. Required next actions

No sealed/approved operator or product code was changed. Before any Attempt 5 or
13:45 staging arming:

1. Owner clears Attempt 4 root leftovers safely after verifying `owner.json`
   matches `joined-20261125-04`.
2. Owner decides whether to authorize a narrow successor fix (`.socket` `MainPID`
   handling, `systemd-analyze verify --recursive-errors=no`, and single `os.sync()`
   replacing 42,414 per-file `fsync` calls) across `joined-attempt5`,
   `boundary/switch`, and `staging-final-v2`, or hold those for the next window
   and run only the clean 10:45 caps slot today.
