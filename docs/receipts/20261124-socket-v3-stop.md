# Socket v3: STOP preserved, no further rehearsal

Owner-launched v3 ran on 24 November **13:03:16–13:05:33 Bangkok**, exit 1.
Result: **STOP — `post_failure_diagnostics_missing`**. Scenarios 1–4 passed;
scenario 5 did not complete its acceptance checks; scenario 6 was not reached.
No retry is authorized or performed.

The original result is retained byte-for-byte in
`20261124-socket-v3-owner-result.json`, SHA-256
`06cc5c4900a475308550c744a8942c6b3b6918090018c384a8782fc494c67697`.
V2 remains unchanged and still failed. No assertion or receipt is rewritten.

## What the retained evidence proves

- A separate pre-burst high-throttle interval lasted **20.542 s**, with 3,373
  high events and zero max/OOM at its final sample. Allocator progress later
  records one 16 MiB allocation taking **84.907 s**. High pressure can stall
  requests well before hard-limit termination; it is not an immediate kill.
- The external timeline reached the API hard limit: peak **1,308,622,848 bytes
  (1248 MiB)**. First sampled max event was at 115.753 s; at 116.269 s the sample
  recorded **15,615 high, 112 max, 5 oom, 3 oom_kill, 1 oom_group_kill**.
- Retained systemd state is API `Result=oom-kill`, `MainPID=0`, `NRestarts=0`,
  failed; socket inactive/dead. The scoped unit journal confirms OOM termination
  and reports its control process killed with SIGKILL. The required in-unit
  post-failure JSON was not produced. These observations do not substitute for
  the subsequent assertions that the harness did not reach.
- Parent peak was **1,320,751,104 bytes (1259.57 MiB)**. Parent
  `memory.events.local` high/max/OOM counters were zero; hierarchical counters
  include the API events and must not be described as zero.
- Cleanup retained exit code 5, matching owned runtime hashes and no active
  synthetic units. A separate normal-user read-only observation at **13:12:59**
  confirmed all ten recorded API/allocator PIDs absent and no active v3 units.
  The earlier journal line about a remaining process is retained, not erased.

The hard-kill path was observed. Post-OOM traffic non-reactivation and explicit
singleton recovery were **not completed**, so the full socket/dependency
prerequisite remains **NOT MET**. No service, configuration, cap, swap or product
change was made in response. The hosted STOP on any Hub high event remains.

## Retained local diagnostics

Directory:
`.local/hosted-capacity-w9-20261116/interim/socket-rehearsal-v3-20261124/retained-linux/`.

| File | SHA-256 |
| --- | --- |
| `controller-result.json` | `9777cc8c106dceec2183da03bc2ba562458a021f0c2848205e4cbc6433bab17e` |
| `child-oom-pressure-timeline.json` | `d1c2d61b330a534b403a633441cb5d6ad1faca4f630648edf7617c6c55ce9e0f` |
| `child-oom-allocator-progress.ndjson` | `e7f3cc67446ee45abf1b34d2ea99eddd4d712712111912fc037fb0c39d78af1b` |
| `api-unit-journal.jsonl` | `59575a4341fca9ebdcb84816372abc7f0d4b7c7716eb5ca31435985cf5721ae7` |

The journal read was restricted to this synthetic API unit and 06:03–06:06 UTC,
normal Ubuntu user, at most 200 rows; exit 0, empty stderr. No sudo, hosted call,
credential access or test rerun was used to retain/inspect this evidence.

## Wednesday outlook and 16:00 follow-up

Without a further reviewed decision resolving this failed prerequisite, the
10:45 cap window must be skipped. The dependent 13:45 staging, 14:45 switch and
15:45 post-promotion check consequently cannot proceed under the approved chain.
Reservations remain conditional; none moves automatically.

Include this failure in the 16:00 decision batch. Recommendation: retain NOT MET,
review an external diagnostic collector that survives the target cgroup's OOM,
and identify the still-missing traffic/recovery proof. Do not silently replace
the failed assertion with post-hoc observations or prepare another executable
socket attempt under the exhausted v3 authorization.
