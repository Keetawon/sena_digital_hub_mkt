# Socket v2 STOP retained; one corrected v3 prepared

The owner launched v2 at 11:06:52 Bangkok. It ended at 11:07:41 with **STOP**:
`failed_graph_did_not_stop` in scenario 5. Scenarios 1–4 passed; scenario 6 was
not reached. The original result is preserved byte-for-byte as
`20261124-socket-v2-owner-result.json`, SHA-256
`db2151f9ddba755102d01fd2dc4bf77f1baef24d0df3fa343dddbcd6647c954a`.

The API remained active after the 40-second wait. Its cgroup recorded **4,738
high events, zero max/oom/oom_kill events**, and a 1,159,147,520-byte peak
(1105.45 MiB). The parent cgroup's sampled peak was 1,170,599,936 bytes
(1116.37 MiB), with zero **local** high/max/OOM events. Its hierarchical high
counter includes the child's events; do not call that counter zero. Cleanup
reported owned file hashes matching and no remaining active synthetic units;
the stop command's exit code 5 remains visible in the original receipt.

Finding for the Wednesday plan: with swap zero, API MemoryHigh=1024 MiB can
throttle allocation below MemoryMax=1248 MiB. This test did not reach or prove
the hard-kill path. Crossing high is not an immediate fail-fast kill; requests
may stall. The existing hosted STOP on **any Hub high event** remains unchanged.
No hosted capacity acceptance or cap change follows from this local result.

## Owner-approved v3 correction

One owner-launched attempt before 16:00; no further rerun if it fails. New source:
`.local/hosted-capacity-w9-20261116/interim/socket-rehearsal-v3-20261124/`.

The cap diff stays exactly
`13403eb7f0d308374c38cdf28ade583bfec086992f09f1fdfcd31ef0a7ab13be`:
API 1024/1248 MiB, worker 128/160 MiB, all other settings unchanged, parent
2048/2304 MiB, swap zero. No limit is lowered and no swap is added.

Scenario 5 first runs the single allocator while retaining per-allocation timing
and a half-second memory/event timeline. Eight additional contained children are
created before pressure; they wait until 25 seconds before each attempting a
128 MiB allocation. This is intended to reach the unchanged hard limit despite
per-task high throttling. It is an unverified test correction, not a claimed pass.
The API fixture has a 200-second lifetime bound; the OOM observation allows
175 seconds inside the unchanged 300-second controller limit. The outer wait
remains 320 seconds.

New assertions require a separately observed pre-burst high interval of at least
five seconds with no max/OOM then; actual subsequent max, oom and oom_kill
increments; every burst child in the same API cgroup with +1000 score; and no
surviving child after group kill. Diagnostics are written before acceptance.
All existing failure/restart, socket, singleton, containment and parent-local
pressure assertions remain. Scenarios 1–4 and 6 are byte-identical; the original
`verify_failed` and `verify_active` functions are AST-identical.

Preparation passed 13 checks, three Python syntax checks and clean Linux unit
syntax. No v3 runtime has been started. The reused syntax-check receipt's
reference to the Windows-mounted warning points to **v2's** retained static
check; v3 itself used Linux-owned 0644 files directly. No earlier receipt is
rewritten. The full runtime result remains pending the owner launch.

Launcher SHA-256:
`a53ad64f92c5d515d234cd096353d3aa9350bb1e533a88652f8343cb47123078`.
Source-seal SHA-256:
`a134f9465b45d11bc12548b30e49324b9b46c2d7620e62574a0dc2ebd015f58f`.

Owner terminal commands (continue only if both hashes report OK):

```sh
cd /mnt/d/Personal/workspace/sena_digital_hub_mkt/.local/hosted-capacity-w9-20261116/interim/socket-rehearsal-v3-20261124
printf '%s\n' 'a53ad64f92c5d515d234cd096353d3aa9350bb1e533a88652f8343cb47123078  launch-owner.py' 'a134f9465b45d11bc12548b30e49324b9b46c2d7620e62574a0dc2ebd015f58f  source-seal.json' | sha256sum -c -
sudo /usr/bin/python3 -B ./launch-owner.py --seal-sha a134f9465b45d11bc12548b30e49324b9b46c2d7620e62574a0dc2ebd015f58f
```

No hosted calls, release changes or credential-file access. Read the new result
when the owner reports completion; retain any failure in the 16:00 report.
