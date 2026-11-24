# One owner local proof attempt

Prepared source checks: 26/26 contracts, six Node syntax checks, Python AST and bash syntax passed. Runtime is UNRUN. Previous STOPs remain unchanged. No hosted readiness or capacity claim is made.

Owner only, from the normal Ubuntu terminal. The lead must confirm the serial local lease is clear first. Start by 21:45 Bangkok on 24 November, or from 08:00 through 09:15 on 25 November. Allow the full 15 minutes; the run must end by 22:00 or 09:30 respectively. Do not run another local test or preview alongside it.

```bash
cd /mnt/c/Users/keetawatw/.codex/worktrees/9927/sena_digital_hub_mkt/artifacts/timing-preparation-20261124/joined-v1
printf '%s  %s\n' '64b293cddb2ddc58921b8f260fdea4c3427e72cb3d37a5bcd43fb9432bf71241' owner-launch.sh 'b39badb5cc3a4534a403535ca22e3dc11dc3542ad1f93600598483439ec02dcb' seal.json | sha256sum --check --strict
bash owner-launch.sh b39badb5cc3a4534a403535ca22e3dc11dc3542ad1f93600598483439ec02dcb
```

Only proceed to the final command when both hash checks say OK. The launcher verifies every source pin again. Type any sudo password personally in that terminal; never send or store it. This consumes the one approved attempt. On any failure, leave the result and do not rerun.

The output is `/home/keetawatw/hub-joined-evidence-20261124/joined-20261124-01/result.json`, with pre-cleanup diagnostics beside it. The consumed marker is `owner-attempt-consumed.json` beside the launcher. The lead reads the result and reports its status without relabelling a STOP.

Seal SHA-256: `b39badb5cc3a4534a403535ca22e3dc11dc3542ad1f93600598483439ec02dcb`. Launcher SHA-256: `64b293cddb2ddc58921b8f260fdea4c3427e72cb3d37a5bcd43fb9432bf71241`. Final source-check receipt: `checks/attempt2/result.json` (`571720d64c223524791c6bb254cec8ccd523e6ead44facda2fbc2bccf70f5f20`).

This attempt uses the original 900-second outer bound and 840-second operation representation (480 active + 300 tail + 60 reserve), the shared 180-second ticket, and guard/transport bounds of 50/55 seconds. The boundary component remains at most 300 seconds. The prepared cleanup is bounded within the original outer deadline.

The real Hub service aggregate is capped at 2304 MiB. The local controller and owned local database each have separate 2304 MiB ceilings; Windows backup memory is excluded. All measured Linux execution is restricted to CPUs 0-3 with swap zero. These are local fixture measurements, not VPS capacity acceptance.

The local baseline is genuinely collected while services are down, then the real baseline services start and actual maintenance stops them. The synthetic PREVIOUS pointer uses the same frozen package as CANDIDATE. External warehouse/job/config metadata and certificate completion timestamps remain labelled synthetic. No old-application-on-schema-94 compatibility or real certificate run is claimed.

The local test runs the shared transaction core and actual boundary/capture/transport functions, not the whole hosted apply outer entrypoint. Live target/CA/database/TLS, live pre-maintenance baseline, actual admission and both guards, package checks, warehouse/job/pressure observations remain mandatory in the approved hosted window. See `coverage-and-handoff.md` and `shared-source-map.json` for exact scope.
