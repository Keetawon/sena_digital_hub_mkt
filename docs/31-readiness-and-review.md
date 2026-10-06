# Readiness and review — product decision, 7 October 2026

Local implementation only. No real content is published by migration, intake, tests or evaluation. Existing published JSON remains immutable.

## A. Publication gate and completeness

Required: Thai public name, Thai address, Thai ad disclaimer, valid slug, latitude 5–21 and longitude 97–106 inclusive, not expired, primary hero and thumbnail with approved current file/binding rights, and a published brand matching the exact REM brand identity. Each coordinate and each required image is a separate check. No minimum model count or all-model confirmation gate remains.

Recommended: confirmation and complete required specs for **each non-deleted REM model** (two separate items), master plan, a unit/floor plan for each model eligible for this publication, gallery, each required amenity answered, reviewed nearby places, and reviewed knowledge. These never block. Completeness is `passed / (required + recommended)`, rounded down to an integer; green is reserved for 100%. Publishability depends only on required checks.

New project versions include only models whose identity is confirmed and whose Thai name, bedroom count, bathroom count and positive usable area are complete. Media with unapproved/inactive rights, and media belonging to excluded models, are omitted. The confirmation dialog names excluded source models. Source IDs remain exact text.

`model_catalogue_complete` is frozen in new published JSON: true only if every non-deleted REM model is included and complete (true for an empty source catalogue). Older versions keep their original JSON and expose SQL NULL in the DW projection if the field is absent. Draft fact cards compute the current value; published fact cards use the frozen value. False or unknown causes room-catalogue questions to hand off with “ยังไม่มีข้อมูลแบบห้องที่ยืนยันครบ”. No guessed specs or room counts.

No role changes, publication-pointer changes, or edits to historical versions are part of this decision. Existing safety withdrawal for revoked rights/mappings remains intact.

Validation for A: admin typecheck and production build passed; full API suite 1,365 passed / 11 skipped; disposable database SQL, concurrency and export tests passed; 39 relevant browser tests passed. Tests used the disposable database and synthetic content. The existing Google Sans build fallback warning and Starlette deprecation warning remain.
