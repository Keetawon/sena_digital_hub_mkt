# Pre-maintenance baseline collector proposal — not armed

Purpose: supply the genuine initial baseline that boundary-v7 requires before maintenance. Existing cap/staging captures are not sufficient and are too old for the promotion interval. No accepted operator, permission, application, migration, hosted setting or warehouse component changes.

`baseline.py` is a proposed capped helper entrypoint, not a hosted launcher. It verifies live API/admin/worker state and the listening broker, actual main PIDs/cgroups, restart count, the single API/admin listeners at 18000/13000, current release and exact applied caps. It never calls, imports as an executed action, replaces or monkeypatches require_down. That remains exclusive to the existing post-maintenance guard.

The collector composes pinned existing read-only definitions: current passive identity/job/process/counter source; current scope classifier; approved v7 cron/timer observation block; switch-v4 properties, cap snapshot, pressure, members, metadata and listeners; the existing admitted protected hash-only digest/metadata definitions. Protected bytes are neither parsed nor emitted; the exact existing fixed-file list and read-only hidden/bind namespace remain mandatory. There is no new credential reader.

The proposed helper uses the existing guard memory/CPU/task/swap/OOM/read-only profile, a finite 50-second service ceiling and 45-second internal read deadline. It requires actual exact transport ancestry, current complete local SSH preflight, no second maintenance helper and positive effective profile checks. The only output is sanitized evidence. The helper does not install anything or alter a running service.

Collected evidence includes an actual journal cursor/boot/timestamp and bounded absolute journal coverage, actual cron/timer identities, all excluded-service completion timestamps/result/empty scopes, five settled minutes, process provenance, warehouse identity/health, parent counters, protected and nonsecret fingerprints, actual caps and live service generations. Unknown or missing evidence is STOP. Initial ADMITTED is produced only after the approved core complete_observation check and owner-baseline identity comparison succeed; no ADMITTED input fixture is accepted.

## Retained-evidence gaps

The nonsecret retained observation review found:

- `interim/observations/20261118T004120Z-cron-identities.json` records the root crontab's exact cgid command hash/schedule and the excluded cleansessions command hash/schedule. It does not provide the complete cron-file fingerprint inventory or service-to-cron-file mapping required by the guard.
- The retained observations' process_provenance rows did not establish active health/line-alert process names in their exact service cgroups. Current source/unit command identities are proven, but deriving a broad process-name exemption from a unit name would be wrong.
- The current owner-page capture contains actual service/timer rows and generic process snapshots, but no complete `cron_units`, `exception_process_names` or `cron_schedule_hashes` review object.

Accordingly `request.proposed.json.reviewed_mapping` is null. Missing cron/process maps and their provenance remain an explicit STOP. The v1 comparison against prior reviewed `cron_schedule_hashes` was a NEW proposed requirement, not an owner decision or an existing core requirement. V2 removes that extra equality gate from collection. The actual contract needs a genuine reviewed first baseline and unchanged subsequent configuration; v2 records the observed first cron fingerprints for that existing continuity check. No new approval gate is introduced. Any needed mapping-evidence decision can be batched for 08:30; no fresh hosted read has been performed tonight. Same three existing overlap exceptions only; names alone never prove process ownership.

The lead's existing source-pinned SSH/capture wrapper still needs to bind this new phase's genuine original output, source/request hashes and its independently checked external seal. No live caller is armed by this helper entrypoint. Protected hash authority is the existing admitted mechanism, with no scope expansion. The new baseline phase is an explicit proposal for the 25 November 08:30 decision, not an additional approval silently imposed on accepted cap/staging operators.

## Checks

48 focused pure/negative cases are prepared in `test_baseline.py`: request authority and complete local inventory; exact completion/settling evidence; positive live-state checks; missing maps; no maintenance mutator selection; exact pinned definition/block extraction. **Not run**. No syntax/runtime/hosted pass is claimed. Parent holds the serial lane for the one owner-launched joined attempt; this proposal will wait for a separate pure-check lease.

The review command, only after a lease grant, is the usual normal-user shared-flock/complete-inventory bridge in this folder. No service, port, root launch or hosted call belongs in that check.

## V2 admission-contract correction

V1 and its seal remain unchanged. V2 adds `approved_overlap_identities_verified` and `heavy_jobs_settled` to the initial receipt required by the unchanged switch. They are derived only after the pinned identity check, the actual owner-identity comparison, and revalidated completed-job/settling evidence succeed. Missing, failed or mismatched evidence cannot produce a passing flag. Fourteen added tests exercise that derivation and the exact admission/freshness predicate extracted from the unchanged switch source; no switch assertion or expected value is edited. These tests remain unrun pending the lead's serial lease grant.
