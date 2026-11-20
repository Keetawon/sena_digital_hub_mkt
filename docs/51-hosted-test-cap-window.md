# Saturday 21 November: proposed cap sequence

PLAN ONLY. No new reservation is approved and no hosted change was made.
W9 and W9.1 are delivered locally. The exact six-file proposed-config.diff
remains conditionally approved; its values and fail-safe behavior are unchanged.

Proposed Bangkok reservations: **09:45–09:59 owner page check**, followed by
**10:45–10:59 cap application only if the page check is complete and accepted**.
These avoid the scheduled 06:00/11:00/17:00 refresh groups. They are not yet
evidenced quiet intervals. Both need separate owner window approval and fresh
read-only admission through the existing docs/46 route. If there is insufficient
time to verify and finish the five-minute tail, do not begin application.

## Current blocker and admission

The 19 November check was skipped: the non-exempt conditional cgid job recurred
about every three minutes. Fourteen paired observations gave a largest gap of
180.335 seconds, versus 1020 seconds for five-minute settling plus twelve clear
minutes. Its conditional no-op outcome/descendant completion was not established.
The health-monitor and line-alert overlap exceptions applied only to the
19 November page check; neither extends to Saturday or cap application.

Therefore **Saturday execution is currently NOT ADMITTED**. Before seeking a
usable window, a short read-only review must establish actual outcomes and
descendants of the cgid job and current schedule. If it still prevents clearance,
skip and report; do not delay jobs, silently exempt them, shorten settling, or
apply caps anyway. Any new overlap exception is a separate owner decision.
The DW monitor's observed exit 2 remains an owner/DW-side issue, not Hub work.

Avoid :20 customer, :30 backup housekeeping, :39 cleansessions and descendants,
certificate windows, refresh groups and unexpected work. Require actual end
plus five settled minutes. For the page check, start by 09:47 with twelve clear
minutes to the next excluded job and the reservation end. Unknown completion
or resource coverage means skip. Read no environment/credential files; install
no watcher and reset no peak/event counters.

## Owner page sequence and evidence

Use the ten exact URLs in quiet-window-proposal-20261118.md: home; one project
overview, data, FAQ, promotions and history; brand overview; Residential business;
publishing; approvals. Sign in personally in one tab and wait for the operator's
start signal. Open each once, normally about twenty seconds. If still loading,
wait for completion/error up to sixty seconds; no retry/reload/extra tab.
Stop for slowness only after two pages exceed sixty seconds; six minutes total,
then five-minute tail and one-minute reserve. No upload/edit/approve/publish.
Unvisited pages and error-only renders are evidence gaps, not successful peak checks.

1. https://72.62.253.205/home
2. https://72.62.253.205/website/project/prj_2717d619f98f451980ef273c99bd99f6?tab=overview
3. https://72.62.253.205/website/project/prj_2717d619f98f451980ef273c99bd99f6?tab=data
4. https://72.62.253.205/website/project/prj_2717d619f98f451980ef273c99bd99f6?tab=faq
5. https://72.62.253.205/website/project/prj_2717d619f98f451980ef273c99bd99f6?tab=promotions
6. https://72.62.253.205/website/project/prj_2717d619f98f451980ef273c99bd99f6?tab=history
7. https://72.62.253.205/website/brand/brd_64325839308d4e479d7f5b7d0bf4ca71?tab=overview
8. https://72.62.253.205/website/business/residential?tab=overview
9. https://72.62.253.205/publish
10. https://72.62.253.205/home?task=approval

Before and after: API, admin, media worker and broker MainPID, cgroup identity,
current/lifetime-peak memory and memory events. Identify a shared API/broker
cgroup rather than double count it; socket unavailable counters remain explicit.
Same PID/cgroup required. Compare admin peak with 256 MiB high / 384 MiB hard,
and API with 1024 / 1280 MiB. Admin peak above 256 MiB requires a rebalanced
proposal inside the 2304 MiB aggregate and approval before caps. Record all other
service peaks and any incomplete evidence for owner review.
An observed service peak at or above its proposed hard cap requires review
before application; do not silently raise a cap or claim an error-page render
proves the corresponding successful page's peak.

## Exact protection and application

| Unit | MemoryHigh MiB | MemoryMax MiB |
| --- | ---: | ---: |
| API | 1024 | 1280 |
| Media worker | 96 | 128 |
| Admin web | 256 | 384 |
| Broker socket | 4 | 8 |
| Certificate renewal | 96 | 128 |
| Sole transient TEST maintenance operator | 320 | 376 |
| Parent sena-hub-test.slice | 2048 | 2304 |

All have swap maximum zero. Persistent TEST application/Exec processes use
OOMScoreAdjust=1000, OOMPolicy=kill and Restart=no as in the approved diff.
The socket has the approved BindsTo dependency; no added After edge. Its short
systemd-internal ownership helper does not inherit the execution-context OOM
adjustment; do not change shared systemd or claim that exception is +1000.

Arithmetic: 1280+128+384+8+128+376 = 2304 MiB. From the measured 15.362297 GiB
host, reserve warehouse cache 7.519035 GiB + Hub 2.25 GiB + other services
1.5 GiB = 11.269035 GiB, leaving 4.093262 GiB, above the 3.840574 GiB
25-percent reserve. This is an allocation allowance, not a warehouse cache
guarantee. The Docker postgres container is production ETL and is excluded.
Never cap, restart, configure or change it. No local Hub PostgreSQL cap is applied
to that container; the Hub TEST database is external.

Use the exact apply/verification/rollback sequence in interim-caps-review.md,
with the pressure paragraph below superseding its obsolete zero-swap wording:

1. Fresh release/schema, ownership, job, health and pressure admission; confirm
   six target paths absent and unchanged approved configuration hash. Verify
   local socket/dependency rehearsal evidence before arming the operator.
2. Stage only the six nonsecret files and validate systemd syntax. Stop TEST
   admin, worker, socket, API; verify descendants gone and renewal inactive.
3. Install exact files, daemon-reload, start parent and verify hard/swap limits.
   Start socket/API as one instance, then worker and admin. No release/DB switch.
4. Verify effective unit settings and actual hierarchy, byte caps, every TEST
   application/Exec descendant's +1000 score, no unexpected restart, current and
   lifetime peak/event deltas. Check existing health/login, anonymous 401/no-store
   and TLS. Check renewal properties without forcing it to run.
5. Verify warehouse remains healthy/running, same identity, no OOM/restart;
   finish the five-minute pressure/job observation tail within the approved window.

## STOP and rollback

STOP if any sample has MemAvailable below 3.84 GiB; operation swap-used growth
exceeds 64 MiB; swap-out exceeds 100 MiB per five minutes; any allocation stall
or direct reclaim increases; available PSI some avg10 exceeds 10; any Hub cgroup
high/max/OOM event; kernel OOM; warehouse unhealthy or OOMKilled. Record smaller
swap deltas, including swap-in alone; they are not STOPs. Missing PSI is disclosed.

Before activation, remove only newly installed exact hash-matched six files if
validation/install fails; leave already stopped TEST down pending direction.
After activation, fail safe by stopping TEST admin/worker/socket/API and retaining
protective caps. Report the outage; do not auto-restart or restore unlimited caps.
No database restore, warehouse change, load/stress test or new release is involved.

Evidence: page-check-afternoon-decision-20261119.json;
observations/20261119T060240Z-window-provenance.json;
observations/20261119T060910Z-cgid-condition.json; proposed-config.diff.
Fresh page-check peaks and job admission are pending, not inferred from idle peaks.

Approved configuration diff SHA-256: `b0d532a7b2e46d7a2719aff58334e4dfa52d2abf8a716fe13da21d3a428c7b87`.
Original local proposal: `.local/hosted-capacity-w9-20261116/interim/proposed-config.diff`.
