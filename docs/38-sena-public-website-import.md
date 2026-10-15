# Public SENA website intake — 15 October 2026

Owner-authorized scope: read the **Project** sheet, column **Q**, in the
[project website list](https://docs.google.com/spreadsheets/d/1BvPr9mjRt2hm2OUVS29HPIjGShZM8rbuRB77xExv-j4/edit?usp=sharing),
capture its public SENA websites, and populate **local project drafts and the Knowledge review library**.
The owner selected both destinations. Hosting/Supabase/R2/VPS setup is a separate task; this run does not
deploy, send mail, contact a hosted Hub, refresh REM/DW, or write to the spreadsheet.

## Meaning of the source remark

The approval/source column displays **ดึงจากเว็บไซต์สาธารณะ SENA**. It describes provenance, not a person's
approval. Existing human review names, timestamps, decisions, rights approvals and publication history remain
separate. The imported text is editable under **ข้อมูลเสริม → เนื้อหาจากเว็บไซต์ (ฉบับร่าง)**. Source URLs and fetch dates are
derived from immutable intake evidence; users cannot forge them in a project PATCH.

No import creates a knowledge acceptance, confirms a model mapping, approves media rights, releases a
preview, or publishes a project. No embedding/provider calls are made. New evidence has no retrieval chunks;
the existing explicit review/release workflow governs later use. Financial/price/availability claims retain
the source text and applicable review holds; a fetch date is never substituted for their business effective date.

## Collection and matching

- Public CSV export is read without authentication; only project identifiers, names, website URLs and mapping
  fields are retained. Sales email columns are not imported.
- IDs are exact text, including leading zeros. Local REM is a read-only identity reference.
- The input has 88 rows, 84 usable website entries and 79 distinct URLs. Four entries say `N/A`.
  After correcting K9BK2, 79 distinct official project pages were captured successfully (plus two identical
  trailing-slash aliases retained in raw evidence).
- `BPEF2` has no exact local REM row. Its shared website remains evidence for the known `BPEF` row, with the
  original `BPEF2` scope retained for review. No REM row or guessed project identity is created.
- One final sheet row has neither an ID nor a website. `FR189`, `SK1SD` and `K9BK5` have `N/A` websites.
- Five website URLs serve two sheet IDs. These candidates carry `needs_phase_decision` and their draft text
  identifies the shared scope. `LADKB` has two distinct website URLs; both are retained in the same exact-ID draft.
- `K9BK2` has a typo in the sheet URL (`…wongwaenn`), which redirects to the HTTP homepage. The matching
  [official project page](https://www.sena.co.th/project/sena-park-ville2-ramindra-wongwaen) (`…wongwaen`)
  is captured in a second evidence package. The original failure and the verified correction are both retained;
  the spreadsheet is unchanged.
- Only public HTTPS SENA hosts are fetched, with robots checks, DNS/redirect restrictions, bounded download
  size/time, retries and a per-host delay. Forms are never submitted. Videos are recorded as links only.
- Static project extraction includes plain text and all accordion FAQ answers, excluding navigation, forms,
  scripts and global page furniture. Images/brochures retain their source URL and immutable SHA-256 bytes.
  Missing files, unsupported types and partial pages are reported as gaps, never invented content.

## Local implementation

Migration **54** adds bounded localized `hub.projects.website_content`, extends the existing guarded PATCH
and frozen draft snapshot, and includes its changes in progress detection. It preserves all permission/RLS,
stale-row and publication checks. No new role, API route or remote credential is introduced.

`scripts/crawl-knowledge.mjs` supports the `sena_project_v1` extractor and an explicit bounded `max_pages`;
legacy inputs keep their original extractor and default limit. `scripts/import-sena-public.py` provides:

1. `prepare --capture <ignored-capture-folder> --capture-sha256 <hash> --mapping <ignored-mapping.json>
   --mapping-sha256 <hash> --out <new-folder-under-.local/sena-public-import>` — offline verification and
   immutable candidate/draft/card preparation, with no database writes.
2. `apply --package <prepared-folder> --manifest-sha256 <hash>` — read-only local plan.
3. The same command with `--apply` — fresh `pg_dump`, verified working-loopback/data-directory guard,
   content-addressed private file copies, then one locked database transaction. Reapplying the same package
   is a no-op. A new source version never overwrites a nonempty website draft or existing fact card.

The import uses the existing synthetic local editor for ordinary draft functions under `hub_app`, including
the live Projects E check; immutable intake writes use the local operator connection. This is an automated
source import, never a claim that the editor reviewed the content. Existing project fields are preserved.
Only newly created drafts receive website address/title/description defaults. No price, coordinates, model
specification, brand mapping, rights, or approval is inferred.

The importer verifies account, permission, REM, publication, knowledge-review and rights-link fingerprints
before committing. It verifies BNA7 is still present. Raw pages, downloaded bytes, mapping data, backups,
receipts and generated screenshots remain under ignored `.local/` or `artifacts/`, never in Git.

## Run receipt and verification

The capture/receipt under `.local/sena-public-import/20261015/` is the local evidence of actual counts,
failures, hashes and backup paths. The two prepared packages contain 82 distinct project drafts and 5,762
Knowledge candidates: 1,110 text sections, 647 FAQs, 3,312 media evidence rows, 203 video-link facts and 490
gap rows. Media rows refer to **3,300 distinct files / 1,081,854,339 bytes** across the packages; identical
files can have separate versioned evidence. Video hosts were not contacted.

The gap rows retain 482 distinct unavailable media URLs (489 scoped occurrences) and the original failed
K9BK2 page, subsequently recovered in the correction package. Robots exclusions and the allowed-host
boundary were respected. Another 64 downloaded media evidence rows fail the existing file type/size/safety
validation and cannot be rights-approved through the normal flow until resolved. No failed download is
represented as a usable file. The source-mapping gaps above remain for owner/Web-team review.

BNA7 received 14,590 Unicode code points of editable website text and 23 new FAQ candidates. Its exact REM
ID is retained. Existing Knowledge evidence is preserved; the new package adds 101 BNA7 candidates overall.

Immediate pre-migration backup: `.local/backups/sena-public-20261015T035543887229Z/sena_hub_local.dump`.
The earlier baseline backup and each import's additional backup are retained in the local receipts.
Baseline: 279 REM projects, BNA7 present, 11 existing accounts, 4 Hub project drafts, 1,910 Knowledge candidates.

**Applied and verified locally:** 79 project drafts created and 3 existing drafts filled with website text,
for 82 populated website drafts / 83 total Hub projects. Knowledge now contains 7,672 candidates, including
the 5,762 new rows. All 279 REM projects and 11 accounts remain intact. Protected fingerprints match the
baseline for accounts, permission/audit records, REM projects/models, publication versions, Knowledge reviews
and rights links. All original fields of the four existing projects are unchanged, apart from the ordinary
edit timestamp/actor on the three drafts receiving website text. Timestamp and numeric comparisons normalize
equivalent timezone/Decimal representations. No human review or publication was added.

`verified-working.json` and `browser-verification.json` contain the post-import checks. The browser verified
exact BNA7 text equality with the prepared package, all 23 added FAQs, no review on imported items, a real
private image download, the visible source column, and no page overflow at 400 px. Working PostgreSQL, API
and Next.js were restarted; the app is available at `http://127.0.0.1:3000`.

Synthetic tests cover full FAQ extraction, excluded forms/scripts, exact/shared IDs, multiple website URLs,
immutable version identity, source URL restrictions, preservation/replay, SQL/API edit denial, stale saves,
source-forgery denial, human-approval separation, and retained dirty form text.

Verification: typecheck and offline webpack build passed; crawler tests **13 passed**; API **1,844 passed,
8 opt-in skips**; DB **51 SQL/concurrency scenarios + 8 Node tests passed**; local H1 simulation **11 Node
and 39 browser tests passed**; the final full UI run passed **255/255**.

The API skips are `test_actuals_import.py:219`, `test_archive_db.py:22`, `test_demo_finance.py:50`,
`test_document_worker.py:121` (real Windows OCR), `test_hosted_h1.py:333` (covered by the separate simulation),
`test_hub_demo.py:285`, `test_promotions_db.py:17`, and `test_residential_seed.py:39`; each is an existing
explicit opt-in suite. No new website-import test is skipped. Existing Pillow deprecation warnings remain.

The first UI run had two failures: the new website form test did not select its **ข้อมูลเสริม** tab (test
corrected), and the existing desktop SVG upload test timed out while the server was still checking the file.
The latter passed unchanged on the focused rerun. Focused verification: **16 passed**. No application upload
behavior was changed to hide that timing failure.

Screenshots (ignored generated artifacts):

- `artifacts/sena-public-websites-20261015/projects-source-column.png`
- `artifacts/sena-public-websites-20261015/BNA7-website-draft.png`
- `artifacts/sena-public-websites-20261015/BNA7-knowledge-faqs.png`
- `artifacts/sena-public-websites-20261015/projects-mobile.png`

To inspect locally, select **ผู้แก้ไขข้อมูล**, open BNA7 from the project list, then **ข้อมูลเสริม**. Its Knowledge
queue is `/knowledge?project=BNA7&kind=faq#knowledge-queue`. Review/media-rights and publication remain explicit
human actions. The imported content and media are local only; this run does not move them to R2 or Supabase.
