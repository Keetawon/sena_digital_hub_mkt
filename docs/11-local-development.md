# 11 — Local development and implemented workflows

Started 16 September 2026. This is a runnable foundation for the Thai back office, not completion of the Phase 1 acceptance criteria in [REQUIREMENTS.md](../REQUIREMENTS.md).

Validation of the initial 20 September commercial-types/amenities slice: Next production build (including TypeScript), 288 API tests with live PostgreSQL integration, all 11 SQL/concurrency suites and all 32 UI/proxy scenarios passed. The initial inspection found 13 HYABC source models, an unpublished project, no commercial types and unknown amenity answers; this is a historical observation, not a statement about later user edits.

The subsequent form-flow update applies migration 012 for read-only Gold default suggestions, visible facility radios, purpose-first project media and persistent next/back actions. Eight SQL suites and 27 relevant UI scenarios passed (19 form/source/workflow/commercial scenarios, six facility scenarios and two asset lifecycle scenarios). A navigation focus race found in that run was corrected and the five form scenarios re-run successfully. Production build passed; final UI changes also passed TypeScript. Chrome inspection confirmed HYABC address suggestions without saving, preserved Marketing names, missing-coordinate help, and responsive media/radios at 375px. No HYABC content was saved by this update. Migrations 001–013 are now applied and must not be edited; further database changes require a new migration.

## Implemented scope

**21 September media editing fix:** project and canonical-model images can be managed while project name/address fields are unsaved. Successful media changes preserve the local text and advance the project revision; conflict reloads cannot silently replace or overwrite another editor's text. TypeScript, 13 existing asset/form/facility UI checks and three focused draft/media regression scenarios passed. No database migration or HYABC content write was needed.

**21 September project media collections:** migration 013 makes every project media role append files without replacing earlier bindings. The upload dialog accepts multiple files with individual Thai captions and keeps successful attachments while retrying unfinished files. Hero, thumbnail and brochure retain one primary file; removing it promotes the next. Brand logo and model binding rules remain unchanged. TypeScript, the production build, all nine SQL suites, eight new batch-upload UI cases, three draft/media regressions and both live asset lifecycle UI cases passed. The queue was visually inspected at desktop and 375px widths; mobile checks found no horizontal overflow and buttons met the 44px target. Tests used synthetic fixtures; no HYABC content was saved.

- **20 September draft intake:** separate project-scoped Marketing Unit Types with their own stable identifiers, single/atomic bulk creation, multiple or shared exact REM references, nullable specifications, named collection gaps, inline editing and multiple private plan/image attachments. Per-file metadata records house-floor labels, drawing revisions and applicable source codes. These are unreviewed commercial drafts, not verified unit partitions or published offerings.
- **Marketing amenities:** ten controlled vocabulary entries with six baseline questions, explicit present/absent/planned/unknown states, descriptions, location/access/evidence notes and optional planned opening date. Saved collection counts distinguish an unknown answer from a known absence; no facility is assumed present for HYABC. The new commercial/amenity content remains outside consumer snapshots until its review/publication increment.
- Project readiness now displays existing publication conditions and blocker counts instead of presenting the legacy penalty score as a completeness percentage. Company evidence is secondary collapsed source context. Editors are prevented from saving conflicting project/amenity/commercial forms concurrently; drafts survive tab changes.
- One explicitly synthetic prepared residential project, two further staged projects, a prepared published sample brand and a second staged brand, plus sample images, loaded by local-only seeds. Two sample projects share a brand but have different source companies.
- Thai project list and editor, searchable staged source selection, read-only source/asset information, readiness feedback and optimistic draft saves. The workspace has three tabs: **ข้อมูลโครงการ**, **แบบที่อยู่อาศัย**, and **เผยแพร่และประวัติ**; switching tabs preserves unsaved form values.
- Model name/specification editing, selection of later-staged models, and explicit human confirmation or rejection of each source mapping. Source names and IDs remain immutable; a stale project timestamp prevents overwriting another editor's changes.
- Local PNG/JPEG/WebP/PDF uploads, checksum-based reuse, a shared asset library, publisher rights review and project bindings for hero/thumbnail images, master plans, floor plans and PDF brochures. Model-scoped images, floor plans and structural plans are also implemented, with exact project/model association checks. Uploaded originals stay private; consumer downloads require a current eligible published reference.
- Brand creation from staged source identities, Thai marketing content, shared logo variants, missing-brand requests and admin resolution. Projects can select only their matching REM brand; source company context remains separate. Brand publication/history/rollback and published API/filtering preserve immutable project brand snapshots.
- PostgreSQL snapshots with publish, withdrawal and rollback; edits to a draft leave the published version unchanged.
- Separate admin, editor, publisher, viewer and API-consumer database roles. Admin can edit content and manage brand registration/requests; only publisher can approve rights or publish. Consumers read published views; publication and validity checks run in PostgreSQL.
- FastAPI admin and published read endpoints, with server-held demo tokens for local testing. The admin proxy keeps tokens out of browser JavaScript.
- Reviewed source staging with immutable private batch evidence. The local-only importer validates a pinned manifest, writes one transaction and supports exact no-op replay; it does not create Hub drafts, confirm mappings or publish. **Current selection is HYABC only**: one project, brand and company with 13 model-master records, plus one type-master record in batch evidence. HYABC and FLEXI were subsequently created as unpublished drafts through staff APIs, with mappings unconfirmed. Existing KUBON/B_PO drafts and their staging remain unchanged, outside the current intake plan. See [the current intake status](16-pilot-intake-hyabc.md). Thai source screens distinguish real snapshots from samples, keep normalized source times unknown and show raw model area separately from approved specifications.
- A private verified Gold-snapshot contract and explicit project-default preview/application. New project defaults use Gold commercial names, requested Thai/English address components and coordinates; source identity/name fields remain read-only. Existing Marketing edits and deliberately cleared values are protected, and stale draft/source revisions are rejected. **The user-supplied HYABC Gold project JSON and 13 model rows are now staged locally**, with exact replay verified. No draft prefill, model confirmation or publication occurred; the earlier saved draft remains intact. Staff see warnings for received Thai text quality, missing coordinates and differing priced-unit counts.

The local role selector is a test facility, not enterprise authentication. The admin fails closed outside explicit local demo configuration. The API includes Supabase JWT validation, but production sign-in, user provisioning and deployed integration have not been completed or accepted.

Still required for pilot acceptance: recurring approved DW intake and crosswalk acceptance, verified model specifications and approved public company wording, managed production storage and real asset-rights verification, an approved residential promotion with data/legal approvals, multi-entity release handling, and live integration acceptance. The reviewed local snapshot closes the first staging step, not scheduled DW synchronization, drift handling, name/fuzzy matching or the complete REM crosswalk requirements. RAG and broader content/API coverage follow the delivery plan. No real SENA facts, rights approvals or project photographs are implied by the synthetic seed.

## Prerequisites

**Pilot source evidence:** the current [HYABC package](16-pilot-intake-hyabc.md) was extracted on 18 September and contains 13 model-master records. The user selected HYABC instead of KUBON/B_PO; the earlier [two-project package and staging event](14-pilot-intake-kubon-b-po.md) remain historical evidence. These Git-ignored packages are dated direct REM snapshots, not live DW feeds or human-approved/public catalogues. The seven-project Phase 1 target remains unchanged, with six additional selections pending.

- Node.js 24 and npm (the admin uses Next.js 16.3.5 / React 19.3.0).
- Python 3.12+ and `uv`.
- This local runner uses native PostgreSQL 17 binaries through the pinned `embedded-postgres` development package. Docker and a system database service are not required. It is separate from the intended Supabase deployment.

Run commands from the repository root. Install the declared dependencies:

```powershell
npm.cmd ci
npm.cmd ci --prefix apps/admin
uv sync --project apps/api
```

On restricted workstations, append `--cache .cache/npm` to root npm commands, use an absolute workspace cache path for commands under `apps/admin`, and append `--cache-dir .cache/uv` to uv commands. Windows binaries do not need symlink hydration; npm may report a pending postinstall script for the native PostgreSQL package. Other platforms may require approving that package's documented hydration script.

## Start the three services

Terminal 1, database:

```powershell
npm.cmd run dev:db
```

This creates a development database on **127.0.0.1:55432**, applies SQL migrations once, and loads the sample project once. It creates random local credentials in ignored `.local/development.json`, `apps/api/.env` and `apps/admin/.env.local`. Existing environment files are preserved. Keep the terminal open. Ctrl+C stops PostgreSQL while retaining the local data directory. Applied migrations are checked by checksum; add a new migration rather than modifying an applied migration.

If this local database is already running after a code update, run `npm.cmd run dev:migrate` in another terminal to apply new migrations and local fixtures, then restart the API and admin. This command is fixed to the generated local development database; it is not a deployment tool.

The brand upgrade adds a generated admin token to the ignored local configuration and environment files when absent, without replacing existing role credentials. Restart both application processes afterwards so they load the new role.

Terminal 2, API:

```powershell
uv run --project apps/api --env-file apps/api/.env python -m sena_hub_api
```

Terminal 3, admin:

```powershell
npm.cmd run dev --prefix apps/admin
```

Open **http://127.0.0.1:3000**. Choose a labelled test role. Edit as an editor, then switch to the publisher to verify publication and rollback. API health is at **http://127.0.0.1:8000/health**; every data endpoint requires authentication. Demo services must stay bound to loopback; do not expose or tunnel this configuration.

## Local DW TEST reader

After `dev:db` has applied migrations 0014 and 0015:

```powershell
npm.cmd run dev:dw-reader
# Explicit rotation only, when needed:
npm.cmd run dev:dw-reader -- --rotate
```

The script accepts only the optional `--rotate` flag and refuses any target other
than **127.0.0.1:55432/sena_hub_local**. It reads the local administrator credential
from `.local/development.json` and provisions the dedicated `dw_hub_reader` login
with only `ads_export_reader` membership, two connections and a read-only default.
It checks all 15 export views, private-table/column denial, forbidden role changes
and failed writes with and without the read-only default. `npm.cmd run test:db`
also provisions/verifies the login and runs the SQL security regression.

The only successful script output is the path to ignored `.local/dw-reader.json`.
Its fields are `host`, `port`, `database`, `username`, `password`, `created_at`,
`environment: local-test` and `rotated_at` after explicit rotation. First-run passwords
use 32 random bytes encoded as base64url (43 characters); ordinary reruns retain them.
Keep this file local and access-controlled. A local DW consumer reads it directly
using its connection library; never paste its contents or place a password/URL in
a shell argument. Rotation requires the consumer to reload the file.

Read all 15 `ads_export` views in one **REPEATABLE READ, READ ONLY** transaction.
Decode THB decimals exactly, preserve text IDs and follow the applicability/grain
rules in [doc 23 §8](23-media-lines-and-memo-register.md#8-implemented-read-only-dw-export-contract)
and [doc 24](24-card-costs-and-recurring-commitments.md). Frozen synthetic examples
and their manifest live in [the fixture directory](../supabase/tests/fixtures/ads_export/README.md).
Use a separate DW TEST source/dataset; no TEST fact becomes production history.

The login works only while this workstation's local PostgreSQL is running. It is
not a hosted Supabase login and does not authorize tunneling or production access.
Hosted/shared-test and production provisioning are separate, approved deployment
steps with their own credentials and acceptance. No DW files or external systems
are modified by this command.

## Try source selection and model review

To reproduce the reviewed intake after starting PostgreSQL and applying migration 007:

```powershell
uv run --project apps/api --cache-dir .cache/uv python -B scripts/stage-pilot-intake.py
uv run --project apps/api --cache-dir .cache/uv python -B scripts/stage-pilot-intake.py --apply
```

The first command only validates. The second writes to the fixed local database `127.0.0.1:55432/sena_hub_local` using its generated credentials. The current reviewed package is `.local/pilot-intake/20260918T080012467449Z_HYABC`; the importer accepts only its pinned manifest. It rejects changed files, ineligible source rows, unresolved references or conflicting existing staging. Bounded retirement is permitted only for unreferenced staging mirrors belonging to the exact superseded KUBON/B_PO manifest, retaining the immutable old batch and files. **Existing Hub references skip retirement and preserve that old staging while independent HYABC intake proceeds.** In this workspace, KUBON/B_PO already had unpublished drafts, so both drafts and their source mirrors were retained unchanged. Conflicting unreferenced mirrors stop the transaction without partial changes. This is not a general refresh or remote connection tool. The former package remains verifiable offline but is no longer an accepted import target.

Search **HYABC** under **เลือกโครงการจากต้นทาง** and choose **เปิดโครงการที่มีอยู่**, or [open its local draft](http://127.0.0.1:3000/?project=prj_7b1044dfaaee44d1a56891802b0506f2). The matching FLEXI brand draft is also present. Earlier KUBON/B_PO drafts remain in the workspace; their presence does not add them to the current pilot plan. Creating drafts does not approve their model mappings or publication. Obtain human mapping review, verified specifications, approved content and asset rights before publication. Unknown REM datetime timezone means `source_updated_at` stays null; exact raw values remain in staff evidence. The snapshot's extraction time and the batch's local import time are separate. See [HYABC intake](16-pilot-intake-hyabc.md) for the verified local outcome and the separate DW unit-count query.

The following walkthrough uses synthetic fixtures:

1. Choose **ผู้แก้ไขข้อมูล**, then **เลือกโครงการจากต้นทาง**. Search for `DEMO-002` and choose **เลือกโครงการนี้**. If it was already selected, use **เปิดโครงการที่มีอยู่**.
2. The new draft starts with its source models awaiting review. Under **แบบที่อยู่อาศัย**, first check the selected project, then select its REM model and edit the Thai public name and specifications. Model images and layout/structural plans stay in this model context. Decimal bedrooms such as `2.5` are supported; unknown numeric fields can remain blank in a draft.
3. Use **ตรวจสอบการจับคู่** to compare source/project IDs and names, then confirm or reject with a reason. Confirmation records the authenticated actor and time; it approves the mapping, not publication or the specifications.
4. Rejected models stay visible in admin and are omitted from new releases. At least one included, confirmed model with complete specifications remains necessary. Rejecting a model referenced by the current published snapshot immediately makes that project unavailable through the public API; restore a correct mapping or publish a corrected version to recover.
5. Save any project-form changes before opening a model editor. Concurrent changes produce a conflict and preserve typed model values for copying before reloading. New projects also need content and approved assets before publication; this workflow does not invent those values or bypass the readiness checks.

## Try verified Gold defaults

Migrations 008 and 009 add the current project form and media workflow. **ข้อมูลโครงการ** shows the requested eleven fields in order, followed immediately by project images/plans. Source/commercial fields have distinct labels; the English address reuses `postcode` because the inspected Gold contract has no `postcode_eng`. **รหัส URL (slug)** is a staff-supplied technical field under **ข้อมูลประกอบและการเชื่อมต่อ**, separate from the REM and commercial names.

The source is a reviewed export of `gold.dim_project` plus `gold.dim_project_model`, not a reconstruction from the local REM relay. `scripts/stage-gold-project.py` validates an operator-provided JSON export by default; `--apply` additionally checks exact staged brand/company/model identities and writes only the fixed local database. Original bytes and hashes are retained privately. Its source timestamp must have a verified timezone; export time remains separate. Unknown timezone, incomplete model identity sets and conflicting existing snapshots stop intake. See [the exact export format and commands](17-project-form-and-plans.md#local-snapshot-intake).

With a verified snapshot available, open **ตรวจค่าเริ่มต้นจาก DW ก่อนเติมข้อมูล**, review the values, then use **เติมค่าเริ่มต้นจาก DW** after saving existing edits. It fills untouched gaps and unchanged historical REM-default names; it does not replace saved Marketing edits, deliberately cleared fields, or published content. New drafts without a verified Gold commercial name show an empty public-name field rather than silently substituting the REM name. Source evidence remains available for comparison. Gold model groups show their technical ID arrays and raw metadata; they neither merge canonical REM model identities nor approve area semantics or mappings.

HYABC project JSON and 13 model rows supplied by the user were staged locally and verified at **2026-09-18 11:03:00 UTC**. Exact replay was a no-op. This is operator-provided evidence, not a direct live DW read. Export time remains unknown (`captured_at = null`); receipt time is the first agent observation while processing the handoff, separate from source/load timestamps. Use the importer's `--received-at` option for this case rather than inventing an export time. The received Thai text is retained exactly, coordinates remain null, and the project/model available-priced counts (40 versus 33) need reconciliation before commercial claims. **No prefill was applied**: the saved draft's correctly spelled Thai wording is preserved for staff review. Before/after checks also preserved KUBON/B_PO drafts, all brands and REM project/model staging. See [the fingerprint, receipt and findings](17-project-form-and-plans.md#operator-provided-gold-result). This remains bounded local intake, not recurring synchronization.

## Try brand management

1. Open the brands workspace as the admin test role. Select staged `DEMO-BRAND-02` to create its Hub record. Source IDs and original names remain read-only; this does not create a REM record.
2. As editor or admin, fill in the Thai public name, description and slug. Upload or choose a shared image and bind it as the primary logo with Thai alternative text. White/monochrome logos and favicon are optional separate roles.
3. As publisher, approve any newly uploaded file's rights, then publish the completed brand with a reason. Admin cannot bypass this publisher step.
4. In project intake, select `DEMO-003` and its matching Hub brand. The project's REM company is shown separately. An unrelated brand cannot be assigned. A project draft may be created without a brand, but it cannot publish until a matching published brand is available.
5. Editors can submit a missing-brand request. Admins select the corresponding source brand, create its Hub record, then resolve the request with that record and a reason, or reject it with a reason.
6. Edit a brand draft after publishing: consumers keep the existing brand release. A published project also retains its frozen brand version after a later brand publication. Withdraw the brand or revoke referenced logo rights to verify that dependent published access stops. Restore a valid publication or explicitly republish corrected content to recover.

The prepared `DEMO-BRAND-01` and logo are already published solely to keep the synthetic project example ready for its first publication. They are not SENA facts or production rights approvals. See [the source research and ownership rules](12-brand-project-mapping.md). Brand and project publication remain separate; this is not multi-entity atomic release support.

## Try uploading and reviewing assets

1. As **ผู้แก้ไขข้อมูล**, use the upload section directly below project details. Select its purpose, choose **อัปโหลดไฟล์**, select one or several compatible sample files, and enter a Thai caption for each. Project image roles accept PNG, JPEG and WebP; plans accept images or PDF; brochures accept PDF. Each file may be up to **10 MiB**. Images must be static and at most 40 million pixels; PDFs must be unencrypted, have 1–200 pages, and contain no interactive actions, links or embedded files. Canonical-model media remains under **แบบที่อยู่อาศัย** and uses its existing upload/library flow.
2. Submit the project queue to upload and attach each file sequentially. Each new file starts at **รอตรวจสิทธิ์**; identical bytes reuse the existing registry record and its rights history. Review per-file results and retry unfinished files without duplicating successes. Closing a partial queue keeps successful attachments and uploaded originals. Unsaved project name/address edits remain in their form until **บันทึกข้อมูลร่าง**.
3. Alternatively, open the shared library and select a compatible file, then enter Thai alternative text. Every project role allows multiple bindings: new selections append and never silently replace existing files. The first hero, thumbnail or brochure remains primary; removing it promotes the next ordered binding. An exact duplicate project binding with the current revision is a no-op preserving its original caption and order. Canonical-model duplicate bindings are still rejected, and brand-logo variants retain single-primary replacement. Originals and the current published snapshot stay unchanged.
4. As **ผู้เผยแพร่**, choose **ตรวจสอบสิทธิ์**, record evidence/terms and a review reason, and set validity dates when applicable. The form uses Bangkok time. Rights approval applies to every project using that file; it does not publish a project automatically.
5. Publish once readiness passes. Pending, revoked, future-dated or expired rights block publication. Revoking a file used by a current release makes the affected project and its consumer file downloads unavailable. Draft binding removal alone does not withdraw an existing release.

The API validates file structure and stores immutable, content-addressed originals in ignored `.local/assets`; these checks are **not a malware scan or legal verification**. Staff previews require staff authentication. The published file endpoint requires a consumer token and an eligible current published reference; a file's approved status by itself is insufficient. PDF responses are attachments. There is no public static mount for uploads, and responses are not cached.

This step covers direct uploads and library selection for project and model bindings, including project master plans and multi-file project queues. Rejected-model attachments remain visible to staff but are omitted from new releases and their readiness checks; existing published-model rejection still stops affected consumer access. Building/floor applicability and layout-variant assignment remain future work under [the plan hierarchy design](17-project-form-and-plans.md#plan-hierarchy-and-same-code-variants). External URL mirroring, filename-convention parsing, derived renditions, expiry notifications and managed production storage remain outside this local slice. Do not treat it as completion of all ASSET requirements. The local asset endpoints fail closed outside `HUB_ENV=local`.

## Verification

Verification includes TypeScript checks, the Next.js build, API tests with live PostgreSQL integration, SQL role/publication/source-selection/asset/brand checks, concurrent model-edit, brand-edit and duplicate-upload regressions, and Edge browser workflows. Browser checks cover publication, permissions, source/model review, mobile/keyboard use, request origins, unsaved-edit protection, image uploads, PDF downloads, asset reuse, brand requests/assignment and rights revocation.

On 16 September 2026, the build, **220 API tests** (including four live database integration tests), **12 browser tests**, and all **seven SQL/concurrency suites** passed with migrations through 006 applied. A fresh temporary database also passed bootstrap and an idempotent setup rerun, and was removed afterwards. Source selection, model review, the asset library, brand desktop/mobile screens and request/upload/rights dialogs were visually inspected.

For the **earlier KUBON/B_PO staging on 18 September**, migration 007 passed a fresh disposable-database run. The build/TypeScript, **220 API tests**, **14 browser tests**, **seven SQL/concurrency suites**, four extraction checks and four new intake checks passed. Intake checks exercise rollback, conflicting records, exact replay, JSON boolean/number distinctions, unconfirmed selection and private evidence. The real local import/replay and staff/consumer APIs were checked separately; the real source picker was visually inspected at desktop/mobile widths. That staging event created no real drafts, model confirmations or public records. These checks do not constitute production UAT. HYABC-specific evidence is recorded separately in [the current intake review](16-pilot-intake-hyabc.md).

For the **later HYABC intake on 18 September**, all **10 targeted checks** passed: four extraction tests and six staging tests, including two disposable-database tests. Exact replay preserved the original import time, consumers could not read the HYABC/FLEXI drafts, and before/after comparisons confirmed that KUBON/B_PO drafts, models, source mirrors and immutable batch were unchanged. The actual HYABC screen displayed its Thai heading, matching FLEXI brand and 13 model cards without page errors; desktop screenshots are under `artifacts/hyabc/`. No API/UI code changed in this step, and the earlier full test counts are not claims of a new full-suite rerun.

For the **project-form and model-media change on 18 September**, the **Next.js production build passed** and **229 API unit tests passed**; four live integration tests were deselected in that API run. **18 UI cases were verified across the full run and final targeted fixes/retries**: 17 passed in the full run, with the remaining case verified afterward. All **nine SQL/concurrency suites** passed. Both **Gold importer tests** passed, including one opt-in disposable PostgreSQL test that applied all migrations, intercepted the importer's fixed connection before redirecting it to its own temporary database, and verified source/export timestamp separation, identity completeness, exact replay, conflicting snapshots and failed-insert rollback. It never wrote to the actual Hub database. These results do not claim a new run of the four deselected live API tests, a successful real Gold import or production acceptance.

For the **subsequent operator Gold handoff**, the real local stage/replay and before/after comparisons passed separately. The updated receipt-time CLI passed two offline tests; the disposable database behavior had already passed above. TypeScript checking and targeted UI verification passed for the visible quality warnings and natural model-code ordering. A final production build passed after both changes. The actual HYABC form and A1 Gold evidence were inspected in Chrome; the staff API returned 13 suggested models and three review notes, while consumer access to the admin endpoint was denied and the unpublished project remained unavailable. No live DW connection, draft prefill or publication was performed as part of this handoff.

```powershell
python -B -m unittest discover -s tests -p test_pilot_intake.py -v
python -B -m unittest discover -s tests -p test_stage_pilot_intake.py -v
# Optional live test: creates and removes only its own disposable local test database.
$env:HUB_INTAKE_TEST_DB = '1'
uv run --project apps/api --cache-dir .cache/uv python -B -m unittest discover -s tests -p test_stage_pilot_intake.py -v
uv run --project apps/api --cache-dir .cache/uv python -B -m unittest discover -s tests -p test_gold_project_intake.py -v
Remove-Item Env:HUB_INTAKE_TEST_DB
```

```powershell
npm.cmd run typecheck --prefix apps/admin
npm.cmd run build --prefix apps/admin
uv run --project apps/api --env-file apps/api/.env pytest apps/api/tests
npm.cmd run test:db
npm.cmd run test:ui
```

Browser tests require the database, API and admin running with the generated local configuration. The default browser is installed Microsoft Edge; set `PLAYWRIGHT_CHANNEL` to `chrome` if appropriate for your machine. Browser-test artifacts are ignored by Git. Tests may publish or withdraw the synthetic project; never point local tests at enterprise data.

The generated API environment explicitly sets `HUB_TEST_DATABASE_URL` to the local runtime connection. Without this variable the API's live database test is skipped; authentication/validation tests still run. Use `npm` instead of `npm.cmd` on macOS/Linux.

`npm run test:db` runs the SQL role/publication/source-selection/asset/brand checks and two-connection model/brand-edit and duplicate-upload regressions in `supabase/tests` against local PostgreSQL using the generated migration/test administrator. SQL tests roll back changes or remove their own uniquely named synthetic fixtures. Browser asset tests restore the sample project's original bindings and publication pointer, soft-delete their registry fixtures and retain the small test originals and immutable audit/publication history. Browser brand tests archive their synthetic brands, retain immutable brand versions/audits and remove their unpublished project/request fixtures. Run API and browser suites sequentially because they exercise the same synthetic development data.

## Deployment boundary

### Synthetic document archive (Task 4)

After applying migration 0022, install the three deterministic demonstration PDFs
and queue the initial memo and statement with `npm.cmd run dev:document-demo`.
Run `npm.cmd run dev:document-worker -- --drain` separately from the API, then open
`/ads/archive` as online staff or admin. Both commands refuse any database other
than `127.0.0.1:55432/sena_hub_local`; generated private PDFs and OCR work files stay
under ignored `.local/document-archive/`. No network OCR, R2 provisioning or real
uploads occur. The source hash allowlist is registered by the local seeder only.

The worker reads text-layer memos and uses installed Windows.Media.Ocr for the
image-only statement fixture. This workstation has the English OCR language;
Thai OCR evaluation remains Q30. Missing engines produce a failed job, never a
fabricated extraction. Review the PDF against the extracted fields, correct any
OCR errors, explicitly confirm the transcription, then separately apply/link it
to P2. Applying a statement creates a draft financial batch, not confirmed costs.
The demo statement has five pages, ten occurrences and a signed total of THB
4,812.00. Its three LINE OA rows stay in the unattributed CHANNEL bucket.
The second memo fixture is available for an explicit new-version demonstration.

Set `HUB_DOCUMENT_OCR_TEST=1` for the real local OCR test and
`HUB_ARCHIVE_TEST=1` for the rollback database integration test. These flags do
not enable external processing. See [doc 21](21-ememo-archive-and-search.md#12-task-4-implementation-note--before-code)
for the local archive boundary and pending production decisions.

### Internal assistant demo (Task 5)

Migration 0023 adds private actor-owned run metadata, citations and explicitly
confirmed synthetic draft proposals. `npm.cmd run dev:assistant-demo` installs a
separate wholly fictional project for the fixed live golden question. It never
rewrites HYABC or approves existing data for external processing; a changed fixture
fails closed. The side panel uses the deterministic local SDK model for free-text
questions. Fake mode still runs the normal typed readers under the calling role.

Optional live mode reads `OPENAI_API_KEY` from the ignored API environment and
`HUB_ASSISTANT_MODEL` (default `gpt-5.4-mini-2026-03-17`). It accepts only fixed
synthetic golden questions and verifies the exact fictional business projection
before provider input. No real internal data, arbitrary prompts or user history
leave the machine while Q36 is pending. External SDK tracing is disabled. A key is
never shown in capabilities, browser responses or logs. Missing configuration is a
visible remark, not a successful live-model result. No deployment is performed.

`scripts/local-db.mjs` and the synthetic seed are development conveniences. Production must use a separately provisioned database, a dedicated NOINHERIT runtime login, verified Supabase identities and controlled asset storage. Do not run the seed against a shared Supabase project. This slice uses server APIs for draft writes; direct browser-to-PostgREST writes are not enabled.

The schema is an initial subset, not a frozen production model. In particular, the sample asset registry and single-project releases must be extended to the full content/asset/publish-set contract before pilot acceptance. See [the delivery plan](07-delivery-plan.md) for the remaining milestones.
