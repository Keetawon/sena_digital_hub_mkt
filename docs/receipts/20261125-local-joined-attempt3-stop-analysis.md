# Attempt 3 STOP - cause analysis

Attempt `joined-20261124-03` started 08:32:55 Bangkok and stopped after 1.68
seconds at stage `runtime_setup`. Hosted calls were zero. The owner pasted the
root-only `result.json` and `before-cleanup-diagnostics.json` at 08:35; no
permission or ownership was changed to read them. Their safe fields are recorded
here. No rerun was made.

## What passed before the STOP

- Seal, all 22 inputs and the start interval.
- Serial lease and fresh local admission inside the controller: Windows clear
  (354 processes, zero SSH, 35 listeners); Linux 34 processes, 31 active units,
  three listeners.
- Controller limits: 2304 MiB, swap zero, CPUs 0-3, 128 tasks, +1000; peak
  memory 21.6 MB; every memory event delta zero.

## Primary STOP: `runtime_unit_collision`

`runtime_control.py` line 76 requires `systemctl show <unit>` to report
`LoadState=not-found` for five service/socket names and for
`sena-hub-test.slice`, `sena-hub.slice` and `sena.slice`. Read-only checks at
08:35-08:36 show:

| Name | LoadState | FragmentPath | ActiveState |
| --- | --- | --- | --- |
| five service/socket names | not-found | none | inactive |
| the three sena slices | loaded | none | inactive/dead |
| control: `zz-never-defined-control-a.slice` | loaded | none | - |
| control: `zz-never-defined-control-b.service` | not-found | none | - |

On this host's systemd 255, **any** slice name that was never defined reports
`loaded` with no unit file; services report `not-found`. The three slices do not
exist (no fragment, no drop-in, not listed, inactive). The sealed check can
therefore never pass here: this is a deterministic source defect, not an
environment conflict. The pure and mocked checks did not exercise real systemd
slice reporting.

## Secondary: `joined_memory_event_increase` during cleanup

Line 358 requires a `hub_event_deltas` entry, which is only recorded after the
runtime slice exists. Because setup stopped first, the entry is absent and the
check fails although every recorded event delta is zero. `cleanup_complete` is
false for this reason only. The independent normal-user inventory at 08:33:59
found no controller/test unit, runtime folder, backup folder, runner or test
listener.

## Consequence and status

No passing attempt 3. The 13:45 staging, 14:45 promotion and 15:45 page slots are
skipped today and do not move. The 10:45 cap slot is independent and unchanged.
Any corrected source needs review, new checks, a new seal and a new owner
approval; none is authorized by this record.
