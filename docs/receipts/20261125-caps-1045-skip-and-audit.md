# 10:45 Caps Read-Only Admission STOP and Slot Skipped - 25 November 2026

The Wednesday 10:45-10:59 Bangkok cap slot stopped during read-only admission
at 10:44:07 Bangkok and was **skipped** per the sealed rules, with no retry,
no automatic move, zero hosted mutations, and zero credential reads.

## What happened

1. Pre-start local checks at 10:40 passed with zero `ssh.exe` processes, zero
   local runners, zero forbidden listeners, and all `caps-exec-v1` pins verified.
2. At 10:44:05, `caller.proposed.py --capture-readonly-admission` ran PowerShell
   `local-preflight.ps1`, which passed local SSH verification (`all_ssh_count: 0`,
   `matching_count: 0`) and emitted `observed_at = "2026-11-25T03:44:07.5952963Z"`
   (7 fractional second digits from `[DateTime]::UtcNow.ToString('o')`).
3. Local Python validated it (Python 3.13 accepts 7 fractional digits) and sent
   one read-only SSH admission call to TEST.
4. Remote `observer_adapter.proposed.py` (`instant()`, line 37, called by
   `Observer.__init__` line 195) ran `datetime.datetime.fromisoformat(...)` on
   the VPS's older Python runtime (< 3.11, which accepts only 0, 3, or 6
   fractional digits) and raised:
   `Invalid isoformat string: '2026-11-25T03:44:07.5952963+00:00'`.
5. Remote exit code was 1 (`hosted_mutations: 0`, `credential_files_read: 0`,
   1.02s elapsed). The runner aborted immediately without invoking
   `--execute-approved-caps`.

## Verification after stop

- `caps-exec-v1/captures/20261125-1045-caps/apply` does not exist.
- Zero `ssh.exe` processes and zero cap runner processes remain.
- `caps-final-v1` and all pinned operator files remain unmodified.
- All remaining Wednesday slots (13:45, 14:45, 15:45) were already skipped under
  [Option 2](20261125-owner-0918-option2-caps-only.md). **No hosted operation
  remains armed today.**

## Fix item for next prepared round

Normalize subsecond precision to 6 digits (or format with
`'yyyy-MM-ddTHH:mm:ss.ffffffZ'` in `local-preflight.ps1` and/or truncate >6
fractional digits inside `instant()` across operators before calling
`fromisoformat()`), plus include a Python 3.10-style 7-digit fractional-second
negative/normalization test alongside the `.socket` `MainPID` and
`systemd-analyze verify` fixes deferred for the next round.
