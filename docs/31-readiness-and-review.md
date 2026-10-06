# Readiness and review — product decision, 7 October 2026

Local implementation only. No real content is published by migration, intake, tests or evaluation. Existing published JSON remains immutable.

## A. Publication gate and completeness

Required: Thai public name, Thai address, Thai ad disclaimer, valid slug, latitude 5–21 and longitude 97–106 inclusive, not expired, primary hero and thumbnail with approved current file/binding rights, and a published brand matching the exact REM brand identity. Each coordinate and each required image is a separate check. No minimum model count or all-model confirmation gate remains.

Recommended: confirmation and complete required specs for **each non-deleted REM model** (two separate items), master plan, a unit/floor plan for each model eligible for this publication, gallery, each required amenity answered, reviewed nearby places, and reviewed knowledge. These never block. Completeness is `passed / (required + recommended)`, rounded down to an integer; green is reserved for 100%. Publishability depends only on required checks.

New project versions include only models whose identity is confirmed and whose Thai name, bedroom count, bathroom count and positive usable area are complete. Media with unapproved/inactive rights, and media belonging to excluded models, are omitted. The confirmation dialog names excluded source models. Source IDs remain exact text.

`model_catalogue_complete` is frozen in new published JSON: true only if every non-deleted REM model is included and complete (true for an empty source catalogue). Older versions keep their original JSON and expose SQL NULL in the DW projection if the field is absent. Draft fact cards compute the current value; published fact cards use the frozen value. False or unknown causes room-catalogue questions to hand off with “ยังไม่มีข้อมูลแบบห้องที่ยืนยันครบ”. No guessed specs or room counts.

No role changes, publication-pointer changes, or edits to historical versions are part of this decision. Existing safety withdrawal for revoked rights/mappings remains intact.

Validation for A: admin typecheck and production build passed; full API suite 1,365 passed / 11 skipped; disposable database SQL, concurrency and export tests passed; 39 relevant browser tests passed. Tests used the disposable database and synthetic content. The existing Google Sans build fallback warning and Starlette deprecation warning remain.

## B. Project progress

The compact staff table shows identity/REM status, a publication badge, completeness, waiting role, update time and reviewed/staged knowledge. Readiness sorts first, then descending completeness, then exact REM ID. Existing status, scope, brand and group filters remain. Source-only identities use the same SQL checklist with empty Hub fields; their links open source selection, never create a draft implicitly.

An ordinary keyboard-operable button with `aria-expanded` opens required/recommended groups, each divided into core, media, models, brand and extra. Every check has a field link; knowledge/nearby links select the exact project queue. Model confirmation and specs contribute independently. A native progress element shows the exact passed/total ratio; only a complete ratio is green. The separate badge alone indicates publication readiness.

Knowledge counts include every staged candidate applicable to the project and every recorded MKT decision (accepted, rejected or missing). Reviewing a candidate does not mean accepting or publishing it. The dashboard is staff-only and performs no writes.

Validation for B: typecheck/build passed; 1,366 API tests passed / 11 skipped; database checks passed; 11 project-dashboard/group UI tests passed on the production server, including keyboard expansion, field focus, pinned identity/header and mobile overflow.

## C. Knowledge progress

The `/knowledge` dashboard contains one row for each staged pilot fact card, excluding programme and vocabulary queues. It uses all project-applicable candidates as the denominator and recorded decisions as the numerator. Pending counts identify sections, FAQs, facts, assets and promotions; other candidate types remain counted and are labelled separately. Holds without a resolved decision are conflicts. Imported gap candidates plus additional named gaps are shown without inflating the count with repeated preview no-answer logs.

No legacy narrative/FAQ coverage shows `ไม่มี KM เดิม · ต้องเขียนใหม่` and an explicit reviewed/staged count for other sources. Last review shows Bangkok time and a staff name/role, never an opaque UUID. A complete review does not imply acceptance or publication. No published knowledge versions exist in this increment; the published state is reserved for an actual publication record, never inferred from 100% review or a private preview.

Project links retain exact IDs in the queue URL; an unknown/non-pilot ID shows a missing-package message rather than silently opening a different project. Pending/conflict filters are read-only. A saved review refreshes both the queue and summary.

Validation for C: typecheck/build passed; 1,369 API tests passed / 11 skipped; database checks passed; all 5 knowledge dashboard/review browser tests passed against the production build.

## D. Motion

Shared-layout morphs, spring/scale effects and animated list/table/dashboard/card entries are removed. Dialogs, dropdowns and tab panels alone may use opacity/translate transitions up to 150 ms; reduced motion removes them. Detail dialogs preserve focus restoration, keyboard behavior and dirty-edit protection without a morph. Docs/22 and the UI skill now describe this policy.

Validation for D: typecheck and production build passed; 94 affected UI tests passed on `next start`, including reduced motion. API/schema behavior did not change in D; C's API/database checks preceded it and the final full suites cover the combined result.

## E. Staff thumbnails

The brand list/dashboard uses the existing primary logo slot. The project list/dashboard and knowledge dashboard prefer the project thumbnail, then the exact REM brand's primary logo, then initials on one of the Hub's muted brand tiles. Missing/unavailable files advance to the next fallback. Tiles remain 48×48, lazy-loaded and labelled with the entity name. These are staff projections under existing RLS, including images awaiting rights review. The authenticated local/hosted file component is reused. No consumer payload, asset approval or real publication changes.

Validation for E: typecheck/build passed; full API 1,369 passed / 11 skipped; database checks passed; 19 thumbnail/brand/project/knowledge browser tests passed, including unavailable-image fallbacks, dimensions, lazy loading and unchanged private-data exclusions in CSV.

## F. Follow-up design

Derived evaluation questions and promotion annotations are a new immutable private package, with a verified source manifest. Original candidates, OCR and captures remain unchanged. Draft expected answers carry exact candidate references and MKT verification status; tuning/held-out assignment is frozen before scoring. Existing legacy held-out prompts never enter question generation or threshold tuning. Shared-phase/closed questions remain blocked from answerable metrics until scope is resolved; their count is reported, not disguised as successful answers.

Calibration measures the tuning split only, with FAQ candidate support precision/recall across 0.80–0.92 and explicit margin values. This is provisional until MKT verifies labels. The runtime 0.88/0.05 settings remain unchanged. The 61 audit cases are a separate refusal/safety suite; explicit human decisions for legacy 517 and the injection refusal override model-judge disagreement only when the actual response follows the approved refusal behavior.

Promotion clusters combine perceptual hash, OCR similarity, matching exact project scope and matching detected end dates. Every member must match, preventing transitive over-merging. Expiry is an advisory flag based only on an OCR-detected end date; undated banners remain unknown. Non-offer text images get a separate review category. Nothing is deleted or converted into an approved promotion automatically.

MKT chooses one primary hero per exact project/phase; other imported hero suggestions default to gallery. A publisher can explicitly freeze a **private preview release**, containing only accepted applicable content and current approved media, with one primary hero. This writes no public publication pointer or consumer index. BNA7's checklist remains a review aid; the agent does not make MKT/rights/publication decisions. A private preview can be evaluated for BNA7 alone; unresolved labels and missing coverage remain visible.

### F. Frozen evidence and calibration results

Follow-up package: `.local/knowledge-followup/20261006T090359724277Z`, manifest SHA-256 `cb1ceaa8cd53631238e3ccdfc8bac3ca3e5715a02b3b3003426f9a94f072be63`. The local intake verifies hashes/sizes/counts and references before one transaction, preserves immutable evidence, and makes exact replay a no-op. No original candidate is rewritten.

Each of the seven projects has 15 **draft, MKT-to-verify** questions with expected answers and exact candidate IDs: 105 total, 70 tuning and 35 held out. TPRAK/SK2TR account for 30 phase/closed-project holds; four other questions invoke runtime safety/model-catalogue handoffs. The measured answerable subset is therefore 48 tuning + 23 held out, not all 105. There are no human-verified answerable labels yet. This is a draft evaluation set, not a claim of 105 approved answerable questions.

Offline report: `.local/knowledge-calibration/20261006T090434790888Z/report.json`. Candidate support is a provisional proxy; these small denominators do not establish semantic precision. No held-out question selects thresholds. The full report includes every threshold × margin combination. At the current margin of 0.05:

| FAQ threshold | Tuning direct precision | Tuning FAQ recall | Section answers / with expected candidate | Refusals |
|---|---|---|---|---|
| 0.80 | 3/3 (100.0%) | 3/14 (21.4%) | 3 / 3 | 42/48 |
| 0.81 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.82 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.83 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.84 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.85 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.86 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.87 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.88 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.89 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.90 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.91 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |
| 0.92 | 2/2 (100.0%) | 2/14 (14.3%) | 3 / 3 | 43/48 |

At 0.88, removing the margin gives 3/4 FAQ precision and 3/14 recall; margin 0.03 matches 0.05 (2/2, 2/14); margin 0.08 gives 1/1 and 1/14. Retain **0.88 / 0.05** pending MKT verification and stronger tuning evidence. This is the proposed setting, and runtime values have not changed.

Held-out evaluation at the unchanged setting: FAQ precision 2/2, recall 2/8; one section answer contains none of its expected candidate IDs; 20/23 handoffs. That section result is a review finding, not a pass. Threshold tuning does not use it.

Case 481: the relevant FAQ exists, but its cosine is only approximately 0.585. Thirteen chunks tie at its keyword score, and RRF uses input order to break ties. Reordering the same frozen project subset moves its rank between 1, 3 and 5; the exact live staff query places it at rank **6**, reproducing the top-five miss. This is a ranking-order instability, separate from the direct-answer threshold failure. Case 537: the expected FAQ is retrieved (two variants), but cosine is approximately 0.552, below every tested threshold. Neither problem is safely solved by lowering the threshold. Proposed follow-up after MKT labels: deterministic tie treatment and reviewed FAQ paraphrases, measured on tuning data before another held-out run. No ranking or embedding-index change was silently made from these diagnostic cases.

Promotion annotations cover all 143 originals: 141 visual/text groups in total, including **59 likely promotion groups** and 84 text-bearing images classified as non-promotions (82 groups). Two pairs of non-promotion variants merge; no promotional offer was merged without the visual/OCR/scope/date checks. All classifications are suggestions for MKT. All 143 lack a reliable detected end date, so likely-expired is 0 and none is presented as current. Dates are compared in Asia/Bangkok, recomputed on read, and never inferred from upload URLs. Every original remains in evidence.

The BNA7 screen includes all nine requested review steps, draft answer verification, candidate links, a publisher-only explicit private-preview confirmation, and a BNA7-only rerun against that frozen preview. Hero suggestions default to gallery; the publisher release requires exactly one MKT-selected hero and current approved rights for every included image. Preview revisions and human question reviews are audited. The agent creates no real reviews, rights approvals or private/public releases.

The first classifier test exposed a Thai substring false positive (`พักผ่อน` versus financial instalments). The final package supersedes the earlier derived annotations; both immutable packages remain on disk, and all question/embedding bytes are unchanged. The final local dry-run verifies 105 question records and 143 promotion annotations.

### F. Live evaluation, validation and local application

Final live report: `.local/knowledge-evaluations/20261006T093100078966Z/summary.json` (74 executed, zero request/judge errors). The suites are reported separately:

| Suite | Correct behavior | Interpretation |
|---|---|---|
| Audit refusal/safety | 61/61 | Model judged with the documented human overrides and typed-status check; no substantive answer-precision denominator |
| Closed TPRAK | 1/1 | States closed; no selling claims |
| Legacy held-out | 9/12 | Answerable cases 480, 481 and 537 still hand off; failed answerability |
| Combined | 71/74 (95.95%) | Does not pass the 100% behavior gate |

Legacy recall is 2/3 (66.67%), below the 90% gate. Unsupported numeric claims and cross-project leakage are zero after checking the explicitly approved cited REM status fact. Live FAQ/citation/groundedness precision for substantive answers is **unmeasured (0/0)**, not a pass. The raw model judge marked 74/74 correct, but the deterministic answerability gate rejects its three inflated handoff scores. Raw judge responses remain in the report alongside the final score; human-reviewed 517 and injection-refusal decisions take precedence. An incomplete model catalogue excuses only model-spec questions, not unanswered demographics or facility questions. No thresholds were changed.

Local application: migrations 037–039 applied without seeding. Before/after counts remained 33 Hub brands, 4 Hub projects, 110 Hub models, 6 asset rows, 0 project publications, 1,910 original knowledge candidates, 0 MKT candidate reviews and 153 preview chunks. The follow-up intake inserted 105 draft questions + 143 annotations in one batch; exact replay inserted 0. No real question verifications, rights approvals or preview/public releases were created. BNA7's actual end-to-end MKT review is still pending; the workflow was exercised with synthetic data only.

Validation commands/results:

- `npm.cmd run typecheck --prefix apps/admin`: passed.
- `npm.cmd run build --prefix apps/admin`: passed; the Google Sans fallback warning remains.
- `npm.cmd run test:api`: 1,385 passed, 11 skipped. The initial classifier failure was fixed and the full suite rerun successfully. After the live judge exposed inflated handoff scoring, `npm.cmd run test:api -- -k knowledge_followup` also passed all 4 focused regressions (1,393 deselected).
- `npm.cmd run test:db`: passed, including immutable follow-up evidence, resolved-phase labels, stale revisions, zero/duplicate hero rejection, approved/current rights and private-preview isolation.
- `npm.cmd run test:ui`: final production build **201 passed**. The initial 196/200 run identified four outdated selectors/fixtures; they were updated for thumbnails, disclosures and required-primary-image readiness, then the complete suite passed.
- `npm.cmd run test:hosted-h1`: **9 checks passed, 1 failed** at the pinned migration inventory (profile expects 33; repository has 39). The H1 browser simulation never started. The guard/profile was left unchanged; reviewing a future hosted-profile version is a follow-up. No hosted endpoint was contacted.

The three read-only working-data captures are `.local/km-review/dashboards/brands.png`, `projects.png`, and `knowledge.png`; browser error capture is empty. These screenshots and evidence packages remain ignored local artifacts.
