# Brand and Project KM transfer plan

19 October 2026. Status: authorised transfer committed to Supabase TEST; private
R2 files verified and the updated hosted UI deployed. The execution record below
is authoritative. Content remains pending human review and publication.

The owner requests all Brand and Project Knowledge Management content in Supabase
TEST and its images in private R2. This plan treats “all” as the union of genuine
Brand/Project content in the local Hub, retained legacy website KM, and the public
website captures, reconciled against exact source identities. It does not mean a
restore of the entire local database. Supabase remains the content/relationship
store, R2 stores file bytes, and the VPS serves the permission-checked application.

## 1. Recorded starting point

These are the last verified receipts, not a new live inventory on 19 October.
Recount both endpoints immediately before preparation and again before applying.

| Source or destination | Recorded state | Implication |
|---|---|---|
| Supabase TEST, 16 October | 82 project drafts and 5,762 Knowledge candidates | Preserve existing IDs, text, subsequent edits and decisions; import only the missing content/version differences |
| Private R2, 16 October | 3,300 distinct originals, 1,081,854,339 bytes | Reuse verified content hashes; do not upload duplicate bytes |
| Local Knowledge library, 15 October | 7,672 candidates, including the 5,762 public-website rows | The earlier 1,910 candidates need reconciliation, not blind copying |
| Retained legacy KM source | 51 project pages, plus programme/shared content | The pilot package is not proof that every legacy page was fully imported |
| Reviewed local brand dictionary | 38 source identities with deletion/exception evidence | Dictionary coverage does not prove that brand descriptions, logos or FAQs exist |
| Hosted reference data | Public-source project identity stubs; canonical brands, models and DW group references were not transferred | Bring across only the verified references needed for content and correct relationships |

Evidence: [hosted transfer receipt](39-hosted-ip-r2-readiness.md#public-website-content-transfer--16-october-2026),
[public website intake](38-sena-public-website-import.md),
[legacy KM design](30-knowledge-library.md),
[brand dictionary](28-dw-brands-and-published-content.md) and
[project/model reference intake](29-dw-project-model-intake.md).

## 2. Inventory and reconciliation

Produce an ignored, checksum-pinned manifest covering every source Brand and
Project, with content counts, image counts/bytes, exact IDs, source/version hashes,
destination matches and one outcome: already present, insert, review conflict,
missing source, or excluded with a reason. Reconcile the older pilot against the
full legacy source and the later website crawl; do not add package totals together
as if their records and images were disjoint.

Include existing genuine draft descriptions, sections, FAQs, aliases, facilities,
nearby information, model/plan references and image associations where the source
actually supplies them. Programme/shared content is included only where it belongs
to these Brand/Project records, with explicit applicability. Keep historical source
versions as evidence rather than making them current answers. Additional reachable
public source pages/files can fill collection gaps through the existing bounded
crawler; unavailable or disallowed files remain named gaps.

Use allowlisted content fields when reading the legacy database dump. Never load
the dump as SQL or copy whole source tables merely to retain unrelated columns.
No Auth users, Hub accounts/requests/invites/permissions, test personas, leads,
visitor analytics, conversations, credentials or operational finance data belong
in this package. Account data never enters content manifests or exports.

## 3. Reference identities and content mapping

Stage the required verified Brand, Project and group references first, followed by
dependent content and asset bindings. Preserve exact source IDs and leading zeros.
Match existing hosted projects by source identity, not display name or local Hub
UUID. Record old-to-new content IDs where a local ID cannot be reused safely.

Reconcile public-source identity stubs with reviewed reference snapshots through an
explicit diff. Preserve the public provenance and human draft edits. Distinguish
REM project groups from DW marketing groups. Keep deleted/unknown source states,
conflicts and ambiguous phases visible; never guess a brand/group/model mapping or
create false Gold records to satisfy a join. REM/DW inputs remain read-only.

Verify that Brand-scoped KM can be listed, reviewed and linked correctly end to
end. The schema permits Brand scope, but the existing candidate intake/review path
is mainly Project/Programme oriented. Any required extension must preserve explicit
applicability and have DB/API/UI tests; do not disguise Brand-wide content as a
single arbitrary Project or automatically apply it to every sibling Project.

## 4. Images and other existing KM files

Collect brand logos, project covers, galleries, floor plans, maps, facility and
progress images, plus existing Knowledge document files. Preserve originals and
their source URLs, hashes, MIME types, sizes, captions and intended bindings.
Videos remain links under the existing collection contract.

Reuse the private R2 adapter and immutable content-hash keys. Upload only missing
objects with conditional writes, then verify their bytes and checksums. Supabase
stores logical object keys and metadata, never access credentials or expiring
download URLs. All duplicate references still retain their individual provenance
and Brand/Project applicability even when they share one physical object.

Connect files to the correct Knowledge items and draft media slots so the hosted
screens actually display them. Exact, safe associations may be imported; uncertain
roles or scope remain review candidates. Preserve file-validation and rights holds.
Originals stay private, and previews use the existing safe-image path. Visibility
continues to follow authorized bindings and the existing upload-workflow rule.

## 5. Import and recovery

1. Prepare a dry-run diff with insert/update/unchanged/conflict totals and the exact
   referenced object inventory. Preserve nonempty hosted human edits; conflicting
   source versions become review evidence instead of silent replacements.
2. Test the importer against disposable databases, including replay, partial failure,
   duplicate sources, ambiguous scope, stale edits, private files and permission denial.
   Reuse existing intake/storage code without removing local-only guards from old tools.
3. Before hosted writes, verify the exact TEST target and TLS, take a fresh protected
   `pg_dump` backup under ignored `.local/`, and verify its archive and checksum.
4. Verify/install R2 objects, then commit dependency-ordered database batches with
   transaction and replay guards. Keep a receipt for each batch. No human approval,
   media-rights approval, publication or embedding is fabricated by migration.
5. On failure, roll back the affected database transaction. Already verified private
   hash objects can be reused on retry; never delete shared R2 files automatically.
   Any later correction must preserve newer hosted edits and use the recorded diff;
   a whole-database restore is a recovery option, not the normal rollback method.

Historical source review attribution stays provenance. Local synthetic actors are
not created in hosted Auth or presented as real approvers. The hosted operator path
uses the existing guarded functions and table-backed authority; no service key,
metadata authorization or broader runtime grant is introduced.

## 6. Hosted usability and acceptance

Correct the legacy TEST/source labels that currently describe public imports as
synthetic or REM-derived. Show the actual source (public website, legacy KM or
reviewed reference snapshot), import time and review state. Keep
“ดึงจากเว็บไซต์สาธารณะ SENA” separate from human approval in the source/approval
column, and do not apply that remark to unrelated legacy/reference content.

Reconcile every manifest row after import and report all missing files/content.
Check Brands, Project Groups, Project drafts, BNA7, Knowledge search/review,
logos/covers/galleries and original/thumbnail reads in the hosted UI. Verify that
source status filters behave correctly after reference reconciliation, without
inventing active status for unknown projects.

Test unauthenticated and unauthorized access, hidden-tab content denial, agency
isolation, and private asset bindings. Compare protected account/permission state
inside the database before and after each transaction; export only aggregate results.
Verify BNA7 and existing hosted content remain intact. Run typecheck, offline build,
DB/API/UI suites and the local H1 simulation for any application/schema changes,
plus focused import/storage checks and authenticated hosted smoke checks.

The delivery report will give before/after totals for Brands, Projects, groups,
Knowledge items and unique files/bytes; remaining gaps/conflicts; backup and receipt
paths; actual test results; and screenshots. Completeness means every source record
is accounted for, not that unavailable information or unreviewed content is approved.

## 7. Decisions for execution

- Include the content-required reference projections, preserving their ownership;
  do not use this request to migrate unrelated REM/DW or finance datasets.
- Keep new evidence/drafts pending the existing human review and publication flow.
- Reuse the current private R2 bucket and hosted TEST destination.
- Determine final import counts from the fresh manifest. The historical counts above
  are planning evidence and must not be presented as a complete new inventory.

## 8. Execution record — 19 October 2026

Live preflight confirmed 82 hosted drafts, 5,762 Knowledge candidates, no Brand
drafts or source brands, and no DW group references. BNA7 exists. The default
project view hid all 82 drafts because the earlier public-website identity stubs
had unknown REM status. Checking “แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ” displayed
them. This is a missing-reference/filter issue, not a missing Supabase connection.

The prepared content-only package is under ignored
`.local/km-full-transfer-20261019/`. Its manifest SHA-256 is
`50bad2a851142e4d904d161c33dcedc07e38dd8f55e96c79dc033a85b8a443ac`.

| Prepared scope | Count |
|---|---:|
| Genuine local Brand drafts | 33 |
| Genuine local Project drafts, matched by source ID | 82 |
| Local model drafts, with match approval excluded | 1,896 |
| Source Brand identities / source Project identities | 38 / 278 |
| Source model identities / marketing groups | 3,427 / 118 |
| Additional Knowledge candidates | 5,340 |
| Candidate assets / distinct Knowledge originals | 2,783 / 2,614 |
| Initially selected local uploads / bindings, before the acceptance correction below | 3 / 3 |
| Historical project/programme snapshots, media labels and KM versions, evidence only | 1,169 |
| Additional media downloads / unavailable URLs | 585 / 9 |

The package retains the reviewed pilot's shared-project holds and records unknown
source scope without inventing a match. Five local facility claims with no reliable
review attribution become held candidates. No local approval attribution is copied.
Brand descriptions are absent after synthetic fields are removed; the importer
does not fabricate Brand-wide stories or repurpose Project KM as Brand-wide KM.
The reviewed reference snapshots date from early October and are labelled as
snapshots, not live REM/DW. Financial, inventory and staff-contact fields are excluded.

The nine collection gaps are policy holds: six `robots_unavailable` responses
(`content.sena.co.th` and `pitisukhumvit101.sena.co.th`) and three `off_allowlist`
URLs at `pitisukhumvit101.senaidea.com`. They are listed in the package's
`file-gaps.json`; the crawler restrictions were not bypassed. Sixteen new-package
asset candidates retain validation holds. All 250 URLs in the legacy media registry
are accounted for among the candidates. Historical review labels remain evidence.

All 38 source Brand identities are retained, but five have no transferred draft:
20/22 have duplicate-name evidence (22 is also deleted), 35 has an empty name and
unknown deletion state, and 29/37 have no residential use in that dictionary snapshot.
BPSN's exact source Brand is 20, so its binding remains unresolved for human review.
The import does not substitute the similarly named Brand 22.

`prepare-km-transfer.py` prepares pinned evidence without DB/provider calls.
`transfer-hub-km.py` verifies the exact TEST target, TLS and a fresh backup;
rehearses in a rollback transaction; verifies private immutable R2 originals; then
commits content and required references atomically. Replay is guarded by manifest.
Existing nonempty edits and deliberately cleared audited fields are protected.
Account/permission, publication, review and retrieval-chunk fingerprints must remain
unchanged. The content source evidence retains values that were not applied.

The UI uses the configured environment label, reserves “ข้อมูลสมมติ” for the local
H1 simulation, distinguishes public-site identity stubs from REM snapshots, and
offers a visible way to include other statuses from an empty project filter.

Final gates: typecheck and offline webpack build passed. Full API: 1,880 passed,
11 existing opt-in skips. Final focused importer checks: 9 passed, including private
asset registration, multiple draft bindings, unchanged rights, cleared-field
preservation, storage retry/reuse and exclusion of unmarked testing uploads.
DB: 52 scenarios plus 8 Node tests passed. Local H1: 11 Node tests
plus 43 browser tests passed. The first H1 attempt found an outdated assertion for
the hard-coded environment label; the corrected assertion passed the full rerun.
Main UI: 257 passed, zero skips or retries. The final focused importer rerun passed
after adding transaction row locks and storage recovery checks. The full gate
receipt is in the ignored package directory. The VPS candidate passed its Linux
production build and loopback preview before promotion. The initial local
Turbopack build could not resolve mocked fonts; the documented offline webpack
build passed. The source, browser bundle and package scan covered 695 files with
zero credential matches.

Fresh hosted backup: `.local/backups/hosted-test-km-20261019T035542Z/supabase-before-content.dump`
(3,664,828 bytes; archive inventory and checksum verified; owner/SYSTEM access).
Before import: one Auth user and one Hub account, 82 drafts, 5,762 candidates,
zero publications and zero human reviews. The rollback rehearsal passed: 33 Brand
drafts, 69 safe draft fill-ins, 81 canonical Brand bindings, 5,340 new candidates.
No new Project identity is needed for the existing 82 drafts. The model drafts
have no additional nonempty specifications beyond their source defaults; matches
remain unconfirmed. Protected account, permission, review, publication and retrieval
state was unchanged. The first R2 pass stopped on a storage HTTP failure before
any database commit. Successful private objects remain reusable. Recovery now
verifies existing bytes before attempting a conditional upload, retries only 5xx
storage failures (at most three attempts), and records per-object failures without
credential details. Eight focused tests passed, including permanent failure and
reuse without rewriting. The operator recovery reuses the verified backup and
successful rehearsal, pins the unchanged import function, and refuses a partial
database state. Recovery verified all 2,617 objects (2,614 Knowledge originals and
three draft originals), with zero failures and no rewrites. The final database
transaction committed at 04:18:23 UTC (11:18:23 Bangkok). Read-only verification
at 04:43:45 UTC, after the acceptance correction below, confirmed the final counts,
BNA7 access under the non-bypass runtime role,
and denial when the actor is missing. Protected state fingerprints were unchanged
inside the import transaction. No schema migration, Auth/account change, human
approval, publication or embedding was made.

| Hosted content | Before | After |
|---|---:|---:|
| Brand drafts | 0 | 33 |
| Source Brand identities | 0 | 38 |
| Project drafts | 82 | 82 |
| Canonical source Project identities | 0 (82 public identity stubs) | 278 |
| DW marketing group references | 0 | 118 |
| Model drafts, matches still unconfirmed | Not separately counted | 1,896 |
| Knowledge candidates | 5,762 | 11,102 |
| Projects visible with the default status filter | 0 | 193 |
| Distinct Knowledge originals in private R2 | 3,300 | 4,018 |
| Knowledge original bytes | 1,081,854,339 | 1,189,666,378 |
| Local upload originals kept active in the content library | 0 | 1 |
| Human reviews / publications / preview chunks | 0 / 0 / 0 | 0 / 0 / 0 |

The 193 default-list entries include source references that have no editable draft
yet; they are not 193 imported draft pages. The Brand screen shows 38 source
identities: 33 drafts and the five documented exceptions. The retained FLEXI logo
adds 40,382 bytes: 4,019 active content originals and 1,189,706,760 bytes across
both storage namespaces. Other collected images remain Knowledge
candidates until their applicability and rights are reviewed; importing bytes does
not approve them or invent project media bindings. BNA7 has 334 candidates,
including 71 image/document candidates, and no previously bound draft media.

Visual acceptance caught two unmarked local testing uploads on HYABC. The first
package had incorrectly treated absence of a demo flag as evidence that those
photos were project content. The corrected preparer requires a reviewed content
hash for local uploads, with a regression test for an unmarked upload. The original
manifest remains immutable. After a fresh verified backup and rollback rehearsal,
an audited correction committed at 04:43:10 UTC: the two imported asset rows were
soft-deleted and their bindings removed through the revision-checked function.
The local originals were not changed. A new immutable intake receipt records the
exclusion; protected account/permission/review/publication state stayed unchanged.
The two unreferenced R2 originals (1,145,049 bytes) remain private for reversible
recovery; they are excluded from the active content totals, unavailable through
the asset library, and were not permanently deleted. Physical transferred storage
therefore totals 4,021 objects / 1,190,851,809 bytes. The correction receipt is
`upload-correction.json`; its protected backup is
`.local/backups/hosted-km-upload-correction-20261019T043949Z/before-upload-correction.dump`
(8,444,929 bytes, archive and checksum verified). `focused-correction.log` records
the final nine passing checks. The deployed application source was unchanged by
this preparation-only correction.

The hosted Next release is `794d9cd-km-34b945a23221`; its previous release
`794d9cd-auth-e423f97fa09c` and service-unit backup remain available for rollback.
The API release and public frontend configuration were unchanged. Authenticated
browser checks confirmed the populated Projects, Brands and Project Groups
screens, BNA7's correct canonical Brand/group and draft fields, the public SENA
source remark, and all ten private image previews on the checked BNA7 Knowledge
page. No review or publish controls were submitted during acceptance.

Live acceptance also exposed a deployment cache defect: the API release's
`.local/assets` directory was a symlink to an empty state directory. The existing
anti-symlink guard correctly rejected that path, so draft-asset thumbnails could
not be generated. The operator repair preserved the old link and service-unit
backup, created a real API-owned `0700` cache directory, and added only that
directory to the service's `ReadWritePaths`. `ProtectSystem=strict`, private R2,
DB authorization and Next's inability to read R2 credentials remain intact. Only
the API service was restarted; its code and environment credentials did not change.
The FLEXI original image and its 96-pixel list thumbnail both loaded afterward.
The repair receipt is `thumbnail-repair.json`; the VPS rollback backup is
`/srv/sena-hub-test/backups/20261019-km-thumbnail-cache`. The deployment helper was
corrected to create this real directory for future releases. These thumbnails are
regenerable cache files; durable originals remain in R2. Keep this directory real,
private and explicitly writable when deploying another API release.

Receipts under `.local/km-full-transfer-20261019/`: `manifest.json`,
`gate-receipt.json`, `verification.json`, `content-id-map.json`, `promotion.log`
and the individual gate logs. The ID map contains content IDs only. Screenshots:

- `artifacts/hosted-km-projects-20261019.jpg`
- `artifacts/hosted-km-brands-20261019.jpg`
- `artifacts/hosted-km-groups-20261019.jpg`
- `artifacts/hosted-km-bna7-20261019.jpg`
- `artifacts/hosted-km-knowledge-20261019.jpg`
- `artifacts/hosted-km-brand-logo-20261019.jpg`

Remaining source gaps and ambiguous mappings are recorded above and in
`file-gaps.json`; they were not silently omitted or guessed. The owner's working
local database was read only, and its services were already stopped before this
task. This transfer initially finished without a Git commit or push; the owner
subsequently authorised a repository checkpoint on 19 October 2026, recorded in
`docs/32-dashboard-performance.md`.

The 11 API skips are the existing opt-in cases in `test_actuals_import.py`,
`test_archive_db.py`, `test_assistant_db.py`, `test_assistant_model.py`,
`test_assistant_tools_db.py`, `test_demo_finance.py`, `test_document_worker.py`,
`test_hosted_h1.py`, `test_hub_demo.py`, `test_promotions_db.py` and
`test_residential_seed.py`. The separate H1 run exercises the managed environment
locally. The API run's six warnings are existing Starlette/Pillow deprecations.
