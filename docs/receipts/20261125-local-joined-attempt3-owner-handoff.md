# Attempt 3 owner handoff: unchanged execution source

Preparation only; no attempt 3 runtime or tests have run. This is the one
pre-approved attempt from the owner's 25 November 08:05 instruction, ID
`joined-20261124-03`. Attempt `joined-20261124-02` was never launched and is
recorded as unrun and expired, not as a STOP. Attempt 1 remains the retained
preflight STOP. Earlier seals, markers and results are unchanged.

Owner start intervals, Bangkok, 25 November: **08:30-10:15** or **11:15-12:30**.
The controller refuses a start outside them. With the 900-second ceiling, a start
by 10:15 finishes by 10:30, before the 10:40 cap read-only assessment. For the
13:45/14:45 condition (a pass by 12:30), the practical latest start is 12:15.

All 22 sealed execution inputs and their limits/checks entries are byte-identical
to attempt 2 (and therefore to attempt 1). The seal changes only `attempt`,
`created_at`, `owner_start_intervals` and the provenance fields. Because a fresh
sibling folder is needed (the launcher refuses an existing consumed marker and the
attempt 2 seal must stay intact), `owner-attempt3.sh` again differs from the
original owner launcher by exactly one line, the invocation working directory;
see `owner-launch-path-only.diff`. **Do not invoke the copied owner-launch.sh.**

Fresh read-only checks, no hosted call and no runtime:

- Launcher pre-sudo checks re-run verbatim as uid 1000 at 08:15: both hashes OK,
  bash syntax OK, all 22 inputs match, no consumed marker, interop path present.
- Windows, 08:15:55-08:15:58: exact embedded sealed admission script clear;
  334 processes, zero SSH, 36 listeners, no forbidden listener.
- Linux, 08:15:59: sealed conflict predicates clear; 28 processes, 32 active
  services, three listeners. The shared serial flock was acquired and released.
  Attempt 3 evidence and backup folders do not exist yet.

From the normal Ubuntu terminal:

```bash
cd /mnt/c/Users/keetawatw/.codex/worktrees/9927/sena_digital_hub_mkt/artifacts/timing-preparation-20261124/joined-attempt3
printf '%s  %s\n' 'e5d8501a75fe8330187f7f8e411908f0cdb4d925b135c8085f63b42b1853c35f' owner-attempt3.sh '086fa5c161737a30f71d70d66dc6c3998bce1e7973e66768a75fec8494870b37' seal.json | sha256sum --check --strict
bash owner-attempt3.sh 086fa5c161737a30f71d70d66dc6c3998bce1e7973e66768a75fec8494870b37
```

Run the last command only if both checks say OK. Type any sudo password
personally in that terminal; never send or store it. On failure, preserve the
result, report it and wait; there is no further rerun.

Result: `/home/keetawatw/hub-joined-evidence-20261124/joined-20261124-03/result.json`.
Consumed marker: `joined-attempt3/owner-attempt-consumed.json`. Backups go only to
new `joined-20261124-03-cal` and `joined-20261124-03-main` folders.

All limits and evidence qualifications stand unchanged: 900-second outer, 840
operation (480 active + 300 tail + 60 reserve), shared 180-second ticket,
guard/transport 50/55 seconds, boundary component at most 300 seconds, 2304 MiB
memory limits, CPUs 0-3, swap zero. Live target/TLS, the pre-maintenance baseline
and all hosted observations remain mandatory. No hosted readiness or capacity
acceptance is claimed.

Seal SHA-256: `086fa5c161737a30f71d70d66dc6c3998bce1e7973e66768a75fec8494870b37`.
Launcher SHA-256: `e5d8501a75fe8330187f7f8e411908f0cdb4d925b135c8085f63b42b1853c35f`.
Path-only diff SHA-256: `cea04d6c137ef50e405cf61dc1b052cdb9b002feb5a251ac9ba7e91003792c5e`.
Owner decision SHA-256: `e8913e7dcd70884de6465927810e20335147c35d36a22e720806b0673c7da316`.
