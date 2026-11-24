# Local DB and backup component: diagnostic attempt

Result: LOCAL_DB_BACKUP_COMPONENT_VERIFIED_NOT_COMPLETE. Actual process exit 0. No hosted calls. The original v2 and v3 STOPs remain unchanged. All six identity comparisons passed before and after this backup; the diagnostic did not reproduce the v3 assertion failure, whose exact cause remains unproven.

| Measured component | Actual local duration |
| --- | ---: |
| Enclosing bridge attempt, including preparation and cleanup | 69.949 s |
| Protected custom dump, inventory, full readback, hash and identity checks | 7.506 s |
| Custom pg_dump archive only | 1.362 s |
| Full pg_restore readback only | 0.102 s |
| 88 to 94 rollback rehearsal and attestations | 1.441 s |
| Committed 88 to 94 batch and attestations | 1.915 s |
| Migration statements inside the committed body | 0.459 s |
| Both DB batches and their attestations | 3.356 s |

The synthetic corpus is **one project, zero FAQs and three assets**. This does not model hosted data volume. The archive is 2,929,136 bytes; SHA-256 `3fd655f405a61cf0186ef371c58ff2fdcee20aecdb6bf2d144630816d0b702ec`. It was stored with protected owner/SYSTEM access. Fixture credentials were generated only for this owned fixture; private temporary files and the owned database directory were deleted.

The actual Linux unit had MemoryMax 2304 MiB, CPUQuota 400%, affinity 0-3, swap 0, TasksMax 128, RuntimeMaxSec 900, OOM score +1000, OOMPolicy kill and Restart no. Peak was 556,421,120 bytes (530.64453 MiB); all high/max/OOM event deltas were zero. This Linux cgroup peak excludes the Windows client/controller processes and is not hosted capacity acceptance. The original 480-second operation deadline and 900-second outer deadline were not changed.

The same-port readiness step observed three ECONNREFUSED outcomes then connected after 776.33 ms. Its first connected socket completed the existing authenticated exchange. The receipt already contained fixture_run_id from initialization; the unchanged worker acknowledgement assertion passed.

Independent cleanup: unit absent/inactive with MainPID 0, cgroup absent, no owned database or Windows backup/controller processes, both attempt ports absent, Linux/Windows listener counts restored to 3/37, private tmpfs and database directory absent. Shared lease released at 15:44:11 Bangkok. No further run was performed.

**Full rollout timing remains NOT MET.** This component executed no shared 180-second host ticket, no boundary-guard callback, no capped frozen-package promotion, no six HTTP smokes, and no measured promotion reserve. It performed none of the three mutation-boundary backup rehashes. Local component times cannot substitute for those missing operations or prove the complete eight-minute active window. The preparation seal remains unchanged as historical source evidence; this receipt records the later checks and execution.

Evidence: `offline-checks-1/result.json` and its logs (17 Node tests and 3 Python tests passed; syntax passed), `execution-1.json`, `controller-runs/component-03-20261124/result.json`, the protected `runs/component-03-20261124/backup-receipt.json`, and `cleanup-observation/linux.json` plus `windows.json`.
