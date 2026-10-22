# 18 — Marketing Unit Types, amenities and information coverage

Decision date: 20 September 2026. The user approved this direction after discussing grouped REM models, acquired projects, amenities and the Marketing editing experience. Scope remains the fixed SENA residential context, current HYABC intake and seven-project Phase 1 target. No generic BU registry, company-management workspace or non-residential catalogue is introduced. [REQUIREMENTS.md](../REQUIREMENTS.md) is the implementation contract.

## Decision and delivery boundary

Marketing works through **SENA residential → brand → project → Marketing Unit Type (แบบขาย)**. Location, product form, physical structure and source identity persist independently of changes in management responsibility. CompanyID remains exact read-only source metadata in collapsed reference details; Marketing does not need to supply or approve it as a content-completeness task. Source-integrity checks, legal disclosure and company-targeted promotion rules still apply where required. A company or team change does not recreate content identities or history.

The first increment is a **private draft catalogue, source associations, type media and project amenity collection**. The existing canonical REM-model editing and release path remains distinct. This document approves the target behavior; it is not evidence that every listed feature has been implemented or tested. Release verification must record the actual delivered subset separately.

The following remain later work: commercial-type review/publication and consumer payloads, verified unit partitions, building/floor variant assignment, four-level FAQ authoring/review, and the complete versioned coverage/task workflow. Saving a new commercial draft or amenity must not silently add it to existing public project snapshots or bypass their current gates. Historic public IDs, snapshots, model mappings and asset ownership remain intact.

## Delivered local increment — 20 September 2026

Migrations 010/011 are applied locally. Staff can create one type or a transactionally saved set, edit bilingual names/descriptions and specifications, select multiple/shared source references, inspect collection gaps, upload several private files, and attach each file with title, role, Thai alternative text, house-floor label, drawing revision and source-code applicability. Existing asset-rights review is reused; it does not approve commercial content or unit allocation. The source model panel remains available separately. No HYABC commercial types, amenities, mappings or content were created or approved during feature verification.

Amenities implement a version-1 baseline of six questions (pool, fitness, garden, security, coworking, playground) and four optional vocabulary entries. Description, location/access/evidence notes, expected opening date and actor/timestamp audit are present. Dedicated amenity images, structured building applicability, assigned task owners and content review are not implemented yet. Collection is an answer count, not approval or full project completeness.

Verified: 288 API tests including four live PostgreSQL integration cases; 11 database/lock suites; all 32 UI/proxy tests, including real proxy validation, bulk cardinalities, private multi-file plans, stale edits, amenity status/date behavior, keyboard/mobile checks, and existing source/media/publication workflows. Synthetic fixtures exercise grouping/acquired cases; these are not assertions about HYABC. Final production build is recorded with the local development verification log.

## Source models and commercial types

Programme Phase 5 extends the initial private catalogue with the six-step wizard,
frozen type/price review versions and a different approver for each revision.
See [docs/41](41-project-content-and-faq.md#35-unit-types-แบบห้องแบบบ้าน) for the
current permission card and E2/E3 decisions. Existing public snapshots remain
unchanged until Phase 8. REM group counts and prices remain staff-only comparisons,
without claiming verified unit partitions. Marketing manually enters its prices
with a specific type/size basis, conditions and expiry within 60 days.

| Object | Identity and purpose | Ownership |
|---|---|---|
| Canonical REM project model | Exact `(ProjectID, ModelID)`; retain suffixes such as `-1`, `-2`, `L` and `R`, source names and current canonical public IDs | REM owns identity and source facts; existing human crosswalk review remains |
| Marketing Unit Type / แบบขาย | Independent internal UUID and stable opaque public identifier, scoped to an existing residential project | Marketing owns commercial wording/content; field authority and evidence govern specifications |
| Source association | Link a commercial type to each exact source model in the same project | Records lineage, reason/evidence and review history; not operational membership |
| Verified unit partition | Reviewed UnitID membership or a verified rule over exact source keys, with overlap and unassigned-unit checks | Separate operational/source-owner verification; deferred from draft entry |

Illustrative examples below are not claims about HYABC:

| Situation | Commercial types | REM models | Meaning |
|---|---|---|---|
| One-to-one | Type A1 | A1 | One source model supports one commercial presentation |
| Several-to-one | Type A1 | A1-1, A1-2, A1-2R | Group for presentation while retaining all source keys and real differences |
| Coarse acquired-project source | Garden; Family | Both reference LEGACY-01 | Shared lineage alone does not identify which units belong to either type |

A draft may temporarily have no source association and must show that gap. Do not invent REM codes for unrepresented commercial types. Do not merge source rows, overwrite their names, replace a public model ID with a new aggregate, or treat a normalized name as a join key. Gold's grouped `model_ids` can suggest associations but never approve them automatically.

Association review, content approval, rights approval and unit partition verification are separate actions. Later publication may expose adequately evidenced commercial content with reviewed lineage while operational membership is unresolved, but must withhold type-level operational prices, availability and promotion eligibility. This is a target release contract, not permission to bypass the existing canonical publication path in the first increment.

Never copy a coarse source model's inventory or price totals onto every commercial type. Once operational resolution exists, count each eligible UnitID once at the relevant reporting grain, expose overlap/unassigned gaps and retain calculation/source freshness. Grouped source area values do not become a marketing average or a verified usable-area range automatically.

## Editing and bulk entry

Keep project context visible in the existing **แบบที่อยู่อาศัย** tab. Show a commercial summary list with type name, area/room summary, source-link count, media count and specific missing-data messages. Expanding a type opens one editor in place with visible labels and three sections:

1. **ข้อมูลแบบขาย:** Thai/English name, description and applicable specifications.
2. **ภาพและแปลน:** images, multiple plan files, order, floor label and stated applicability.
3. **รหัสต้นทางและขอบเขต:** source associations and evidence, clearly distinguished from verified unit membership.

Use explicit **บันทึกร่าง** and **ยกเลิก** actions, expected-revision conflict checks and unsaved-change protection. Disclosure controls must be keyboard operable and expose expanded state; error/status text must not depend on color alone. Keep exact REM models in a clearly labelled reference/review section rather than presenting the old one-to-one editor as the commercial catalogue.

“เพิ่มแบบขายเป็นชุด” is a bulk-entry aid: validate multiple rows and create independent drafts with independent IDs, editable details and source associations. It is not a required group entity or new navigation level. Report actionable row errors and do not hide failed rows behind a success message. Shared initial values remain editable per type; they do not establish identical plans/specifications or a verified partition.

| Specification | Entry rule |
|---|---|
| Names and description | Thai default, English optional according to the agreed locale contract; preserve source wording separately |
| Usable area | Explicit value or evidenced range with square-metre meaning; unknown remains null, not zero; raw REM ModelArea requires semantic verification |
| Bedrooms, bathrooms, kitchens | Queryable values; preserve genuine fractional-bedroom conventions where used and kitchen configuration separately |
| Land area, frontage/depth, storeys, parking | Show when applicable to the product form; land-area unit is explicit |
| Functional rooms, ceiling height and other details | Add supported details with evidence; no inferred specifications from model names or images alone |
| Different sub-types in one commercial type | Retain the differences and plan applicability; do not select the first record or average incompatible room/layout values |

The initial form may deliver only a bounded subset of these fields. Missing required specifications remain visible; the target table does not mean every specification is already implemented.

## Media and plans

Upload multiple files within the expanded editor; preview thumbnails and per-file metadata there. A dialog is appropriate for choosing an existing asset or viewing a large drawing. Keep originals and separate derived crops. Uploading a file does not approve its use, source mapping or spatial applicability.

| Plan | Intended relationship |
|---|---|
| Project master plan | Project, optionally a phase |
| Condominium building/floor plan | Building and exact applicable floor(s); one verified typical plan may cover several floors |
| House floor plans | Marketing type, one or more labelled storeys/files, with specific sub-type applicability when needed |
| Unit sales layout | Marketing type and evidenced source model/layout variant applicability |
| Structural/internal drawings | Restricted internal asset; distinct purpose/rights from an approved public sales plan |

One commercial type may need several drawings, including left/right variants. A floor label or free-text note is draft evidence, not a verified spatial relation. A single A1 image does not prove coverage of every associated A1 source model or location. The later spatial increment must capture exact node/variant relationships and drawing revisions without duplicating REM identity.

Preserve existing canonical model attachments and their public snapshot associations. New commercial draft media must remain private until its release contract and rights checks are implemented. Rights revocation/expiry must continue to affect eligible serving even when a historical content version is immutable.

## Marketing-supplied project amenities

Use a controlled vocabulary table with stable codes and Thai labels, initially covering agreed residential amenities such as fitness, swimming pool, garden, shared workspace and security facilities. Marketing records one of **มี (`present`) / ไม่มี (`absent`) / อยู่ในแผน (`planned`) / ยังไม่ทราบ (`unknown`)**. A missing row or unchecked box is not evidence of absence.

Support details, location, shared-building applicability, access restrictions/opening hours when relevant, associated images/evidence, owner and review metadata. Planned facilities must not be served as available facilities. Applicable detail can remain draft/unknown until supplied; avoid inventing location, hours or approval dates.

The expected checklist depends on project type and agreed Marketing needs. Completing an answer as “absent” can resolve the collection gap; it must not fabricate a positive amenity. A required answer about a pool does not require the project to have a pool. Later reviewed/published completeness remains separate from draft collection.

## Completeness and shared knowledge

Track two coverage dimensions independently:

- **Commercial catalogue/content:** the expected type list agreed with Marketing, and each type's required details, topic coverage, images/plans and review/freshness.
- **Source coverage:** canonical source models represented, lineage review, and separately verified unit allocation with overlaps/unassigned units.

REM having one model does not prove one commercial type; 13 HYABC source groups do not prove an independently approved complete commercial catalogue. Do not improve a percentage by excluding unfinished types. For the first increment, show concrete saved counts and named gaps. Existing publication eligibility is a boolean with blocker counts; a penalty score such as `100 - 10 × gaps` is not a completeness KPI.

The later coverage contract defines versioned, applicable expected items and distinguishes collected, reviewed/current and publish-blocking requirements. Unknown differs from known absent and from approved not-applicable. Do not introduce arbitrary requirement percentages before the denominator is agreed. An actionable gap needs its entity context, requirement, owner/state and a direct editing destination; assignment/deadline/review functionality must not be claimed from a plain gap list.

FAQs and narrative knowledge will support the fixed residential context, brand, project and Marketing type. Shared answers use explicit applicability and versioned references, not unconditional inheritance or duplicated text. Review changes against affected descendants; a shared gap should have one responsible task with affected entities rather than many duplicate assignments. Catalogue collection must not expose internal plans or unpublished answers to website/AI consumers.

## HYABC and verification

The received 18 September Gold result contains 13 groups, each with one technical ModelID: A1, A3, B1, C1, CA1, CB1, D1, E1, F1, F2, G1, H1 and I1. This evidence supports preserving those identities; it does not demonstrate the aggregation/acquired-project examples. The real local draft remains unpublished and the source area meanings, Thai-text transfer issue, missing coordinates and priced-unit definition discrepancy remain review gaps. See [17 — Gold receipt](17-project-form-and-plans.md#operator-provided-gold-result).

Use labelled disposable fixtures to verify both many-source-to-one-type and one-coarse-source-to-many-types, as well as missing lineage. Validate cross-project link rejection, stale-write protection, multi-file rights boundaries, unknown-versus-absent amenities and consumer denial of draft data. Do not modify real HYABC mappings or declare sample aggregation reviewed simply to demonstrate the interface. Historical snapshots/public identifiers must remain unchanged.
