# Bounded local package self-checks: passed

One independent serial run completed at **13:23:25 Bangkok**, exit 0. It used the
already extracted sealed `f07f7cb-media-dd33d4d7f14b` candidate; no rebuild,
re-extraction, socket-rehearsal retry, product edit or hosted call occurred.
Fresh Windows process/port and Linux service/port admission and the shared local
lock were checked before starting the unprivileged transient unit.

Actual limits: **376 MiB hard / 320 MiB high**, swap zero, half a CPU with affinity
0–3, 32 tasks, 180-second lifetime, OOM score +1000, OOMPolicy=kill, Restart=no.
Observed helper peak **271,306,752 bytes (258.74 MiB)**; high/max/oom/oom_kill
deltas all zero. Parent plus serial child checks were charged to this one helper.
Total measured check time **36.327 seconds**, a local estimate only.

| Frozen check | Result | Local seconds |
| --- | --- | ---: |
| Production imports, native decoder and application construction | Passed; 67 imported modules | 17.736 |
| API self-check | Passed | 8.907 |
| Worker self-check | Passed with synthetic connection settings and a public packaged CA bundle | 4.788 |
| Native Unix peer/JPEG check | 2 cases passed | 4.469 |

The first three checks reported zero network calls, database connections,
external service calls and writes. The native check uses only an in-memory Unix
socket pair and image, with no database or external connection. No real settings,
credential files or hosted data were read, copied or supplied. Source hashes and
the accepted local Python binary were verified before and after. Raw child output
is retained by hash/size only; the receipt contains selected status/count fields.
Memory and process diagnostics were saved before acceptance assertions.

Evidence directory:
`.local/hosted-content-rollout/marketing-20261124/bounded-self-checks-v1/`.
Source seal SHA-256:
`b1adcbc391aeeeb240ab8666502d2164ff46aea93ffad716dfab6ccbd1b074f9`.
Result SHA-256:
`bcd1c5b5ee0c522c349f5334d397693a5f44dcc1ae8d7e782f4dec54b1acd3e8`.
The exact result is copied to `20261124-bounded-self-check-result.json`.

This closes the **local bounded check-memory** gap behind extraction's accurate
`self_checks_executed:false` field; the earlier extraction receipt remains
unchanged. It does not prove hosted identities, actual existing hosted worker
settings/CA, aggregate concurrent-service capacity, hosted latency or permission
to stage/switch. The actual target checks remain mandatory in the staging window.

The old candidate wrapper starts separate self-check units; enclosing only that
wrapper in a helper would not bound its sibling units. The future staging
successor must supervise these frozen check entry points inside the approved
helper, with actual existing service identities verified, and prove descendant
containment. Do not run the old wrapper as an assumed contained equivalent.
Socket v3 remains STOP; full local boundary integration and complete migration-
to-promotion timing remain outstanding. Wednesday readiness is still NOT MET.
