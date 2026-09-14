# SENA Digital Hub & AI Knowledge Platform — Requirements Specification

**Version** 1.0 · **Date** 2026-09-14 · **Status** Draft for implementation

**Audience:** engineering agent / implementation team. This document is self-contained — it does not
assume access to prior design conversations.

Keywords **MUST**, **MUST NOT**, **SHOULD**, **MAY** follow RFC 2119.
Priorities: **P0** = required for MVP (2026-09-30) · **P1** = required if time allows · **P2** = post-MVP.

---

## 1. Context

SENA is a Thai property developer. Marketing content (project descriptions, images, floor plans,
promotions) is currently scattered across spreadsheets, a legacy CMS, and people's drives. The
website and a planned AI chatbot each source data independently, so they disagree.

This system is a central content and digital-asset platform that becomes the **single source of
truth** for everything customer-facing, consumed by the public website, an AI chatbot, and future
consumers through one versioned API.

**Scope of first release:** 7 pilot residential projects, plus promotion data for all business units.

### 1.1 Systems in the landscape

| System | Role | Access |
|---|---|---|
| **REM** | Operational property system (SQL Server). Owns project/model IDs, unit inventory, pricing, and operational promotions. | Read-only from this system |
| **Digital Hub** (this system) | Owns marketing content, assets, public promotions, SEO. | Read/write |
| **Marketing Ads sheet** | Google Sheet used by the content team as a media plan + post log. | Read-only, **MUST NOT be written to** |
| **Website** | Public site. Consumer of Hub API. | Consumer |
| **AI Chatbot** | Separate repo (`sena_ai_chatbot_mkt`). Consumer of Hub API + RAG. | Consumer |
| **CRM** | Owns leads and customer data. | Out of scope; MUST NOT be touched |

### 1.2 Technology baseline

- **Database:** Supabase (PostgreSQL 15+), extensions `pgvector`, `pg_trgm`, `ltree`
- **Storage:** Supabase Storage
- **Auth:** Supabase Auth with row-level security
- **Timezone:** all business date logic MUST use `Asia/Bangkok`; timestamps stored as `timestamptz`
- **Languages:** Thai (`th`) required, English (`en`) prepared for

---

## 2. Glossary

Read this before implementing. Two pairs of terms are routinely confused and getting them wrong
produces a system that cannot be corrected later.

| Term | Definition |
|---|---|
| **REM name** | The name of a project/model as stored in REM. **Read-only in this system. MUST NEVER be overwritten.** |
| **Public name** | The marketing-approved customer-facing name. Owned by Digital Hub. Defaults to the REM name but is editable. |
| **Offer** | An operational entitlement (discount, free transfer fee, gift) that sales can apply to a contract. **REM is the system of record.** ~7,676 rows exist. |
| **Public Promotion** | The marketing communication about one or more offers — title, artwork, legal terms. **Digital Hub is the system of record.** Expect dozens, not thousands. |
| **Project node** | Any element of a project's spatial hierarchy: phase, building, floor, zone, or cluster. |
| **Model type** | A unit or house type (e.g. a 2-bedroom layout), with queryable specifications. |
| **Entity** | Any addressable object: brand, project, project node, model type, public promotion. |
| **Consumer** | A registered API client (website, chatbot, partner). |
| **Structured data** | Data answerable by SQL/API (specs, prices, promotions, facilities). |
| **RAG content** | Narrative content answerable by retrieval (highlights, FAQ, policies). |

An Offer and a Public Promotion are **not** the same object and the relationship is **0..N in both
directions**. A Public Promotion may cite zero offers (e.g. a Solar or corporate campaign that has no
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
| REM-03 | P0 | A crosswalk table MUST map REM model IDs to public model IDs with: `match_method` (ID / EXACT_NAME / NORMALIZED / FUZZY / MANUAL), `match_confidence`, `match_status` (SUGGESTED / CONFIRMED / REJECTED), `verified_by`, `verified_at`. |
| REM-04 | P0 | Matching MUST be attempted in this order: REM ID → previously approved mapping → normalized name → fuzzy. |
| REM-05 | P0 | Confidence thresholds MUST be: ≥0.95 auto-suggest with bulk-confirm affordance; 0.75–0.95 present as candidates requiring selection; <0.75 no suggestion, manual review only. |
| REM-06 | P0 | The system MUST NOT auto-confirm any mapping. A human MUST confirm. |
| REM-07 | P0 | AI/heuristics MAY propose public names. They MUST NOT set them. |
| REM-08 | P0 | Every Hub project and model record MUST originate from a REM selection. A "Pre-REM" creation path MAY exist but such records MUST NOT be publishable until mapped. |
| REM-09 | P0 | When a fingerprint changes, the system MUST set `drift_status = 'source_changed'`, record it in a drift queue, and MUST NOT modify any public field. |
| REM-10 | P0 | When a REM record disappears, the system MUST set `drift_status = 'source_missing'` and MUST NOT auto-unpublish. It MUST alert after 7 days. |
| REM-11 | P0 | The sync job MUST distinguish "record genuinely removed" from "sync failed" by comparing total record counts before committing. A failed sync MUST NOT be treated as deletions. |
| REM-12 | P1 | The drift queue MUST be visible in the admin UI with the changed fields shown side by side. |

---

## 7. Content model (CONT)

### 7.1 Brand

| ID | P | Requirement |
|---|:-:|---|
| CONT-01 | P0 | Brands MUST store `brand_name`, `public_company_name`, REM `company_id`/`company_name` (read-only), and status. |
| CONT-02 | P0 | Brands MUST support multiple logo variants distinguished by asset role (e.g. `logo_primary`, `logo_white`, `logo_mono`, `favicon`). |
| CONT-03 | P0 | Brands MUST be created by `admin` only. The project wizard MUST offer selection of an existing brand, plus a request-new-brand action routed to an admin. |

### 7.2 Project

| ID | P | Requirement |
|---|:-:|---|
| CONT-10 | P0 | Projects MUST store: `project_id` (internal UUID), `project_id_rem`, `public_project_id` (stable, opaque, never reused), `slug`, `project_name_rem` (read-only), `public_name` (i18n), `name_source` (`rem_default` \| `marketing_override`), `brand_id`, `product_type`, `address`, `latitude`, `longitude`, `project_status`, `source_updated_at`. |
| CONT-11 | P0 | `public_name` MUST default to `project_name_rem` on creation and MUST be editable. Editing MUST set `name_source = 'marketing_override'`. |
| CONT-12 | P0 | The public API path key MUST be `public_project_id`. `project_id_rem` MUST be returned as an attribute but MUST NOT appear in public URLs. |
| CONT-13 | P0 | Projects MUST store SEO fields: `slug`, `meta_title`, `meta_description`, `og_image_asset_id`. |
| CONT-14 | P1 | Changing a `slug` MUST create a redirect record from the old slug. |
| CONT-15 | P0 | Coordinates from REM MUST be editable in the Hub (REM coordinates are frequently inaccurate). This is an explicit exception to ARCH-02 and MUST be recorded as an override. |
| CONT-16 | P1 | Price fields MUST be stored as a snapshot with `price_from`, `price_as_of`, `price_source`. They MUST NOT be presented as live prices. |

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

### 7.4 Model type

| ID | P | Requirement |
|---|:-:|---|
| CONT-30 | P0 | Model types MUST store queryable specifications: `bedrooms` (numeric, supports 2.5), `bathrooms`, `usable_area_sqm`, `land_area_sqwah`, `frontage_m`, `depth_m`, `storeys`, `parking_spaces`, `ceiling_height_m`, `functional_rooms` (JSONB), `product_form`. |
| CONT-31 | P0 | Model types MUST store `rem_model_id`, `public_model_id` (unique), `slug`, `public_name` (i18n), `name_source`, and optional `node_id` when the model is specific to one phase or building. |
| CONT-32 | P0 | The system MUST be able to answer, by SQL and via API filters, queries such as "all model types in project X with ≥3 bedrooms and ≥2 parking spaces". |
| CONT-33 | P1 | Layout variants (A / A1 / A2 — mirrored or differently extended plans) MUST be representable without duplicating the whole model type. |

### 7.5 Narrative content, facilities, location, compliance

| ID | P | Requirement |
|---|:-:|---|
| CONT-40 | P0 | Narrative content MUST be stored as discrete sections (`hub.content_sections`) keyed by `entity_type`, `entity_id`, `section_key`, each with heading, markdown body per locale, sort order, and a `rag_eligible` flag. A single free-text `description` column is not acceptable. |
| CONT-41 | P0 | Facilities MUST reference a controlled vocabulary table (`facility_taxonomy`) so that "does it have a pool?" is answerable as a structured query, not by text search. |
| CONT-42 | P0 | Nearby places MUST store `category`, `name` (i18n), `transit_line`, `distance_m`, `travel_time_min`, `travel_mode`, coordinates, and `is_highlight`. |
| CONT-43 | P0 | FAQs MUST be stored as discrete question/answer records scoped to project and optionally model, with approver and effective dates. |
| CONT-44 | P1 | Projects MUST store compliance fields: `license_no`, `license_issued_at`, `eia_status`, `land_title_no`, `ad_disclaimer` (i18n), `reviewed_by`, `reviewed_at`. |
| CONT-45 | P1 | Compliance text MUST be returned by the API so that website, chatbot and printed material render identical wording. |
| CONT-46 | P1 | Entity aliases MUST be storable (`hub.entity_aliases`) with `alias`, `locale`, `alias_type` (former_name / nickname / misspelling / transliteration / rem_name) and `source`, indexed for trigram search. |

---

## 8. Internationalisation (I18N)

| ID | P | Requirement |
|---|:-:|---|
| I18N-01 | P0 | All public-facing text fields MUST be stored as JSONB keyed by BCP-47 locale (e.g. `{"th": "...", "en": "..."}`). |
| I18N-02 | P0 | `th` MUST be present for any entity to be publishable. |
| I18N-03 | P0 | The API MUST implement a fallback chain and MUST flag when a fallback was used (`is_fallback_locale: true`). |
| I18N-04 | P0 | Schema MUST accommodate additional locales (e.g. `zh-Hans`) without migration. |
| I18N-05 | P1 | A helper function `hub.i18n(value jsonb, locale text) returns text` MUST exist, with an index on the `th` value for search. |

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
| VER-08 | P0 | For a project, the minimum required set MUST include: `public_name.th`, `slug`, `address`, coordinates, a `thumbnail` asset, a `hero` asset, at least one published model type, and `ad_disclaimer`. |
| VER-09 | P0 | The admin UI MUST display a completeness percentage and an itemised list of what is missing, each item linking to the field. |
| VER-10 | P1 | Scheduled publishing MUST be supported via `scheduled_at`. |
| VER-11 | P1 | Preview MUST be supported by requesting a specific `version_id` with a signed preview token (JWT, ≤30 min TTL, bound to version and user). |
| VER-12 | P1 | A diff view between the draft and the currently published version MUST be available. |

---

## 11. Promotions (PROMO)

### 11.1 Known facts about the REM promotion data

Verified read-only on 2026-09-14. The implementation MUST account for these.

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
| PROMO-06 | P0 | Adding a new source system (Solar CMS, EV back office, LivNex) MUST require only a new adapter, with **no change to the canonical schema**. |
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
| PROMO-23 | P0 | A public promotion MUST be creatable with no source offer at all (for Solar, EV, LivNex, corporate campaigns). |
| PROMO-24 | P0 | Campaigns MUST exist as an optional grouping layer (`hub.campaigns`) with `code`, `name` (i18n), `campaign_type`, `starts_at`, `ends_at`, `owner`. A promotion MUST be able to exist without a campaign. |
| PROMO-25 | P0 | Promotion artwork MUST be attached through the existing asset link table with `entity_type = 'public_promotion'`. |
| PROMO-26 | P0 | Cost, budget and internal notes MUST be stored in the `internal` schema, which `service_consumer` has no privileges on. |
| PROMO-27 | P0 | Both a data approval (by the data owner) and a legal approval (by `legal`) MUST be recorded before publishing. A single combined approval field is not acceptable. |

### 11.5 Entity association

| ID | P | Requirement |
|---|:-:|---|
| PROMO-30 | P0 | Promotion targets MUST be modelled as many-to-many associations, **not** as a single scope enum, and MUST NOT require a `ProjectID`. |
| PROMO-31 | P0 | `target_entity_type` MUST support: `COMPANY`, `BUSINESS`, `BRAND`, `PROJECT_GROUP`, `PROJECT`, `UNIT`. |
| PROMO-32 | P0 | `relationship_role` MUST support at least: `OFFERED_BY`, `APPLIES_TO`, `PROMOTES`, `FULFILLED_BY`, `EXCLUDED_FROM`. |
| PROMO-33 | P0 | `project_applicability` MUST be one of `APPLIES`, `NOT_APPLICABLE`, `UNKNOWN`. An empty value MUST NOT be used, because it cannot distinguish "does not apply to projects" from "project not yet identified". |
| PROMO-34 | P0 | `mapping_status` MUST be `CANDIDATE`, `CONFIRMED` or `REJECTED`. Only `CONFIRMED` associations MUST reach the public API. |
| PROMO-35 | P0 | `match_method` MUST be recorded. A `ProjectID` obtained from `Sys_Prom_PromotionUnits` is direct evidence and MAY be `CONFIRMED` automatically. A project inferred from a name prefix MUST be `CANDIDATE` only. |
| PROMO-36 | P0 | The business line of a promotion MUST be derived only from confirmed associations. It MUST NOT be inferred from the promotion name or from offer item names. |
| PROMO-37 | P0 | A solar or EV item appearing inside a housing promotion MUST be represented as an offer item (`offer_type = SOLAR_PACKAGE` / `EV_CHARGER`) on a real-estate promotion. It MUST NOT be represented as a Solar or EV business promotion. |

### 11.6 Resolution

| ID | P | Requirement |
|---|:-:|---|
| PROMO-40 | P0 | Given an entity and an `as_of` date, the system MUST resolve applicable promotions in this order: (1) gather all confirmed associations covering the entity at any level; (2) remove anything matching an `EXCLUDED_FROM` association — **exclusion always wins**; (3) filter by `temporal_status = ACTIVE`; (4) require both approvals and `published` status; (5) order by `priority` ascending, then specificity descending (`UNIT` > `MODEL` > `PROJECT` > `PROJECT_GROUP` > `BRAND` > `BUSINESS` > `COMPANY`); (6) if `stackable = false`, return only the winner per `offer_type`. |
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
| ADS-05 | P0 | The adapter MUST parse the `Campaign` cell into `campaign_code`, `business_unit`, and `destination_url`, and MUST retain the raw text in `campaign_raw`. Parenthesised free text MUST be stripped from the code but preserved in the raw field. |
| ADS-06 | P0 | The parser MUST accept both month positions (`Corp_AlwaysOn_May2026` and `Corp_JulAlwaysOn`). |
| ADS-07 | P0 | `hub.landing_page_map` MUST map URL patterns (exact / prefix / regex) to `target_entity_type` + `target_id`. This table is maintained in the Hub, not in the sheet. |
| ADS-08 | P0 | Destination URL matching MUST be the primary linking mechanism and MUST produce `CONFIRMED` links (`match_method = LANDING_PAGE`). |
| ADS-09 | P0 | A campaign code registry (`hub.ad_campaigns`) MUST exist as a secondary linking mechanism (`match_method = CAMPAIGN_REGISTRY`). Unknown codes MUST raise a warning and MUST NOT block ingestion. |
| ADS-10 | P0 | Fuzzy name matching MAY be implemented but MUST produce `CANDIDATE` links only. Auto-confirmation is forbidden. |
| ADS-11 | P0 | URLs with no entry in `landing_page_map` MUST appear in a URL inbox for a human to classify once. |
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
| API-04 | P0 | `/v1/promotions` MUST accept `as_of`, `project_id`, `model_type_id`, `business_id`, `brand_id`. `as_of` MUST default to today in `Asia/Bangkok`. |
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

---

## 14. RAG (RAG)

| ID | P | Requirement |
|---|:-:|---|
| RAG-01 | P0 | The ingestion pipeline MUST read from `public_api` views only, never from `hub` tables, so unpublished content is structurally incapable of entering the index. |
| RAG-02 | P0 | Re-indexing a document MUST delete that document's chunks for prior versions and insert new chunks **within one transaction**. Insert-only re-indexing is a defect. |
| RAG-03 | P0 | A daily reconcile job MUST delete chunks whose parent document is no longer present in `public_api`. |
| RAG-04 | P0 | A database CHECK constraint MUST prevent documents with `content_domain` in (`promotion`, `price`, `availability`, `legal_contract`, `customer_data`) from being `rag_eligible`. |
| RAG-05 | P0 | Retrieval MUST apply metadata pre-filters (project, model, content domain, language, effective window) **before** vector search. |
| RAG-06 | P0 | Content sections and FAQs MUST map to chunks along their authored boundaries (one section or one Q+A pair per chunk), splitting only when a chunk exceeds the token budget. |
| RAG-07 | P0 | Every chunk MUST carry `citation_label` and a resolvable `citation_url` back to the source document version. |
| RAG-08 | P0 | Chunks MUST record `source_version`, `embedding_model`, `token_count`, `lang_detected`. |
| RAG-09 | P0 | Documents MUST record `indexed_version` so index staleness is detectable. |
| RAG-10 | P1 | Retrieval MUST be hybrid: vector similarity plus lexical search, fused with Reciprocal Rank Fusion. Thai text MUST be word-segmented before lexical indexing (PostgreSQL has no Thai text-search configuration); `pg_trgm` MUST be used for names and codes. |
| RAG-11 | P0 | The chatbot MUST route price, availability, promotion and specification questions to structured tools. These MUST NOT be answered from RAG. |
| RAG-12 | P0 | Any numeric value in a generated answer MUST be traceable to retrieved context or a tool result; otherwise it MUST be removed from the answer. |
| RAG-13 | P0 | Once a conversation has established a project, subsequent retrieval MUST lock to that project. |
| RAG-14 | P0 | When evidence is insufficient the system MUST say so, offer human handoff, and log the question to `hub.content_gaps`. |
| RAG-15 | P0 | If a promotion has no end date, the answer MUST state that no end date is recorded. It MUST NOT invent one and MUST NOT claim the promotion has no expiry. |
| RAG-16 | P0 | `project_applicability = UNKNOWN` MUST NOT be answered as "applies". The system MUST state that applicability is unconfirmed and offer handoff. |
| RAG-17 | P1 | An evaluation set MUST exist covering: 7 projects × 8 question types; ≥20 adversarial questions that must be refused; ≥15 cross-project questions; ≥10 English questions. It MUST include "what Solar promotions are there?" (correct answer: none as standalone Solar business promotions). |
| RAG-18 | P1 | Evaluation thresholds MUST be: retrieval recall@5 ≥ 0.90; citation precision ≥ 0.95; groundedness ≥ 0.95; cross-project leakage = 0%; volatile-answer rate = 0%; no-answer correctness ≥ 0.90. Cross-project leakage and volatile-answer rate are hard failures. |
| RAG-19 | P1 | A re-index MUST NOT reach production if recall@5 drops by more than 3 points or any hard-failure metric is non-zero. |

---

## 15. Observability and operations (OBS)

| ID | P | Requirement |
|---|:-:|---|
| OBS-01 | P0 | Publish failures MUST alert the publisher and an operations channel. |
| OBS-02 | P0 | Sync jobs MUST record run status, record counts and duration in `audit`. |
| OBS-03 | P1 | A link-health job MUST check external reference URLs weekly and flag broken ones. |
| OBS-04 | P1 | `hub.content_gaps` MUST capture chatbot no-answer events, website 404s and zero-result searches, with occurrence counts, and MUST be visible to editors as a work queue. |
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
| NFR-05 | P1 | The published page and each text asset MUST be servable through a CDN. |
| NFR-06 | P1 | The system MUST handle the full REM promotion volume (7,676 rows, growing) in staging without degrading the admin UI. |

---

## 17. Acceptance criteria for MVP

Each item MUST be demonstrated, not asserted.

| # | Acceptance test |
|---|---|
| A-01 | Marketing staff create and publish all 7 pilot projects unaided. |
| A-02 | Every published project and model type has a confirmed REM crosswalk entry (100%, no candidates). |
| A-03 | Every model type in the 7 projects has bedrooms, bathrooms and usable area populated. |
| A-04 | A URL pasted into any asset field is fetched into Hub storage; the public API returns a Hub URL and no external URL appears anywhere in API output. |
| A-05 | Twelve edits across four entities are published as one release; a consumer polling during the publish never observes a partial state. |
| A-06 | That release is rolled back and the consumer returns to the previous state, verified by response payload comparison. |
| A-07 | Connecting as `service_consumer`, every attempt to read `hub`, `staging` or `internal` fails. |
| A-08 | Draft, archived and expired records are absent from the public API, verified by querying as the consumer role — not by code review. |
| A-09 | A promotion resolves correctly across all six target entity types, including an `EXCLUDED_FROM` case where exclusion overrides a corporate-level inclusion. |
| A-10 | Setting a promotion's `ends_at` into the past causes it to disappear from the API without any job running. |
| A-11 | A promotion with no `ends_at` and no open-ended approval cannot be published; the database rejects the write. |
| A-12 | Marking a cited source offer inactive in `staging` causes the public promotion to unpublish and a webhook to fire. |
| A-13 | A promotion expiring at a date boundary is reflected on the website within 5 minutes. |
| A-14 | The publish readiness gate blocks a project missing a hero image, and names the missing field. |
| A-15 | The ads adapter ingests the sheet, resolves ≥90% of rows to an entity via `landing_page_map`, writes nothing to the sheet, and lists unresolved URLs in the inbox. |
| A-16 | An ad marked Active linked to an expired promotion raises an alert. |
| A-17 | A chatbot question "what Solar promotions are there?" does not return housing promotions that merely include a solar item. |
| A-18 | RAG re-index of a modified FAQ leaves zero orphan chunks, verified by the reconcile job reporting zero. |

---

## 18. Out of scope for this release

Enterprise DAM migration · JD API automation · multi-level approval workflows beyond the promotion legal gate · image similarity search and image embeddings · advanced AI auto-tagging · migration of legacy assets for all 93 projects · Meta/GA4 creative performance analytics · real-time availability guarantees · net price calculation after promotions · per-customer promotion codes · A/B testing · ad spend allocation models · Solar/EV/LivNex source adapters (create public promotions directly in the Hub instead until a source system is identified).

---

## 19. Open questions blocking implementation

Each MUST be answered by the named owner before the dependent requirements can be built.

| # | Question | Blocks | Owner |
|---|---|---|---|
| Q-01 | Which 7 projects are the pilot set (by name and REM ID)? | Content collection, PROMO-51 | Marketing |
| Q-02 | REM access — **partially answered:** the existing data warehouse already ingests from REM and Hub jobs will run on the same host, so Hub reads REM through the DW's **bronze/raw** layer rather than connecting to REM directly. Remaining: can the DW pipeline be extended to land `Sys_Prom_Promotion`, `Sys_Prom_PromotionDetails`, `Sys_Prom_PromotionUnits`, and is a raw (untransformed) layer exposed? | REM-01..12, PROMO-01..07 | IT / DW owner |
| Q-03 | Which promotion fields may be shown to customers and to AI? | PROMO-26, SEC-06 | Data owner |
| Q-04 | Who is the named publisher and who is the named legal approver? | SEC-03, SEC-04, PROMO-27 | Marketing / Legal |
| Q-05 | How should promotions with no end date be handled operationally (323 rows affected)? | PROMO-13, PROMO-52 | Data owner |
| Q-06 | Where do standalone Solar / EV / LivNex promotions live today? | PROMO-06 (does **not** block MVP — use direct Hub authoring) | BU owners |
| Q-07 | Does GA4 capture `meta_campaign_id` as a custom dimension? | ADS-19 | Marketing / analytics |
| Q-08 | Do landing pages persist the query string when submitting a lead? | ADS-19 | Web team |
| Q-09 | Are there UTM templates for TikTok and Google Ads? | ADS-20 | Marketing |
| Q-10 | Is the ads sheet a single evergreen file or one per period? | ADS-01..03 | Content team |
| Q-11 | Does the consuming website already exist, or is it new? | CONT-13, CONT-14 | Web team |
| Q-12 | Is MVP Thai-only or Thai + English? | I18N-02, content volume | Marketing |
| Q-13 | Who owns content for each project (for notifications and review cadence)? | OBS-01, REM-12 | Marketing |
| Q-14 | **Does the company hold OpenAI *API* access (a key or an Azure OpenAI deployment), or only ChatGPT seats?** These are different products under different contracts; seats cannot power a chatbot. | All RAG generation | IT / procurement |
| Q-15 | For the licensed model: does it support function/tool calling and parallel tool calls, structured outputs, and prompt caching? What is its context window and rate limit? | RAG-11, RAG-12, retrieval depth, cost | IT |
| Q-16 | Hostinger VPS specification — vCPU, RAM, free disk, and region? Below ~8 GB RAM the API should not share the box with DW ETL and RAG ingestion. | Deployment topology, NFR-01 | IT |

---

## 20. Suggested build order

1. **Vertical slice (5 days):** five tables (`brands`, `projects`, `assets`, `entity_assets`, `entity_versions`) — select a project from REM, upload one asset, publish, and have `GET /v1/projects/{id}` return it correctly. This surfaces auth, RLS, storage, CORS and deployment problems immediately rather than in the final week.
2. **Breadth:** project nodes, model types, content sections, facilities, nearby, compliance, admin CRUD, bulk import.
3. **Promotions:** source mirror, triage, entity links, public promotions, resolution, publish gates.
4. **Ads:** sheet adapter, landing page map, campaign registry, links, alerts.
5. **Publishing and API:** versioning, publish sets, rollback, public views, change feed, webhooks.
6. **RAG:** ingestion, hybrid retrieval, evaluation harness.

Content collection MUST start in parallel on day one using a spreadsheet template matching the schema
and an enforced file-naming convention — for 7 projects this is roughly 300 records and 300 files,
and it is the true critical path, not the code.
