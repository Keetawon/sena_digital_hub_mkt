# Owner decisions - 25 November 2026, 08:05 Bangkok

This receipt records the owner's instruction received at 08:05 Bangkok. Earlier
results, STOPs, seals and risk acceptances remain unchanged. No hosted operation
is armed by this receipt.

## Attempt joined-20261124-02

Attempt `joined-20261124-02` was **not launched**. Its sealed owner start window
ended 24 November 21:45 Bangkok. Record it as **unrun and expired**, not as a
STOP. Its seal
`19e3db872497c6c85c4460249ec3513bd13ecea56a450a7b656f53a29a1c562f` and
directory stay unchanged; no consumed marker exists for it.

## Pre-approved attempt 3

Exactly one attempt 3 is pre-approved with identical sources, limits, assertions
and admission. Only the attempt id, the seal and the owner start intervals change.

| Owner start interval (Bangkok, 25 November) |
| --- |
| 08:30-10:15 |
| 11:15-12:30 |

The run must not overlap the 10:45 cap window or any local runner. The lead
confirms the serial lease and Windows/Linux admission are clear, then sends only
the hash-check and launch command. A failure is reported and the lead waits; no
further rerun.

## 08:30 report

Show per slot whether its prerequisites are met:

- 10:45 caps can proceed on its sealed packet independently.
- 13:45 and 14:45 need a passing attempt 3 by 12:30, plus the operator approvals
  still listed as outstanding.

Batch any decision into that one report with a recommendation for each. Ask the
owner for GO before arming 10:45.

Commit receipts only (LF, docs/receipts), push and verify. Credential files are
not touched.
