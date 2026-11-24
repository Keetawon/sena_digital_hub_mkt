# Local socket/dependency rehearsal: owner terminal handoff

Prepared only; no runtime rehearsal or hosted call has occurred. The owner's
standing rule requires the owner to enter any sudo password in their own Ubuntu
terminal. No password is requested, stored or read by these files.

This successor uses the 10:45 approved cap allocation, including API 1248 MiB
hard and worker 128/160 MiB. Original proposals, operators and receipts remain
unchanged. Its source directory is
`.local/hosted-capacity-w9-20261116/interim/socket-rehearsal-v2-20261124/`.

Preparation: 13 local checks passed; all three Python sources compile; eleven
generated runtime files passed `systemd-analyze verify` with no diagnostics.
The first static verification retained warnings because Windows-mounted files
appeared executable/world-writable. Identical bytes checked on the Linux
filesystem with mode 0644 passed the same assertions. Both receipts remain.
Neither static check loaded or started a service.

The one-attempt launcher repeats Windows process/port and Linux service/port
admission, holds the local serial lock, and requires at least 3 GiB available
inside WSL. It creates only new, uniquely named synthetic runtime units and a
new local fixture directory. No application, database, account, package,
credential, warehouse or network endpoint is used. It checks normal start,
startup failure, abrupt exit, queued Unix-socket traffic, contained child OOM
and explicit recovery. Expected synthetic API OOM is isolated under the local
1248 MiB API and 2304 MiB parent caps; it is not a hosted pressure test.

The controller has a 300-second bound (320-second outer wait), 376/320 MiB,
four CPUs, swap zero, 32 tasks, +1000 OOM score, OOMPolicy=kill and Restart=no.
Actual kernel caps, hierarchy, process scores, failure/restart state and memory
diagnostics are retained before assertions. Cleanup stops only this attempt's
synthetic units and removes only its unchanged runtime files. A failure stays
visible; do not rerun without review. This command accepts 24 November before
16:00 Bangkok only. It never connects to the VPS.

In the owner's Ubuntu terminal, verify both lines below, then run the launcher
only if they report `OK`:

```sh
cd /mnt/d/Personal/workspace/sena_digital_hub_mkt/.local/hosted-capacity-w9-20261116/interim/socket-rehearsal-v2-20261124
printf '%s\n' '9fbda31308eb592baf6ca7344fb351b5f8fd595cbea33a7abc8434534e2cdee9  launch-owner.py' '64a585a583722ee28af933a8c3e52b4df802307937fca9765f970eba254a6c66  source-seal.json' | sha256sum -c -
sudo /usr/bin/python3 -B ./launch-owner.py --seal-sha 64a585a583722ee28af933a8c3e52b4df802307937fca9765f970eba254a6c66
```

Result: `owner-result.json` beside the launcher; detailed diagnostics under
`/home/keetawatw/hub-release-build/cap-socket-v2-20261124/output/`.
The launcher verifies its complete source inventory, approved diff, socket
source and Windows lease-check hashes before any runtime work.

Limits of the proof: local systemd is 255; retained VPS evidence identifies 252.
Synthetic behavior is not application memory capacity. The certificate fixture
checks cap settings only, not renewal capacity. Hosted transport containment,
live boundary admission and migration-to-promotion timing remain separate.
