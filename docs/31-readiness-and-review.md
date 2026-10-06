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

## E. Staff thumbnails

The brand list/dashboard uses the existing primary logo slot. The project list/dashboard and knowledge dashboard prefer the project thumbnail, then the exact REM brand's primary logo, then initials on one of the Hub's muted brand tiles. Missing/unavailable files advance to the next fallback. Tiles remain 48×48, lazy-loaded and labelled with the entity name. These are staff projections under existing RLS, including images awaiting rights review. The authenticated local/hosted file component is reused. No consumer payload, asset approval or real publication changes.

Validation for E: typecheck/build passed; full API 1,369 passed / 11 skipped; database checks passed; 19 thumbnail/brand/project/knowledge browser tests passed, including unavailable-image fallbacks, dimensions, lazy loading and unchanged private-data exclusions in CSV.
