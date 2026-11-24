# Approved cap successor checks: passed locally

After owner v3 finished and read-only cleanup confirmed no recorded API processes
or active synthetic units, a fresh Windows process/port inventory and the shared
Linux serial lock admitted the independent mocked checks. These did not rerun
the socket rehearsal, start services, bind a port or connect to the VPS.

| Suite | Actual result |
| --- | --- |
| Existing switch failure paths | 19 tests passed; assertions unchanged |
| Approved cap values and stale caller pins | 11 tests passed, including 3 stale-pin subcases |
| Existing caller capture checks | 12 tests passed; assertions unchanged |
| Existing boundary cases | 38 passed |
| Current baseline / scope cases | 21 passed |
| Transport-scope cases | 3 passed |
| Assembly / profile | 2 syntax checks and 1 static profile check passed |

Evidence:
`.local/hosted-content-rollout/marketing-20261124/cap-successors-v1/checks/`.
Each suite's original log, source hash, log hash and actual exit code is retained
in `result.json`. The test runner prohibits subprocess/network/listening-socket
operations inside the mocked checks. No live admission or successful hosted
receipt was created.

New sources remain separately sealed: switch-v4, caller-v3 and boundary-v6.
The approved 2304 MiB allocation and updated inventory pins are exercised by
these checks. Wrong old API/worker caps, changed file metadata, mismatched kernel
caps, foreign hierarchy, wrong OOM score, automatic restart and stale caller
pins are refused. The four unchanged configuration files, including certificate
protection, remain unchanged.

These are **pure/mock and static results**, not the required complete
LOCAL_FIXTURE runtime integration, real transport containment or migration-to-
promotion timing proof. The array-valued timer parser gap remains proposed for
the 16:00 decision batch. Socket v3 remains STOP and is not superseded by these
passing checks. No product gate is repeated or implied.
