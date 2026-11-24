# Owner decisions labelled 24 November 13:40 Bangkok

These decisions supersede the prerequisite acceptance and calendar outlook only.
Both socket STOP receipts remain unchanged, and no hosted operation is armed.

## Socket/dependency risk acceptance

The owner accepts the retained v2/v3 evidence as a **TEST-only residual risk**:
scenarios 1–4 passed twice; v3 reached API `Result=oom-kill` at 1248 MiB,
`NRestarts=0`, socket inactive/dead, all recorded PIDs subsequently absent, and
zero parent-local high/max/OOM events. Hierarchical parent counters still include
the API's events and are not zero. The missing post-failure JSON is attributed
to the harness-only in-cgroup ExecStopPost being killed during OOM.

The owner's accepted inference is that post-OOM non-reactivation uses the same
Restart=no/BindsTo mechanism proved in the other failure modes, and explicit
recovery uses the normal-start path proved in scenario 1. This is **owner risk
acceptance, not a rewritten test pass**. No v4 or further socket attempt.

The cap operator must still verify the effective approved limits, hierarchy,
Restart=no, cleared RestartForceExitStatus, OOMPolicy=kill, socket dependency
ordering/BindsTo, singleton start and application/Exec +1000 scores live. Any
mismatch is STOP. Do not force a hosted failure, OOM or load test to verify them.

The finding remains: with swap zero, above the API's 1024 MiB high threshold,
allocation can stall before the hard kill; one 16 MiB allocation took 84.9 s.
**Any Hub cgroup high event remains a hosted STOP.** No cap or timeout change.

## Conditional evening attempt and fallback

| Date/time, Bangkok | Operation |
| --- | --- |
| 24 November 17:30 | Readiness report: every prerequisite's actual result and seal; one numbered list of open decisions with recommendations, including the boundary timer proposal |
| 24 November 18:45–18:59 | Caps, only after complete readiness and an explicit owner go before arming |
| 24 November 19:45–19:59 | Staging without switch, dependent on successful caps and fresh admission |
| 24 November 20:45–20:59 | Backup, migrations 89–94, promotion, smoke and tail; genuine live boundary/transport checks after maintenance and before migration commit |

All Wednesday-plan rules, proof requirements, unchanged source/package/migration
pins, finite budgets, backups, rollback/maintenance behavior and STOP policies
apply. No proof may be compressed, skipped or weakened for tonight. The 17:30
solar refresh and all descendants must actually finish plus five settled minutes;
also avoid :20, :30, :39 and all other excluded work. The owner holds warehouse
deployments until 22:00; any observed identity drift still means STOP.

If anything is missing at readiness, **do not run tonight**. Wednesday 25 November
10:45 caps, 13:45 staging and 14:45 switch remain approved conditional fallbacks;
no slot moves automatically. Report before and after each hosted step.

If tonight promotes successfully, the mandatory owner ten-page recheck moves to
**Wednesday 09:45** under the same page-check rules, before marketing review.
No owner page check tonight. If tonight does not promote, retain the previously
approved Wednesday chain and dependent 15:45 recheck. The page-start signal
still requires the owner and fresh admission. Admin peak at or above 256 MiB,
any hard-cap hit or any pressure STOP requires stopping and a rebalance proposal.

The certificate-cap TEST-only risk acceptance remains; verify settings live and
observe the next ordinary renewal passively. The worker/API rebalance stays
128/160 and 1024/1248 MiB, aggregate 2304 MiB. The icon fix remains separate;
the sealed release stays `f07f7cb-media-dd33d4d7f14b`. No hosted calls, secret-file
access or warehouse changes are authorized by writing this receipt.
