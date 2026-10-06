# 30 — Knowledge library: legacy website field mapping and design

**Design for owner review · 6 October 2026 · no implementation authorized by this document.**

This document covers SENA public website knowledge for Digital Hub, website consumers and the public chatbot. It builds on [02 — data model](02-data-model.md), [05 — published API](05-api-contract.md), [06 — retrieval](06-rag.md), [18 — Marketing types and amenities](18-marketing-types-and-amenities.md), [29 — DW intake](29-dw-project-model-intake.md) and [30 — residential workspace](30-residential-workspace-flow.md). The two documents numbered 30 have different purposes; the existing workspace document is not renamed or superseded.

The owner's **6 October instruction permits publication and OpenAI processing of this public website KM content**, including embeddings and chatbot previews. Earlier DPO/sensitive-content approval restrictions do not apply to this content. The legacy `is_sensitive` flag is classification evidence, not an access or OpenAI exclusion rule. Public business contacts are eligible. Accounts/passwords, leads, visitor analytics, delivery queues and private conversations elsewhere in the database are outside the requested content library; they are not imported or sent for embedding. Media still requires the existing rights review. Public origin does not establish present-day accuracy, phase applicability or asset rights.

Step 1 delivers this document only, commits and pushes it, then stops for owner review. No importer, migration, UI, provider call, database mutation or deployment is included. Future publication uses existing roles and the core publication gate; legacy approval never bypasses either. All physical tables/columns newly proposed below require a later reviewed migration.

## 1. Evidence and denominators

Read-only inspection used `D:\tmp\sena-production-2026-10-05.sql.gz` (MariaDB SQL; decompressed as text, never executed), compressed SHA-256 **`c7a863cbad771a796cfaceed22cc9ea5a56eebd145503fb56687928adbab921b`**. Local evidence: `.local/km-review/profile.json`, `summary.json` and `column-fill.json`. No raw dump or local evidence is committed. Counts below were recomputed on 6 October from that same checksum.

| Source table | Rows | Meaning for intake |
|---|---:|---|
| `campaign_projects` | 51 | 50 legacy published, 1 draft; these are website pages, not necessarily single REM projects |
| `campaign_project_links` | 53 | Links for 50 pages: 47 single-project, 3 two-project pages; 1 page has no link |
| `project_content_snapshots` | 580 | 51 approved (one/page), 427 drafts, 102 errors; 478 nonempty content documents |
| `project_knowledge_items` | 333 | 204 active, 7 candidates, 122 superseded; active KM covers only 3 projects |
| `project_media_assets` | 250 | Legacy reviewed/tagged assets across 4 pages; not Hub rights approvals |
| `solution_content_snapshots` | 6 | 3 approved + 3 draft; Homeways, LivNex, RentNex |
| `ai_language_terms` | 99 | 38 intent, 45 facility, 8 room, 2 transport, 5 project, 1 other |
| `ai_language_aliases` | 360 | All legacy active/seed; 211 Thai, 149 English |

The 51 approved project snapshots contain 447 FAQ occurrences across 46 pages, 217 unit-type entries across 48, 107 facility-list entries across 15, 24 nearby-place entries across 4, 323 floor-plan entries across 48, 49 document entries across 48 and 37 video entries across 31. These are raw list entries, not verified distinct facilities, models or files. Additional facilities/nearby data is embedded in prose and `facts`.

**Fill rate is `populated parent rows / all rows in that source table`, not accuracy or readiness.** Appendix B reproduces the 135 populated JSON paths in `profile.json`, including historical/error rows in its denominator (580 for project snapshots; 6 for solution snapshots). A parent with several populated array elements counts once per path. Appendix A additionally covers all 112 physical columns of these eight tables, so no container or source metadata field is implicit. SQL null, empty/whitespace-only strings and empty containers are unfilled for physical columns; zero and false are valid values. Nested-path numerators retain the profile's original presence rule. Approved-only item counts above must not be confused with those fill rates. Profile histogram buckets such as category values are values of fields, not additional fields; `counts` is aggregate evidence, not a target column.

## 2. Target model and ownership

### 2.1 Existing and proposed objects

Reuse `hub.projects`, `hub.brands`, `hub.model_types`, `hub.commercial_types`, `hub.commercial_type_sources`, `hub.project_facilities`, `hub.facility_taxonomy`, asset bindings, rights review and immutable `hub.entity_versions`. The existing `hub.project_facilities` implements the facility concept sketched as `hub.facilities` in doc 02; do not create a competing facility master. Existing Marketing types and amenities are private drafts today: projecting their reviewed fields publicly is explicit future contract work, not already supported behavior.

Proposed objects complete doc 02's `hub.content_sections`, `hub.entity_aliases`, `hub.content_gaps` and `hub.nearby_places`; add `hub.faqs`, `hub.knowledge_topics`, `hub.knowledge_terms`, `hub.programmes`, `hub.project_contacts`, `hub.project_compliance`, and typed supplemental `hub.project_facts`, `hub.project_progress_facts`, `hub.project_fees`, `hub.programme_terms`, `hub.sustainability_claims`. They extend the existing release snapshot instead of creating a second publication system. `hub.content_gaps` records missing facts, mapping conflicts and unanswered questions with owner/state and a direct source/content reference.

Future staging names used in the mapping:

- `staging.km_source_records`: immutable source record identity (`source_system`, `source_table`, `source_id`), original row/payload/hash, source URL/path, source timestamps, legacy workflow/actor metadata and batch reference. All source IDs remain text. `metadata.*` denotes named keys within its evidence JSON, never public DTO fields.
- `staging.km_scope_links`: legacy page-to-exact-REM link, source group claim, match state and phase-review reason. No source-name or trimmed-ID joins.
- `staging.km_fact_candidates`: extracted `fact_key`, typed proposed value/unit, raw text, exact applicability, source reference, owner and review state. Candidates are not authoritative facts or public answers. Prices/promotions/availability go to the existing owner's approval/serving process; this staging table cannot authorize them.
- `staging.km_asset_candidates`: source URL, proposed role/tags, scope/type association and review state. A URL hash deduplicates references, not file bytes or rights.

Dropped fields mean **excluded from the operational content model/index/consumer output**. Their original bytes remain in immutable local batch evidence if a future intake is approved. No production credential, identity or operational chat data is copied merely to preserve unrelated tables.

### 2.2 Common scope, source and lifecycle

Sections and FAQs share these fields:

| Target field | Contract |
|---|---|
| `scope_type` | Exact enum `brand`, `rem_project_group`, `project`, `unit_type`, `programme` |
| `scope_id` | Text with type-specific validation: existing Hub brand ID; exact REM ProjectGroupID; exact REM ProjectID; existing Hub commercial-type ID; controlled programme key respectively. Never substitute Marketing group IDs for REM group IDs |
| `applies_to_project_ids[]` | Explicit exact REM text IDs, validated against reviewed source identities, unique and sorted without trimming. Project/type scope must be consistent with its parent. Empty means applies to no project, never all projects |
| `topic` | FK to the controlled vocabulary below, not free-form legacy category |
| `source_url`, `source_ref` | Canonical reviewed website URL and immutable `{batch, table, row_id, snapshot_id/hash, json_path}` reference; preserve multiple references when merging |
| `version`, `status` | Stable content identity + immutable version; `DRAFT`, `PUBLISHED`, `WITHDRAWN`. Source candidates/rejections are review states in staging, not implicit publication |
| `reviewed_by`, `reviewed_at` | Authenticated Hub actor/time for the reviewed revision; historical legacy actor IDs/times remain separate provenance |
| `created_at/by`, `updated_at/by` | Hub audit metadata, distinct from source creation/fetch dates |

Scope expresses ownership; applicability expresses where an answer is valid. Brand/group membership does not silently expand `applies_to_project_ids`. A shared FAQ is one canonical record with multiple source references and explicit applicability; each project release freezes its referenced version. A shared edit previews affected projects and publishes the selected changes atomically. Existing project versions keep their pinned content until republished; shared-content withdrawal immediately removes its eligibility everywhere, while retaining history. No independent editable REM-group master or automatic publication of sibling projects is introduced.

### 2.3 Sections and FAQ

`hub.content_sections`: `id`, common fields above, `title`, `body`, `summary` (each locale-keyed JSON, starting with `th`), `keywords[]`, `sort_order`, `fact_keys[]`, `rag_eligible`. This refines doc 02's `heading/body_md`: mapping uses `title/body`, and the later migration must choose one physical representation, not maintain both.

Every stored section body starts with the project or brand name. For a shared group/programme section, start with the reviewed brand name and group/programme name; the per-project retrieval projection additionally starts with that project's published name. A unit-type section starts with the project name and type name. Repeat this prefix on every split chunk, so no chunk depends on an earlier heading. Keep natural paragraph boundaries, approximately 300–600 tokens as a pilot target; split long sections by subheading. Strip volatile commercial values from body, title, summary, keywords, citation labels and embedded image captions, not just the answer paragraph.

`hub.faqs`: `id`, common fields, locale-keyed `canonical_question`, `alt_questions[]`, `short_answer`, optional `live_fact_key`, plus `fact_keys[]` for a compound structured answer. Alternative questions are wording variants of the same intent/scope, not alternative answers. The published short answer is concise and self-contained. A dynamic answer is an approved template, e.g. project name + common-fee placeholder; the value is obtained at query time using `live_fact_key=common_fee`, never stored as a stale amount inside narrative text. Missing/expired structured values produce an explicit no-answer for that part, never a guessed value or a fallback to the source quote.

For storage, use locale-keyed objects consistently: `title/body/summary/canonical_question/short_answer = {th: text, en?: text}`, and `alt_questions = {th: text[], en?: text[]}`. Missing English remains missing; an explicit fallback returns `locale=th` and `is_fallback_locale=true`. Publish/review tracks each translation against its source revision so an old English answer cannot silently accompany a newer Thai one. Keyword and alias entries retain their own locale. Topic codes are language-independent.

Stable numerical assertions (area, rooms, distance, floors, counts, percentages, dates) also require typed values and `fact_keys` bindings. The chatbot may repeat reviewed names/codes such as “KM.29” or “1 Bedroom”; these are identity labels, not newly inferred measurements. It never extracts a numerical claim from prose and treats it as a structured fact. SQL/source numerals and unit labels are parsed into candidates for human review, not silently accepted.

### 2.4 Controlled topics proposed from the source

| Topic code | Legacy categories/content consolidated | Allowed content |
|---|---|---|
| `identity` | project, project_identity, real_estate_project, project_attribute, ข้อมูลโครงการ, ชื่อโครงการ, สถานะโครงการ, ข้อมูลอาคาร | Identity explanation; status/counts via typed fields |
| `brand` | All แบรนด์ / แนวคิดแบรนด์ / developer variants | Brand story and reviewed relationships |
| `design` | แนวคิดโครงการ, จุดเด่น, จุดเด่นโครงการ, การอยู่อาศัย, private living, project_feature | Design and lifestyle narrative |
| `location` | ที่ตั้ง, ทำเล, location, location_preference | Address/context; exact location from structured facts |
| `transport` | การเดินทาง, ที่ตั้งและการเดินทาง, transportation, transport | Access narrative; distances/service dates as typed claims |
| `nearby` | Nearby places, nearby_places, สถานที่ใกล้เคียง, schools/hospitals/shopping | Typed places plus explanatory narrative |
| `facilities` | Facilities, facilities, ส่วนกลาง, สิ่งอำนวยความสะดวก and combined variants | Present/absent/planned/unknown and reviewed details |
| `parking_security` | ที่จอดรถ, ที่จอดรถและ EV, ระบบรักษาความปลอดภัย | Access/policy narrative; ratio/hours/fees from typed facts |
| `unit_types` | All แบบห้อง, รูปแบบห้อง, รายละเอียดห้อง, พื้นที่ห้อง, ความสูงเพดาน, เฟอร์นิเจอร์และการตกแต่ง variants | Type descriptions; dimensions/specifications from typed sources |
| `sustainability` | sustainability, แนวคิด Low Carbon | Qualitative features; quantitative claims require reviewed measurement/source/as_of |
| `technology` | technology | Supported smart-home/building features |
| `buying_process` | เอกสารจองและสินเชื่อ, การเงินและสินเชื่อ, การจองและสินเชื่อ, policy | General process/document guidance; no loan guarantee or embedded rate |
| `programmes` | LivNex เช่าออม, solution content | Programme explanation with explicit project eligibility |
| `commercial_terms` | ราคา, โปรโมชั่น, ราคาและโปรโมชั่น, fees, ค่าใช้จ่าย, payment/investment | FAQ/tool routing only for prices, fees, offers, availability; no value-bearing RAG prose |
| `investment_context` | investment, การลงทุนและทำเล | Attributed qualitative context; no promised return, rate or inferred forecast |
| `contacts` | ติดต่อ, ช่องทางติดต่อ, ติดต่อโครงการ | Reviewed public business contact fields; no personal lead data |
| `media_documents` | เอกสาร, สื่อโครงการ, เอกสารโครงการ, โบรชัวร์, คลังรูปที่พร้อมใช้งาน, แปลน*, รูป*, ภาพโครงการ, วิดีโอโครงการ | Asset links with exact applicability and rights eligibility |
| `construction_progress` | `project.progress.*` | Dated typed progress, not an evergreen completion claim |

Multiple facts in one legacy answer are split by topic/scope. Unrecognized categories enter review with the original label retained; do not create a new topic automatically.

### 2.5 Typed facts and authority

Use existing canonical REM models for reviewed model facts and existing `hub.commercial_types` for Marketing types. Preserve exact model associations; a website “Type A” name is not a REM ModelID. Unit-level inventory/prices remain outside this library. Facilities use controlled codes plus applicability, state, access notes and as_of. Nearby places retain category, reviewed name, distance in metres, travel mode/time, measurement/source date and uncertainty; do not infer a route, convert minutes into distance or assume a future station is operating. Compliance uses `hub.project_compliance` with owner review; the backup does not supply a complete legal disclosure dataset.

`hub.project_facts` holds reviewed building/floor/total-unit/land-area/parking/ceiling facts with explicit grain and units; operational facts remain owned by REM/DW and cannot be overwritten by website evidence. New facts resolve source conflicts explicitly. `hub.project_progress_facts` holds dated progress measurements. `hub.project_contacts` allows official project phone, LINE, Messenger and website contacts. `hub.project_fees` and `hub.programme_terms` have typed amounts/rates/currency/basis, exact applicability, `as_of`, effective window, owner and review version. Price/promotion/availability tools continue to use their existing authoritative owners. No source fetch timestamp is invented as a fact's measurement date. Unknown dates are null with a freshness warning; dynamic monetary answers require current owner-approved dates/policy.

### 2.6 Aliases and resolution

Load all 99 terms/360 aliases as candidates through `hub.knowledge_terms` and `hub.entity_aliases`. Extend doc 02's alias target to distinguish `knowledge_term` (intent/facility/room/transport vocabulary) from actual project/brand/group/type/programme entities. The 94 non-project terms must not become project identities; the five project terms still need exact reviewed links. Add canonical REM names, published public names, former names and accepted transliterations with their provenance. Dictionary term IDs and REM IDs are separate namespaces.

Normalize aliases for lookup (Unicode NFC, whitespace collapse and case folding), preserving original spelling. Never normalize the source identity key. Permit one alias to resolve to multiple valid entities and ask for clarification rather than guessing. Resolve a requested project using project aliases only; use concept aliases for topic/tool routing after scope is established. Alias confidence and seed/active flags do not establish mapping approval. Duplicate alias strings may share a lookup form but retain target and source references. A proposed `GET /v1/resolve` returns only eligible public entities; staff preview uses authorized draft resolution separately.

## 3. Publication, retrieval and the project fact card

### 3.1 Versioned retrieval index

Extend doc 06's `rag.knowledge_documents` and `rag.knowledge_chunks`; add a `rag.project_chunk_index` projection. A document pins a section/FAQ version, not its mutable draft. Per locale, embed published section chunks and **each canonical/alternative FAQ question separately**, with references back to one FAQ answer/version. Do not embed repeated FAQ answers once per question variant. Group scores by FAQ ID before comparing competing answers. Metadata includes source URL/ref, content/version ID, exact `project_ids`, brand ID, exact REM group ID, topic, locale, effective window, embedding model/dimensions, content hash and citation target.

Use **pgvector HNSW cosine indexes**. To honor project filtering before vector search, physically project shared chunks into the partitions for their approved exact projects and LIST-partition `rag.project_chunk_index` by `rem_project_id`, with HNSW indexes on the partitions. A query must supply one exact project, prune to that partition, and apply locale/version/eligibility filters before returning candidates. Do not query a global top five and discard other projects afterward. Partition rows are disposable retrieval projections, not duplicated authoring records. If a selective locale/version predicate yields too few ANN candidates, use bounded iterative scans or exact distance search over the already authorized subset. This addresses pgvector's documented post-scan filtering behavior rather than assuming a global HNSW index prefilters automatically. [pgvector filtering and partitioning](https://github.com/pgvector/pgvector#filtering)

Pilot embedding proposal: configurable `text-embedding-3-large` with `dimensions=1536`, versioned as one index configuration; evaluate Thai/English quality before fixing the setting. OpenAI supports reduced dimensions; standard pgvector HNSW `vector` indexes support up to 2,000 dimensions, so do not pair their index with the model's default 3,072-dimensional output. [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings), [pgvector HNSW types](https://github.com/pgvector/pgvector#hnsw)

Publishing builds the exact release's embeddings and fact cards. Prepare embeddings outside the DB transaction, keyed by proposed revision/hash; recheck unchanged revisions, core readiness and actor permissions before atomically inserting immutable content/fact-card versions, their prepared index generation and the publication pointers. A provider failure or stale revision exposes no partial generation and leaves the previous publication intact. No DB transaction remains open while waiting on OpenAI. An unpublished preview uses a separately authorized, short-lived preview index and cannot be returned through public routes. A withdrawn source/project removes the relevant live index projection in the withdrawal transaction; request-time eligibility checks and cache invalidation prevent stale answers even before housekeeping completes. Reconcile orphaned/superseded index entries, and rebuild the pinned generation on rollback. Embeddings are derived data; immutable source/version history is retained.

### 3.2 Project fact card

Propose `hub.project_fact_cards(project_id, project_version_id, payload, built_at)` and a published-only projection, read through `GET /v1/projects/{public_project_id}/fact-card`. It is a compact immutable JSON card per published project version, assembled from reviewed structured values, not generated from prose. It carries:

| JSON field | Source and unknown behavior |
|---|---|
| `public_project_id`, `project_id_rem`, `project_version_id`, `published_at` | Existing exact project/version identity |
| `name`, `brand` | Published localized project name and pinned eligible brand identity/name |
| `status.raw`, `status.label`, `status.as_of` | Reviewed REM ProjectStatus with the owner-approved mapping; raw unknown/null stays explicit |
| `location` | Reviewed property address, coordinates and district; null when absent |
| `bedrooms.min/max`, `area_sqm.min/max` | Compatible, reviewed and published model/type facts; include population/grain and incomplete-coverage flag, never an average of unlike REM areas |
| `facility_codes`, `facilities_as_of` | Reviewed present facilities only, plus collection/coverage state; planned/unknown is not present |
| `top_nearby_places` | Proposed maximum five reviewed places with category, distance/time/mode if known; review order, not invented importance |
| `contacts` | Reviewed official project channels, not customer/personal contacts |
| `field_meta` | Per field: `as_of`, source/ref/version, freshness state, unit/grain where needed; unavailable is explicit |
| `live_fact_keys` | Available structured tool keys, not frozen price/availability/fee amounts |

No prices, promotions, fees or availability values are frozen into the card. The chatbot loads the card first as structured context; stale immutable fields remain labelled as_of and do not claim live freshness. It calls an owner tool for any live fact. A withdrawn project returns unavailable, including its cached card and citations.

Illustrative compact shape only (synthetic identifiers/null facts, not an actual publication):

```json
{
  "public_project_id": "prj_example", "project_id_rem": "DEMO-KM", "project_version_id": "example-version",
  "published_at": "2026-10-06T03:00:00Z", "locale": "th",
  "name": "โครงการตัวอย่าง", "brand": {"id": "brand-example", "name": "แบรนด์ตัวอย่าง"},
  "status": {"raw": null, "label": "ไม่ทราบสถานะ", "as_of": null},
  "location": {"address": null, "latitude": null, "longitude": null},
  "bedrooms": {"min": null, "max": null}, "area_sqm": {"min": null, "max": null},
  "model_coverage": "unknown", "facility_codes": [], "facilities_as_of": null, "facility_coverage": "unknown",
  "top_nearby_places": [], "contacts": {}, "live_fact_keys": [],
  "field_meta": {"location": {"as_of": null, "source_ref": null, "freshness": "unknown"}}
}
```

Actual responses include a `field_meta` entry for every factual leaf or explicitly grouped set sharing the same provenance; the example abbreviates that map. A populated known-zero field remains zero; an empty collection with unknown coverage must not be described as confirmed absence.

**Status contract change proposed by this request:** doc 29 currently keeps REM status staff-only. The new fact-card request explicitly proposes exposing the reviewed raw/label/as_of triplet to website/chatbot consumers in this new contract. Record that narrow change here; existing routes remain unchanged until the later contract/migration review. `2` means ready to move, not that a particular unit is available or that Hub content is published.

### 3.3 Chatbot flow and answer contract

1. Resolve the project through aliases. If ambiguous, ask which project/phase; never retrieve across candidates as though they were one.
2. Load that project's eligible published fact card and retain its version/context. Staff preview explicitly labels the selected draft and cannot masquerade as public content.
3. Match the question against in-scope, locale-specific FAQ question embeddings. Proposed pilot starting values: cosine similarity at least **0.88**, and at least **0.05** ahead of the next distinct FAQ. These are tuning hypotheses, not measured accuracy or approval. Above the calibrated threshold, return the stored short answer and versioned citation. For a fact-bound FAQ, first call its structured tool and fill only approved placeholders; never bypass step 5.
4. Otherwise retrieve section chunks with **top-k = 5**, within the same project/locale/eligible version. Deduplicate source sections and use keyword/alias support for exact names/codes. If evidence conflicts or does not answer the question, say what is missing.
5. Numerical factual claims come only from the fact card/typed structured tools with source/as_of. No price, promotion, fee or availability answer from narrative retrieval. Validate numbers before returning the answer. Do not calculate offers, loan eligibility or investment returns from source prose.
6. Record unanswered/ambiguous/conflicting questions in `hub.content_gaps`: normalized, sanitized question, topic, exact entity context, reason, occurrence count, first/last seen, state/assignee and eventual resolving content/version. Do not store a full customer conversation as knowledge. The gap writer is a controlled application action; it does not give the assistant arbitrary write/publish permission.

Every answer includes a safe citation identifying the relevant entity, content/fact version and source date. Recheck eligibility on citation open. Website sections and FAQs read the same published content contract. The public chatbot remains in its separate repo, consuming Hub and the existing operational Serving API server-to-server; no browser service credentials and no direct reading of staging. The staff assistant retains its existing caller-role checks and private namespaces. Previewing imported public content with OpenAI is authorized; a preview is still not publication.

## 4. Cleaning decisions and measured queues

### 4.1 Duplicate FAQ and KM handling

On the **447 approved-snapshot FAQ occurrences**, Unicode NFC + whitespace collapse + case folding of the question/answer pair yields **352 distinct pairs**. There are **49 cross-project duplicate groups covering 143 occurrences**, offering 94 repeated rows to consolidate after scope review, plus one additional within-project duplicate. Answer-only matching yields 340 distinct answers and 56 cross-project groups/162 occurrences; use this wider set only to propose canonical questions/alternatives, not to auto-merge.

Consolidate equivalent, reviewed FAQs into one record and union only their approved exact `applies_to_project_ids`, retaining all source refs. The shared owner can be a brand/group/programme; where no single shared scope fits, keep one chosen owner and explicit cross-project applicability for review. Equal text is insufficient when it is a generic “none”, a promotion, completion status or unit specification: 13 pages share a ready-to-move answer and 11 share an offer answer. Those become fact-bound FAQs, not evergreen shared assertions. Semantic near-duplicates remain proposals until reviewed. Two pairs of active KM answers repeat exactly within their own project; one project also repeats `knowledge_key=project_name` under different source paths. Stable IDs and source refs survive deduplication; keys alone are not globally unique.

### 4.2 Commercial text and blanks

A reproducible broad review scan (`ราคา|บาท|ลบ\.?|ล้านบาท|โปรโมชั่น|โปรโมชัน|ส่วนกลาง.{0,12}บาท|เงินกองทุน|ดอกเบี้ย|ค่าเช่า|ผ่อน|ฟรี|ส่วนลด|ยูนิตว่าง|ห้องว่าง|คงเหลือ`) flags **34/204 active KM answers** and **74/447 approved FAQ question/answer pairs**. These are review candidates, with overlaps and possible false positives, not counts of validated offers. All 51 campaign pages have `price_text`, 50 have promotion text, and 48 approved snapshots contain 63 promotion-banner entries. Scan every narrative/caption/summary, including currently unflagged entries.

Move price, promotion, fee, rate, term and availability claims into typed `staging.km_fact_candidates`, preserving source quote/date and exact scope. Route to the appropriate owner; attach a `live_fact_key` to the remaining FAQ. Remove obsolete amounts/offer promises from narrative and embeddings. Do not silently resolve contradictory fees/rates by taking the newest capture. An image containing an offer also needs its effective terms/rights reviewed before public use; a banner title is not proof of an active promotion.

Blanks remain unknown, never zero/false/absent. There are **206 blank counts among 937 room-component entries** in the approved snapshots. Facts are objects in 48 approved snapshots and empty lists in 3: normalize the empty list to unknown rather than parse it as a map. Most copied room/model labels mix Thai and English; parse locale and units independently, do not fill English with Thai or fabricate a translation. Of 250 reviewed media rows, **215 have no unit-type label**. Of 99 language terms, none has a legacy creator/approver recorded. Retain those provenance gaps without inventing people.

### 4.3 Combined pages and mapping exceptions

| Legacy page | Exact linked REM IDs | Required disposition |
|---|---|---|
| `6` — SENA Kith Sathorn–Kanlapaphruek | `80101`, `80102` | Review each section/fact/asset by phase; existing phase-labelled facts do not license copying totals to both |
| `10` — SENA Eco Town Rangsit Station | `BPEF`, `BPEF2` | Preserve both original links; `BPEF2` is missing from the latest retained DW dictionary, so that applicability remains unresolved |
| `17` — FLEXI Sathorn–Charoen Nakhon phases 1 & 2 | `HYABC`, `HY2DE` | Shared narrative may explicitly apply to both; the source note says the combined 899-unit total needs phase confirmation. Never assign it to HYABC alone, divide it equally, or infer phase ownership from image filenames |
| `13` — SENA Kith Sukhumvit Bangpu–Beachfront | No source link | Stage for mapping review; no automatic name match, new REM identity or public project binding |

Comparison to the retained 5 October DW package finds **52/53 exact links**, all 52 non-deleted; three pages have phase-review flags (six link rows). The unmatched link and unlinked page stay visible in the review queue and source picker. Never trim IDs, infer Gold identity, alter HYABC mappings or overwrite REM/DW evidence. Source-page IDs, CMS IDs, REM IDs and group IDs stay in distinct namespaces.

### 4.4 Source lifecycle and all 97 flagged active entries

Skip **122 superseded KM entries** from candidate generation/retrieval, retaining original evidence only. All **7 candidates** go to review: `539` common fee; `665` and `702` conversational acknowledgements (propose dropping as knowledge); `666` model specifications; `703` pet policy; `704` installment claim; `705` booking/document/contact guidance. They are not auto-published. The 204 active entries all match their approved snapshot hash, but this verifies origin rather than present-day truth. Of all 333 rows, 164 are flagged: 97 active, 7 candidates, 60 superseded. Do not confuse the 97-active classification below with all flagged history.

The following mutually exclusive primary classifications cover **all 97** active flagged IDs. Secondary structured extraction can overlap; counts in this table do not.

| Actual content | Count | Legacy KM IDs | Handling |
|---|---:|---|---|
| Commercial amounts, offers, fees, programme rates/terms/eligibility | 26 | 468,469,470,471,472,513,569,570,571,572,597,598,604,619,620,621,623,625,670,671,672,673,674,675,676,677 | Structured candidates and live-fact FAQ templates; source describes public claims, not confidential customer data |
| Promotion banner metadata | 7 | 528,529,530,646,647,689,690 | Asset/offer candidates; no live promotion inferred from a label or URL |
| Specifications, counts, completion, parking ratios and type-use assertions | 29 | 476,487,489,514,516,579,583,584,585,589,590,592,593,594,595,596,600,601,602,603,627,629,631,633,635,668,669,680,682 | Typed facts with grain/as_of; retain qualitative remainder only after separating numbers |
| Location, travel and proximity | 15 | 474,491,493,494,495,508,509,574,575,587,588,684,685,686,687 | Typed places/distances/time plus narrative; AQ states both 270 m and 200 m to MRT Bang Krasor, requiring owner resolution |
| Future transport timing | 1 | 496 | Dated planned-service claim; do not present as operational transit |
| Quantified environmental claims | 4 | 500,501,502,503 | Reviewed typed sustainability claims with methodology/source/date; no unsupported savings assertion |
| Facility/service details | 2 | 605,606 | Typed floor/hours plus reviewed facility/security descriptions |
| Loan-document guidance | 1 | 616 | Public process FAQ; keep quantitative document-period requirements in approved programme/process terms |
| Media references containing specifications/floor applicability | 12 | 653,654,655,656,657,659,660,661,663,664,696,697 | Asset/type/plan candidates; separate measured specifications and rights review |

None is excluded merely because `is_sensitive=1`. Classification controls accuracy, tool routing and applicability, not a renewed DPO permission gate. The same cleaning applies to the 107 unflagged active entries.

## 5. Delivery increments after design review

| Increment | Deliverable and boundary | Acceptance evidence |
|---|---|---|
| 1 — Four-project pilot | `BPSK2`, `BNA7`, `AQ`, `HYABC`: reviewed identity links, draft narrative sections, FAQs, aliases, typed fact card, published retrieval index and authorized chatbot preview. HYABC uses the combined page with explicit applicability; unresolved phase facts stay unknown. Existing model facts may supply the card; new Marketing-type/media intake is later. Implement the minimal reviewed facility/nearby/contact projection needed for the card, with empty/unknown values where not reviewed | Deterministic scope/version tests, field mapping audit, preview with citations, threshold calibration, numeric-tool checks, atomic publish/withdraw/rollback tests on synthetic fixtures; no real publication without an explicit publisher action |
| 2 — Remaining approved snapshots | Batch the other **47 approved project-page snapshots** as drafts, and the 3 approved programme snapshots as shared content candidates; resolve mappings/dedup/applicability without overwriting existing Hub edits. Page count is not a guaranteed count of new Hub projects. Historical drafts/errors/superseded KM are not imported as live content | Dry-run reconciliation and reasons for every held/dropped item; exact replay no-op; changed source becomes review evidence; no automatic publication |
| 3 — Unit types and media | Review 217 source type entries, model associations and plan applicability; handle 250 reviewed-media rows plus eligible snapshot media references with byte-hash dedup and existing rights review. Complete the Marketing-type release contract before public serving | No inferred REM ModelID/unit allocation, no duplicate inventory totals, per-file rights/expiry/revocation, correct model/type/project scope |

Latest **retained reviewed** DW package: `20261005T025000717680Z`, manifest SHA-256 **`6251c4663d85303caeb5bb7469d79bd00b022f64f470486afcf14db050955ed3`**. Its manifest and `projects.json` hashes were verified locally; no live DW query or write occurred. There is no claim that a newer unprovided export does not exist.

| Pilot | Legacy page | Active KM | Approved FAQ occurrences | Raw REM ProjectStatus | Label | Deleted |
|---|---|---:|---:|---|---|---|
| `BPSK2` — SENA Kith Bangna KM.29 Phase 2 | `7` | 35 | 0 | `2` | Ready to move / พร้อมอยู่ | false |
| `BNA7` — FLEXI Mega Space Bangna | `16` | 73 | 23 | `2` | Ready to move / พร้อมอยู่ | false |
| `AQ` — FLEXI Rattanathibet | `18` | 96 | 25 | `2` | Ready to move / พร้อมอยู่ | false |
| `HYABC` — FLEXI Sathorn–Charoen Nakhon | `17`, shared with `HY2DE` | 0 | 13 on the combined page | `2` | Ready to move / พร้อมอยู่ | false |

Status mapping is the product owner's 3 October 2026 confirmation: `0` Presale / พรีเซล; `1` On Construction / กำลังก่อสร้าง; `2` Ready to move / พร้อมอยู่; `3` Closed / ปิดโครงการ; other/null Unknown / ไม่ทราบสถานะ, retaining raw value. Status does not approve source content or auto-withdraw a publication.

Pilot evaluation should include at least ten reviewed questions per project, shared-brand questions, ambiguous phase names, fee/offer expiry, AQ's distance conflict, blank model counts and withdraw/rollback cases. Hold out paraphrases from the legacy alternative questions to measure actual generalization. Tune FAQ thresholds by locale against false matches; target FAQ direct-answer precision at least 0.98, citation precision at least 0.95, section recall@5 at least 0.90, groundedness at least 0.95 and no-answer correctness at least 0.90. Cross-project leakage and unsupported numerical answers must be zero. These are proposed acceptance gates, not test results. Measure fact-card/read/retrieval latency and payloads; do not repeat the existing full-source-dictionary request on every chatbot turn.

## 6. Decisions requested from the owner

1. **Fact owners and freshness:** who maintains common fees, sinking funds, LivNex terms, dated travel/service and environmental claims, and what expiry/review intervals apply? Also confirm the legacy database timezone before interpreting its naive timestamps. Proposed default: no dynamic monetary answer until its owner, as_of and current validity are recorded; unknown source timezone remains explicit.
2. **Specific source conflicts:** confirm AQ's 200 m versus 270 m MRT distance and the grain of HYABC/HY2DE totals; provide the correct mapping for `BPEF2` and legacy page `13` when available. Proposed default: hold only the affected claims/mappings; continue drafting unambiguous pilot content.
3. **Shared content responsibility:** identify the publisher/content owner for brand/group/programme FAQs and confirm explicit applicability without automatic inheritance. Proposed default: publisher reviews every shared-content applicability change and sees all affected projects before release.

OpenAI use of this public KM is already authorized and is not an open question. Index model/dimension and match-threshold tuning are engineering proposals to validate, not additional business approval requests. This document stops at review; it does not start any increment.

## Appendix A. Physical source columns

Each source column maps to the listed target field(s), or an explicit drop. Proposed fields are governed by section 2. Repeated `metadata.*` targets preserve source evidence only. Source timestamps without a timezone remain raw with `source_timezone=unknown` until confirmed; do not silently assume UTC or Bangkok. Actual target instants use `timestamptz` and business displays use Asia/Bangkok.

### A.1 `campaign_projects` (51 rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `campaign_projects.id` | 51/51 (100.0%) | `staging.km_source_records.source_id` | Preserve exact source identifier as text in source-system/table namespace; new Hub UUID is separate. |
| `campaign_projects.source_row` | 51/51 (100.0%) | `staging.km_source_records.metadata.source_row` | Keep sheet row as lineage; not an identity or display order. |
| `campaign_projects.name` | 51/51 (100.0%) | `hub.projects.public_name`; `hub.entity_aliases.alias` | Split locale only with evidence; compare with existing published/REM names; no overwrite. |
| `campaign_projects.price_text` | 51/51 (100.0%) | `staging.km_fact_candidates.proposed_value` | Extract price/range/currency/conditions for owner review; no price prose in sections or embeddings. |
| `campaign_projects.tear_angle` | 50/51 (98.0%) | **DROP** from content; `staging.km_source_records.metadata.tear_angle` | Campaign sales slogan, mostly price/installment rhetoric; retain source evidence, not an evergreen project fact. |
| `campaign_projects.promotion_text` | 50/51 (98.0%) | `staging.km_fact_candidates.raw_text` | Split offers/conditions/effective dates; promote only through the promotion owner's existing process. |
| `campaign_projects.promotion_categories` | 50/51 (98.0%) | `staging.km_fact_candidates.metadata.promotion_categories` | Normalize offer categories after reviewing actual terms; source labels do not prove active eligibility. |
| `campaign_projects.selling_point` | 50/51 (98.0%) | `hub.content_sections.body`; `staging.km_fact_candidates.raw_text` | Split qualitative highlights from numeric, location and commercial claims; prefix scope name. |
| `campaign_projects.remark` | 1/51 (2.0%) | `staging.km_source_records.metadata.remark`; `hub.content_gaps.reason` | One populated row; review/mapping context only, never publish unexamined notes. |
| `campaign_projects.project_type` | 50/51 (98.0%) | `hub.commercial_types.product_form`; `staging.km_fact_candidates.fact_key` | Map legacy taxonomy to reviewed product form; do not overwrite REM ProjectType. |
| `campaign_projects.project_subtype` | 50/51 (98.0%) | `hub.project_facts.building_form` | Normalize low/high-rise or other form with source review; labels appear on non-condominium pages too. |
| `campaign_projects.location_text` | 50/51 (98.0%) | `hub.content_sections.body`; `hub.projects.address` | Review human location description; district/road references are not exact coordinates. |
| `campaign_projects.website_url` | 51/51 (100.0%) | `hub.content_sections.source_url`; `hub.project_contacts.website_url` | Canonical HTTPS URL, preserve original reference; check exact page/project applicability. |
| `campaign_projects.thumbnail_url` | 51/51 (100.0%) | `staging.km_asset_candidates.source_url` | Candidate thumbnail; metadata/URL is not downloaded content or rights approval. |
| `campaign_projects.listing_badge` | 36/51 (70.6%) | `hub.content_sections.summary`; `staging.km_fact_candidates.raw_text` | Review badge meaning; promotional/status claims go to typed owners, not a permanent label. |
| `campaign_projects.details_json` | 51/51 (100.0%) | `staging.km_source_records.payload.details_json` | Preserve container; map each profiled leaf in Appendix B, avoiding duplicate facts. |
| `campaign_projects.verification_json` | 51/51 (100.0%) | `staging.km_source_records.metadata.verification` | Keep historical collection/match flags; not Hub approval/readiness. |
| `campaign_projects.status` | 51/51 (100.0%) | `staging.km_source_records.metadata.legacy_status`; `hub.content_sections.status` | 50 published/1 draft are legacy states; every new Hub content candidate starts DRAFT. |
| `campaign_projects.sort_order` | 51/51 (100.0%) | `hub.content_sections.sort_order` | Only propose ordering within the correct scope; source page order is not factual ranking. |
| `campaign_projects.created_at` | 51/51 (100.0%) | `staging.km_source_records.source_created_at` | Preserve source timestamp separately; do not backdate Hub creation or claim a fact measurement date. |
| `campaign_projects.updated_at` | 51/51 (100.0%) | `staging.km_source_records.source_updated_at` | Preserve source change time; review/fact as_of and Hub updated_at remain distinct. |

### A.2 `campaign_project_links` (53 rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `campaign_project_links.id` | 53/53 (100.0%) | `staging.km_source_records.source_id` | Preserve exact source identifier as text in source-system/table namespace; new Hub UUID is separate. |
| `campaign_project_links.campaign_project_id` | 53/53 (100.0%) | `staging.km_scope_links.source_page_id` | Keep text source FK; page may represent multiple REM projects. |
| `campaign_project_links.project_id` | 53/53 (100.0%) | `staging.km_scope_links.rem_project_id` | Exact text match only: 52/53 verified against retained DW; BPEF2 remains unresolved. |
| `campaign_project_links.project_name_th` | 53/53 (100.0%) | `hub.entity_aliases.alias` | Source-name alias candidate; Thai field can contain mixed-language words; not a join key. |
| `campaign_project_links.project_name_en` | 53/53 (100.0%) | `hub.entity_aliases.alias` | English-name alias candidate; preserve missing/incorrect locale for review. |
| `campaign_project_links.brand` | 53/53 (100.0%) | `staging.km_scope_links.source_brand_label` | Resolve brand by existing exact mappings; never bind by display-name similarity. |
| `campaign_project_links.master_json` | 53/53 (100.0%) | `staging.km_source_records.payload.master_json` | Preserve original source claim container; leaf mapping below. |
| `campaign_project_links.needs_phase_review` | 53/53 (100.0%) | `staging.km_scope_links.needs_phase_review` | Six true link rows over three combined pages; false is filled but not proof of reviewed phase facts. |

### A.3 `project_content_snapshots` (580 rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `project_content_snapshots.id` | 580/580 (100.0%) | `staging.km_source_records.source_id` | Preserve exact source identifier as text in source-system/table namespace; new Hub UUID is separate. |
| `project_content_snapshots.campaign_project_id` | 580/580 (100.0%) | `staging.km_source_records.source_page_id` | Link approved snapshot to legacy page then reviewed applicability; not directly to one REM project. |
| `project_content_snapshots.source_url` | 580/580 (100.0%) | `hub.content_sections.source_url`; `hub.faqs.source_url` | Canonicalize URL safely, preserve original; no request/query credentials in citations. |
| `project_content_snapshots.content_hash` | 580/580 (100.0%) | `staging.km_source_records.content_hash`; `rag.knowledge_documents.source_hash` | Source content hash plus new hash for each transformed version; hash equality is provenance, not approval. |
| `project_content_snapshots.status` | 580/580 (100.0%) | `staging.km_source_records.metadata.legacy_status` | 51 approved are intake candidates; 427 drafts/102 errors remain historical evidence, not active content. |
| `project_content_snapshots.content_json` | 478/580 (82.4%) | `staging.km_source_records.payload.content_json` | 478 filled; use only approved snapshots for new content drafts; enumerate leaves below. |
| `project_content_snapshots.error_message` | 102/580 (17.6%) | **DROP** from public content; `staging.km_source_records.metadata.error_message` | 102 extraction errors, not project knowledge; retain in intake diagnostics without indexing. |
| `project_content_snapshots.fetched_at` | 580/580 (100.0%) | `staging.km_source_records.fetched_at` | Fetch date is not a fact as_of or Hub publication date; source timezone needs confirmation. |
| `project_content_snapshots.approved_at` | 51/580 (8.8%) | `staging.km_source_records.metadata.legacy_approved_at` | 51 legacy times; no recorded approving actor column in this table; obtain new Hub review. |
| `project_content_snapshots.created_at` | 580/580 (100.0%) | `staging.km_source_records.source_created_at` | Preserve source timestamp separately; do not backdate Hub creation or claim a fact measurement date. |

### A.4 `project_knowledge_items` (333 rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `project_knowledge_items.id` | 333/333 (100.0%) | `staging.km_source_records.source_id` | Preserve exact source identifier as text in source-system/table namespace; new Hub UUID is separate. |
| `project_knowledge_items.campaign_project_id` | 333/333 (100.0%) | `staging.km_scope_links.source_page_id` | Resolve through exact reviewed page links, then fill section/FAQ applicability. |
| `project_knowledge_items.knowledge_key` | 333/333 (100.0%) | `staging.km_source_records.metadata.knowledge_key`; `hub.faqs.source_key` | Keep source key; not globally unique, and project_name repeats within one page. |
| `project_knowledge_items.category` | 333/333 (100.0%) | `hub.knowledge_topics.code`; `hub.content_sections.topic`; `hub.faqs.topic` | Map Thai/English category variants through section 2.4; split mixed-topic answers. |
| `project_knowledge_items.keywords_json` | 333/333 (100.0%) | `hub.content_sections.keywords`; `hub.entity_aliases.alias` | Deduplicate wording, classify language; entity aliases require an actual reviewed target, not every keyword. |
| `project_knowledge_items.sample_questions_json` | 333/333 (100.0%) | `hub.faqs.canonical_question`; `hub.faqs.alt_questions` | Select one canonical intent; deduplicate equivalent variants; 289 question occurrences in active KM. |
| `project_knowledge_items.answer_text` | 333/333 (100.0%) | `hub.faqs.short_answer`; `hub.content_sections.body`; `staging.km_fact_candidates.raw_text` | Split narrative/structured claims; 34 active answers match broad commercial review terms; no unchecked number in generated answer. |
| `project_knowledge_items.source_type` | 333/333 (100.0%) | `staging.km_source_records.source_type` | Preserve five source kinds; full_content_search may contain conversation filler, not approved facts. |
| `project_knowledge_items.source_path` | 333/333 (100.0%) | `hub.faqs.source_ref`; `hub.content_sections.source_ref` | Resolve mixed bracket/dot/name path syntax against pinned source hash; retain raw path, flag failures. |
| `project_knowledge_items.source_excerpt` | 333/333 (100.0%) | `staging.km_source_records.source_excerpt` | Evidence for review; not a second public answer or embedding containing stale commercial values. |
| `project_knowledge_items.confidence` | 333/333 (100.0%) | `staging.km_source_records.metadata.extraction_confidence` | 0.90–1.00 source scores; extraction confidence is not truth or publication approval. |
| `project_knowledge_items.is_sensitive` | 333/333 (100.0%) | `staging.km_source_records.metadata.legacy_is_sensitive` | Preserve flag; classify 97 active rows by content, no access/OpenAI exclusion. |
| `project_knowledge_items.status` | 333/333 (100.0%) | `staging.km_source_records.metadata.legacy_status`; `hub.faqs.status` | 204 active become draft candidates, 7 require review, 122 superseded generate no content. |
| `project_knowledge_items.content_hash` | 333/333 (100.0%) | `hub.faqs.source_ref`; `hub.content_sections.source_ref` | All 204 active hashes match approved snapshots; preserve exact source linkage plus transformed hash. |
| `project_knowledge_items.usage_count` | 333/333 (100.0%) | **DROP** from canonical content; `staging.km_source_records.metadata.legacy_usage_count` | Legacy usage is not Hub analytics or answer quality; start new usage metrics separately. |
| `project_knowledge_items.created_at` | 333/333 (100.0%) | `staging.km_source_records.source_created_at` | Preserve source timestamp separately; do not backdate Hub creation or claim a fact measurement date. |
| `project_knowledge_items.updated_at` | 333/333 (100.0%) | `staging.km_source_records.source_updated_at` | Preserve source change time; review/fact as_of and Hub updated_at remain distinct. |

### A.5 `project_media_assets` (250 rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `project_media_assets.id` | 250/250 (100.0%) | `staging.km_source_records.source_id` | Preserve exact source identifier as text in source-system/table namespace; new Hub UUID is separate. |
| `project_media_assets.campaign_project_id` | 250/250 (100.0%) | `staging.km_asset_candidates.source_page_id` | Exact applicability via reviewed legacy-page mapping; combined-page assets need phase review. |
| `project_media_assets.project_content_snapshot_id` | 250/250 (100.0%) | `staging.km_asset_candidates.source_ref.snapshot_id` | Pin source snapshot; legacy numeric FK stays in its namespace. |
| `project_media_assets.image_url` | 250/250 (100.0%) | `staging.km_asset_candidates.source_url` | Preserve URL; later fetch through controlled asset ingestion and rights workflow. |
| `project_media_assets.image_url_hash` | 250/250 (100.0%) | `staging.km_asset_candidates.source_url_hash` | URL identity only; downloaded bytes get the existing asset checksum, never reuse URL hash as file checksum. |
| `project_media_assets.source_group` | 250/250 (100.0%) | `staging.km_asset_candidates.proposed_role` | Map unit_type/floor_plan/gallery/promotion/progress/map; a gallery is not automatically a hero image. |
| `project_media_assets.source_label` | 250/250 (100.0%) | `staging.km_asset_candidates.proposed_title` | Review label/locale and phase; not sufficient for alt text or technical applicability. |
| `project_media_assets.ai_suggested_tag` | 250/250 (100.0%) | `staging.km_asset_candidates.metadata.ai_suggested_tag` | Suggestion provenance only; never self-approves role or rights. |
| `project_media_assets.ai_secondary_tags` | 236/250 (94.4%) | `staging.km_asset_candidates.metadata.ai_secondary_tags` | 236 filled; retain suggestions for comparison to reviewed tags, not consumer output. |
| `project_media_assets.ai_confidence` | 250/250 (100.0%) | `staging.km_asset_candidates.metadata.ai_confidence` | Classification score only; not a rights/readiness score. |
| `project_media_assets.ai_reason` | 250/250 (100.0%) | `staging.km_asset_candidates.metadata.ai_reason` | Keep explanatory evidence, not public alt text or inferred specifications. |
| `project_media_assets.ai_status` | 250/250 (100.0%) | `staging.km_asset_candidates.metadata.ai_status` | Legacy job state; drop from published asset contract. |
| `project_media_assets.ai_model` | 250/250 (100.0%) | `staging.km_asset_candidates.metadata.ai_model` | Classifier provenance only; do not send this as public knowledge. |
| `project_media_assets.ai_analyzed_at` | 250/250 (100.0%) | `staging.km_asset_candidates.metadata.ai_analyzed_at` | Source analysis time, not rights effective date. |
| `project_media_assets.approved_tag` | 250/250 (100.0%) | `staging.km_asset_candidates.proposed_role` | Legacy human tag proposes Hub role; preserve differences from AI tag, require applicable Hub review. |
| `project_media_assets.approved_secondary_tags` | 236/250 (94.4%) | `staging.km_asset_candidates.proposed_tags` | 236 filled; controlled vocabulary mapping without declaring missing tags false. |
| `project_media_assets.unit_type` | 35/250 (14.0%) | `staging.km_asset_candidates.proposed_type_label` | Only 35/250 filled; names/ranges mixed, 215 unknown; no name-only join to REM models. |
| `project_media_assets.review_status` | 250/250 (100.0%) | `staging.km_asset_candidates.metadata.legacy_review_status` | All 250 approved for legacy review; Hub rights remain pending. |
| `project_media_assets.reviewed_by` | 250/250 (100.0%) | `staging.km_asset_candidates.metadata.legacy_reviewer_id` | Preserve legacy actor reference; do not map numeric user ID onto a Hub actor or import user accounts. |
| `project_media_assets.reviewed_at` | 250/250 (100.0%) | `staging.km_asset_candidates.metadata.legacy_reviewed_at` | Historical tag-review time; new authenticated Hub rights action remains necessary. |
| `project_media_assets.created_at` | 250/250 (100.0%) | `staging.km_source_records.source_created_at` | Preserve source timestamp separately; do not backdate Hub creation or claim a fact measurement date. |
| `project_media_assets.updated_at` | 250/250 (100.0%) | `staging.km_source_records.source_updated_at` | Preserve source change time; review/fact as_of and Hub updated_at remain distinct. |

### A.6 `solution_content_snapshots` (6 rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `solution_content_snapshots.id` | 6/6 (100.0%) | `staging.km_source_records.source_id` | Preserve exact source identifier as text in source-system/table namespace; new Hub UUID is separate. |
| `solution_content_snapshots.solution_key` | 6/6 (100.0%) | `hub.programmes.programme_key` | Controlled homeways/livnex/rentnex keys; do not infer project eligibility from programme existence. |
| `solution_content_snapshots.solution_name` | 6/6 (100.0%) | `hub.programmes.public_name` | Reviewed localized programme name; preserve source wording. |
| `solution_content_snapshots.source_url` | 6/6 (100.0%) | `hub.content_sections.source_url`; `hub.faqs.source_url` | Canonical public programme source with pinned version; not a project-specific offer. |
| `solution_content_snapshots.schema_version` | 6/6 (100.0%) | `staging.km_source_records.schema_version` | Validate expected structure before later intake; do not confuse source schema version with Hub content version. |
| `solution_content_snapshots.content_hash` | 6/6 (100.0%) | `staging.km_source_records.content_hash` | Immutable source hash; transformed sections/FAQ carry separate hashes. |
| `solution_content_snapshots.status` | 6/6 (100.0%) | `staging.km_source_records.metadata.legacy_status` | 3 approved versions selected; 3 drafts remain historical evidence; all new Hub content starts draft. |
| `solution_content_snapshots.content_json` | 6/6 (100.0%) | `staging.km_source_records.payload.content_json` | Programme content/FAQs become scoped sections/FAQ; all nested commercial values are routed out. |
| `solution_content_snapshots.error_message` | 0/6 (0.0%) | **DROP** from content; `staging.km_source_records.metadata.error_message` | 0/6 present; diagnostics only, never indexed. |
| `solution_content_snapshots.fetched_at` | 6/6 (100.0%) | `staging.km_source_records.fetched_at` | Fetch time, not programme terms as_of. |
| `solution_content_snapshots.approved_at` | 3/6 (50.0%) | `staging.km_source_records.metadata.legacy_approved_at` | 3/6 populated; legacy approval does not establish new Hub publication. |
| `solution_content_snapshots.created_at` | 6/6 (100.0%) | `staging.km_source_records.source_created_at` | Preserve source timestamp separately; do not backdate Hub creation or claim a fact measurement date. |

### A.7 `ai_language_terms` (99 rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `ai_language_terms.id` | 99/99 (100.0%) | `staging.km_source_records.source_id` | Preserve exact source identifier as text in source-system/table namespace; new Hub UUID is separate. |
| `ai_language_terms.canonical_key` | 99/99 (100.0%) | `hub.knowledge_terms.canonical_key` | Preserve vocabulary key; term identity differs from project identity. |
| `ai_language_terms.category` | 99/99 (100.0%) | `hub.knowledge_terms.category` | Controlled intent/facility/room/transport/project/other; only 5 project terms, 94 are other vocabulary. |
| `ai_language_terms.label_th` | 99/99 (100.0%) | `hub.knowledge_terms.label.th`; `hub.entity_aliases.alias` | Thai label as lexical candidate; target must be reviewed and language retained. |
| `ai_language_terms.label_en` | 99/99 (100.0%) | `hub.knowledge_terms.label.en`; `hub.entity_aliases.alias` | English canonical label; not proof that English narrative exists. |
| `ai_language_terms.status` | 99/99 (100.0%) | `staging.km_source_records.metadata.legacy_status`; `hub.knowledge_terms.status` | 99 active in legacy; review mapping before activation in project resolution. |
| `ai_language_terms.usage_count` | 99/99 (100.0%) | **DROP** from resolution score; `staging.km_source_records.metadata.legacy_usage_count` | Usage does not establish meaning or authority; new runtime counters start separately. |
| `ai_language_terms.created_by` | 0/99 (0.0%) | `staging.km_source_records.metadata.legacy_created_by` | 0/99 filled; leave unknown, never invent a creator or import accounts. |
| `ai_language_terms.approved_by` | 0/99 (0.0%) | `staging.km_source_records.metadata.legacy_approved_by` | 0/99 filled; new authenticated mapping review required. |
| `ai_language_terms.created_at` | 99/99 (100.0%) | `staging.km_source_records.source_created_at` | Preserve source timestamp separately; do not backdate Hub creation or claim a fact measurement date. |
| `ai_language_terms.updated_at` | 99/99 (100.0%) | `staging.km_source_records.source_updated_at` | Preserve source change time; review/fact as_of and Hub updated_at remain distinct. |

### A.8 `ai_language_aliases` (360 rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `ai_language_aliases.id` | 360/360 (100.0%) | `staging.km_source_records.source_id` | Preserve exact source identifier as text in source-system/table namespace; new Hub UUID is separate. |
| `ai_language_aliases.term_id` | 360/360 (100.0%) | `hub.entity_aliases.entity_id`; `hub.knowledge_terms.source_ref` | Map legacy term FK to canonical knowledge term or verified real entity; never treat term_id as REM ID. |
| `ai_language_aliases.alias_text` | 360/360 (100.0%) | `hub.entity_aliases.alias` | Preserve original; seed variants become resolution/topic candidates, not automatic project bindings. |
| `ai_language_aliases.normalized_text` | 360/360 (100.0%) | `hub.entity_aliases.normalized_alias` | Recompute NFC/space/case normalization; retain original normalization in evidence, never trim REM keys. |
| `ai_language_aliases.language` | 360/360 (100.0%) | `hub.entity_aliases.locale` | 211 th/149 en; mixed strings keep reviewed language, no automatic translation. |
| `ai_language_aliases.status` | 360/360 (100.0%) | `staging.km_source_records.metadata.legacy_status`; `hub.entity_aliases.status` | All legacy active; project resolution requires reviewed target and current public eligibility. |
| `ai_language_aliases.source` | 360/360 (100.0%) | `hub.entity_aliases.source` | All seed; preserve origin and source ref, never claim a human approved it. |
| `ai_language_aliases.confidence` | 360/360 (100.0%) | `staging.km_source_records.metadata.alias_confidence` | Legacy score is not a calibrated semantic-match threshold. |
| `ai_language_aliases.usage_count` | 360/360 (100.0%) | **DROP** from resolution score; `staging.km_source_records.metadata.legacy_usage_count` | Do not bias public project resolution using inherited usage counts. |
| `ai_language_aliases.created_at` | 360/360 (100.0%) | `staging.km_source_records.source_created_at` | Preserve source timestamp separately; do not backdate Hub creation or claim a fact measurement date. |
| `ai_language_aliases.updated_at` | 360/360 (100.0%) | `staging.km_source_records.source_updated_at` | Preserve source change time; review/fact as_of and Hub updated_at remain distinct. |

## Appendix B. Every profiled JSON leaf

Source names below are fully qualified. Each `[]` denotes an array path in the profile; its fill rate counts parent rows with at least one populated value, not the number of list elements. These mappings propose reviewed candidates; they never overwrite an existing Hub draft, confirmed mapping or source-owned fact.

### B.1 `campaign_projects.details_json` (51 parent rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `campaign_projects.details_json.building_count` | 11/51 (21.6%) | `hub.project_facts.building_count` | Integer candidate at reviewed project/phase grain; no source overwrite. |
| `campaign_projects.details_json.facilities[]` | 28/51 (54.9%) | `hub.project_facilities.facility_code`; `hub.project_facilities.description` | Split lists/prose, map vocabulary, preserve present/planned/unknown; do not count list entries as distinct facilities. |
| `campaign_projects.details_json.fact_source_url` | 51/51 (100.0%) | `staging.km_fact_candidates.source_ref.url` | Source for extracted facts; URL alone does not establish current authority/as_of. |
| `campaign_projects.details_json.features[]` | 1/51 (2.0%) | `hub.content_sections.body` | Qualitative highlight after stripping numeric/commercial claims; one page filled. |
| `campaign_projects.details_json.floor_count` | 18/51 (35.3%) | `hub.project_facts.floor_count` | Verify building/phase applicability; cannot assume every building has this height. |
| `campaign_projects.details_json.floor_count_text` | 1/51 (2.0%) | `staging.km_fact_candidates.raw_text`; `hub.project_facts.floor_count` | Parse only unambiguous floor counts; keep mixed/range text for review. |
| `campaign_projects.details_json.land_area_text` | 11/51 (21.6%) | `staging.km_fact_candidates.raw_text`; `hub.project_facts.land_area_sqm` | Parse Thai rai/ngan/square-wah only with explicit units, retain original; unknown is null. |
| `campaign_projects.details_json.phase_facts[].building_count` | 5/51 (9.8%) | `hub.project_facts.building_count` | Requires exact reviewed phase/project applicability; no copying combined totals. |
| `campaign_projects.details_json.phase_facts[].floor_count` | 5/51 (9.8%) | `hub.project_facts.floor_count` | Preserve phase grain and source row; do not infer model storeys. |
| `campaign_projects.details_json.phase_facts[].phase` | 5/51 (9.8%) | `staging.km_scope_links.phase_label` | Free label requires mapping to exact REM identity; unspecified phase stays unresolved. |
| `campaign_projects.details_json.phase_facts[].room_types[].area_sqm` | 1/51 (2.0%) | `hub.commercial_types.area_min_sqm`; `hub.commercial_types.area_max_sqm` | Typed area candidate for the reviewed phase/type, not a canonical REM area override. |
| `campaign_projects.details_json.phase_facts[].source_url` | 5/51 (9.8%) | `staging.km_fact_candidates.source_ref.url` | Pin specific page/PDF source to the phase claim. |
| `campaign_projects.details_json.phase_facts[].unit_count` | 5/51 (9.8%) | `hub.project_facts.total_unit_count` | Declared total only; distinct from available/priced units, no aggregation across ambiguous phases. |
| `campaign_projects.details_json.phase_scope_note` | 1/51 (2.0%) | `staging.km_scope_links.review_reason`; `hub.content_gaps.reason` | Combined-total warning retained; never expose as customer-facing fact. |
| `campaign_projects.details_json.project_url` | 1/51 (2.0%) | `hub.content_sections.source_url` | One extra source URL; reconcile to page URL, retain alternatives as evidence. |
| `campaign_projects.details_json.room_types[].area_sqm` | 38/51 (74.5%) | `hub.commercial_types.area_min_sqm`; `hub.commercial_types.area_max_sqm` | Equal bounds only for a confirmed exact area; strings/ranges parsed and reviewed. |
| `campaign_projects.details_json.room_types[].area_sqm_max` | 7/51 (13.7%) | `hub.commercial_types.area_max_sqm` | Positive numeric sqm; retain min/max relationship, no averaging. |
| `campaign_projects.details_json.room_types[].area_sqm_min` | 7/51 (13.7%) | `hub.commercial_types.area_min_sqm` | Positive numeric sqm; do not infer min from a type name. |
| `campaign_projects.details_json.room_types[].bathrooms` | 2/51 (3.9%) | `hub.commercial_types.bathrooms` | Known numeric count; blank is unknown. |
| `campaign_projects.details_json.room_types[].bedrooms` | 2/51 (3.9%) | `hub.commercial_types.bedrooms` | Known numeric count; no inference from string alone without review. |
| `campaign_projects.details_json.room_types[].land_area_sqwah_min` | 1/51 (2.0%) | `hub.commercial_types.land_area_sqm`; `staging.km_fact_candidates.unit` | Multiply confirmed square-wah by four for sqm, retain source unit and range semantics. |
| `campaign_projects.details_json.room_types[].parking_spaces` | 2/51 (3.9%) | `hub.commercial_types.parking_spaces` | Type-specific count; not shared project parking ratio. |
| `campaign_projects.details_json.room_types[].type` | 15/51 (29.4%) | `hub.commercial_types.public_name`; `hub.entity_aliases.alias` | Mixed marketing labels, many absent; never use as REM ModelID. |
| `campaign_projects.details_json.unit_count` | 25/51 (49.0%) | `hub.project_facts.total_unit_count` | Declared source total; phase/grain check and owner reconciliation required. |

### B.2 `campaign_projects.verification_json` (51 parent rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `campaign_projects.verification_json.master_match` | 51/51 (100.0%) | `staging.km_scope_links.legacy_match_status` | 50 matched/1 missing_or_partial are old judgments; recheck exact IDs against retained DW. |
| `campaign_projects.verification_json.needs_phase_review` | 51/51 (100.0%) | `staging.km_scope_links.needs_phase_review` | Three true page flags; false does not approve individual facts. |
| `campaign_projects.verification_json.notes` | 1/51 (2.0%) | `staging.km_scope_links.review_reason` | Preserve exception explanation, not public content. |
| `campaign_projects.verification_json.project_page_details` | 51/51 (100.0%) | `staging.km_source_records.metadata.collection_state` | All 51 say partially collected; never display as complete/verified. |
| `campaign_projects.verification_json.thumbnail_status` | 51/51 (100.0%) | `staging.km_asset_candidates.metadata.legacy_thumbnail_status` | 23 matched URL, 13 alternate URL, 15 not in supplied HTML; these are matching outcomes, not rights. |

### B.3 `campaign_project_links.master_json` (53 parent rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `campaign_project_links.master_json.area_district` | 53/53 (100.0%) | `hub.projects.address`; `hub.content_sections.body` | Review district wording/location; do not interpret as customer address or geographic identity key. |
| `campaign_project_links.master_json.brand` | 53/53 (100.0%) | `staging.km_scope_links.source_brand_label` | Compare with exact existing brand binding; no name-based mutation. |
| `campaign_project_links.master_json.bud` | 53/53 (100.0%) | **DROP** from knowledge; `staging.km_source_records.metadata.legacy_bud` | Financial/campaign cross-reference is not project knowledge; no ads/memo linkage changes. |
| `campaign_project_links.master_json.cms_id` | 53/53 (100.0%) | `staging.km_source_records.metadata.legacy_cms_id` | Keep CMS namespace for lineage; not REM ID or public ID. |
| `campaign_project_links.master_json.project_group_id` | 52/53 (98.1%) | `staging.km_scope_links.source_group_id` | 52 filled; compare exact REM group separately from Marketing namespaces; one missing remains visible. |
| `campaign_project_links.master_json.project_id` | 53/53 (100.0%) | `staging.km_scope_links.rem_project_id` | Exact text; cross-check outer link ID, stop on disagreement rather than choose one. |
| `campaign_project_links.master_json.project_name_en` | 53/53 (100.0%) | `hub.entity_aliases.alias` | Review locale/name alias; retain original even if a preferred public name differs. |
| `campaign_project_links.master_json.project_name_th` | 53/53 (100.0%) | `hub.entity_aliases.alias` | Source name only; duplicates cannot establish identity. |
| `campaign_project_links.master_json.project_subtype` | 53/53 (100.0%) | `hub.project_facts.building_form` | Reconcile with other subtype candidates; do not overwrite source enterprise fields. |
| `campaign_project_links.master_json.project_type` | 53/53 (100.0%) | `staging.km_fact_candidates.fact_key`; `hub.commercial_types.product_form` | Map taxonomy deliberately; enterprise project form remains source-owned. |
| `campaign_project_links.master_json.status` | 53/53 (100.0%) | `staging.km_source_records.metadata.legacy_project_status` | Legacy master claim only; fact card uses reviewed current REM raw/status label/as_of. |
| `campaign_project_links.master_json.website_url` | 53/53 (100.0%) | `hub.content_sections.source_url`; `hub.project_contacts.website_url` | Canonical source/public website candidate; differing URLs need page/phase review. |
| `campaign_project_links.master_json.zone_road` | 53/53 (100.0%) | `hub.projects.address`; `hub.content_sections.body` | Location context, no inferred coordinates, distance or traffic time. |

### B.4 `project_content_snapshots.content_json` (580 parent rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `project_content_snapshots.content_json.project.concept` | 448/580 (77.2%) | `hub.content_sections.body` | Scoped design/overview sections; split claims/offers, remove HTML/navigation noise, prefix project/brand name. |
| `project_content_snapshots.content_json.project.contacts.facebook_messenger_url` | 328/580 (56.6%) | `hub.project_contacts.messenger_url` | Official business contact only; preserve URL, validate destination. |
| `project_content_snapshots.content_json.project.contacts.line_id` | 463/580 (79.8%) | `hub.project_contacts.line_id` | Public project LINE handle; do not infer advertising account identity or CRM permission. |
| `project_content_snapshots.content_json.project.contacts.line_url` | 15/580 (2.6%) | `hub.project_contacts.line_url` | Reviewed official LINE URL; reconcile with handle without inventing missing link. |
| `project_content_snapshots.content_json.project.contacts.telephone` | 448/580 (77.2%) | `hub.project_contacts.telephone` | Preserve call-centre extensions, normalize dialing separately; mixed prose is reviewed. |
| `project_content_snapshots.content_json.project.documents[].title` | 447/580 (77.1%) | `staging.km_asset_candidates.proposed_title` | Brochure/document title; check locale, type and commercial claims before display/index. |
| `project_content_snapshots.content_json.project.documents[].url` | 447/580 (77.1%) | `staging.km_asset_candidates.source_url` | Later controlled document ingestion; title/link is not rights approval or permission for every embedded claim. |
| `project_content_snapshots.content_json.project.facilities[]` | 147/580 (25.3%) | `hub.project_facilities.facility_code`; `hub.project_facilities.description` | Mixed lists and prose; separate location/access/numeric details, deduplicate against facts.facilities. |
| `project_content_snapshots.content_json.project.facts.community` | 45/580 (7.8%) | `hub.nearby_places.name`; `hub.content_sections.body` | Review places/community narrative; verify each name and applicability. |
| `project_content_snapshots.content_json.project.facts.education` | 28/580 (4.8%) | `hub.nearby_places.name`; `hub.nearby_places.category` | School/university candidates; parse list, separate distance/time into typed fields. |
| `project_content_snapshots.content_json.project.facts.facilities` | 147/580 (25.3%) | `hub.project_facilities.facility_code`; `hub.project_facilities.description` | Mixed fact labels/strings; merge with facility list only after semantic review. |
| `project_content_snapshots.content_json.project.facts.hospital` | 46/580 (7.9%) | `hub.nearby_places.name`; `hub.nearby_places.category` | Hospital candidates; not a guaranteed emergency travel time. |
| `project_content_snapshots.content_json.project.facts.land area` | 10/580 (1.7%) | `hub.project_facts.land_area_sqm`; `staging.km_fact_candidates.raw_text` | Explicit unit parsing and phase grain; preserve raw mixed-language value. |
| `project_content_snapshots.content_json.project.facts.location` | 439/580 (75.7%) | `hub.projects.address`; `hub.content_sections.body` | Location description; split contacts/distance that are embedded in address prose. |
| `project_content_snapshots.content_json.project.facts.number of unit` | 205/580 (35.3%) | `hub.project_facts.total_unit_count` | Typed total with exact grain; not availability; avoid combined-page totals assigned to a phase. |
| `project_content_snapshots.content_json.project.facts.office worker` | 37/580 (6.4%) | `hub.nearby_places.name`; `hub.content_sections.body` | Employment-area context; do not invent buyer demographics or employment guarantees. |
| `project_content_snapshots.content_json.project.facts.parking` | 10/580 (1.7%) | `hub.project_facts.parking_ratio`; `hub.project_facilities.description` | Separate percentage/count/stacked-parking basis and access conditions. |
| `project_content_snapshots.content_json.project.facts.private living` | 9/580 (1.6%) | `hub.content_sections.body` | Qualitative living/design section, separate numerical/offer claims. |
| `project_content_snapshots.content_json.project.facts.project location` | 9/580 (1.6%) | `hub.projects.address`; `hub.content_sections.body` | Alias of location topic; reconcile with location.address, never duplicate contradictory values. |
| `project_content_snapshots.content_json.project.facts.project name` | 448/580 (77.2%) | `hub.projects.public_name`; `hub.entity_aliases.alias` | Name candidate/alias; preserve public-name ownership and existing edits. |
| `project_content_snapshots.content_json.project.facts.project type` | 308/580 (53.1%) | `staging.km_fact_candidates.fact_key` | Reconcile project form with enterprise identity; no silent type override. |
| `project_content_snapshots.content_json.project.facts.road` | 9/580 (1.6%) | `hub.projects.address`; `hub.content_sections.body` | Road name/context; preserve numeric road/name tokens as names, not distances. |
| `project_content_snapshots.content_json.project.facts.room type` | 89/580 (15.3%) | `hub.commercial_types.public_name`; `staging.km_fact_candidates.raw_text` | Split type labels/specs into candidates, no invented REM model association. |
| `project_content_snapshots.content_json.project.facts.shopping` | 9/580 (1.6%) | `hub.nearby_places.name`; `hub.nearby_places.category` | Retail/market candidates with typed distance/time if actually supplied. |
| `project_content_snapshots.content_json.project.facts.shopping & dinning` | 37/580 (6.4%) | `hub.nearby_places.name`; `hub.nearby_places.category` | Keep original misspelled source key in source_ref; controlled retail/dining target category. |
| `project_content_snapshots.content_json.project.facts.transport` | 9/580 (1.6%) | `hub.nearby_places.name`; `hub.content_sections.body` | Transit/access candidates; differentiate operating and planned service. |
| `project_content_snapshots.content_json.project.facts.transportation` | 37/580 (6.4%) | `hub.nearby_places.name`; `hub.content_sections.body` | Same controlled transport topic; reconcile duplicates and conflicting distances. |
| `project_content_snapshots.content_json.project.facts.unit type` | 15/580 (2.6%) | `hub.commercial_types.public_name`; `staging.km_fact_candidates.raw_text` | Marketing type/spec candidates only; repeated group labels do not prove unit membership. |
| `project_content_snapshots.content_json.project.facts.การเดินทาง` | 45/580 (7.8%) | `hub.nearby_places.name`; `hub.content_sections.body` | Thai transport label to same controlled topic; preserve time/mode/as_of as typed values. |
| `project_content_snapshots.content_json.project.facts.ตลาด` | 18/580 (3.1%) | `hub.nearby_places.name`; `hub.nearby_places.category` | Market list; no false precision for missing distance. |
| `project_content_snapshots.content_json.project.facts.สถานที่ใกล้เคียง` | 18/580 (3.1%) | `hub.nearby_places.name`; `hub.nearby_places.category` | Split nearby list and classify per place; unknown category stays reviewable. |
| `project_content_snapshots.content_json.project.facts.สถานศึกษา` | 18/580 (3.1%) | `hub.nearby_places.name`; `hub.nearby_places.category` | Education category, deduplicate name with other source refs after review. |
| `project_content_snapshots.content_json.project.facts.สถานศึกษา / โรงพยาบาล` | 9/580 (1.6%) | `hub.nearby_places.name`; `hub.nearby_places.category` | Split mixed education/hospital list; do not apply one category to all entries. |
| `project_content_snapshots.content_json.project.facts.ห้างสรรพสินค้า` | 27/580 (4.7%) | `hub.nearby_places.name`; `hub.nearby_places.category` | Retail places, source-based travel fields only. |
| `project_content_snapshots.content_json.project.facts.ห้างสรรพสินค้า / ตลาด` | 18/580 (3.1%) | `hub.nearby_places.name`; `hub.nearby_places.category` | Separate mall and market categories per actual place. |
| `project_content_snapshots.content_json.project.facts.โรงพยาบาล` | 54/580 (9.3%) | `hub.nearby_places.name`; `hub.nearby_places.category` | Hospital list; preserve conflicting source travel claims for review. |
| `project_content_snapshots.content_json.project.facts.โรงเรียน` | 36/580 (6.2%) | `hub.nearby_places.name`; `hub.nearby_places.category` | School list; no inferred catchment/admission rights. |
| `project_content_snapshots.content_json.project.faqs[].answer` | 429/580 (74.0%) | `hub.faqs.short_answer`; `staging.km_fact_candidates.raw_text` | Canonicalize equivalent answers with explicit applicability; commercial/numeric values become typed facts/templates. |
| `project_content_snapshots.content_json.project.faqs[].question` | 429/580 (74.0%) | `hub.faqs.canonical_question`; `hub.faqs.alt_questions` | Pair question with its answer; normalize for duplicate detection, retain meaningful punctuation/codes and scope. |
| `project_content_snapshots.content_json.project.floor_plans[].images[]` | 258/580 (44.5%) | `staging.km_asset_candidates.source_url` | Group source file refs under exact plan and reviewed floor/building/type applicability; rights pending. |
| `project_content_snapshots.content_json.project.floor_plans[].title` | 258/580 (44.5%) | `staging.km_asset_candidates.proposed_title`; `staging.km_asset_candidates.floor_applicability` | Parse named floor/range as candidate only; no inference from a typical-plan label. |
| `project_content_snapshots.content_json.project.gallery[].image_url` | 478/580 (82.4%) | `staging.km_asset_candidates.source_url` | Gallery candidates; byte-hash dedup later, preserve per-project bindings. |
| `project_content_snapshots.content_json.project.gallery[].title` | 478/580 (82.4%) | `staging.km_asset_candidates.proposed_title` | Labels may contain numeric type/area/offer claims; separate metadata from public narrative. |
| `project_content_snapshots.content_json.project.location.address` | 439/580 (75.7%) | `hub.projects.address` | Reviewed property address, retaining locale; separate mixed phone/contact text. |
| `project_content_snapshots.content_json.project.location.google_maps_url` | 388/580 (66.9%) | `hub.projects.map_url` | Reviewed map link; verify exact coordinates/project and use safe URL schemes. |
| `project_content_snapshots.content_json.project.location.latitude` | 448/580 (77.2%) | `hub.projects.latitude` | Numeric latitude; Thailand 5–21 check and location review; no default 0. |
| `project_content_snapshots.content_json.project.location.longitude` | 448/580 (77.2%) | `hub.projects.longitude` | Numeric longitude; Thailand 97–106 check and latitude pairing. |
| `project_content_snapshots.content_json.project.location.map_embed_url` | 478/580 (82.4%) | **DROP** raw embed; `hub.projects.map_url` | Do not publish arbitrary iframe HTML/URL; derive a safe maps link from reviewed location and retain original in evidence. |
| `project_content_snapshots.content_json.project.location.map_image_url` | 439/580 (75.7%) | `staging.km_asset_candidates.source_url` | Map graphic candidate, not geographic authority; existing asset rights review. |
| `project_content_snapshots.content_json.project.name` | 460/580 (79.3%) | `hub.projects.public_name`; `hub.entity_aliases.alias` | Keep source title and approved preferred name separately; no automatic overwrite. |
| `project_content_snapshots.content_json.project.nearby_places[].category` | 11/580 (1.9%) | `hub.nearby_places.category` | Map train/store/education/hospital to controlled categories; planned/unknown service is explicit. |
| `project_content_snapshots.content_json.project.nearby_places[].name` | 11/580 (1.9%) | `hub.nearby_places.name` | Reviewed localized place names; duplicates across prose and lists reconcile through evidence. |
| `project_content_snapshots.content_json.project.progress.images[]` | 249/580 (42.9%) | `staging.km_asset_candidates.source_url` | Dated progress-image references; not proof that completion is current. |
| `project_content_snapshots.content_json.project.progress.items[].label` | 239/580 (41.2%) | `hub.project_progress_facts.component` | Controlled construction component label, locale/source retained. |
| `project_content_snapshots.content_json.project.progress.items[].percent` | 239/580 (41.2%) | `hub.project_progress_facts.percent` | Numeric 0–100 plus source measurement date; null remains unknown. |
| `project_content_snapshots.content_json.project.progress.overall_percent` | 249/580 (42.9%) | `hub.project_progress_facts.overall_percent` | 22/51 approved snapshots claim 100, 25 lack a value; no evergreen completion statement without date/review. |
| `project_content_snapshots.content_json.project.progress.updated_text` | 137/580 (23.6%) | `hub.project_progress_facts.as_of`; `staging.km_fact_candidates.raw_text` | Parse Thai/BE dates only when unambiguous; only 15 approved pages supply a label, others unknown. |
| `project_content_snapshots.content_json.project.promotion_banners[].image_url` | 255/580 (44.0%) | `staging.km_asset_candidates.source_url` | Offer asset candidate linked to reviewed promotion; no narrative embedding/OCR of unchecked monetary terms. |
| `project_content_snapshots.content_json.project.promotion_banners[].title` | 255/580 (44.0%) | `staging.km_asset_candidates.proposed_title` | Generic Promotion 1 titles are not offer terms, validity or eligibility. |
| `project_content_snapshots.content_json.project.unit_types[].images[]` | 448/580 (77.2%) | `staging.km_asset_candidates.source_url` | Type/plan media candidates with reviewed exact type associations; no automatic canonical model binding. |
| `project_content_snapshots.content_json.project.unit_types[].name` | 448/580 (77.2%) | `hub.commercial_types.public_name`; `hub.entity_aliases.alias` | Mixed locale/name variants; type identity stays within the project and independent of REM IDs. |
| `project_content_snapshots.content_json.project.unit_types[].rooms[].count` | 357/580 (61.6%) | `hub.commercial_types.bedrooms`; `hub.commercial_types.bathrooms`; `hub.commercial_types.kitchens`; `hub.commercial_types.living_rooms` | Dispatch by reviewed room role; 206/937 approved component counts blank; no guessed count. |
| `project_content_snapshots.content_json.project.unit_types[].rooms[].name` | 448/580 (77.2%) | `staging.km_fact_candidates.fact_key`; `hub.commercial_types.room_labels` | Normalize room roles while retaining original labels; a bedroom number in a name needs review before typed assignment. |
| `project_content_snapshots.content_json.project.unit_types[].size` | 439/580 (75.7%) | `hub.commercial_types.area_min_sqm`; `hub.commercial_types.area_max_sqm` | Parse explicit sqm/ranges, normalize units, preserve variants; no fabricated usable-area meaning. |
| `project_content_snapshots.content_json.project.videos[].title` | 323/580 (55.7%) | `staging.km_asset_candidates.proposed_title` | Reviewed video title/scope; title does not establish reuse rights. |
| `project_content_snapshots.content_json.project.videos[].url` | 323/580 (55.7%) | `staging.km_asset_candidates.source_url` | Approved provider/link candidate; do not blindly embed arbitrary video HTML. |
| `project_content_snapshots.content_json.schema_version` | 478/580 (82.4%) | `staging.km_source_records.schema_version` | Validate source contract shape; not the Hub release version. |
| `project_content_snapshots.content_json.source.content_hash` | 478/580 (82.4%) | `staging.km_source_records.metadata.embedded_content_hash` | Cross-check outer snapshot hash semantics; keep both if hashes refer to different source representations. |
| `project_content_snapshots.content_json.source.edited_at` | 1/580 (0.2%) | `staging.km_source_records.metadata.legacy_edited_at` | One manual source edit; preserve raw timestamp/timezone uncertainty. |
| `project_content_snapshots.content_json.source.edited_manually` | 1/580 (0.2%) | `staging.km_source_records.metadata.legacy_edited_manually` | One marker; no automatic Hub review or approval implied. |
| `project_content_snapshots.content_json.source.excludes[]` | 478/580 (82.4%) | `staging.km_source_records.metadata.source_excludes` | Record collection exclusions so missing content is visible; source exclusion list cannot override Hub policy. |
| `project_content_snapshots.content_json.source.fetched_at` | 478/580 (82.4%) | `staging.km_source_records.metadata.embedded_fetched_at` | Compare with outer fetched_at; neither is a measured fact date by default. |
| `project_content_snapshots.content_json.source.line_contact_updated_at` | 3/580 (0.5%) | `staging.km_source_records.metadata.contact_source_updated_at` | Three captured rows; contact provenance only, not global content freshness. |
| `project_content_snapshots.content_json.source.progress_url` | 478/580 (82.4%) | `hub.project_progress_facts.source_url` | Specific progress evidence endpoint/page, preserve dates per claim. |
| `project_content_snapshots.content_json.source.url` | 478/580 (82.4%) | `hub.content_sections.source_url`; `hub.faqs.source_url` | Reconcile with snapshot/page URL; conflicting source references remain visible. |

### B.5 `solution_content_snapshots.content_json` (6 parent rows)

| Legacy field | Fill rate | Target table.field | Transformation / issues |
|---|---:|---|---|
| `solution_content_snapshots.content_json.schema_version` | 6/6 (100.0%) | `staging.km_source_records.schema_version` | Validate programme source schema, preserve history separately from content versions. |
| `solution_content_snapshots.content_json.solution.category` | 6/6 (100.0%) | `hub.programmes.category` | Controlled programme category, not project eligibility or contractual terms. |
| `solution_content_snapshots.content_json.solution.contacts[].label` | 6/6 (100.0%) | `hub.programmes.contacts.label` | Reviewed business contact label and locale. |
| `solution_content_snapshots.content_json.solution.contacts[].url` | 6/6 (100.0%) | `hub.programmes.contacts.url` | Public programme contact URL; validate and retain source ref. |
| `solution_content_snapshots.content_json.solution.content_blocks[]` | 6/6 (100.0%) | `hub.content_sections.body` | Programme-scoped sections, brand/programme prefix; split monetary/legal/eligibility claims into typed candidates. |
| `solution_content_snapshots.content_json.solution.faqs[].answer` | 2/6 (33.3%) | `hub.faqs.short_answer`; `staging.km_fact_candidates.raw_text` | Only two of six snapshots contain FAQ leaves; use approved versions and explicit project applicability. |
| `solution_content_snapshots.content_json.solution.faqs[].question` | 2/6 (33.3%) | `hub.faqs.canonical_question`; `hub.faqs.alt_questions` | Review programme intent and variants; answers cannot imply every project participates. |
| `solution_content_snapshots.content_json.solution.key` | 6/6 (100.0%) | `hub.programmes.programme_key` | Must agree with outer solution_key; conflict stops mapping for that record. |
| `solution_content_snapshots.content_json.solution.key_facts[]` | 3/6 (50.0%) | `staging.km_fact_candidates.raw_text`; `hub.programme_terms.rate`; `hub.programme_terms.duration_months` | Separate typed rates, durations, conditions and general guidance; all need owner/as_of review. |
| `solution_content_snapshots.content_json.solution.links[].label` | 6/6 (100.0%) | `hub.programmes.links.label` | Curated related-link label, not evidence of endorsement/eligibility. |
| `solution_content_snapshots.content_json.solution.links[].url` | 6/6 (100.0%) | `hub.programmes.links.url` | Reviewed safe links, no arbitrary fetch tool or automatic crawl. |
| `solution_content_snapshots.content_json.solution.name` | 6/6 (100.0%) | `hub.programmes.public_name` | Reconcile with outer solution_name; approved localized names become aliases. |
| `solution_content_snapshots.content_json.solution.pathways[]` | 6/6 (100.0%) | `hub.content_sections.body`; `staging.km_fact_candidates.raw_text` | Process explanation split from quantitative eligibility/contract terms. |
| `solution_content_snapshots.content_json.solution.summary` | 6/6 (100.0%) | `hub.content_sections.summary` | Clean localized programme synopsis; no stale rate/offer embedded. |
| `solution_content_snapshots.content_json.source.content_hash` | 6/6 (100.0%) | `staging.km_source_records.metadata.embedded_content_hash` | Keep embedded and outer content identity; validate before linking a source version. |
| `solution_content_snapshots.content_json.source.fetched_at` | 6/6 (100.0%) | `staging.km_source_records.metadata.embedded_fetched_at` | Source fetch time only; not a contract-effective date. |
| `solution_content_snapshots.content_json.source.policy` | 6/6 (100.0%) | `staging.km_source_records.metadata.source_policy` | Source extraction policy as evidence, not permission instructions or replacement for Hub review. |
| `solution_content_snapshots.content_json.source.url` | 6/6 (100.0%) | `hub.content_sections.source_url`; `hub.faqs.source_url` | Canonical programme source citation, distinct from project pages. |
