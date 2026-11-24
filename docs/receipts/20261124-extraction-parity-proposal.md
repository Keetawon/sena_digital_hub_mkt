# Extraction parity review and proposed correction — 24 November

Result: **NOT MET**. No hosted operator, source, package, limits or service has
been changed. This proposal needs owner approval before implementation.

The accepted local harness used a 1 MiB source-file pump, a pipe to the receiver,
and `POSIX_FADV_DONTNEED` on the source archive after each chunk. Pump and receiver
ran inside the same capped helper. Peak: 284.55 MiB; high/max/OOM deltas zero.
The earlier regular-file-input attempt remains failed: 321.80 MiB and 132 high
events. The precise cause of the difference has not been established.

The reviewed package's receiver matches exactly, SHA-256
`9e8150f782d4b7a68f38f142bc07d5975baf6be1174fcd8d7c2ae94d19841e11`.
Its own archive/output cache-discard operations are unchanged. However, those
operations do not discard the separate source archive's pages. The hosted
recipe shows `systemd-run --pipe ... < candidate.tar.gz`, without the tested
sender/pump implementation or a sealed executable transfer launcher. A pipe
flag alone proves neither source discard nor same-cgroup charging. The receiver
template is still explicitly disabled with unset execution pins.

Source references: candidate-v3 `README.md` lines 43–66 and
`receiver.template.json`; local `extraction-r8-stream/after-gate.py` lines
94–120 and 159–180. Their verified hashes and the later receiver inventory are
in [the machine-readable review](20261124-extraction-parity-review.json).

## Proposed change, not applied

1. Create a separately named, sealed staging wrapper. Preserve all earlier
   operators, attempts and receipts. Keep the receiver and package hashes exact.
2. Inside the sole maintenance helper, receive the bounded archive into a new
   source file while hashing it and flushing/discarding only that new file's
   cache. Do not use an uncapped host-side file reader or a global cache flush.
3. In that same helper, open the source archive and use the accepted local
   pump unchanged: read 1 MiB, write/flush the child pipe, and advise source-cache
   discard after each chunk. Start the unchanged receiver as an ordinary child
   and verify actual shared cgroup membership. Keep transfer and extraction
   serial; propagate any child failure and preserve its diagnostics.
4. Keep MemoryMax 376 MiB, MemoryHigh 320 MiB, half a CPU, swap zero, TasksMax 32,
   OOM score +1000, OOMPolicy=kill, Restart=no and the ten-minute outer bound.
   Keep the active parent 2304 MiB ceiling and all current admission/STOP rules.
   Reserve disk for two archive copies, the extracted tree and the existing
   1 GiB spare; never delete or reuse existing release paths to make room.
5. Rehearse the complete new transfer/pump/receiver path locally, serially,
   including actual cgroup identities, before/after event counters, memory.peak
   and elapsed time. This is a new measurement, not a relabelling of 284.55 MiB.
   A failure stops; no limit relaxation or silent retry. Seal the resulting
   wrapper, admission and receipt before presenting the hosted command.

This change adds a bounded source spool to make source-file handling and
charging explicit. Its extra transfer time and disk usage must be measured and
included in window admission; the ten-minute refusal ceiling does not prove
completion within the active portion of a fourteen-minute reservation.
No implementation or hosted execution is authorized by this document alone.

## Why self_checks_executed is false

`stream_receiver.py` line 382 deliberately records false in both modes. It
verifies/extracts bytes and containment; it never imports or starts the candidate.
This is not a failed or skipped assertion inside extraction. The accepted build
separately passed `production_imports`, `native_peer` and
`relocated_installed_modules`. Those used local build context, not a staged
application under the hosted API/worker identities or the 376 MiB helper limit.

Therefore the receipt is valid only for extraction with the measured local
harness. It cannot accept hosted staging, final interpreter/shebang resolution,
bounded runtime self-check memory, or capacity. The planned serial API/worker
runtime/native checks and scans must still pass under their admitted bounded
operators before promotion; they must produce separate receipts. No flag is
being changed to true without executing those checks.

## Other conditions

The owner runs the sealed root proof personally before 09:38. Read its result
as written; no rerun after failure without approval. At this review its result
file was absent, which is pending evidence, not a failed probe.

The 09:45 page check and conditional 10:45 caps remain independent. Ask the
owner before any page-sequence start signal, and require fresh admission.
At 13:00, missing accepted parity/boundary/timing proof means skip both afternoon
windows and submit the Wednesday fallback for approval. No automatic rollover.
