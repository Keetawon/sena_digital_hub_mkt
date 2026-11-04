# SENA Digital Hub & AI Knowledge Platform — Requirements Specification

**Version** 1.9 · **Date** 2026-09-21 · **Status** Draft for implementation — SENA residential back office and content supply for commercial websites and AI

**Audience:** engineering agent / implementation team. This document is self-contained — it does not
assume access to prior design conversations.

Keywords **MUST**, **MUST NOT**, **SHOULD**, **MAY** follow RFC 2119.
Priorities: **P0** = required for the assigned Phase 1 milestone (§1.3) · **P1** = optional within Phase 1 unless needed by a mandatory acceptance criterion · **P2** = Phase 2, after October 2026, subject to separate planning.

---

## 1. Context

SENA is a Thai property developer. Marketing content (project descriptions, images, floor plans,
promotions) is currently scattered across spreadsheets, a legacy CMS, and people's drives. The
website and a planned AI chatbot each source data independently, so they disagree.

This system is a central content and digital-asset platform that becomes the **single source of
truth** for everything customer-facing, consumed by the public website, an AI chatbot, and future
consumers through one versioned API.

**Phase 1 scope (September–October 2026): SENA residential only** — build the Thai staff back office and rich content platform for 7 pilot housing/condominium projects. Collect enterprise facts through the existing DW and Marketing contributions through forms, file uploads and imports; reconcile, enrich, approve and publish their brands, project structures, model types, assets, FAQs, documents and public promotions. Commercial websites are a primary consumer of the published APIs. The SENA residential AI pilot uses the same approved information through the separate chatbot repository.

**Internal users are 100% Thai-speaking**, as confirmed by the business owner. Staff menus, forms, help, errors, notifications and approval workflows MUST be in Thai. Technical identifiers and original source values remain unchanged. Content is authored in Thai by default; the existing locale-capable content schema remains available to consumers.

**Responsibility boundary:** this project owns the back-office application, data intake, rich content preparation and Hub-side integration that feeds the enterprise commercial websites. The separate website team owns commercial site design, frontend implementation, hosting, page rendering, website-side API/cache integration, language selectors, redirects and website launch/UAT. Website field mapping, API documentation and examples, consumer access setup, change feeds, signed webhooks and support for integration issues on the Hub side are in scope. Excluding commercial website construction does not exclude preparing and delivering its data.

Solar is deferred entirely to **Phase 2, after 2026-10-31**. Standalone Solar content, promotion authoring, product catalogues, source discovery/adapters, assistants, and BU workspaces MUST NOT be built or populated in Phase 1. Commercial website construction remains the website team's responsibility in every phase. EV, LivNex and other non-residential businesses are also outside Phase 1. A solar roof or EV charger included in an approved housing offer remains a residential benefit; it does not require a separate BU or product catalogue.

Use the residential brand/project/model structure. Phase 1 MUST NOT introduce a generic cross-BU product model, BU registry, or tenant/workspace framework for anticipated Phase 2 needs. Later extensions will be designed from confirmed Phase 2 requirements; schema changes are allowed then. This scope and §1.3 supersede broader BU examples and earlier dates in the design documents.

**20 September decision:** distinguish a Hub-owned **Marketing Unit Type (แบบขาย)** from each exact REM project model. Several REM models may support one commercial type; an acquired project's coarse REM model may support several separately evidenced commercial types. Company is optional source context in the Marketing workflow, not the project's navigation parent or a new Marketing completion task. [18 — Marketing types and amenities](docs/18-marketing-types-and-amenities.md) defines this contract, the initial draft-only increment, and deferred verification/publication work. These requirements are not a claim that the new catalogue, amenities, four-level FAQs or complete coverage workflow have already shipped.

**4 November 2026 decisions:** [47 — Unified content workspace](docs/47-unified-content-workspace.md) is authoritative for the staff navigation, authoring flow and content governance. Content is edited on one page per level (group «เครือ», a fixed business list «ธุรกิจ» starting with residential, brand, project), with FAQ, media and facts as tabs of that page. A Manager may edit and approve the same content version with a recorded reason; Online Marketing publishes approved versions and may not publish a version they edited, translated or self-approved; promotions keep their DATA + LEGAL review. Staff permission scope follows the marketing BUD taken from REM (`Sys_Admin_Bu.BUCode` via `Sys_Master_Projects.BUID`, delivered through the DW), with per-project exceptions. BUD membership mirrors the source system and is not a Hub-owned BU registry; the fixed business list is maintained only by migration. SEC-01/SEC-03 role names describe templates; publication rights follow docs/47 §5.

### 1.1 Systems in the landscape

| System | Role | Access |
|---|---|---|
| **REM** | Operational property system (SQL Server). Owns project/model IDs, unit inventory, pricing, and operational promotions. | Read-only from this system |
| **Enterprise DW** | Existing bronze/raw access to REM data for Hub intake and reconciliation; preserves source IDs and provenance. Source systems retain ownership of enterprise facts. | Read approved in-scope datasets; no DW redesign |
| **Digital Hub** (this system) | Thai back office for Marketing intake, enrichment, review and publication; owns marketing content, assets, public promotions, stored SEO metadata and the data APIs feeding websites/AI. | Read/write |
| **Marketing Ads sheet** | Google Sheet used by the content team as a media plan + post log. | Read-only, **MUST NOT be written to** |
| **Commercial websites** | Primary consumers of Hub content, built by the separate website team. The Hub team prepares data and supports the API contract; the website team implements and releases its sites. | Published API and asset delivery; no direct draft/source-table access |
| **AI Chatbot** | Separate repo (`sena_ai_chatbot_mkt`). Consumer of Hub API + RAG. | Consumer |
| **CRM** | Owns leads and customer data. | Out of scope; MUST NOT be touched |

### 1.2 Technology baseline

- **Database:** Supabase (PostgreSQL 15+), extensions `pgvector`, `pg_trgm`, `ltree`
- **Storage:** Supabase Storage
- **Auth:** Supabase Auth with row-level security
- **Timezone:** all business date logic MUST use `Asia/Bangkok`; timestamps stored as `timestamptz`
- **Languages:** Thai (`th`) for the staff interface and default authoring; locale-capable content storage retained for API consumers. Public website language rollout is outside scope.

### 1.3 Delivery milestones

**Capacity update, 18 September 2026:** the business owner confirmed one full-time developer assisted by Codex/agents. The two-developer dates below are retained as the original baseline, not a current capacity commitment. See the [dated status and proposed KPI forecast](docs/15-status-kpi-plan-20260918.md) for the provisional delivery scenario and 25 September review. No acceptance criteria or business deadlines are changed by that proposal.

These are planning targets, assuming two full-time developers, DW support, named content/publishing/legal owners, required service access by 18 September, website-team participation in data-contract review, and coordination with the separate chatbot repository for the AI pilot. A running commercial website or its deployment is not required for Hub acceptance. Hub-side integration is verified with an API test client and a controlled webhook/cache test harness, together with the website data handoff in A-21. Acceptance evidence, not the calendar alone, determines readiness.

| Target | Milestone | Required outcome |
|---|---|---|
| 2026-09-18 | Scope and access checkpoint | Identify the 7 residential projects, source/content owners and website integration contact; confirm source access and promotion rules; begin residential content intake and website field-contract review. |
| 2026-09-30 | Limited internal pilot | One real residential project, its minimum publishable model/assets/disclaimer, and an approved residential promotion complete the author → approve → publish → API → withdraw/rollback workflow. Required permissions and publishing gates remain enforced. |
| 2026-10-16 | Core SENA Hub MVP | All non-RAG P0 requirements, except the AI dependencies listed below, and A-01..A-16 plus A-19..A-22, for the 7 residential projects, including website-ready content/API handoff. |
| 2026-10-30 | SENA residential AI pilot | RAG requirements, their quality gates, A-17..A-20, evaluated on the 7 residential projects without requiring a commercial website launch. |
| After 2026-10-31 | Phase 2 | Solar and any other non-residential expansion are separately scoped after Phase 1 acceptance; no delivery date is committed. |

RAG-specific storage/indexing and `/v1/knowledge/feed` and `/v1/resolve` are due with the October AI pilot, not the September internal pilot. Required publishing and acceptance dependencies MUST be included even when the broader feature is marked P1. At the 25 September readiness review, demonstrate the real pilot workflow; if it cannot pass, keep 30 September as an internal demonstration and revise the release forecast rather than weakening acceptance gates. See [the delivery plan](docs/07-delivery-plan.md) for sequencing.

### 1.4 Data preparation and delivery ownership

| Work | Responsible team / platform behavior |
|---|---|
| Enterprise data intake | IT/DW supplies approved residential source data. Hub imports and reconciles source IDs/facts with provenance and freshness; operational values remain read-only. This is not permission to ingest unrelated enterprise datasets or personal data. |
| Marketing content intake | Marketing uses the Thai back office to enter descriptions, specifications it owns, facilities, nearby places, FAQs, promotions and SEO metadata, and upload images, floor plans and brochures. The Hub validates files/fields, links them to the correct project/model and supports review before publication. |
| Missing or conflicting information | Maintain an intake checklist for the 7 projects with field, owning source/team, required/optional status, current gap, owner and resolution status. Marketing supplies missing narrative/media; the source owner corrects enterprise facts. Missing required content blocks publication; optional gaps remain explicit in the API contract. |
| Publication and website data handoff | Hub delivers approved, versioned content and asset URLs, locale/fallback and freshness metadata, promotion validity/legal terms, API documentation, sample payloads and consumer onboarding. Hub and website teams review field mapping and record any gaps before the core handoff. |
| Commercial website application | Website team builds pages and interactions, implements API calls/cache handling, renders SEO and approved content, and operates/releases the commercial sites. Hub fixes issues in its data/API; website team fixes its application. |

The back office is itself a web application and is fully in scope. Content can support multiple locales through the existing schema; the staff interface and default authoring language remain Thai. Additional translation production and commercial website language rollout require their own agreed scope.

---

## 2. Glossary

Read this before implementing. Two pairs of terms are routinely confused and getting them wrong
produces a system that cannot be corrected later.

| Term | Definition |
|---|---|
| **REM name** | The name of a project/model as stored in REM. **Read-only in this system. MUST NEVER be overwritten.** |
| **Public name** | The marketing-approved customer-facing name, owned by Digital Hub. Project defaults come from verified Gold commercial names under CONT-11; brand/canonical-model defaults retain their REM provenance. New Marketing type names are separately authored or explicitly reviewed source suggestions. All public wording remains editable and requires publication approval. |
| **Project slug** | A URL-friendly technical content identifier, separate from official/commercial names and from the immutable public API key. Show it in advanced integration settings, not as “ชื่ออ้างอิงโครงการ” among the primary name fields. |
| **Offer** | An operational entitlement (discount, free transfer fee, gift) that sales can apply to a contract. **REM is the system of record.** ~7,676 rows exist. |
| **Public Promotion** | The marketing communication about one or more offers — title, artwork, legal terms. **Digital Hub is the system of record.** Expect dozens, not thousands. |
| **Project node** | Any element of a project's spatial hierarchy: phase, building, floor, zone, or cluster. |
| **REM project model** | An exact source `(ProjectID, ModelID)` such as `A1-1`, retaining its complete suffix and original name. REM `ModelTypeID`, REM `UnitTypeID` and individual `UnitID` are separate concepts. Existing canonical model records/public IDs keep this meaning. |
| **Marketing Unit Type / แบบขาย** | A Hub-owned commercial presentation with its own stable ID, name, specifications, content and assets. It may reference one or several exact REM project models; several types may reference one coarse REM model. A source association records lineage, not verified unit membership or operational eligibility. |
| **Entity** | Any addressable object: fixed SENA residential content context, brand, project, project node, canonical REM model, Marketing Unit Type, public promotion. The fixed residential context is not a generic BU registry. |
| **Consumer** | A registered API client (website, chatbot, partner). |
| **Structured data** | Data answerable by SQL/API (specs, prices, promotions, facilities). |
| **RAG content** | Narrative content answerable by retrieval (highlights, FAQ, policies). |

An Offer and a Public Promotion are **not** the same object and the relationship is **0..N in both
directions**. A Public Promotion may cite zero offers (e.g. an approved residential campaign that has no
REM record). An Offer may be cited by zero Public Promotions (most of the 7,676 are historical).

---

## 3. Architectural constraints (non-negotiable)

| ID | Constraint |
|---|---|
| **ARCH-01** | One field has exactly one owning system. Two systems MUST NOT write the same field. |
| **ARCH-02** | REM is the source of record for IDs, structure, inventory and price. The Hub MUST mirror these read-only and MUST NOT expose any UI to edit them, including for admins. |
| **ARCH-03** | The Hub is the source of record for public names, assets, descriptions, facilities, SEO and public promotions. No other system may write them. |
| **ARCH-04** | The RAG index is derived. It MUST be fully rebuildable from published content with zero data loss. |
| **ARCH-05** | Unit availability and price MUST NOT be stored in the Hub. They MAY be proxied through the Hub API with freshness metadata attached. |
| **ARCH-06** | Personal data (leads, customers) MUST NOT enter the Hub database, storage, or vector index. |
| **ARCH-07** | Filtering of unpublished/expired content MUST be enforced by database views and role grants, not by application code. |
| **ARCH-08** | Every record returned by the public API MUST be traceable to a version, a publisher, and a publish timestamp. |
| **ARCH-09** | Content that expires MUST disappear automatically through time-based view predicates. It MUST NOT depend on a scheduled job running. |

---

## 4. Platform and schema (PLAT)

| ID | P | Requirement |
|---|:-:|---|
| PLAT-01 | P0 | The database MUST be organised into schemas: `hub` (working content), `public_api` (published views only), `staging` (source mirrors), `rag` (index), `audit` (change log), `internal` (cost/budget/internal notes). |
| PLAT-02 | P0 | `public_api` MUST contain only views. No consumer-readable base tables. |
| PLAT-03 | P0 | Every content table MUST carry `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at`. |
| PLAT-04 | P0 | Deletion MUST be soft (`deleted_at`). Published content MUST NOT be hard-deleted. |
| PLAT-05 | P0 | Controlled vocabularies (`asset_role`, `facility_code`, `offer_type`, `document_type`, `node_type`) MUST be tables, not enums, so values can be added without a migration. |
| PLAT-06 | P0 | Storage buckets MUST be: `hub-originals` (private), `hub-published`, `hub-documents`, `hub-temp`. |
| PLAT-07 | P0 | Folder names MUST NOT encode relationships. All relationships live in the database. |
| PLAT-08 | P1 | Separate dev / staging / production environments MUST exist. After schema freeze, only additive migrations are permitted. |

---

## 5. Authentication, roles and access (SEC)

| ID | P | Requirement |
|---|:-:|---|
| SEC-01 | P0 | Roles MUST be: `admin`, `editor`, `publisher`, `legal`, `viewer`, `service_consumer`. |
| SEC-02 | P0 | `editor` MAY create and edit drafts and upload assets. MUST NOT publish. |
| SEC-03 | P0 | `publisher` MAY publish and roll back. |
| SEC-04 | P0 | `legal` MAY approve promotions and compliance text. MUST NOT edit content. |
| SEC-05 | P0 | `admin` MAY manage brands, taxonomies and users. |
| SEC-06 | P0 | `service_consumer` MUST have `USAGE` on `public_api` only, and no privileges on `hub`, `staging`, `internal`, or `rag`. This MUST be verified by an automated test that connects as that role and fails if any `hub` table is readable. |
| SEC-07 | P0 | The Supabase service role key MUST be used server-side only and MUST NOT appear in browser-delivered code. |
| SEC-08 | P0 | Each consumer MUST have its own API key, recorded in `hub.api_consumers` with owner, scope and rate limit. Keys MUST be individually revocable. |
| SEC-09 | P1 | Admin write endpoints MUST accept and honour an `Idempotency-Key` header. |
| SEC-10 | P1 | Rate limits MUST default to 600 reads/min and 60 writes/min per key. |
| SEC-11 | P1 | Rights-restricted assets MUST be served via signed URLs with a TTL of 15 minutes or less. |
| SEC-12 | P1 | All writes MUST be recorded in `audit.change_log` with actor, timestamp, before/after JSON and reason. |

---

## 6. REM synchronisation and crosswalk (REM)

| ID | P | Requirement |
|---|:-:|---|
| REM-01 | P0 | The system MUST ingest REM data into `staging` on a nightly schedule and on demand. |
| REM-02 | P0 | REM-sourced records MUST be stored with `source_snapshot_at` and a `source_fingerprint` (hash of the source payload). |
| REM-03 | P0 | Canonical crosswalks MUST retain exact `(ProjectID, ModelID)` and existing public model IDs with `match_method` (ID / EXACT_NAME / NORMALIZED / FUZZY / MANUAL), `match_confidence`, `match_status` (SUGGESTED / CONFIRMED / REJECTED), `verified_by`, `verified_at`. Marketing Unit Type source associations MUST be separate, project-scoped, auditable relationships; they MUST NOT replace canonical crosswalks or claim that lineage review verifies unit membership. |
| REM-04 | P0 | Matching MUST be attempted in this order: REM ID → previously approved mapping → normalized name → fuzzy. |
| REM-05 | P0 | Confidence thresholds MUST be: ≥0.95 auto-suggest with bulk-confirm affordance; 0.75–0.95 present as candidates requiring selection; <0.75 no suggestion, manual review only. |
| REM-06 | P0 | The system MUST NOT auto-confirm any mapping. A human MUST confirm. |
| REM-07 | P0 | AI/heuristics MAY propose public names. They MUST NOT set them. |
| REM-08 | P0 | Every residential project and canonical REM model MUST originate from a REM selection. Marketing Unit Types MAY be drafted, singly or in a bulk set, within a selected residential project before their source associations are resolved. Publication requires reviewed source lineage and adequate approved content evidence; unresolved unit membership MUST prevent operational price, inventory and promotion-eligibility claims. A project awaiting REM registration remains unpublishable. The initial commercial draft increment MUST NOT bypass existing publication gates. |
| REM-09 | P0 | When a fingerprint changes, the system MUST set `drift_status = 'source_changed'`, record it in a drift queue, and MUST NOT modify any public field. |
| REM-10 | P0 | When a REM record disappears, the system MUST set `drift_status = 'source_missing'` and MUST NOT auto-unpublish. It MUST alert after 7 days. |
| REM-11 | P0 | The sync job MUST distinguish "record genuinely removed" from "sync failed" by comparing total record counts before committing. A failed sync MUST NOT be treated as deletions. |
| REM-12 | P1 | The drift queue MUST be visible in the admin UI with the changed fields shown side by side. |
| REM-13 | P0 | The intake contract MUST identify each field's source table/column, complete key, business meaning, unit where applicable, owner, editability and missing/conflict handling. Source IDs, separate business codes and internal names MUST be preserved without replacing Hub UUIDs or stable public IDs. Source-owned values MUST remain distinct from Hub-owned supplements and explicitly permitted overrides. |
| REM-14 | P0 | The 20 September commercial-type decision refines the earlier “Unit Type = ModelID” shorthand: every source model MUST retain its complete REM `(ProjectID, ModelID)` key, while a Marketing Unit Type has separate Hub identity and explicit source associations. Preserve source codes exactly, including L/R suffixes; `ModelName`, `ModelTypeID`, `UnitTypeID` and individual `UnitID` MUST NOT replace the model key. Missing UnitTypeID is not a model-identity blocker. Grouping MUST NOT merge source keys, infer approved specifications, or auto-confirm crosswalks under REM-06. |
| REM-15 | P0 | Project-form enrichment MUST use a verified `gold.dim_project` snapshot keyed by exact `project_id`, with source payload, timestamp, fingerprint and verification provenance. Commercial fields come from the governed commercial Sheet through DW and MUST NOT impersonate REM brand-master identity. Missing or conflicting scalar values MUST remain explicit gaps. Refresh/default application MUST preserve saved Marketing edits and use the expected draft revision to reject stale writes. |
| REM-16 | P0 | `gold.dim_project_model` MAY supply commercial names and source metadata, but its grain is `(project_id, model_name)` with `model_ids` lineage. Intake MUST retain every underlying `(ProjectID, ModelID)` and MUST NOT create a fake scalar ModelID, merge distinct source codes, or infer approved specifications from aggregated areas. |
| REM-17 | P0 | Where commercial types share a coarse source model, operational resolution MUST use separately reviewed unit membership or a verified partition rule with evidence and scope. It MUST detect overlap and unassigned units, count each eligible unit once, and MUST NOT copy a source model's totals, prices or promotion eligibility onto every commercial type. Neither a source link, matching name nor content approval establishes a partition. Verified unit-partition authoring is outside the initial draft catalogue increment. |

The verified mappings, current implementation gaps and future source-ownership policy are recorded in [13 — Source identity and field ownership](docs/13-source-field-ownership.md). REM remains mandatory for Phase 1 project/source-model identities; Hub-owned commercial types use the reviewed relationships above. This does not add another BU, a source adapter, or a publishable project without REM registration.

---

## 7. Content model (CONT)

### 7.1 Brand

| ID | P | Requirement |
|---|:-:|---|
| CONT-01 | P0 | Brands MUST have an internal UUID, stable opaque `public_brand_id`, REM `rem_brand_id` and original brand names (read-only), editable public `brand_name`/description with Thai content, slug and status. REM identifiers MUST remain strings, including leading zeros. A brand MUST NOT be assumed to belong to one project company. |
| CONT-02 | P0 | Brands MUST support multiple logo variants distinguished by asset role (e.g. `logo_primary`, `logo_white`, `logo_mono`, `favicon`). |
| CONT-03 | P0 | Brands MUST be created by `admin` only. The project wizard MUST offer selection of an existing brand, plus a request-new-brand action routed to an admin. |
| CONT-04 | P0 | The Hub MUST stage the REM brand dictionary (`Sys_Master_Brands`) through the DW and retain source timestamps, fingerprints and deletion flags. Brand identity MUST NOT be inferred from project names or commercial-sheet labels. Editors/admins MAY edit Hub-owned brand content and logos; publisher approval is required to expose changes. |
| CONT-05 | P0 | A project's brand association MUST match its verified REM `BrandID`; missing, deleted or mismatched source brands MUST block publication. Brand and project-recorded company are separate relationships. Any future public reclassification needs an explicitly approved override policy; this slice MUST NOT silently rewrite REM structure. |
| CONT-06 | P0 | Project releases MUST freeze their approved brand version/content. Brand draft edits or a later brand release MUST NOT silently change a published project. Withdrawal of the brand, invalid source mapping, or invalid rights for referenced logos MUST make dependent published content unavailable. Brand publication, withdrawal and rollback MUST be audited. |

### 7.2 Project

| ID | P | Requirement |
|---|:-:|---|
| CONT-10 | P0 | Projects MUST store: `project_id` (internal UUID), `project_id_rem`, `public_project_id` (stable, opaque, never reused), `slug`, `project_name_rem` (read-only), `public_name` (i18n), `name_source` (`unset` \| `dw_default` \| historical `rem_default` \| `marketing_override`), `brand_id`, source `rem_brand_id`, available source `rem_company_id`/company names (read-only), `product_type`, `address`, `latitude`, `longitude`, `project_status`, `source_updated_at`. Company MUST be secondary/collapsed reference metadata, not a required Marketing input, navigation parent or content-completeness task. Changes of management MUST NOT recreate project/type/asset identities. This does not waive source integrity, legal disclosure or promotion-target rules. Any approved public company wording MUST remain project-specific. |
| CONT-11 | P0 | On new project creation, `public_name.th` and `public_name.en` MUST default from verified `gold.dim_project.commercial_project_name` and `commercial_project_name_eng`, respectively, and remain editable. Missing/conflicting commercial defaults MUST remain a visible gap rather than silently substituting the REM name. Preserve historical `rem_default` provenance and existing drafts; applying newly available defaults MUST NOT overwrite saved Marketing wording. Editing MUST set `name_source = 'marketing_override'`; record Gold default provenance separately from REM defaults. |
| CONT-12 | P0 | The public API path key MUST be `public_project_id`. `project_id_rem` MUST be returned as an attribute but MUST NOT appear in public URLs. |
| CONT-13 | P0 | Projects MUST store content metadata: `slug`, `meta_title`, `meta_description`, `og_image_asset_id`, and expose it through the API. Implementing website SEO tags, routes or pages is outside scope. |
| CONT-14 | P1 | Changing a `slug` MUST retain old-to-new slug metadata for consumers. Implementing HTTP redirects in an external website is outside scope. |
| CONT-15 | P0 | Coordinates from REM MUST be editable in the Hub (REM coordinates are frequently inaccurate). This is an explicit exception to ARCH-02 and MUST be recorded as an override. |
| CONT-16 | P1 | Price fields MUST be stored as a snapshot with `price_from`, `price_as_of`, `price_source`. They MUST NOT be presented as live prices. |
| CONT-17 | P0 | Add/Edit project MUST display the exact ordered fields in [17 — Project form and plans](docs/17-project-form-and-plans.md#ordered-project-fields): commercial brand, ProjectID, REM project group, REM Thai name, commercial Thai name, REM English name, commercial English name, Thai address, English address, latitude, longitude. Source identity/name fields MUST be read-only; commercial names, both addresses and coordinates MUST be editable. Address defaults MUST concatenate the requested nonblank components, with the common `postcode` used for English because `postcode_eng` is absent from the inspected Gold contract. |
| CONT-18 | P0 | The project workspace MUST use three tabs: `ข้อมูลโครงการ`, `แบบที่อยู่อาศัย`, and `เผยแพร่และประวัติ`. Project image/plan upload MUST appear directly below project details. Model entry MUST show project selection/context before details, images and layout plans. Primary field order MUST remain unchanged on narrow screens; source, editable and approval context MUST be visibly labelled. Switching tabs MUST preserve unsaved form state. Saving, model confirmation, asset-rights approval and publication MUST remain distinct actions. |

### 7.3 Spatial hierarchy

| ID | P | Requirement |
|---|:-:|---|
| CONT-20 | P0 | Phases, buildings, floors, zones and clusters MUST be modelled as a **single self-referencing tree table** (`hub.project_nodes`), not as separate tables per level. |
| CONT-21 | P0 | Each node MUST have: `node_type`, `parent_node_id`, `code`, `name_rem`, `public_name` (i18n), `name_source`, `sort_order`, `attrs` (JSONB), `path` (ltree, trigger-maintained), `status`. |
| CONT-22 | P0 | The tree MUST support condominium shapes (phase → building → floor) and low-rise shapes (phase → zone → cluster) without schema changes. |
| CONT-23 | P0 | Legal parent/child combinations MUST be defined in a `node_type_rules` table, not hardcoded. |
| CONT-24 | P0 | `attrs` SHOULD carry type-specific fields: building → `floors_above`, `floors_below`, `units_total`, `elevators`; floor → `floor_number`, `units_on_floor`, `is_typical_floor`; zone → `plots_total`. |
| CONT-25 | P0 | The editor MUST provide bulk floor creation ("create floors 1–N") and "apply this typical floor plan to floors X–Y". Manual entry of every floor is not acceptable. |
| CONT-26 | P0 | Subtree queries MUST be answerable in one query using the `path` column. |
| CONT-27 | P0 | Master plans MUST belong to the project or applicable phase. Building/floor plans MUST record spatial applicability through project nodes; one approved plan MAY apply to multiple floors. The bounded local project/model attachment slice MUST NOT be described as complete building/floor applicability management. |

### 7.4 Marketing Unit Types and canonical REM models

| ID | P | Requirement |
|---|:-:|---|
| CONT-30 | P0 | Marketing Unit Types MUST support queryable specifications: `bedrooms` (numeric, supports 2.5), `bathrooms`, `kitchens`, kitchen configuration, `usable_area_sqm`, `land_area_sqwah`, `frontage_m`, `depth_m`, `storeys`, `parking_spaces`, `ceiling_height_m`, `functional_rooms` (JSONB), `product_form`. Show fields applicable to the selected product form. Unknown is not zero. Verified varying areas MAY be an explicit range with its meaning/unit; do not average heterogeneous plans or select the first source value. Differences in room counts/layout MUST remain visible through appropriate sub-type/variant details before claiming a common specification. |
| CONT-31 | P0 | A Marketing Unit Type MUST have its own internal UUID and stable opaque public identifier, owning project, editable public name (i18n), description and specification provenance. Source links MUST support multiple exact REM models per type and multiple commercial types per coarse source model within the same project. Keep canonical `rem_model_id`/`public_model_id`, source evidence, existing assets and historical releases intact; never reinterpret an existing public model ID as a newly aggregated type. Source associations are not verified unit partitions. |
| CONT-32 | P0 | The system MUST be able to answer, by SQL and via API filters, queries such as "all approved Marketing Unit Types in project X with ≥3 bedrooms and ≥2 parking spaces". Unknown or varying specifications MUST NOT be asserted to satisfy a filter without an explicit applicable rule. Draft catalogue endpoints alone do not meet public API acceptance. |
| CONT-33 | P1 | Where the same REM ModelID has different layouts by building/floor, a model MUST support separate layout variants with their own plan assets/revisions and explicit spatial applicability, without duplicating its REM identity. Distinct real REM codes (including A/A1/A2 or L/R codes) MUST remain distinct canonical source mappings. A shared model or commercial name alone MUST NOT imply identical drawings. Variant assignment and detailed applicability UI are secondary to the initial project/model workflow. |
| CONT-34 | P0 | Within the selected project, Marketing MUST see a type summary list with name, specifications, source-link count and explicit gaps. An accessible expandable editor MUST group details, images/plans and source references, with draft save/cancel and unsaved-change protection. Multiple house-plan files MUST support order, floor labels and stated applicability; upload belongs inside the editor, while asset selection/preview MAY use a dialog. Upload alone MUST NOT approve rights or applicability. |
| CONT-35 | P0 | “Add types as a set” MUST bulk-create independent commercial draft records after row validation; a set is an entry aid, not a new mandatory hierarchy. Each record retains its own ID, details, plans, source associations and review state. Do not create fake REM IDs for acquired-project sub-types. Publication/API support for commercial types MUST explicitly freeze approved content, lineage and plan applicability; initial draft storage MUST NOT silently enter existing public snapshots. |

### 7.5 Narrative content, facilities, location, compliance

| ID | P | Requirement |
|---|:-:|---|
| CONT-40 | P0 | Narrative content MUST be stored as discrete sections (`hub.content_sections`) keyed by `entity_type`, `entity_id`, `section_key`, each with heading, markdown body per locale, sort order, and a `rag_eligible` flag. A single free-text `description` column is not acceptable. |
| CONT-41 | P0 | Project amenities MUST reference a controlled vocabulary table so that "does it have a pool?" is answerable as a structured query. Marketing supplies explicit `present`, `absent`, `planned` or `unknown` status; an omitted checkbox is not evidence of absence. Support details, location/shared-building applicability, access restrictions/hours where relevant, linked media, owner and review metadata. Expected amenities depend on project type; a missing/unknown answer is a gap, not a requirement that every project physically provide every amenity. |
| CONT-42 | P0 | Nearby places MUST store `category`, `name` (i18n), `transit_line`, `distance_m`, `travel_time_min`, `travel_mode`, coordinates, and `is_highlight`. |
| CONT-43 | P0 | FAQs MUST be discrete question/answer records scoped to the SENA group, a business from the fixed list maintained by migration (initially residential), a brand, a programme, a project or a Marketing Unit Type (docs/47 §6), with source/evidence, approver and effective/review dates. The answer level is set by the page on which it is written, not chosen from a list. Shared answers require explicit applicability and versioned references; they MUST NOT be copied or automatically inherited across all descendants. Changes MUST identify affected content without mutating historical releases. Completeness is measured against expected topics, not FAQ counts. Four-level FAQ authoring/review is a later increment than the initial commercial draft catalogue; it MUST NOT introduce a generic BU registry. |
| CONT-44 | P1 | Projects MUST store compliance fields: `license_no`, `license_issued_at`, `eia_status`, `land_title_no`, `ad_disclaimer` (i18n), `reviewed_by`, `reviewed_at`. |
| CONT-45 | P1 | The API MUST return the approved compliance text for consumers to reuse. Rendering that text in external websites or printed material is owned by those consumers. |
| CONT-46 | P1 | Entity aliases MUST be storable (`hub.entity_aliases`) with `alias`, `locale`, `alias_type` (former_name / nickname / misspelling / transliteration / rem_name) and `source`, indexed for trigram search. |

---

## 8. Internationalisation (I18N)

Staff-interface language and content locale are separate. The staff application is Thai; storing additional content locales does not require a multilingual admin or a public website. This section defines Hub behavior only, not a website-language rollout.

| ID | P | Requirement |
|---|:-:|---|
| I18N-01 | P0 | All public-facing text fields MUST be stored as JSONB keyed by BCP-47 locale (e.g. `{"th": "...", "en": "..."}`). |
| I18N-02 | P0 | `th` MUST be present for any entity to be publishable. |
| I18N-03 | P0 | The API MUST implement a fallback chain and MUST flag when a fallback was used (`is_fallback_locale: true`). |
| I18N-04 | P0 | Schema MUST accommodate additional locales (e.g. `zh-Hans`) without migration. |
| I18N-05 | P1 | A helper function `hub.i18n(value jsonb, locale text) returns text` MUST exist, with an index on the `th` value for search. |
| I18N-06 | P0 | Staff menus, forms, validation messages, upload/approval feedback, notifications and help MUST be in Thai. Thai-speaking marketing staff MUST be able to complete the workflow without translating English interface instructions. Preserve identifiers, original filenames and source values; allow editing other content locales within the Thai interface when supplied. |
| I18N-07 | P0 | New content entry MUST default to `th`. If AI assistance for staff is introduced under a separately scoped feature, explanations and draft image descriptions, alt text and content suggestions MUST default to Thai; foreign-language output requires an explicit target locale. This requirement does not add AI image analysis, generation or translation features to Phase 1. |

---

## 9. Assets (ASSET)

| ID | P | Requirement |
|---|:-:|---|
| ASSET-01 | P0 | A single asset registry MUST hold all files with: `asset_type`, `mime_type`, `original_filename`, `storage_bucket`, `storage_path`, `public_url`, `checksum`, `file_size`, `width`, `height`, `duration`, `version`, `language`, `owner`, `rights_status`, `effective_from`, `effective_to`, `status`. |
| ASSET-02 | P0 | Assets MUST be bindable to entities through a polymorphic link table with `entity_type`, `entity_id`, `asset_role`, `display_order`, `is_primary`, `alt_text` (i18n), `effective_from`, `effective_to`. |
| ASSET-03 | P0 | One asset MUST be bindable to multiple entities and roles simultaneously, with different alt text per binding. |
| ASSET-04 | P0 | A partial unique index MUST enforce at most one `is_primary` asset per (`entity_type`, `entity_id`, `asset_role`) among non-deleted rows. |
| ASSET-05 | P0 | Three ingest paths MUST be supported: file upload, selection from the asset library, and pasting an external URL. |
| ASSET-06 | P0 | **Mirror-on-ingest:** when a URL is pasted, the system MUST fetch the file into `hub-originals` and serve it from Hub storage. The original URL MUST be retained in `asset_sources.source_url` as provenance. An external URL MUST NOT be served to consumers. |
| ASSET-07 | P0 | If the fetch fails (e.g. the URL requires authentication), the asset MUST be marked `link_only`, MUST NOT be publishable in `hero` or `thumbnail` roles, and MUST enter a weekly link-health check queue. |
| ASSET-08 | P0 | On upload, `checksum` MUST be computed and a matching existing asset MUST be offered for reuse instead of creating a duplicate. |
| ASSET-09 | P0 | Asset provenance MUST record `source_system`, `source_job_id`, `source_url`, `ingest_method` (`upload` / `paste_url` / `link_only` / `jd_reference` / `migration` / `api`), `original_reference`. |
| ASSET-10 | P0 | External references (JD, Canva, Drive, DAM, legacy web) MUST be stored in a generic `hub.external_references` table, not as dedicated columns. |
| ASSET-11 | P0 | Bulk upload MUST be supported, with filename-convention parsing to pre-assign entity and role (e.g. `{PROJECT_CODE}__{level}__{ref}__{role}__{seq}.{ext}`). |
| ASSET-12 | P1 | Derived renditions MUST be storable (`purpose`, `format`, `width`, `height`, `page_number` for PDF pages). Supabase image transformation MAY be used instead for MVP, provided the recipe is recorded. |
| ASSET-13 | P1 | Video assets MUST record `provider` (youtube / vimeo / upload), `provider_video_id` and a poster frame. |
| ASSET-14 | P1 | `virtual_tour` MUST be a supported asset type (360 tours are standard in this industry). |
| ASSET-15 | P1 | When `rights_status` implies a licence expiry, the system MUST notify the asset owner 30 days before `effective_to`. |
| ASSET-16 | P0 | The local catalogue workflow MUST distinguish project `master_plan`, model `floor_plan`, and project/model image roles. Model-targeted bindings MUST verify the model belongs to the selected project. Plan/image upload or draft attachment MUST NOT imply reviewed rights, confirmed model mapping or publication. Approved releases MUST freeze the relevant model assets and retain existing rights/expiry/withdrawal access gates. |
| ASSET-17 | P0 | Each project media role MUST support multiple files, including `hero`, `thumbnail`, `master_plan`, `floor_plan` and `brochure`. Staff MUST be able to select several compatible files together, provide Thai alternative text per file, and append them without silently replacing existing bindings. Partial failures MUST identify unfinished files and allow retry without duplicating successful bindings. Project text being edited MUST survive media saves. At most one primary binding remains enforced where applicable; adding further files MUST NOT imply additional primary bindings or publication approval. |

---

## 10. Versioning and publishing (VER)

| ID | P | Requirement |
|---|:-:|---|
| VER-01 | P0 | Every publishable entity MUST have an immutable version history (`hub.entity_versions`) storing a full JSONB snapshot per version with `version_no`, `change_reason`, `created_by`. |
| VER-02 | P0 | Each entity MUST carry a `published_version_id` pointer. Publishing MUST be implemented as a pointer flip, not as a status mutation. |
| VER-03 | P0 | Multiple entity changes MUST be publishable as one atomic release (`hub.publish_sets`) within a single transaction. Consumers MUST NOT observe a partially published release. |
| VER-04 | P0 | Rollback MUST be available and MUST work by flipping pointers back. It MUST NOT require a database restore. |
| VER-05 | P0 | Lifecycle states MUST be: `draft`, `in_review`, `approved`, `scheduled`, `published`, `expired`, `archived`. |
| VER-06 | P0 | `expired` MUST be derived from time in the published view, not set by a job. |
| VER-07 | P0 | A publish readiness gate MUST block publishing when required fields are missing. Required fields per entity type MUST be configurable in `hub.publish_requirements`. |
| VER-08 | P0 | For a project, the minimum required set MUST include: `public_name.th`, `slug`, `address`, coordinates, a `thumbnail` asset, a `hero` asset, at least one approved model in the release, and `ad_disclaimer`. Existing canonical-model gates remain enforced while commercial types are draft-only; introducing commercial types into releases requires their own reviewed content, lineage and rights gates, with no silent reinterpretation of existing releases. |
| VER-09 | P0 | The admin UI MUST distinguish collection coverage, reviewed/current coverage and boolean publication eligibility. A percentage MUST use a versioned, applicable expected-item denominator, with numerator/denominator shown; arbitrary deductions per missing item are not completeness. Until that checklist exists, show concrete collected counts and named gaps without a completeness percentage. Each actionable gap MUST link to its field/entity; unresolved source/type coverage MUST remain visible rather than disappear from the denominator. |
| VER-10 | P1 | Scheduled publishing MUST be supported via `scheduled_at`. |
| VER-11 | P1 | Preview MUST be supported by requesting a specific `version_id` with a signed preview token (JWT, ≤30 min TTL, bound to version and user). |
| VER-12 | P1 | A diff view between the draft and the currently published version MUST be available. |

---

## 11. Promotions (PROMO)

### 11.1 Known facts about the REM promotion data

Verified read-only on 2026-09-14. These are historical source observations, not completed migration counts. Phase 1 uses the residential subset; references to other BUs do not expand the release scope.

- Source tables: `dbo.Sys_Prom_Promotion` → `dbo.Sys_Prom_PromotionDetails` → `dbo.Sys_Prom_PromotionUnits` (carries `ProjectID`), plus `dbo.Sys_REM_Master_Promotion`.
- `Sys_Prom_Promotion` columns include: `PromotionID`, `PromotionName`, `Description`, `StartDate`, `EndDate`, `isActive`, `isDelete`, `ActiveDate`, `FinishDate`, `CloseDate`, `SBUID`.
- Row counts: **7,676 total**; **440** with `isActive=1` and not deleted; **346** of those have no `EndDate`; **323** of those have no `EndDate` and started before 2026.
- Therefore `isActive=1` alone is **not** evidence that a promotion is currently running.
- Promotions tagged Solar (47) and EV (10) all carry a project signal — they are **housing promotions that include a solar or EV item**, not promotions of the Solar/EV business lines.
- `Sys_REM_Master_Promotion` has no start/end dates (Solar 85 rows / 82 not deleted; EV 8 rows). It is an **entitlement catalogue**, not a campaign schedule.
- The existing pipeline ingests only `Sys_REM_PromotionContract` and `Sys_REM_Master_Promotion`, which describe promotions *selected in a contract* — a different meaning from *currently on offer*.
- No source system has been identified for standalone Solar / EV / LivNex promotions. **Unverified.**

### 11.2 Source offers (mirror layer)

| ID | P | Requirement |
|---|:-:|---|
| PROMO-01 | P0 | Source promotions MUST be mirrored into `staging.source_offers`, one row per source promotion, read-only, with no editing UI. |
| PROMO-02 | P0 | The primary key MUST be a namespaced string: `{SOURCE_SYSTEM}:{NAMESPACE}:{TABLE_OR_TYPE}:{ID}` (e.g. `REM:SENA_PRD:Sys_Prom_Promotion:2609003000`). |
| PROMO-03 | P0 | Source identifiers MUST be stored as text, never as integers (to preserve leading zeros and accommodate alphanumeric IDs from other sources). |
| PROMO-04 | P0 | The mirror MUST store `source_active_flag`, `source_deleted_flag`, `start_at`, `end_at` (nullable), `sbu_id`, `source_created_at`, `source_modified_at`, `source_snapshot_at`, `source_fingerprint`. |
| PROMO-05 | P0 | Offer line items MUST be mirrored into `staging.source_offer_items` with `offer_type`, raw name, value type, amount, currency, percentage, quantity, display order. |
| PROMO-06 | P2 | Additional BU source systems and adapters MUST be assessed in Phase 2 after October. Phase 1 integrates REM only and MUST NOT add an adapter framework or generic product schema for unconfirmed future sources. |
| PROMO-07 | P1 | `offer_type` MUST reference a controlled vocabulary table, seeded from the `Sys_REM_Master_Promotion` entitlement catalogue. |

### 11.3 Temporal and status logic

| ID | P | Requirement |
|---|:-:|---|
| PROMO-10 | P0 | Five statuses MUST be modelled separately and MUST NOT be collapsed: `source_active_flag`, `temporal_status`, `approval` (data), `approval` (legal), `publication_status`, `visibility`. |
| PROMO-11 | P0 | `temporal_status` MUST be computed from a caller-supplied `as_of` date, not stored. Logic: `start > as_of` → `FUTURE`; `end < as_of` → `EXPIRED`; `start <= as_of AND (end IS NULL OR end >= as_of)` → `ACTIVE`; otherwise `UNKNOWN`. |
| PROMO-12 | P0 | `EndDate` MUST be treated as inclusive of the whole day, in `Asia/Bangkok`. |
| PROMO-13 | P0 | A promotion with no end date MUST NOT be publishable unless an explicit `open_ended_approved_by` **and** a `review_due_at` (≤90 days ahead) are both set. This MUST be enforced by a database CHECK constraint. |
| PROMO-14 | P0 | When `review_due_at` passes without renewal, the promotion MUST disappear from the public view automatically. |

### 11.4 Public promotions (editorial layer)

| ID | P | Requirement |
|---|:-:|---|
| PROMO-20 | P0 | `hub.public_promotions` MUST be a separate table owned by the Hub, holding `title` (i18n), `summary` (i18n), `conditions_public`, `legal_terms`, `disclaimer`, `stackable`, `priority`, `starts_at`, `ends_at`, `visibility[]`, approval fields, and `published_version_id`. |
| PROMO-21 | P0 | Public promotion text fields MUST NOT live on the same table as mirrored source fields, so that a source sync can never overwrite marketing copy. |
| PROMO-22 | P0 | A public promotion MUST be able to cite zero or more source offers via `hub.public_promotion_sources`, with an `is_primary` flag. |
| PROMO-23 | P0 | A SENA residential public promotion MUST be creatable with no source offer, subject to the same approvals and publication gates. This path MUST NOT permit standalone Solar or other non-residential promotions in Phase 1. |
| PROMO-24 | P0 | Campaigns MUST exist as an optional grouping layer (`hub.campaigns`) with `code`, `name` (i18n), `campaign_type`, `starts_at`, `ends_at`, `owner`. A promotion MUST be able to exist without a campaign. |
| PROMO-25 | P0 | Promotion artwork MUST be attached through the existing asset link table with `entity_type = 'public_promotion'`. |
| PROMO-26 | P0 | Cost, budget and internal notes MUST be stored in the `internal` schema, which `service_consumer` has no privileges on. |
| PROMO-27 | P0 | Both a data approval (by the data owner) and a legal approval (by `legal`) MUST be recorded before publishing. A single combined approval field is not acceptable. |

### 11.5 Entity association

| ID | P | Requirement |
|---|:-:|---|
| PROMO-30 | P0 | Residential promotion targets MUST support many-to-many associations. Company-, brand- and project-group-level residential campaigns need not store a single `ProjectID`; their applicability MUST resolve only to in-scope residential entities. |
| PROMO-31 | P0 | Phase 1 `target_entity_type` MUST support: `COMPANY`, `BRAND`, `PROJECT_GROUP`, `PROJECT`, `MODEL`, `UNIT`. Company and brand targets are limited to residential applicability. `BUSINESS` and generic non-residential products are deferred. |
| PROMO-32 | P0 | `relationship_role` MUST support at least: `OFFERED_BY`, `APPLIES_TO`, `PROMOTES`, `FULFILLED_BY`, `EXCLUDED_FROM`. |
| PROMO-33 | P0 | `project_applicability` MUST be one of `APPLIES`, `NOT_APPLICABLE`, `UNKNOWN`. An empty value MUST NOT be used, because it cannot distinguish "does not apply to projects" from "project not yet identified". |
| PROMO-34 | P0 | `mapping_status` MUST be `CANDIDATE`, `CONFIRMED` or `REJECTED`. Only `CONFIRMED` associations MUST reach the public API. |
| PROMO-35 | P0 | `match_method` MUST be recorded. A `ProjectID` obtained from `Sys_Prom_PromotionUnits` is direct evidence and MAY be `CONFIRMED` automatically. A project inferred from a name prefix MUST be `CANDIDATE` only. |
| PROMO-36 | P0 | Public promotion applicability MUST be established from confirmed residential associations, never inferred from promotion or offer-item names. No BU classification registry is required in Phase 1. |
| PROMO-37 | P0 | A solar or EV item appearing inside a housing promotion MUST remain an offer item (`offer_type = SOLAR_PACKAGE` / `EV_CHARGER`) on that residential promotion. It MUST NOT create standalone Solar/EV content, a BU record, or a separate product catalogue. |

The existing `MODEL` target denotes its canonical source-model identity. A new Marketing Unit Type or shared source association MUST NOT silently change that target's meaning or inherit unit-level eligibility; commercial-type operational resolution requires REM-17 verification. Company as secondary editor context under CONT-10 does not remove legal or promotion applicability requirements.

### 11.6 Resolution

| ID | P | Requirement |
|---|:-:|---|
| PROMO-40 | P0 | Given an in-scope residential entity and an `as_of` date, the system MUST resolve applicable promotions in this order: (1) gather all confirmed associations covering the entity at any level; (2) remove anything matching an `EXCLUDED_FROM` association — **exclusion always wins**; (3) filter by `temporal_status = ACTIVE`; (4) require both approvals and `published` status; (5) order by `priority` ascending, then specificity descending (`UNIT` > `MODEL` > `PROJECT` > `PROJECT_GROUP` > `BRAND` > `COMPANY`); (6) if `stackable = false`, return only the winner per `offer_type`. |
| PROMO-41 | P0 | Each returned promotion MUST include `applies_via`, naming the association level and role that granted it. |
| PROMO-42 | P0 | The public promotions view MUST exclude any promotion whose cited source offer has `source_deleted_flag = true` or `source_active_flag = false`. |
| PROMO-43 | P0 | When a source offer becomes inactive or deleted, the citing public promotion MUST be unpublished automatically, a cache purge webhook MUST fire, and the owner MUST be notified afterwards. This is a deliberate exception to REM-09: for promotion validity, the risk of leaving a withdrawn offer live outweighs the risk of unpublishing in error, and rollback is one click. |

### 11.7 Triage

| ID | P | Requirement |
|---|:-:|---|
| PROMO-50 | P0 | All 440 active, non-deleted REM promotions MUST be ingested into a triage queue. |
| PROMO-51 | P0 | Triage review scope for MVP MUST be limited to promotions associated with the 7 pilot projects. Remaining items MUST sit in the queue with a default of not published. |
| PROMO-52 | P0 | The queue MUST auto-classify into: has end date (temporal status computable); open-ended but started in the current year; open-ended and started before the current year (treated as suspected stale, default not published); expired or deleted (excluded). |
| PROMO-53 | P1 | Creating a public promotion from a triage item MUST prefill the title from the source name, which the editor then rewrites for customers. |

---

## 12. Ads registry integration (ADS)

### 12.1 Known facts about the source

Verified read-only on 2026-09-14 from the Google Sheet tab `Working file_for content team`.

- The sheet is a media plan and post log, not a registration system.
- Columns: `โพสต์ลำดับที่` (post seq), `เดือน` (month), `ใช้เงินก้อนไหน` (budget bucket), `Campaign`, `Content Type`, `Channel`, `Post Name`, `Artwork`, post date, `จำนวนวัน` (days), `Period Boost`, `Link Post`, `Budget`, `Memo`, `Ad Status`.
- The `Campaign` cell contains **both** a campaign code and a hyperlink to the destination URL, e.g. `Corp_PriceLimit` → `https://campaign.sena.co.th/pricelimit`.
- Observed campaign codes: `Corp_PriceLimit`, `Corp_TradeIn`, `Corp_GreenLifestyle_Jun2026`, `Corp_AlwaysOn_May2026`, `Corp_JulAlwaysOn`, `Corp_AugAlwaysOn`. Pattern: `{BU}_{CampaignCode}[_{Month}{Year}]`, roughly 80% consistent.
- Observed destination URLs map to distinct entity types: `sena.co.th/project/...` (project), `sena.co.th/brands/...` (brand), `senasolarenergy.com` (Solar business), `livnex.sena.co.th` (LivNex business), `tradecar.sena.co.th`, `campaign.sena.co.th/...` (campaign landing page).
- The team's UTM template already contains Meta dynamic macros: `utm_source`, `utm_medium`, `utm_campaign={{campaign.name}}`, `utm_content={{adset.name}}`, `meta_campaign_id={{campaign.id}}`, `meta_adset_id={{adset.id}}`, `meta_ad_id={{ad.id}}`, `utm_term={{ad.name}}`. Only a Facebook template was observed.
- A separate reporting tab has columns `DATE, YEAR, QUARTER, MONTH, BUD, Brand, Project ID, Agency, Project, Media Campaign, Objective, Amount Spent, ...`. **The `Project ID` column does not contain a REM ProjectID** — an observed row has `Brand=CORP`, `Project ID=PriceLimit`, `Project=จำกัดความแพง`, i.e. it holds a campaign code.
- Data quality issues observed: free text inside campaign names (e.g. `Corp_AlwaysOn_May2026 (ใช้เงิน Pricelimit)`), inconsistent month position, at least one exactly duplicated row.
- Export flattening dropped empty cells, so some column-to-value alignment is inferred. The adapter MUST re-verify against the Sheets API.

### 12.2 Requirements

| ID | P | Requirement |
|---|:-:|---|
| ADS-01 | P0 | The system MUST read the sheet via the Google Sheets API using a service account with viewer access. It **MUST NOT write to the sheet under any circumstances**. |
| ADS-02 | P0 | The sheet tab MUST be referenced by `gid`, not by tab name. |
| ADS-03 | P0 | Rows MUST be mirrored into `staging.ads_registry_rows` with a snapshot timestamp and a row fingerprint. |
| ADS-04 | P0 | The adapter MUST deduplicate rows on (month, post name, post permalink). |
| ADS-05 | P0 | The adapter MUST parse the `Campaign` cell into `campaign_code`, a raw business-prefix value, and `destination_url`, and MUST retain the raw text in `campaign_raw`. The prefix is source metadata, not authority to create a BU entity. Parenthesised free text MUST be stripped from the code but preserved in the raw field. |
| ADS-06 | P0 | The parser MUST accept both month positions (`Corp_AlwaysOn_May2026` and `Corp_JulAlwaysOn`). |
| ADS-07 | P0 | `hub.landing_page_map` MUST map URL patterns (exact / prefix / regex) to `target_entity_type` + `target_id`. This table is maintained in the Hub, not in the sheet. |
| ADS-08 | P0 | Destination URL matching MUST be the primary linking mechanism and MUST produce `CONFIRMED` links (`match_method = LANDING_PAGE`). |
| ADS-09 | P0 | A campaign code registry (`hub.ad_campaigns`) MUST exist as a secondary linking mechanism (`match_method = CAMPAIGN_REGISTRY`). Unknown codes MUST raise a warning and MUST NOT block ingestion. |
| ADS-10 | P0 | Fuzzy name matching MAY be implemented but MUST produce `CANDIDATE` links only. Auto-confirmation is forbidden. |
| ADS-11 | P0 | URLs with no entry in `landing_page_map` MUST appear in a URL inbox for a human to classify once as residential or `OUT_OF_SCOPE`. Known non-residential destinations MUST be marked `OUT_OF_SCOPE`; they MUST NOT require Solar/EV/LivNex entity creation or promotion authoring. These rows remain raw source records and are excluded from residential resolution metrics and publication alerts. |
| ADS-12 | P0 | **Budget bucket, campaign and content subject MUST be modelled as three separate dimensions** and MUST NOT be collapsed. Evidence: rows exist where the budget bucket is `PriceLimit`, the campaign is `Corp_AlwaysOn_May2026`, and the destination promotes a different project or business line entirely. |
| ADS-13 | P0 | Ad spend MUST remain at its native grain (ad / ad set / campaign). Spend figures MUST NOT be written into the campaign–promotion link table. |
| ADS-14 | P0 | "Spend per promotion" reports MUST use `is_primary = true` links by default so totals reconcile to actual spend without double counting. |
| ADS-15 | P0 | Any alternative allocation rule (equal split, weighted) MUST be a separately named and documented model, and every report MUST state which rule it used. Implicit derivation is forbidden. |
| ADS-16 | P1 | Any report aggregating across promotions MUST display the count of `CANDIDATE` links included, so readers can judge uncertainty. |
| ADS-17 | P1 | The system MUST raise an alert when an ad with `Ad Status = Active` is linked to a promotion whose `temporal_status` is `EXPIRED`. |
| ADS-18 | P1 | The system MUST raise an alert when a destination URL resolves to an entity that is unpublished, or resolves to nothing. |
| ADS-19 | P2 | The system MAY join Meta Ads API and GA4 data on `meta_campaign_id` / `meta_adset_id` / `meta_ad_id`. **Blocked until it is confirmed that GA4 captures these as custom dimensions** — they are not standard GA4 parameters and will otherwise be discarded on arrival. |
| ADS-20 | P2 | UTM templates for channels other than Facebook (TikTok, Google Ads) MUST be collected before those channels can be linked; each platform uses different macro syntax. |

---

## 13. Published content API (API)

| ID | P | Requirement |
|---|:-:|---|
| API-01 | P0 | All endpoints MUST be version-prefixed (`/v1/...`). Breaking changes MUST be announced ≥30 days ahead and MUST run two versions in parallel. |
| API-02 | P0 | Read endpoints MUST include at minimum: `/v1/brands`, `/v1/projects`, `/v1/projects/{id}`, `/v1/projects/{id}/structure`, `/v1/projects/{id}/models`, `/v1/projects/{id}/assets`, `/v1/projects/{id}/facilities`, `/v1/projects/{id}/nearby`, `/v1/projects/{id}/content`, `/v1/projects/{id}/faqs`, `/v1/projects/{id}/compliance`, `/v1/models/{id}`, `/v1/models/{id}/assets`, `/v1/promotions`, `/v1/campaigns/{code}`, `/v1/resolve`, `/v1/changes`, `/v1/knowledge/feed`. |
| API-03 | P0 | `/v1/projects` MUST support filtering by brand, product type, status, bedrooms, max price and nearby transit. |
| API-04 | P0 | `/v1/promotions` MUST accept `as_of`, `project_id`, `model_type_id`, `brand_id` and return only SENA residential promotions. `as_of` MUST default to today in `Asia/Bangkok`. `business_id` and non-residential promotion APIs are deferred; unsupported scope filters MUST be rejected rather than silently returning residential results. |
| API-05 | P0 | `/v1/resolve?q=` MUST map a free-text customer utterance to candidate entities using aliases and trigram similarity, for chatbot entity resolution. |
| API-06 | P0 | Every response MUST include a `meta` block with: `version`, `entity_version`, `published_at`, `source_updated_at`, `data_freshness`, `locale`, `is_fallback_locale`, `fallback_indicator`, `cache_ttl`. |
| API-07 | P0 | `fallback_indicator` MUST name which required elements are missing so the consumer uses a placeholder rather than sourcing content elsewhere. |
| API-08 | P0 | Availability and pricing endpoints MUST proxy REM and MUST attach freshness metadata. They MUST NOT serve stored values as if live. |
| API-09 | P0 | `/v1/changes?since={cursor}` MUST return a delta feed of published, rolled-back, expired and archived events with a `next_cursor`. |
| API-10 | P0 | Webhooks MUST be emitted for `content.published`, `content.rolled_back`, `promotion.activated`, `promotion.expired`, `asset.replaced`, signed with HMAC. |
| API-11 | P0 | `promotion.expired` MUST be emitted within 60 seconds of expiry. |
| API-12 | P0 | Promotion responses MUST carry `cache_ttl` ≤ 300 seconds **and** a `cache_expires_at` that does not cross midnight `Asia/Bangkok`, because `temporal_status` is date-dependent and a cached response becomes incorrect at the date boundary. |
| API-13 | P0 | Promotion responses MUST always include `legal_terms` and `disclaimer`. These MUST NOT be optional. |
| API-14 | P0 | Promotion responses MUST include `source_snapshot_at`. |
| API-15 | P0 | Admin endpoints MUST include asset creation, mirror-from-URL, entity patch, publish-set create/publish/rollback, crosswalk confirm, drift listing, and bulk import. |
| API-16 | P1 | Bulk import MUST accept CSV/XLSX matching the content schema and MUST report per-row validation errors without aborting the whole file. |
| API-17 | P0 | The Hub MUST provide a commercial-website data handoff: a field-to-source/API mapping with required/optional fields and gap owners, versioned API documentation, representative approved payloads and asset URLs, and instructions for per-consumer authentication, locale/fallback, freshness, promotion validity, change feeds and signed webhooks. Review the contract with the website team, provide a restricted test consumer and record Hub-side integration results. Website application code and deployment are owned by that team. |

---

## 14. RAG (RAG)

The Phase 1 assistant serves SENA residential projects only. All RAG P0 requirements and the evaluation gates below are due at the 30 October AI pilot. Out-of-scope questions MUST receive a scope explanation and an appropriate handoff when available, not an assertion that another BU has no offers.

| ID | P | Requirement |
|---|:-:|---|
| RAG-01 | P0 | The ingestion pipeline MUST read from `public_api` views only, never from `hub` tables, so unpublished content is structurally incapable of entering the index. |
| RAG-02 | P0 | Re-indexing a document MUST delete that document's chunks for prior versions and insert new chunks **within one transaction**. Insert-only re-indexing is a defect. |
| RAG-03 | P0 | A daily reconcile job MUST delete chunks whose parent document is no longer present in `public_api`. |
| RAG-04 | P0 | A database CHECK constraint MUST prevent documents with `content_domain` in (`promotion`, `price`, `availability`, `legal_contract`, `customer_data`) from being `rag_eligible`. |
| RAG-05 | P0 | Retrieval MUST apply metadata pre-filters (project, model, content domain, language, effective window) **before** vector search. |
| RAG-06 | P0 | Content sections and FAQs MUST map to chunks along their authored boundaries (one section or one Q+A pair per chunk), splitting only when a chunk exceeds the token budget. |
| RAG-07 | P0 | Every chunk MUST carry `citation_label` and a resolvable `citation_url` back to the source document version, using Hub document/version or API URLs subject to access controls. Citations MUST NOT depend on building external website pages. |
| RAG-08 | P0 | Chunks MUST record `source_version`, `embedding_model`, `token_count`, `lang_detected`. |
| RAG-09 | P0 | Documents MUST record `indexed_version` so index staleness is detectable. |
| RAG-10 | P1 | Retrieval MUST be hybrid: vector similarity plus lexical search, fused with Reciprocal Rank Fusion. Thai text MUST be word-segmented before lexical indexing (PostgreSQL has no Thai text-search configuration); `pg_trgm` MUST be used for names and codes. |
| RAG-11 | P0 | The chatbot MUST route price, availability, promotion and specification questions to structured tools. These MUST NOT be answered from RAG. |
| RAG-12 | P0 | Any numeric value in a generated answer MUST be traceable to retrieved context or a tool result; otherwise it MUST be removed from the answer. |
| RAG-13 | P0 | Once a conversation has established a project, subsequent retrieval MUST lock to that project. |
| RAG-14 | P0 | When evidence is insufficient the system MUST say so, offer human handoff, and log the question to `hub.content_gaps`. |
| RAG-15 | P0 | If a promotion has no end date, the answer MUST state that no end date is recorded. It MUST NOT invent one and MUST NOT claim the promotion has no expiry. |
| RAG-16 | P0 | `project_applicability = UNKNOWN` MUST NOT be answered as "applies". The system MUST state that applicability is unconfirmed and offer handoff. |
| RAG-17 | P0 | An evaluation set MUST exist covering: 7 residential projects × 8 question types; ≥20 adversarial questions that must be refused; ≥15 cross-project questions; ≥10 English questions. It MUST include an out-of-scope Solar question: the assistant explains its residential scope, does not claim Solar has no promotions, and does not substitute housing offers containing solar items. This is a boundary test, not Solar content onboarding. |
| RAG-18 | P0 | Evaluation thresholds MUST be: retrieval recall@5 ≥ 0.90; citation precision ≥ 0.95; groundedness ≥ 0.95; cross-project leakage = 0%; volatile-answer rate = 0%; no-answer correctness ≥ 0.90. Cross-project leakage and volatile-answer rate are hard failures. |
| RAG-19 | P0 | A re-index MUST NOT reach production if recall@5 drops by more than 3 points or any hard-failure metric is non-zero. |

---

## 15. Observability and operations (OBS)

| ID | P | Requirement |
|---|:-:|---|
| OBS-01 | P0 | Publish failures MUST alert the publisher and an operations channel. |
| OBS-02 | P0 | Sync jobs MUST record run status, record counts and duration in `audit`. |
| OBS-03 | P1 | A link-health job MUST check external reference URLs weekly and flag broken ones. |
| OBS-04 | P1 | `hub.content_gaps` MUST capture chatbot no-answer events and zero-result Hub/retrieval searches, with occurrence counts, and MUST be visible to editors as a work queue. Collecting website analytics or website 404 events is outside scope. |
| OBS-05 | P1 | API latency, error rate and per-consumer usage MUST be measurable. |
| OBS-06 | P1 | Database point-in-time recovery and storage bucket versioning MUST be enabled. |

---

## 16. Non-functional (NFR)

| ID | P | Requirement |
|---|:-:|---|
| NFR-01 | P0 | Read endpoints MUST respond in under 500 ms at p95 for the pilot dataset. |
| NFR-02 | P0 | All business date arithmetic MUST use `Asia/Bangkok`. |
| NFR-03 | P0 | The system MUST support at least Thai and English content without schema change. |
| NFR-04 | P1 | The admin UI MUST be usable by non-technical marketing staff without training beyond a one-page guide. |
| NFR-05 | P1 | Published Hub assets MUST support CDN delivery. Hosting or optimizing external website pages is outside scope. |
| NFR-06 | P1 | The system MUST handle the full REM promotion volume (7,676 rows, growing) in staging without degrading the admin UI. |

---

## 17. Acceptance criteria for Phase 1

Each item MUST be demonstrated, not asserted.

A-01..A-16 and A-21..A-22 apply to the 16 October core Hub milestone; A-17..A-18 apply to the 30 October AI pilot. A-19 and A-20 apply to every Phase 1 milestone. The smaller 30 September pilot demonstrates the one-project workflow in §1.3 and the delivery plan, including its approved brand, without bypassing security, approvals, or publication gates. Website data-contract review and Hub-side handoff are in scope; commercial website code, hosting and launch/UAT are not acceptance dependencies.

| # | Acceptance test |
|---|---|
| A-01 | Marketing staff create and publish all 7 pilot projects unaided. |
| A-02 | Every published project/canonical REM model has a confirmed REM crosswalk (100%, no candidates). Before commercial types enter public releases, demonstrate reviewed exact source lineage and approved content evidence; unresolved unit partitions cannot expose commercial-type operational prices, inventory or promotion eligibility. Draft-only types do not satisfy publication acceptance. |
| A-03 | Every canonical model and every expected commercial type in the 7-project intake has verified bedrooms, bathrooms and usable area (or an explicitly evidenced area range where applicable), with no unknown values hidden through grouping or omission. Track expected commercial-type coverage and source-model/unit coverage separately; source row counts alone cannot prove the commercial catalogue complete. |
| A-04 | A URL pasted into any asset field is fetched into Hub storage; the public API returns a Hub URL and no external URL appears anywhere in API output. |
| A-05 | Twelve edits across four entities are published as one release; a consumer polling during the publish never observes a partial state. |
| A-06 | That release is rolled back and the consumer returns to the previous state, verified by response payload comparison. |
| A-07 | Connecting as `service_consumer`, every attempt to read `hub`, `staging` or `internal` fails. |
| A-08 | Draft, archived and expired records are absent from the public API, verified by querying as the consumer role — not by code review. |
| A-09 | A residential promotion resolves correctly across `COMPANY`, `BRAND`, `PROJECT_GROUP`, `PROJECT`, `MODEL`, `UNIT`, including an `EXCLUDED_FROM` case where exclusion overrides a company-level inclusion. No `BUSINESS` entity is required. |
| A-10 | Setting a promotion's `ends_at` into the past causes it to disappear from the API without any job running. |
| A-11 | A promotion with no `ends_at` and no open-ended approval cannot be published; the database rejects the write. |
| A-12 | Marking a cited source offer inactive in `staging` causes the public promotion to unpublish and a webhook to fire. |
| A-13 | At a promotion date boundary, the Hub API excludes the expired promotion without a job; the signed expiry webhook arrives at a controlled test endpoint within 60 seconds, and a cache-contract test client retains no expired response beyond `cache_expires_at` or the 300-second maximum TTL. No external website is needed for this test. |
| A-14 | The publish readiness gate blocks a project missing a hero image, and names the missing field. |
| A-15 | Before evaluation, agree a dated sheet snapshot containing residential ads. Classify every row in that snapshot as residential or `OUT_OF_SCOPE`; unclassified rows block acceptance. The adapter resolves ≥90% of all residential rows to an entity via `landing_page_map`, retaining unresolved residential rows in the denominator, writes nothing to the sheet, and lists unresolved URLs in the inbox. Report total, residential, resolved, unresolved and `OUT_OF_SCOPE` counts separately; non-residential rows do not require Hub entities. |
| A-16 | An ad marked Active linked to an expired promotion raises an alert. |
| A-17 | A chatbot question about standalone Solar promotions receives a SENA-residential scope explanation and a handoff when available. It neither claims Solar has no offers nor returns housing promotions merely containing a solar item. |
| A-18 | RAG re-index of a modified FAQ leaves zero orphan chunks, verified by the reconcile job reporting zero. |
| A-19 | Phase 1 authoring and publication reject standalone non-residential content/promotions. Public APIs return only the in-scope residential catalogue; unsupported BU filters are rejected. Approved residential offers may retain solar/EV benefit items without creating a separate BU or product catalogue. |
| A-20 | Thai-speaking staff complete project entry, image upload, validation correction, promotion review and publication using Thai interface text and help. New content defaults to `th`; technical identifiers and original source values remain intact. |
| A-21 | Demonstrate the website handoff with a restricted test consumer: retrieve representative approved project/model content, images/floor plans/brochures, FAQs, promotions/legal terms and SEO/locale metadata with stable IDs and version/freshness information. Review the field-to-source/API mapping with the website team, resolve required-field gaps for the 7 projects, and record owners for optional gaps. Deliver the API/authentication/cache/change-feed/webhook guide with reproducible examples and test evidence. This verifies data readiness and Hub-side integration without building or launching a commercial website. |
| A-22 | Admin creates a brand from a staged REM identity; editor creation and admin publication are rejected. An editor edits Thai content and attaches approved logo variants; publisher releases and rolls back it. Demonstrate two projects under one brand with separate source companies, reject a source-brand mismatch, preserve published project payloads across brand draft edits/new releases, and block dependent access after brand withdrawal or referenced-logo rights revocation. An editor's missing-brand request reaches the admin queue and its resolution is audited. |

---

## 18. Out of scope for Phase 1

**Commercial website application delivery belongs to the separate website team:** public page design/build, hosting, website-side API/cache code, language selectors, SEO rendering, HTTP redirect deployment, website analytics instrumentation and commercial website launch/UAT. This applies to existing and new commercial sites. The Thai back office, Marketing/enterprise data intake, rich content and asset preparation, stored SEO/locale metadata, Hub-side API integration support and website data handoff remain in scope. Additional translation production is not a committed Phase 1 deliverable.

**Solar is entirely Phase 2, after October:** content intake, standalone promotions (including direct Hub authoring), product models, source discovery/adapters and assistants. The same exclusion applies to EV, LivNex and other non-residential BUs. Cross-BU workspaces, sharing controls and generic product modelling are deferred; do not scaffold them during Phase 1. Commercial website construction remains with the website team, not a Phase 2 Hub deliverable.

Also deferred: enterprise DAM migration · JD API automation · multi-level approval workflows beyond the promotion legal gate · image similarity search and image embeddings · advanced AI auto-tagging · migration of legacy assets for all 93 projects · Meta/GA4 creative performance analytics · real-time availability guarantees · net price calculation after promotions · per-customer promotion codes · A/B testing · ad spend allocation models · CRM/CDP integration and customer-specific advertising. Phase 2 requires a separate scope and estimate; November is the earliest planning window, not a promised Solar launch.

**Future source ownership:** a non-residential business may use another approved enterprise catalogue, an owner-governed spreadsheet, or a catalogue governed directly in Hub when no master exists. Any such path requires its own source/field ownership and approval contract; it MUST NOT manufacture REM IDs or bypass the residential REM requirement. Preserve stable Hub/public identities when later linking another source. This is a Phase 2 policy, not a requirement to build generic source or product infrastructure in Phase 1.

---

## 19. Open questions blocking implementation

Each MUST be answered by the named owner before the dependent requirements can be built. Questions whose dependencies are P2 are deferred until Phase 2; they MUST NOT block or consume Phase 1 delivery work.

| # | Question | Blocks | Owner |
|---|---|---|---|
| Q-01 | **Selection changed, 18 September:** the user now selects only `HYABC` (เฟล็กซี่ สาทร - เจริญนคร เฟส 1) for current intake, replacing `KUBON` and `B_PO`; see the [HYABC source review](docs/16-pilot-intake-hyabc.md). Which six additional projects complete the unchanged seven-project pilot? The former two-project evidence remains historical. Source selection does not confirm individual model crosswalks or authorize publication. | Content collection, PROMO-51 | Marketing |
| Q-02 | REM access — **partially answered:** the existing data warehouse already ingests from REM and Hub jobs will run on the same host, so Hub reads REM through the DW's **bronze/raw** layer rather than connecting to REM directly. Remaining: can the DW pipeline be extended to land `Sys_Prom_Promotion`, `Sys_Prom_PromotionDetails`, `Sys_Prom_PromotionUnits`, and is a raw (untransformed) layer exposed? | REM-01..12, PROMO-01..07 | IT / DW owner |
| Q-03 | Which promotion fields may be shown to customers and to AI? | PROMO-26, SEC-06 | Data owner |
| Q-04 | Who is the named publisher and who is the named legal approver? | SEC-03, SEC-04, PROMO-27 | Marketing / Legal |
| Q-05 | How should promotions with no end date be handled operationally (323 rows affected)? | PROMO-13, PROMO-52 | Data owner |
| Q-06 | Phase 2 only: what are the approved scope, content owners and source systems for standalone Solar / EV / LivNex offerings? | PROMO-06; deferred until after October, no Phase 1 discovery or direct-authoring workaround | BU owners |
| Q-07 | Does GA4 capture `meta_campaign_id` as a custom dimension? | ADS-19 | Marketing / analytics |
| Q-08 | External dependency for any future ADS-19 integration: what attribution fields can the website owner supply? | P2 discovery only; no landing-page or lead-form changes in this project | External website / analytics owner |
| Q-09 | Are there UTM templates for TikTok and Google Ads? | ADS-20 | Marketing |
| Q-10 | Is the ads sheet a single evergreen file or one per period? | ADS-01..03 | Content team |
| Q-11 | **Responsibility resolved:** the separate team builds commercial websites; Hub prepares their rich data and supports API integration. Remaining: name the website integration contact and review required fields, sample payloads and handoff expectations. | API-17, A-21; contract review is needed, commercial website go-live is not | Hub product owner / website team |
| Q-12 | **Resolved for Hub staff:** Thai interface and Thai default authoring. Additional supplied content locales use the existing schema; website-language choices and translation rollout are outside scope. | I18N-02, I18N-06, I18N-07; no website-language decision blocks Phase 1 | Marketing |
| Q-13 | Who owns content for each project (for notifications and review cadence)? | OBS-01, REM-12 | Marketing |
| Q-14 | **Does the company hold OpenAI *API* access (a key or an Azure OpenAI deployment), or only ChatGPT seats?** These are different products under different contracts; seats cannot power a chatbot. | All RAG generation | IT / procurement |
| Q-15 | For the licensed model: does it support function/tool calling and parallel tool calls, structured outputs, and prompt caching? What is its context window and rate limit? | RAG-11, RAG-12, retrieval depth, cost | IT |
| Q-16 | Hostinger VPS specification — vCPU, RAM, free disk, and region? Below ~8 GB RAM the API should not share the box with DW ETL and RAG ingestion. | Deployment topology, NFR-01 | IT |

---

## 20. Suggested build order

1. **Scope and intake (15–18 September):** identify the 7 SENA residential projects, source access and owners; review website data needs and create the field/source/gap checklist; finalize the residential model and publication requirements. No Solar discovery or BU framework work.
2. **Working residential pilot (21–30 September):** select one real project from REM; include its minimum model, required assets and disclaimer; author an approved residential promotion; publish through protected views and consume the API. Include versioning, publish sets, withdrawal and rollback from the start. Table count is not a constraint: the pilot MUST satisfy VER-08 and required approvals.
3. **Core Hub (1–16 October):** expand to 7 projects; complete project nodes, model specifications, content, facilities, compliance, bulk import, residential promotion resolution and source reconciliation. Complete residential ads mapping/alerts, Hub change-feed/webhook/cache contracts and the website data/API handoff using a test consumer, then demonstrate A-01..A-16 and A-19..A-22. Commercial website application implementation remains with the website team.
4. **SENA AI pilot (19–30 October):** ingestion, retrieval, structured tools, evaluation and human handoff for the 7 residential projects; demonstrate A-17..A-20 and RAG quality gates with the separate chatbot repository, without website delivery.
5. **Phase 2 (after October):** scope Solar and any other BU expansion using confirmed needs and a separate estimate.

Content collection MUST start in parallel on day one using a spreadsheet template matching the schema
and an enforced file-naming convention — for 7 projects this is roughly 300 records and 300 files,
and it is the true critical path, not the code.
