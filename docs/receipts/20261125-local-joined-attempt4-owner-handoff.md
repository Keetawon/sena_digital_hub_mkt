# Attempt 4 owner handoff: narrow systemd slice and cleanup fixes

Preparation only; no attempt 4 runtime has run. Following attempt 3's STOP
analysis ([20261125-local-joined-attempt3-stop-analysis.md](20261125-local-joined-attempt3-stop-analysis.md))
and the owner's [08:42 direction](20261125-owner-0842-attempt4-fix-direction.md),
this successor (`joined-20261125-04`) applies the two narrow runtime fixes in a
fresh sibling directory while preserving attempts 1, 2 and 3 untouched.

Owner start intervals, Bangkok, 25 November: **08:45-10:15** or **11:15-12:30**.
The controller refuses a start outside them. With the 900-second ceiling, a start
by 10:15 finishes by 10:30, before the 10:40 cap read-only assessment. For the
13:45/14:45 condition (a pass by 12:30), the practical latest start is 12:15.

Only three execution files differ from attempt 3 (`attempt4-fix.diff`, SHA-256
`0e0ad2ce2832df2144ecae0781df30c781459d6de653c2de9e32b52fd9a0b09b`); the other
19 execution files, all limits, bounds and admission predicates stay byte-identical:

- `runtime_control.py`: inspect `FragmentPath,DropInPaths` and treat `.slice`
  names as absent when `LoadState=loaded`, `ActiveState=inactive`, no fragment or
  drop-in exists and `/sys/fs/cgroup/sena.slice` is absent under systemd 255;
  services and sockets still require `LoadState=not-found`.
- `root_controller.py`: require `hub_event_deltas` during cleanup only when
  `hub_events_before` exists or verification succeeded, keeping
  `controller_event_deltas` checked unconditionally.
- `check_joined.py`: add 3 focused tests covering `slice_absent`, read-only
  `systemctl show` on this host for the three sena slices, and
  `verify_memory_event_deltas`.

`owner-attempt4.sh` differs from `joined-v1/owner-launch.sh` only by the
working-directory line (`owner-launch-path-only.diff`, SHA-256
`f06a55354fbae8e2c8a951553885b6d99272312edaaa3eecddeba136deae285d`). **Do not
invoke the copied `owner-launch.sh`.**

Fresh read-only checks, no hosted call and no root runtime:

- Pure/syntax checks (`run_pure_checks.py`): **PASSED** (08:47 Bangkok); 29/29
  Python contracts including real read-only `systemctl show` on the three slice
  names, 6/6 Node `--check`, 12 `.py` AST parses, `bash -n owner-launch.sh`,
  serial `measurement.lock` held. Receipt SHA-256:
  `123bffa7622756f7dbd03d36aefaba6589061364ddfe420bd741eb913d8834f8`.
- Launcher pre-sudo checks re-run as uid 1000 at 08:48: `owner-attempt4.sh`
  and `seal.json` hashes OK, `bash -n owner-attempt4.sh` OK, all 22 inputs
  matched, no consumed marker.
- Windows, 08:48:34-08:48:36: exact embedded sealed admission script clear;
  356 processes, zero SSH, 35 listeners, no forbidden listener.
- Linux, 08:48:38: sealed conflict predicates clear; 29 processes, 29 active
  services, 3 listeners. Shared serial `measurement.lock` acquired and released.
  Attempt 4 evidence and backup folders do not exist yet.

From the normal Ubuntu terminal:

```bash
cd /mnt/c/Users/keetawatw/.codex/worktrees/9927/sena_digital_hub_mkt/artifacts/timing-preparation-20261124/joined-attempt4
printf '%s  %s\n' '102b5ac61f1ca3a41ab56efcdae57cff2926ddc56b001cca6d6a0a7ad7ba837b' owner-attempt4.sh '92894c0220561459932eda319f497e5f45d5aa981850b1f3216d1085059df3b6' seal.json | sha256sum --check --strict
bash owner-attempt4.sh 92894c0220561459932eda319f497e5f45d5aa981850b1f3216d1085059df3b6
```

Run the last command only if both checks say OK. Type any sudo password
personally in that terminal; never send or store it. On failure, preserve the
result, report it and wait; no further rerun.

Result: `/home/keetawatw/hub-joined-evidence-20261124/joined-20261125-04/result.json`.
Consumed marker: `joined-attempt4/owner-attempt-consumed.json`. Backups go only to
new `joined-20261125-04-cal` and `joined-20261125-04-main` folders.

All limits and live evidence qualifications stand unchanged: 900-second outer,
840 operation (480 active + 300 tail + 60 reserve), shared 180-second ticket,
guard/transport 50/55 seconds, boundary component at most 300 seconds, 2304 MiB
memory limits, CPUs 0-3, swap zero. Live target/TLS, the pre-maintenance baseline
and all hosted observations remain mandatory. No hosted readiness or capacity
acceptance is claimed.

Seal SHA-256: `92894c0220561459932eda319f497e5f45d5aa981850b1f3216d1085059df3b6`.
Launcher SHA-256: `102b5ac61f1ca3a41ab56efcdae57cff2926ddc56b001cca6d6a0a7ad7ba837b`.
Fix diff SHA-256: `0e0ad2ce2832df2144ecae0781df30c781459d6de653c2de9e32b52fd9a0b09b`.
Pure check receipt SHA-256: `123bffa7622756f7dbd03d36aefaba6589061364ddfe420bd741eb913d8834f8`.
Owner direction SHA-256: `8dcfe07e078dd402cedafeeb3aadf7e1166c97c92969b343e19ac707e7f9a6d3`.
