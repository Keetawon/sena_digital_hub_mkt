# Joined proof: retained preflight STOP and one fresh attempt

The owner reports that `joined-20261124-01`, launched at 17:54:40 Bangkok,
stopped within three seconds during Windows/Linux admission because of
**a local IDE process**. Hosted calls were zero and no runtime work started.
This is recorded as a preflight STOP, not a failed application or migration.

The original result remains at
`/home/keetawatw/hub-joined-evidence-20261124/joined-20261124-01/result.json`.
It has not been rewritten. A normal-user read returned Permission denied;
no permission, ownership or privilege change was attempted. The owner was
asked to paste the original JSON for its exact refusal code. Until then, the
cause and elapsed bound above are explicitly owner-reported evidence, not
an independently parsed result. The separately retained consumed marker
confirms start time `2026-11-24T10:54:40.325952+00:00` and the original seal.

The owner pre-approved exactly one new attempt after closing the process:
`joined-20261124-02`, tonight only, starting no later than 21:45 Bangkok.
A failure must be reported with no further rerun. The original seal
`b39badb5cc3a4534a403535ca22e3dc11dc3542ad1f93600598483439ec02dcb`
and consumed marker `46e63911c0c9e35a38103274c4524ce7e8f65fdd52a052abcec8722eb096276f`
were independently rehashed unchanged.

The new sibling directory preserves all 22 execution/source inputs byte for
byte. Their hashes and every limit were compared with the first seal. The
separate owner handoff launcher changes only its invocation working-directory
line; UID, all-input hashes, consumed-marker, interop, systemd properties and
all admission/assertion logic are unchanged. No source, limit or admission
rule was relaxed. The original launcher is retained but must not be invoked
for attempt 2. The unchanged backup bridge uses exclusive new attempt-2
output directories, so it cannot overwrite attempt-1 evidence.

Fresh read-only preflight passed:

- Windows, 18:02:53-18:02:55 Bangkok: the exact embedded sealed admission
  script passed; complete inventory, 376 processes, zero SSH processes,
  40 listeners and no forbidden test listener.
- Linux, 18:04:09 Bangkok: original sealed conflict predicates passed;
  complete inventory, 31 processes, 31 active services and three listeners.
  The existing shared flock was acquired and released successfully. No
  conflicting runtime, test unit or forbidden listener was observed.

These checks made no hosted call and started no runtime. No test suite was
rerun: the 26-case/syntax evidence applies to the byte-identical source.
The local serial lane is reserved for the owner; the owner launcher performs
its own fresh admission and takes the same lock again.

New seal: `19e3db872497c6c85c4460249ec3513bd13ecea56a450a7b656f53a29a1c562f`.
Handoff launcher: `4a1ce3ab334029a0a9980af5048d37d4892b86280aabff5d590009a8546a99b7`.
See the [owner handoff](20261124-local-joined-attempt2-owner-handoff.md),
[seal](20261124-local-joined-attempt2-seal.json),
[Windows preflight](20261124-local-joined-attempt2-windows-preflight.json) and
[Linux preflight](20261124-local-joined-attempt2-linux-preflight.json).
Runtime is still UNRUN. Tonight's hosted work stays cancelled and unarmed.
