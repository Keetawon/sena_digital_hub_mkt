# Owner page check: incomplete render evidence, caps not admitted

The owner's initial report gave **10:03 Bangkok on 24 November 2026**.
They reported slow loading across nearly all pages, an oversized information
icon, and errors on home, brand overview, publishing and approvals. HTTP status
codes and exact durations were not supplied. A subsequent clarification says
all ten pages were visited, each settled in less than twenty seconds, and none
was still loading at the 09:51:30 cutoff. A request to
investigate 500/503 responses is not evidence that those codes occurred.

The read-only observation completed at 09:56:31. Its pressure samples and
unchanged warehouse health are retained in
[the observation receipt](20261124-owner-page-observation.json). Admin lifetime
peak was 199.66 MiB, API 137.59 MiB, worker 115.19 MiB and broker socket 0.34 MiB.
The worker lifetime peak exceeded its proposed 96 MiB high threshold but remained
below its 128 MiB hard limit; no new event occurred during observation. PSI was
unavailable and is not treated as passed. No production counter was reset.

The initial 10:03 time was later than the retained sampling interval; the
follow-up clarifies that no request remained in flight at the cutoff. The
retained 09:51:30-09:56:30 tail therefore covers the owner-reported idle period,
although individual render times were not measured. The four error-only renders
do not establish successful-page memory peaks. Consequently the owner page
check is **not accepted for cap admission**, regardless of the admin peak being
below 256 MiB. The conditional **10:45 cap occurrence will not be started**.
No cap, service, release, database, warehouse or job change was made. No further
hosted observation or automatic replacement slot is authorized by this receipt.

The prepared candidate and the live W1-W5 application must be distinguished
when investigating the owner findings. Initial investigation will use local
source and retained evidence. The sealed release package is not changed by
this report. The separately approved extraction parity rehearsal passed;
full boundary integration, actual transport containment and migration-to-promotion
timing remain unproved. Afternoon rollout prerequisites remain NOT MET.

The owner was asked to leave the hosted tab idle. Their clarification resolves
the unvisited/in-flight uncertainty; it does not retract the four error reports.
A new observation, replacement window or hosted action needs the required
owner approval and fresh admission. Earlier raw receipts remain unchanged.
