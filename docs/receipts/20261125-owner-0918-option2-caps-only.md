# Owner decision - 25 November 2026, 09:18 Bangkok (Option 2: 10:45 caps only today)

Following the [Attempt 4 STOP and socket property audit](20261125-local-joined-attempt4-stop-and-socket-audit.md),
the owner selected **Option 2** at 09:18 Bangkok: run only the independent
10:45-10:59 cap slot today and skip the remaining afternoon slots.

## Today's slot status

| Slot | Decision today | Notes |
| --- | --- | --- |
| 10:45-10:59 caps | **Remains armed** | Execution copy `caps-exec-v1`, packet `110d919fbc517b7026ad77096839583be01f60f79e00dd2736efe820886ca1c5`, source seal `2f7c44b05eac8bfec48f9e3dd1dcb4234f8276f6ba6582514fa41c913df86e16`. Confirmed unaffected by the `.socket` `MainPID` defect. Subject to fresh local admission under 60s old, 10:45-10:46 apply cutoff, and all live cap checks. |
| 13:45-13:59 staging | **Skipped today** | Does not move automatically. |
| 14:45-14:59 promotion | **Skipped today** | Does not move automatically. |
| 15:45-15:59 owner pages | **Skipped today** | No promotion today. |

## Deferred work and cleanup reminder

- No Attempt 5 is prepared or sealed today.
- The narrow `.socket` `MainPID`, `systemd-analyze verify`, and single `os.sync()`
  successor fixes across joined-proof, boundary/switch, and staging operators,
  along with the pre-maintenance baseline mapping and capture wrapper, are
  deferred to the next scheduled round.
- Attempt 4 root leftovers (`/srv/sena-hub-test`,
  `/run/hub-joined-joined-20261125-04`, `/run/systemd/system/sena-hub-test-*`)
  await the owner's safe `sudo` cleanup command. No files or worktrees were
  deleted during the disk audit.
