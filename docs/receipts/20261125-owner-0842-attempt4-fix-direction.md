# Owner direction - 25 November 2026, 08:42 Bangkok

Following the [attempt 3 STOP cause analysis](20261125-local-joined-attempt3-stop-analysis.md),
the owner directed immediate preparation of whichever fix is fastest ahead of
today's deadline.

This receipt records the resulting narrow source successor `joined-20261125-04`
under sibling directory `joined-attempt4`. Attempts 1, 2 and 3, along with all
earlier seals, markers and failure receipts, stay intact and unmodified.

## Narrow source changes from attempt 3

Only three files differ from attempt 3; the other 19 execution files, all
limits, bounds, admission predicates, external inputs and backup bridge stay
byte-identical:

1. `runtime_control.py`: extend `systemctl show` with `FragmentPath,DropInPaths`
   and treat a `.slice` unit with `LoadState=loaded`, `ActiveState=inactive`,
   empty `FragmentPath`, empty `DropInPaths` and an absent cgroup directory as
   absent under systemd 255, while keeping `LoadState=not-found` required for all
   service and socket units.
2. `root_controller.py`: require `hub_event_deltas` during cleanup only when
   `hub_events_before` was recorded (after the runtime slice exists) or the run
   claims verification, while still checking `controller_event_deltas` unconditionally.
3. `check_joined.py`: add focused checks covering `slice_absent`, read-only
   `systemctl show` verification on this host for the three slice names, and
   `verify_memory_event_deltas`.

No hosted call, sudo action, product change, migration change or permission
change was performed by this preparation.
