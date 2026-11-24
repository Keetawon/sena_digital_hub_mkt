# Second owner attempt: unchanged execution source

Preparation only; no second runtime or tests have run. This is the one newly approved attempt for tonight, using ID `joined-20261124-02`. The first attempt remains a STOP reported during admission because of a local IDE process; its seal, consumed marker and result are unchanged.

The lead performs fresh normal-user Windows/Linux admission and confirms the serial lease first. Owner only: start no later than 21:45 Bangkok on 24 November, allowing the complete 15 minutes to finish by 22:00. There is no automatic retry or Wednesday carry-over in this new seal.

All 22 sealed execution inputs are byte-identical to the first seal and final 26-case/syntax check snapshot. `owner-attempt2.sh` is the original owner launcher with exactly one changed line: the invocation working directory. Its UID, input/source hashes, absent consumed-marker and WSL_INTEROP checks, root command, limits and systemd properties remain byte-for-byte unchanged. The mechanical one-line diff is `owner-launch-path-only.diff`. **Do not invoke the copied owner-launch.sh**, because that intentionally retains the old path.

From the normal Ubuntu terminal, after the lead's admission signal:

```bash
cd /mnt/c/Users/keetawatw/.codex/worktrees/9927/sena_digital_hub_mkt/artifacts/timing-preparation-20261124/joined-attempt2
printf '%s  %s\n' '4a1ce3ab334029a0a9980af5048d37d4892b86280aabff5d590009a8546a99b7' owner-attempt2.sh '19e3db872497c6c85c4460249ec3513bd13ecea56a450a7b656f53a29a1c562f' seal.json | sha256sum --check --strict
bash owner-attempt2.sh 19e3db872497c6c85c4460249ec3513bd13ecea56a450a7b656f53a29a1c562f
```

Proceed to the final command only if both checks say OK. Type any sudo password personally in that terminal; never send or store it. On a failure, preserve the result and stop without another attempt.

Result: `/home/keetawatw/hub-joined-evidence-20261124/joined-20261124-02/result.json`. The root-created result may require the owner's terminal to read; do not change permissions or source to work around that. Consumed marker: `joined-attempt2/owner-attempt-consumed.json`.

The unchanged backup bridge still uses its original pinned source in joined-v1. Only exclusive NEW backup folders for `joined-20261124-02-cal` and `joined-20261124-02-main` can be created there. No first-attempt file is overwritten.

All previous limits and evidence qualifications stand: 900-second outer, 840 operation (480 active + 300 tail + 60 reserve), shared 180-second ticket, guard/transport 50/55 seconds, boundary component at most 300 seconds. Real Hub aggregate 2304 MiB; local controller and DB have separate 2304 MiB limits; Windows backup memory is excluded. CPUs 0-3 and swap zero. Live target/TLS, pre-maintenance baseline and all hosted observations remain mandatory. No hosted readiness or capacity acceptance is claimed.

Seal SHA-256: `19e3db872497c6c85c4460249ec3513bd13ecea56a450a7b656f53a29a1c562f`. Owner handoff launcher SHA-256: `4a1ce3ab334029a0a9980af5048d37d4892b86280aabff5d590009a8546a99b7`. Reused pure receipt: `../joined-v1/checks/attempt2/result.json`, SHA-256 `571720d64c223524791c6bb254cec8ccd523e6ead44facda2fbc2bccf70f5f20`.
