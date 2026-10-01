# Local DW TEST handoff and motion verification — 1 October 2026

Scope: owner-authorized Task 0 → A → B → C. P1/P2 behavior and
`sena_h_approved=false` are unchanged. External systems and the DW repository remain
read-only. P3/P4 deliverables are design documents awaiting their own approvals.

## Motion integration (Task 0)

`git fetch origin` exited 0. `git merge --ff-only
origin/claude/stoic-ramanujan-us11jk` exited 0:

```text
Updating e029630..4886981
Fast-forward
15 files changed, 292 insertions(+), 60 deletions(-)
```

This brings in `0d6930b` and `4886981`. No merge conflict, rebase or force push.
The owner's follow-up requires the motion and Task A handoff to reach `origin/main`
before the design documents. The first normal push exited **0**:

```text
To https://github.com/Keetawon/sena_digital_hub_mkt.git
   e029630..4886981  main -> main
```

The merged motion contract is [doc 22 §3](../22-hub-assistant-and-ui.md#3-hub-motion-and-interaction-spec).

Local verification against the rebuilt production app, each exit **0**:

```text
> npm.cmd run typecheck --prefix apps/admin
> sena-hub-admin@0.1.0 typecheck
> tsc --noEmit

> npm.cmd run build --prefix apps/admin
▲ Next.js 16.3.5 (Turbopack)
✓ Compiled successfully in 8.2s
Finished TypeScript in 5.9s ...
✓ Generating static pages using 10 workers (3/3) in 791ms
Warning: Failed to find font override values for font `Google Sans`
Skipping generating a fallback font.

> npm.cmd run test:ui
Running 73 tests using 1 worker
73 passed (4.7m)
```

`PLAYWRIGHT_CHANNEL=msedge` was set explicitly for this run. Both new motion tests,
P1/P2 workflows and residential regressions passed. The existing Google Sans metric
warning and `NO_COLOR`/`FORCE_COLOR` warning remain. No human Thai readability
acceptance or full new accessibility audit is claimed.

The first `dev:db` startup failed in the sandbox with
`uv_os_get_passwd returned ENOMEM`; the approved local-server retry outside the
sandbox started the existing synthetic PostgreSQL successfully. No data reset or
remote migration occurred.

## Local reader and fixtures (Task A)

Implementation: `scripts/provision-dw-reader.mjs`, `dev:dw-reader`, SQL regression
`supabase/tests/dw_reader.sql` and the test-db runner integration. The verifier uses
an actual fresh login, not only an administrator session with `SET ROLE`.

`npm.cmd run dev:dw-reader` exits **0** and prints only:

```text
D:\Personal\workspace\sena_digital_hub_mkt\.local\dw-reader.json
```

A direct Node assertion run exercised incorrect/remote target refusal, exact
credential-file replay, explicit rotation, old-password rejection and fresh-login
permissions. Actual output, exit **0**:

```text
PASS: remote/incorrect targets refused; replay preserves credential file; explicit rotation replaces password; old login rejected; fifteen-view and ACL checks passed
```

Development checks initially exposed PostgreSQL's inet text `/32` suffix and
non-updatable joined-view SQLSTATE `55000`. The verifier now uses `host(inet_server_addr())`
and checks write ACLs independently before accepting a joined-view write denial.
Neither error required a migration or relaxed permission.

Connection instructions: [doc 11](../11-local-development.md#local-dw-test-reader).
Contract and counting rules: [doc 23 §8](../23-media-lines-and-memo-register.md#8-implemented-read-only-dw-export-contract)
and [doc 24](../24-card-costs-and-recurring-commitments.md).
Fixture provenance, row counts and exact source checksums are in the
[manifest](../../supabase/tests/fixtures/ads_export/manifest.json).
Only these deliberately frozen synthetic contract fixtures are versioned; local
credentials, running databases, build output, caches and test artifacts are ignored.

Hosted/production reader provisioning and actual DW test-ingestion acceptance are
separate steps. The owner reports the DW P1 intake/contract is pushed; this Hub task
does not independently attest a DW run or create a production login.

`node scripts/export-dw-fixtures.mjs --seed` exited **0**:

```text
Frozen 15 ads_export views, 330 synthetic rows.
ads_export.ad_account: 5
ads_export.campaign_name: 87
ads_export.campaign_registration: 76
ads_export.channel_account: 1
ads_export.correction: 1
ads_export.cost_allocation: 38
ads_export.cost_record: 13
ads_export.line_assignment: 10
ads_export.media_line: 15
ads_export.memo: 11
ads_export.memo_identifier: 13
ads_export.native_binding: 34
ads_export.recurring_commitment: 6
ads_export.scope_code: 9
ads_export.scope_member: 11
```

Replay preserved all 15 data-file hashes and counts. `npm.cmd run test:db` exited
**0**, including all existing SQL/concurrency suites and these output excerpts:

```text
PASS: DW reader attributes, sole membership, 15 export views, private table/column/RPC isolation and write denial with read-only disabled
PASS: local DW login, fifteen export views, private-table isolation and read-only enforcement
PASS: concurrent statement interpretations cannot create two applicable batches
✔ all 15 TEST views match their frozen checksums, schema and exact decimals
✔ fixtures preserve supersession, foreign keys, applied corrections and annual satang
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ skipped 0
```

The manifest pins the schema source commit `4886981`, all 15 applied migrations and
the seed/export generator checksums; it cannot contain its own future Git commit
hash. SQL and fixture checks did not modify P1/P2 migration files. No API source
changed, so the API pytest suite was not rerun for this handoff; its earlier result
remains historical evidence in the P2 report.

The full manifest source commit is
`488698177e570a4e2cc9b334793a951819a385f2`; its export contains **15 views, 202 columns,
330 rows**, timestamp `2026-10-01T02:18:31.061Z`. Migration checksums and separate
generator checksums retain reproducible provenance without a self-referencing Git
hash. Credentials remain only in the ignored local file.

Task A was committed separately as **`30972d0`**, with 29 explicit files and no
docs 25/21, credentials or incidental generated artifacts. The second normal push
exited **0**:

```text
To https://github.com/Keetawon/sena_digital_hub_mkt.git
   4886981..30972d0  main -> main
```

The DW owner reports completed 15-view intake against `e029630` in DW commits
`faaa297` and `44f04b3`. A live ingestion/fixture acceptance receipt for this handoff
is still requested under Q3/Q25; no DW command was run or repository changed here.
The Hub package is a manifest plus fifteen individual JSON arrays. The DW's current
offline loader uses a single `environment` / `source_snapshot_at` / `views` envelope;
its acceptance step must explicitly adapt the package after verifying the manifest,
or read the live local views. The Hub does not claim the manifest itself is that
loader's input envelope or modify the DW loader in this task.

## Design gates

Task B owns [doc 25](../25-line-actuals-and-exceptions.md); Task C owns
[doc 21](../21-ememo-archive-and-search.md). Implementation requires `P3.0 approved`
and `P4.0 approved` respectively and proceeds P3 → P4, one priority at a time.
The [question register](OPEN_QUESTIONS.md) records unresolved DW, Finance and DPO
decisions. No P3/P4 migration, API, screen or worker is implemented by this handoff.

Doc 25 answers the DW questions explicitly: componentless drafts remain deliberately
absent at the financial-component grain; missing effective timestamps stay unknown;
observed CODE comes from literal DW read-back evidence, not `formatted_mapping`;
DW conditions and Hub workflow have separate lifecycles. The October cutover and
daily read-back cadence are proposals requiring acceptance. Master changes need a
later steward-reviewed diff, with no automatic update/retirement. Q31–Q35 cover the
Bangpu conflict, five invalid labels, missing Google account, Solar scope and shared
VIVA/VELA CODE-only attribution.

Doc 21 designs a shared private archive/worker for memos and statements. It separates
transcription confirmation from P2 financial confirmation, preserves exact row
multiplicity/per-page counts and excludes statements from every RAG index. Q7
precedes real uploads or external processing; Q20 requires per-account LINE evidence;
Q29/Q30 establish retention and engine/reviewer acceptance. The 3-statement/10-memo
engine comparison is planned, not performed. Primary documentation was checked;
no real files were uploaded or processed.

Documentation verification: local path/heading-link and UTF-8 checks passed for all
eight changed design/report documents (**67 links** before this final report note).
Independent review found and corrected the unbound frozen-name/variant matching
condition and stale historical authorization wording. `git diff --check` exited 0.
