# 41 — Project content and website FAQ programme

Repository: SENA Digital Hub (`Keetawon/sena_digital_hub_mkt`), branch `main`. Work locally. Commit and push to `origin/main` after each phase passes its gates, then continue to the next phase without waiting for me, unless a STOP condition below applies. The owner will run one UAT at the end, so every phase must be fully tested by automation before you push.

Before Phase 1, read: `REQUIREMENTS.md`, `docs/02-data-model.md`, `docs/05-api-contract.md`, `docs/13-source-field-ownership.md`, `docs/17-project-form-and-plans.md`, `docs/18-marketing-types-and-amenities.md`, `docs/29-dw-project-model-intake.md`, `docs/30-knowledge-library.md`, `docs/31-readiness-and-review.md`, `docs/34-permission-map.md`, `docs/36-adding-feature-permissions.md`, `docs/38-sena-public-website-import.md`, `docs/40-brand-project-km-transfer-plan.md`, and any agent guidance under `.agents/` or `.claude/`. Where this prompt conflicts with an older design proposal in those docs, this prompt wins. Where it conflicts with a safety rule below, the safety rule wins and you STOP and report.

## 1. Non-negotiable rules

1. No credentials in Git, chat, logs, test fixtures or reports. Credentials live only in `.local/dw-reader.json`, `.env.supabase-test` and `apps/api/.env`.
2. Never commit `.local/`, `.env*`, generated packages, screenshots outside `artifacts/`, or build output.
3. Local only. Do not deploy, do not apply migrations to hosted Supabase, do not write to R2 or the VPS. Hosted rollout will be authorised separately.
4. Never write to REM, the DW, the INVOICE Ads ledger, E-memo or the media sheets. DW data enters the Hub only through the existing read-only intake/snapshot paths. Do not modify the DW repository.
5. `sena_h_approved` stays `false`.
6. Bank statements never enter RAG, embeddings or any AI call.
7. Website backups: never import customer, lead, contact or user tables.
8. Any crawler use respects robots.txt and the SENA allowlist.
9. No pull request unless I ask. No model names in commit messages.
10. Admin UI: minimal animation, works at 390 px with no horizontal page scroll, Thai labels.
11. OpenAI use is limited to the owner-approved scope in decision E1 and E9 below. No live provider calls in automated tests; mock them.

## 2. Owner decisions (21 October 2026) — record these verbatim in the new design doc

- **E1** Use the ChatGPT (OpenAI) API to suggest image category, tags, captions and alt text at upload, and to draft English translations. Scope: marketing images and marketing text uploaded for publication. Excluded: customer data, contracts, bank statements, Legal documents, finance data.
- **E2** Marketing types its own prices for now. REM prices are shown to staff for comparison only, until the DW Website API publication is approved.
- **E3** If a Marketing starting price differs from REM, warn but do not block. A starting price must state the unit type/size it refers to, its conditions and an expiry date no more than 60 days after it starts.
- **E4** Rental yield may be shown only with its basis (expected rent ÷ price, as of a date) and the text "ประมาณการ ไม่รับประกัน". Its AI exposure defaults to web-only.
- **E5** Marketing enters solar savings and carbon figures for now, with a source/reference field. The Solar/sustainability team may review later.
- **E6** Marketing enters the สคบ. project disclosure for now. A Legal document can be uploaded and attached to a disclosure version. The file stays private, never appears in public output and is never sent to AI.
- **E7** Articles are written in the Hub.
- **E8** Facts are stored per REM project (sales phase). A marketing web page that covers several phases combines them and shows per-phase values when they differ. Disclosures are per phase.
- **E9** Fields marked "must have" need Thai and English before publication. English is drafted by AI as soon as the Thai is filled, and counts only after Marketing reviews it.
- **D1** FAQ applicability may be defined by a rule (for example "all FLEXI condominium projects"). The rule is resolved into an explicit, frozen list of REM project IDs at publication, and the resolved list is shown before publishing.
- **D2** When a fact used by an answer is missing or expired, that FAQ item is hidden from the website and a gap task is created for the fact's owner.
- **D3** The person who edits a version cannot approve or publish that same version. Add a special capability "เผยแพร่ขึ้นเว็บ" (publish to website) at approve level. Warn admins when fewer than two active accounts hold it.
- **D4** Stop exposing `hub.projects.website_content`, internal UUIDs and REM-internal fields through the public API. Keep `website_content` as Hub-only reference text.
- **D5** The website server will fetch the Hub API and render HTML with caching, using a change feed. Integration with the web team is outside this programme.
- **D6** The FAQ question bank is approved by Managers (approve level). Marketing may propose new questions.

Earlier accepted rules that still apply: availability always hands off to Sales; no calculators in v1; floor plans for every storey/floor are a target, not a publication blocker; only the project hero and thumbnail block publication among media; unknown is never shown as absent; numbers in prose are never treated as structured facts.

## 3. Target design (authoritative)

All text fields are locale maps `{th, en}`. Every new table has audit (`created_*`, `updated_*`, `audit.record_change`), FORCE RLS consistent with the current permission model, SECURITY DEFINER write functions with optimistic revision checks, and an `ai_exposure` value where content can be published: `open` (website, JSON-LD, llms.txt, chatbot) · `web_only` (website HTML only) · `internal` (never published).

### 3.1 Field registry
`hub.field_catalog`: `field_key` PK (e.g. `project.common_fee`), `entity`, `section`, `sort`, `label`, `help`, `value_kind` (text, rich, number, money, percent, area, enum, bool, date, list, link), `unit`, `source_policy` (mkt, rem, rem_override, legal, finance, computed), `source_ref`, `owner_role`, `locales_required`, `required_for` (per product form: required/recommended/optional), `surfaces[]` (web.project.*, web.unit_type, web.disclosure, jsonld, llms_txt, chatbot, dw_export, hub_only), `default_ai_exposure`, `review_every_days`, `validation`, `faq_question_keys[]`, `status`.
The admin forms, the "where does this field appear" tooltip (icon "i" beside each label: shown where, not sent to, owner/review cadence, required or not), readiness checks, translation requirements and publication filters all read this registry. Seed it with every field in this prompt. Editing the registry is admin-only.

### 3.2 Narrative content and translation
- `hub.content_sections` becomes an identity table with `hub.content_section_versions` (immutable after submission). `section_key`: `project_intro` (must have), `selling_summary` (must have), `concept_name` (must have), `concept_detail`, `investor_intro`, `location_summary`, plus corporate keys. `scope_type` adds `corporate`. States: DRAFT, IN_REVIEW, PUBLISHED, WITHDRAWN.
- `hub.project_selling_points`: 3–6 items per project (must have): `title` (≤60 chars), `detail`, `icon_code`, `linked_feature_code`, `linked_fact_keys[]`, `sort`.
- Translation: every locale map tracks `en_from_th_version` and `translation_state` (missing, machine, reviewed, stale). `hub.translation_jobs` queues an AI draft whenever Thai text for a field whose registry requires English is saved; a changed Thai source marks English `stale` and drafts a new machine version for comparison without overwriting reviewed text. `hub.translation_glossary` holds fixed renderings (project/brand names, feature names such as นอนดี, facility names, units). Placeholders like `{common_fee}` and all numbers are never translated. Reuse the existing worker infrastructure where suitable.

### 3.3 Project facts and structure
- `hub.project_facts`: `project_id`, `fact_key` (FK registry), `grain` (project, phase:<REM id>, building:<key>), typed value columns (exactly one used), `unit`, `source` (rem, mkt, legal, finance, computed), `rem_value`, `rem_as_of`, `override_reason` (required when overriding a REM value), `as_of`, `valid_to`, `approved_by/at`, `ai_exposure`.
- Seed keys: `land_area_sqwah` (rem_override from `dim_project.area_rai/area_ngan/area_square_wah`, displayed as ไร่-งาน-ตร.ว.), `unit_total` (rem_override; show both REM `total_unit` and counted units and require Marketing to confirm one), `project_status` (rem, read-only), `phase_count` (computed from the group), `building_count` and `floors_max` (computed from buildings), `parking_regular`, `parking_tandem` (mkt), `parking_pct_regular`, `parking_pct_total` (computed = spaces ÷ units, never typed), `common_fee` (money per sqm/month for condominiums, per sq wah/month for houses; review every 180 days), `sinking_fund`, `rental_yield_gross_pct` (with basis text; E4).
- REM values are pre-filled from the existing DW snapshot (`staging.dw_projects.source_record`) and labelled "จาก REM ณ <date>". Show conflicts between REM and Marketing values.
- `hub.project_buildings`: `building_key` (REM tower id or Marketing key), `name`, `floors_above`, `has_rooftop`, `skip_floors[]`, `unit_count`, `rem_project_id`. Pre-fill from DW where the snapshot has the data; otherwise Marketing enters it.
- `hub.contacts` (scope project, brand or corporate): `channel` (phone, call_center_ext, line_oa, facebook, instagram, tiktok, youtube, website, email, messenger), `value`, `url` (validated per channel), `label`, `is_primary` (one per channel), `sort`. Email accepts any valid domain, with required confirmation that it is a shared/company mailbox rather than a personal address. Free webmail domains show an advisory warning without blocking save. Existing four-eyes approval is required before publication. Never import `sales_email` from the DW.

### 3.4 Media
- Extend `hub.assets`: `media_category` (exterior, interior, facility, lifestyle, aerial, surrounding, master_plan, floor_plan, unit_plan, map, progress, promotion_ad, brochure, legal_document), `tags[]` (FK `hub.media_tags`), `caption`, `alt_text`, `image_kind` (photo, render, progress, drawing, stock), `taken_at`, `people` and `third_party_marks` (present/absent/unknown), `credit`, `ai_suggestion` jsonb (kept separate from confirmed values), `metadata_state` (needs_review, confirmed).
- `hub.media_tags`: controlled vocabulary with `code`, `label`, `tag_group` (room, facility, view, time, style), `allowed_categories[]`, `status` (active, proposed, retired). Marketing can propose; approve level activates. Seed rooms (living_room, bedroom, master_bedroom, bathroom, kitchen, dining, balcony, walk_in_closet, maid_room, multipurpose_room, family_area), views (city_view, garden_view, river_view, sunset_view), time (day, night, sunset), style (show_unit, actual_unit), and every facility taxonomy code.
- `hub.asset_links` for new targets (facility, feature, place, promotion, article, building_floor, selling_point, disclosure): `usage` (hero, thumbnail, gallery, card, banner, evidence), `building_key`, `floor_from`, `floor_to`, `room_tag`, `sort`, `is_primary` (one cover per facility), `effective_from/to` (promotion banners expire with the promotion). Existing project/brand/model/commercial-type bindings stay.
- Fix the readiness bug: readiness checks `gallery` and `unit_plan`, which are not valid roles today.
- Upload flow: multi-file upload with context pre-selected (category, facility, unit type, building/floors, promotion); per-card fields above; batch-apply to selected cards; rights review by approvers unchanged. Context pickers use real data (facilities, commercial types, buildings, promotions), never free text.
- E1 AI suggestions: server-side call with a resized image (images only, never PDFs or `legal_document`) and context (allowed categories, active tag list, this project's facilities, unit types and buildings). Structured JSON output validated against the vocabulary; unknown tags become proposals. Store model and time. Never auto-confirm; show suggestions apart from confirmed values, with confidence shown only in details.
- `hub.media_requirements` (approve-level editable rules) and a computed per-project checklist: rule `per` (project, facility_present, commercial_type, type_storey, building_floor, active_promotion, under_construction), `media_category`, `tags[]`, `min_count`, `target_count`, `blocks_publish` (true only for hero and thumbnail), `max_age_days`. Default rules: project exterior/aerial/master plan/map/lifestyle 1/3; each facility marked present 1/3; each unit type plans for every storey plus main rooms 1/4; each building floor coverage as a target; each active promotion one banner; projects under construction one progress photo within 30 days (1/3). Each missing item links to the upload screen with its context pre-selected. Flag uploads where the AI suggestion disagrees with the chosen facility/category. Checklist results feed the recommended readiness score.
- `hub.media_links` + `hub.media_link_targets`: many clips and 360 tours per project. `provider` (youtube, tiktok, facebook, instagram, matterport, kuula, other), `kind` (review, walkthrough, tour_360, drone, ad, interview, progress), `tour_kind`, `url`, `external_id`, `embed_url`, `title`, `description`, `published_at` (upload date), `captured_at`, `duration_sec`, `aspect`, `language`, `subtitles[]`, `channel_name`, `owner_type` (sena_owned, partner, influencer), `is_sponsored`, `thumbnail_asset_id`, `metadata_source`, `metadata_fetched_at`, `link_status` (ok, broken, private, removed), `checked_at`, `is_featured`, `sort`, state, `ai_exposure`. Paste a URL → fetch metadata via oEmbed/provider API where available (network calls only to the provider's documented endpoints; mock in tests) → Marketing completes the rest. A periodic link check hides broken links and adds them to the checklist.

### 3.5 Unit types (แบบห้อง/แบบบ้าน)
Extend `hub.commercial_types` (keep existing fields): `category` (studio, 1br, 1br_plus, 2br, 3br, duplex, single_house, twin_house, townhome, shophouse), `special_rooms[]` (maid_room, multipurpose, family_area, double_living, walk_in_closet), `ceiling_height_m`, `furniture_package` (full, partial, none), `highlights`, `price_mode` (manual, hidden; `rem_auto` exists but is disabled behind a flag per E2), publishable state (remove the draft-only restriction, keep review/approval), `ai_exposure`. Commercial type assets gain the `room_tag` and bilingual captions. Build a six-step wizard under the project: details → concept and highlights → plans (per storey for houses) → room photos and 360 → map to REM models (list REM models from the DW snapshot with REM area and unit counts, suggest matches, never infer bedrooms/bathrooms from REM) → price and pre-submit check. Unit counts and availability for the mapped models come from the DW snapshot and are never typed.

#### Phase 5 implementation and permission card — 22 October 2026

The six steps extend the existing project commercial-type catalogue and its
revision lock. Existing drafts, source associations and asset bindings retain
their identities. Submission freezes a version for a different approver; an
approved version is eligible for Phase 8 composition, without changing existing
public feeds. Editing approved content starts another draft and preserves the
approved snapshot. Submitted content is immutable until returned for editing.

| Field | Decision |
|---|---|
| Feature / owner | Marketing unit-type wizard and manual project/type prices; Marketing edits, Managers approve |
| Tab / V | Existing `projects`; view types, history, private media, source comparison and prices for the project |
| E | Save type details/source references/media, draft prices and submit frozen versions; English review through the existing translation workflow |
| A | Approve, return or withdraw type/price versions; asset rights remain a separate approval |
| Specials / separation | No new special. E/A remain exclusive. Every editor of the submitted version is excluded from approving it, including after account permission changes. Website publication still requires the Phase 8 special |
| Templates / agency | No account, template or default grant changes; agencies and consumers have no access |
| Sensitivity | REM identities, source areas/counts/prices and revision authors are staff-only; public-ready content uses existing opaque public IDs. Prices default to `web_only` |
| Other tabs | Promotion references require `promotions` view as well as project edit, and must apply to this project. Existing shared asset access checks remain mandatory |
| Shared surfaces | Reuse existing private file, media link and translation boundaries. No new assistant/export/RAG projection; no REM/DW writes or new provider integration. Price text is excluded from translation AI |
| Endpoints | Existing commercial list/create/patch/bind/remove routes; GET `/v1/admin/projects/{public_id}/unit-types`; POST `/commercial-types/{commercial_id}/submit` and `/review`; POST `/prices`, PUT `/prices/{price_id}`, POST `/prices/{price_id}/submit` and `/review` under the same project prefix |
| SQL | Extend `commercial_types` and `commercial_type_assets`; add `commercial_type_versions`, `project_prices`, `project_price_versions`; guarded workspace/save/submit/review functions, private readiness/source/payload helpers and translation dispatch extensions |
| Rollout / verification | New tables audit and FORCE RLS; no direct runtime DML or PUBLIC helper execution. Exact API/proxy/H1 inventories; runtime deny/neighbor, inactive, stale, cross-project, author-change and immutable-version tests; populated replay and 1280/390 px UI evidence |

REM comparison reads only the already imported snapshot. A grouped model's
counts are shown once at their recorded group grain; a shared/partial mapping
never becomes an allocated total for a Marketing type. Missing snapshot values
stay unknown. Name/area matches are suggestions requiring explicit selection;
bedrooms and bathrooms are never inferred. Availability always refers users to
Sales and never enters the public-ready type payload.

Marketing enters prices with a specific type and size basis, bilingual display,
basis and conditions, and a validity interval of at most 60 days. Source prices
are read-only comparison values; a difference warns without blocking. Hidden
types and expired or withdrawn prices are excluded from public-ready output.
`rem_auto` is a recognised disabled option, not a client-controlled switch.
Plans for each storey, room photos and working 360 tours are recommended gaps,
not publication blockers. Required bilingual type text uses the field registry
and the existing reviewed/stale translation rules.

### 3.6 Facilities, features and places
- `hub.project_facilities` adds `display_name`, `location_label`, `size_sqm`, `opening_hours`, `applies_to_project_ids[]`; photos via `asset_links`. Extend `hub.facility_taxonomy` with groups/icons and codes such as lobby, meeting_room, sky_garden, rooftop, jogging_track, bbq, sauna, theater, kids_zone, basketball, putt_golf, multi_sport, convenience_store, mailroom, juristic_office.
- `hub.feature_catalog` (corporate-level definition, explanation content, `category` health/sustainability/smart/security/service/partnership, `metric_defs`) + `hub.project_features` (`status`, `detail`, `metrics` validated against `metric_defs`, optional `commercial_type_id`, `source_note`). Seed: vmove, joint_venture (partner), fresh_air, pm25_filter, universal_design, low_carbon (tCO2e/year + method), non_dee (นอนดี; English name via glossary), smart_camera, smart_app, smart_home, smart_parking, bms, solar_rooftop (kW, battery kWh), ev_charger (count, kW, AC/DC), cctv, key_card, guard_24h, easy_pass, lift_lock.
- `hub.solar_estimates` (E5): `system_kw`, `battery_kwh`, `usage_profile`, `bill_before`, `bill_after`, `saving_pct`, `assumptions`, `source_note`, `as_of`. These are approved scenario rows, not a calculator.
- `hub.project_places`: `category` (rail, expressway, mall, school, university, hospital, airport, park, office, market), `ref_id`, `name`, `distance_m`, `distance_method` (road, straight_line), `travel_minutes`, `travel_mode`, `status` (operating, construction, planned), `expected_open`, `as_of`, `show_on_web`, `sort`. Reference tables `hub.ref_rail_lines`, `hub.ref_rail_stations`, `hub.ref_expressways`, `hub.ref_expressway_ramps` with an admin screen and CSV import template. Seed line identities only; do not invent station or ramp coordinates. Suggest the nearest stations from project coordinates only when reference coordinates exist.

### 3.7 Prices, legal, sales, programmes, progress
- `hub.project_prices`: `kind` (starting, unit_type), `commercial_type_id`, `amount`, `display_text`, `basis`, `condition_text`, `promotion_id`, `valid_from`, `valid_to` (required, ≤60 days, E3), `rem_min_available`, `rem_as_of`, `approved_by/at`. Warn on REM difference; expired prices disappear from output.
- `hub.project_disclosures` (per REM project, versioned): owner company and address, registered and paid capital, managing director, legal project name, location text, land area (must match the land-area fact), title deed and land numbers, encumbrance (none or mortgage with bank), building description (must match buildings/units facts), `eia_status` (not_required, pending, approved) and approval date, construction start and completion years, notes (e.g. "ภาพจำลองเพื่อการโฆษณา"), `basis` (mkt_entered, legal_document, legal_approved), `legal_document_asset_id`, `legal_doc_ref`, `legal_doc_date`, `legal_reviewed_by/at`. Mismatches block publication of the disclosure unless an override reason is recorded. Legal files (`media_category = legal_document`) are visible only to project editors/approvers, never in public output and never sent to AI.
- Promotions: allow real (non-synthetic) rows within the existing environment guards, add multi-target scope (projects, brands, commercial types), `audience` (general, investor, livnex), booking and transfer windows, English fields and banner images via `asset_links`. Keep the existing DATA + LEGAL review.
- `hub.project_sales_terms`: booking fee, contract fee, down payment, `installment_from`, `installment_basis`, interest rate, rate period, lender, conditions, validity, approval. No calculators.
- `hub.project_programmes`: `programme_key`, `participating`, `monthly_from`, `basis`, `units_offered` (source REM, pending IT; leave empty and clearly marked), `as_of`, approval.
- `hub.project_progress`: `component` (overall, structure, architecture, systems, landscape, other), `percent`, `as_of`, `source` (construction, mkt). This is construction progress, separate from the existing content-readiness "progress" cache.

### 3.8 FAQ
- `hub.knowledge_topics` (controlled topics from doc 30 §2.4).
- `hub.faq_questions` (question bank, D6): `question_key`, `topic`, `default_level` (corporate, brand, programme, project_group, project, unit_type), `question_template` with `{project}`/`{brand}`, `alt_questions`, `answer_kind` (text, fact, handoff, auto), `fact_keys[]`, `property_types[]`, `is_core`, `show_on_project_pages`, `web_sort`, `status`.
- `hub.faqs` becomes an identity table (`question_key`, `scope_type` incl. corporate and project_group, `scope_id`, state, draft/published version pointers, `pinned_on[]`) with `hub.faq_versions` (question, alt_questions, short_answer ≤300 chars, detail, answer_kind, fact_keys, `applies_to_project_ids[]`, `applicability_rule` (D1), translation fields, `review_due`, `effective_to`, author, approver) and `hub.faq_sources` (faq ↔ candidate, cluster, decided by/at). Migrate existing `hub.faqs` drafts to version 1. A later rejection must not leave stale drafts.
- `staging.faq_clusters`: regenerable grouping of the 647 public-website FAQ candidates and the legacy pairs, with suggested key/level/kind and holds. Intake screen "คัดจากของเดิม" decides per cluster, creating one answer with explicit applicability.
- Page composition: for each question key use the most specific level (unit type > project > group > programme > brand > corporate); two answers at the same level for the same project block publication; corporate answers appear on project pages only when `show_on_project_pages`. Fact slots resolve from `project_facts`/`project_prices` at read time with "ข้อมูล ณ <date>"; missing/expired → hidden plus gap (D2). Handoff answers for availability and installments. Lint: direct first sentence, ≤300 chars, includes the project or brand name, no typed numbers where a fact slot exists, strip "คำตอบ:" and navigation residue.
- Coverage matrix: projects × core questions with states published, inherited, draft, waiting for fact, legacy candidate, hold, missing, not applicable.
- `hub.content_gaps` adds `state`, `assignee`, `occurrences`, `last_seen`, `question_key`, `resolved_by_faq_id`.
- Navigation: a new item "คลัง FAQ เว็บไซต์" with tabs ความครบ · คัดจากของเดิม · คำถามมาตรฐาน · เผยแพร่ขึ้นเว็บ. The existing "ตรวจข้อมูลก่อนนำเข้า" stays for media/facts evidence.

### 3.9 Articles
`hub.articles` (slug, category, cover, author, tags, state, `ai_exposure`), `hub.article_versions` (per locale: title, excerpt, `blocks` jsonb, SEO, translation fields) and `hub.article_links` (projects, brands, programmes). Block editor with an MIT-licensed library (for example TipTap); allowed blocks: heading, paragraph, list, quote, image from the asset library (rights-approved only), video (media link), table, callout, FAQ embed, project card. No raw HTML or scripts; server-side sanitised rendering.

### 3.10 Publication and website output
- `hub.web_pages`: `page_key` (project:<id>, brand:<id>, programme:<key>, corporate:faq, article:<slug>, location:<tag>), `page_type`, `entity_ref`, `url`, `locales[]`, `ai_policy` (open, search_only, no_ai), `max_faq_items`.
- Publishing a page freezes the composed payload in `hub.entity_versions` (entity_type `web_page`) with its JSON-LD and `content_sha256`; withdraw and rollback re-point to earlier versions. Shared-content changes preview all affected pages and publish atomically. Four-eyes per version and the "เผยแพร่ขึ้นเว็บ" special apply (D3).
- Public endpoints (existing consumer auth): `GET /v1/web/pages/{page_key}?locale=` (sections, facts, media, unit types, facilities, features, places, contacts, disclosure, prices, FAQ, `hidden` list with reasons, JSON-LD blocks such as FAQPage, VideoObject, Residence/Product, Organization), `GET /v1/web/pages/{page_key}/faq?locale=`, `GET /v1/web/changes?since=`, `GET /v1/web/llms.txt`, `GET /v1/web/robots-ai` (rule list for the web team). ETags from `content_sha256`. Locale fallback is explicit (`is_fallback_locale`). Filter by `ai_exposure` and `ai_policy`: web_only items are excluded from JSON-LD, llms.txt and the chatbot; `internal` never leaves the Hub. Public payloads use public IDs and slugs only (D4).
- Provide a staff preview route that renders a page payload as plain HTML so the owner can see what the website would show. Do not contact the web team or any production site.

### 3.11 Permissions
Follow `docs/36-adding-feature-permissions.md` for every new capability, template change and DB guard. Project-content editing uses the `projects` tab levels; FAQ and articles use `knowledge`; add the approve-level special "เผยแพร่ขึ้นเว็บ"; question bank, media tags and media requirement rules need approve level; the field registry is admin-only; legal documents follow project edit/approve visibility. Existing accounts are never silently changed; report any conflicts.

## 4. Phases

Each phase lists what to build. Every phase also: adds DB/API/UI tests for new functions, RLS and permission denial; updates the relevant docs; records progress in a new `docs/42-project-content-programme-log.md`; and keeps all existing suites green.

1. **Fixes (D4).** Remove `website_content`, internal UUIDs and REM-internal fields from public payloads (keep staff access). Fix the `gallery`/`unit_plan` readiness bug. Add English inputs for brand description, ad disclaimer, meta title/description and facility descriptions. Make the publish comparison show every field that will go public. Create `docs/41-project-content-and-faq.md` with this design and the decisions in section 2.
2. **Core data (C1 + K1).** Field registry with tooltips and registry-driven readiness; project facts with REM pre-fill and override reasons; buildings; narrative sections and selling points with versions; translation jobs, AI English drafts and glossary; contacts including email; question bank; FAQ identity/versions/sources with corporate scope and an FAQ editor (question, alternatives, short answer, detail, kind, fact slots, applicability, English tab, sources, web preview, history). Nothing is published to the website yet.
3. **Media (C2).** Asset metadata, controlled tags, context pickers, batch upload, E1 suggestions, media requirements and checklist with deep links, multiple photos per facility with a cover, media links for clips and 360 with metadata fetch and link checks, map and promotion banner categories.
4. **FAQ intake (K2).** Cluster generation over the existing candidates and the "คัดจากของเดิม" screen with per-cluster decisions, holds and applicability.
5. **Unit types and prices (C3).** The six-step wizard, REM model mapping, publishable unit types, room photos and 360, `project_prices` with E2/E3 rules.
6. **FAQ coverage and fact slots (K3).** Coverage matrix, composition rules, read-time fact resolution, rule-based applicability (D1), hide-and-gap behaviour (D2).
7. **Facilities, features, places (C4).** Facility details/photos, feature catalog and project features, solar estimates, places and reference tables with import template.
8. **Website publication (K4).** Web page registry, page snapshots, withdraw/rollback, public endpoints, JSON-LD, change feed, four-eyes and the publish special, staff HTML preview. Pilot data: BNA7 and the FLEXI brand page in the local database. STOP after this phase and report, because the owner must arrange the web-team integration (D5) before the remaining phases are prioritised.
9. **Legal, sales, investor, programmes, progress (C5)** — the owner lifted the Phase 8 report gate for this phase only on 22 October 2026. Implement now. The rebased Phase 4 push released the test gate; the owner's later instruction gives this workstream port priority before the Phase 7 agent. Always require ports 55432/8000/3000 to be free; never stop another agent's process. After pushing Phase 9, continue Phase 6 after Phase 4 merges, then Phase 10a articles (section 3.9), then Phase 8 after Phase 7 merges; finish articles first even if Phase 7 merges sooner, and retain Phase 8's STOP. Disclosures with Legal document upload, real promotions with targets/audience/banners, sales terms, investor section, programmes (REM fields pending IT), construction progress.
10. **Expansion (C6 + K5).** Articles with the block editor, corporate content and FAQ (LivNex/RentNex, SEN X, SENA 360 app, after-sales), `ai_policy` handling, generated `llms.txt` and robots rule list, location pages generated from published data, English pages, and the chatbot reading published content only. Finish with a Thai UAT pack (`docs/43-uat-project-content-th.md`) in the style of `docs/37`.

## 5. Gates for every phase

Admin typecheck; the documented offline webpack build; full `test:api`; full `test:db`; the relevant `test:ui` specs plus new ones at 1280 px and 390 px; migration replay on a disposable database; a credential scan over changed files and the browser bundle. Do not skip, quarantine or weaken existing tests.

## 6. STOP and report instead of proceeding when

Hosted TEST Auth comparisons, including UAT, follow owner decision **H5h
(28 October 2026)** in `docs/46-hosted-content-rollout.md`: identity, schema,
all unclassified Auth tables and every non-Auth protected table stay strict;
the explicitly classified Auth activity is recorded with orphan checks rather
than treated as a STOP. Auth writes by Hub migrations/scripts and Auth write
privileges or ownership by Hub roles remain prohibited. Production requires
its own go/no-go decision. Earlier decisions remain historical records.

- a credential, hosted resource, DW change, REM access or web-team action is needed;
- a requirement here conflicts with an existing accepted decision or a safety rule;
- a migration would delete or rewrite existing content, reviews or account/permission state;
- an AI call would need data outside the E1/E9 scope;
- Phase 8 is complete.
Register unresolved business questions in the existing pending-question catalogue (คำถามที่รอคำตอบ) with suggested owners, for example the rail/expressway reference data source and the English name for นอนดี.

## 7. Report format after each phase

Commit hash and push confirmation; migrations added; what was built; test counts per suite (passed/skipped/failed); screenshots under `artifacts/`; deviations from this prompt with reasons; new pending questions; next phase.


## 8. Owner clarification and Phase 1 implementation contract — 21 October 2026

The owner approved `.local/development.json` and `apps/admin/.env.local` as two
additional credential locations, solely for random local-only values from the
documented `dev:db` setup. They must never contain hosted, TEST or production
secrets. Verify both with `git check-ignore` before every commit. Never print,
copy or quote their contents, and create no other credential files. Screenshots
stay in ignored `artifacts/`; report paths and never force-add the files.

### Phase 1 permission card

| Field | Decision |
|---|---|
| Feature / owner | Public-field boundary and bilingual editorial inputs; Marketing / Hub owner |
| Tabs | Existing Projects and Brands; no new capability or account assignment |
| View | Existing staff drafts/history retain source evidence; published readers receive an explicit public-field allowlist |
| Edit | Existing Projects E and Brands E save English text with the same revision checks as Thai |
| Approve | Existing Projects A and Brands A publish/withdraw/rollback; asset-rights checks unchanged |
| Specials / separation | No Phase 1 special; existing E/A separation remains. D3 is implemented in Phase 8 |
| Templates / agency | No template or account changes; external agency management denial remains |
| Sensitivity | Website reference text, REM source identities/evidence and internal UUIDs remain staff-only |
| Shared surfaces | Public project/brand/model/media/promotion reads and publication comparison; private DW exports retain their contract |
| DB / API | Existing permission-checked reads/writes; private projection helpers with closed EXECUTE; public read RPCs narrow output and direct raw snapshot views are unavailable to consumers |
| Verification | Runtime SQL denial and neighboring permissions, immutable-version preservation, API response allowlists, actual publication preview, 1280/390 px UI, full programme gates |

### Phase 1 public projection

Use the existing immutable snapshots as the source. Do not rewrite content,
reviews, account state or publication pointers. Public RPCs select only explicit
customer-facing fields, including localized names, descriptions, address, SEO,
disclaimer, coordinates, validity, public identities, approved model specs and
eligible media. Nested brand/model/media objects have independent allowlists.
Do not emit source records, REM IDs/names, source fingerprints, UUIDs, review
actors, binding IDs, website reference text, rights evidence or new unknown keys.
Version numbers and publication timestamps remain available. Synthetic content
retains a public boolean marker; private demo evidence is excluded. Promotions retain
approved terms and expiry, with code/public identity rather than internal UUIDs.

Media public identities use the existing immutable checksum (`ast_<sha256>`),
with the existing file-eligibility check at read time. Legacy URL-only files use a
SHA-256 digest of their internal identity as an opaque public ID and retain their
approved public URL when it contains no UUID. No new identifier backfill
or historical snapshot update is needed. Staff file paths retain UUIDs. Raw
eligibility views and private DW export readers keep their internal relationships;
consumer access uses the guarded public projection rather than raw view SELECT.
The HTTP server alone can execute the guarded file-transport helper; the public
file-metadata RPC omits internal IDs, filenames and storage keys.

The staff publication preview uses the same database projection as the public
reader after applying the existing model and rights inclusion rules. It displays
all outgoing fields, including unchanged values, both locales, nested brand
content, model completeness, asset metadata and validity. Existing cross-tab and
historical-file permission redactions still apply. A redacted comparison is marked
and cannot be confirmed in the UI; there are no new account grants. Private website text
is labelled as reference material and is not a publication change.

For current media roles, the gallery recommendation is satisfied by an eligible
additional project image in the existing hero/thumbnail collections; a primary
cover alone does not complete the gallery recommendation. Per-model plans use
`floor_plan`. These fixes add no asset role and change no required blocker.
English inputs preserve all other locale-map entries and use existing API/DB
validation; Phase 2 owns translation jobs/review requirements.

### Phase 2 permission card and preservation design

| Field | Decision |
|---|---|
| Feature / owner | Core project content and website FAQ drafts; Marketing and Managers |
| Tabs | `projects` for project facts, buildings, project narrative, selling points and contacts; `brands` for brand contacts; `knowledge` for FAQ, question bank, corporate narrative/contacts and glossary |
| View | Registry metadata, authorized scope drafts, versions, sources, translation status and private preview. Scope/name references are bounded; no hidden-tab draft facts, files or evidence |
| Edit | Existing E saves drafts with expected revisions; Knowledge E proposes questions and edits FAQ. Translation review requires E for its exact source scope |
| Approve | Knowledge A approves question-bank versions and glossary entries, with revision-author separation. No website publishing in Phase 2 |
| Special | The owner-required admin-only registry editor uses new `projects.manage_field_catalog` plus an ACTIVE internal admin identity. Both are required; `can_manage_users` confers no data rights |
| Separation | Existing tab E/A rules remain. A version's editor cannot approve it. Submitted content is immutable; further edits create another draft |
| Templates / rollout | Add the registry special to the catalog with no assignments or template changes. Existing accounts remain byte-for-byte unchanged. Administrators assign it explicitly through the existing preview/confirm workflow |
| Agency | No access, including direct SQL/API, caches, previews and worker requests |
| Sensitivity | Internal drafts and private source evidence; publication-oriented text alone may enter translation. Legal documents, contacts, financial values, customer data and arbitrary evidence are excluded from AI input |
| Shared surfaces | No new public endpoint, assistant tool, RAG, export or publication member. Workers have a separate bounded role; `hub_app` cannot claim jobs or forge results |
| Endpoints | Exact `/v1/admin/content/fields`, `/v1/admin/content/glossary`, `/v1/admin/content/translations/{id}/review`; project `/content`, `/facts/{key}`, `/buildings/{key}`, `/sections/{key}`, `/selling-points/{key}`, `/contacts`; scoped contacts; `/v1/admin/faq/questions`, question approval, FAQ list/detail/save/submit/history/preview. Every resolved method/route is classified before enabling |
| SQL | New registry/fact/building/selling-point/contact/topic/question/version/source/translation tables; bounded guarded reads and revision-checked commands; FORCE RLS, audit and closed helpers. The exact runtime inventory is tested without changing historical manifests |
| Verification | Positive/negative neighboring permissions, inactive/external identities, stale/concurrent writes, immutable submission, source rejection, translation staleness and protected placeholders/numbers; 1280/390 px browser flows, all programme gates and loopback H1 |

Existing `hub.content_sections` and `hub.faqs` retain their original columns and
values as historical intake evidence. New version tables receive additive copies
of existing drafts, preserving their identity, author and source. No migration
updates or removes the old content/review rows. New drafts use the identity and
version path; nullable version pointers on legacy rows resolve to the copied
version until an authorized subsequent write sets a pointer. Existing intake
commands will append a version on acceptance and withdraw the current candidate
draft on rejection, so rejected source material cannot remain an active draft.

Registry readiness is a separate website-draft report until Phase 8. It reads
registry requirements and translation review state, including 3–6 selling
points. It does not silently change the existing legacy project publication
contract or publish any new draft. REM prefill reads only the existing local DW
snapshot, retains unknowns, dates the source, and requires confirmation of the
selected unit count. Overrides preserve the observed REM value and require a
reason. Calculated ratios/counts cannot be typed.

English tracking is stored beside locale maps, so `{th,en}` stays the text
contract. Saving changed Thai queues a new source-version job, marks a reviewed
English translation stale, and preserves the reviewed text. Machine output is
separate until Marketing accepts it against the current source revision. Jobs
never publish or approve text. The worker receives only allowlisted marketing
text and approved glossary terms; it protects placeholders and numbers and
validates the returned structure. The integration follows the official
[Responses structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
Tests inject a provider stub and never call OpenAI. No credentials are added by
this phase; local execution uses only the already approved API environment.

Phase 2 implementation details: the route inventory is
`tests/permissions/project-content-routes.json` (32 methods/paths). Translation
retry is an additional exact shared route, checking the original source's E bit
inside SQL. FAQ history, sources and staff text preview use the same scoped
detail read; they have no independent authority or public URL. The registry
editor changes labels, help, owner, cadence and product-form requirements;
source/AI safety classifications remain reviewed migration metadata.

Existing identities retain raw intake fields. Section and FAQ saves append
versions, and submitted versions reject content edits. Selling-point English
review also appends a revision, so an older title/detail form cannot overwrite
it. Building names join the readiness report when a building exists. Unknown
product form conservatively applies conditional required fields. Future-phase
registry entries remain planned; core contact/building/FAQ metadata is active.
The investor section stays planned until Phase 9.

The translation worker checks current author permission when claiming and
finishing, validates source hash/lease/revision, preserves the exact number and
placeholder multiset, and keeps machine output separate from reviewed English.
Failed jobs have an explicit retry action. Financial FAQ topics
(`commercial_terms`, `investment_context`, `buying_process`) never enter AI
drafting; Marketing can enter and review English manually. This applies E1's
finance-data exclusion to E9, without sending financial facts or references to
the provider. No live provider call is part of the programme's test gates.

### Q76 resolved — owner decision, 22 October 2026

Do not restrict contact email domains. Group companies use many domains,
including Google-hosted custom domains and `@gmail.com` addresses. Replace the
allowlist with required confirmation that each address is a shared/company
mailbox rather than a personal address. Show a visible, non-blocking warning
for free webmail such as `gmail.com`, `hotmail.com`, `outlook.com` and `yahoo.com`
(also `icloud.com` and `live.com`). Custom domains do not require registration.
Keep the existing four-eyes approval before anything is published. No DW sales
email is read or imported.

This decision is folded into Phase 3 by migration
`202610220065_contact_mailbox_policy.sql`. The shared contact form covers project,
brand and corporate scopes, displays warnings while editing and on saved cards,
and requires fresh confirmation if the email address changes. The registry's
domain controls are removed; its old command rejects writes while historical
domain rows and applied migration bytes are preserved. Q76 is closed in the
question catalog; there is no separate decision commit.

### Owner coordination update — 21 October 2026

The owner assigned Phase 4, Phase 7 and the articles portion of Phase 10 to a
separate agent, delivered through pull requests merged by the owner. This
workstream now follows Phases **1 → 2 → 3 → 5 → 6 → 8**. Pull the latest
`origin/main` before starting each new phase. Never modify or renumber files,
migrations or tests introduced by the other agent's merged pull requests; stop
and report if they need changes. Stop on any pull/merge conflict, without force
pushes or history rewriting. Phase 6 requires Phase 4 already merged; Phase 8
requires Phase 7 already merged. If either prerequisite is absent, stop and
report instead of implementing a replacement. The original Phase 8 STOP remains.

### Phase 3 permission card and media contract

Baseline: `01d288f5d6830af17de7ca3fec1fd5fb2f62d88e`; `git pull --ff-only
origin main` completed before Phase 3 and reported already up to date.

| Field | Decision |
|---|---|
| Feature / owner | Media metadata, coverage and external clips/tours; Marketing and Managers |
| Tab / V | Projects V reads project media, controlled vocabulary, rules and real project context; file bytes still require an authorized binding |
| E | Projects E saves metadata, links and clip drafts, proposes tags, requests suggestions and provider metadata; each write checks its revision and every affected binding's tab |
| A | Projects A activates/retires tags and edits coverage rules. Existing asset-rights review remains unchanged; metadata confirmation is editorial E, not rights approval |
| Specials / templates | None; no new tab, account assignment or template changes |
| Separation | Existing E/A exclusivity; tag proposers cannot activate their own proposal. An AI result never confirms metadata or approves rights |
| Agency | No access through URLs, SQL, bytes, cache or workers |
| Sensitivity | Marketing-publication images only for E1. PDFs, Legal documents, contracts, financial/customer data excluded. Legal files require Projects E/A and remain private |
| Other tabs | Promotion targets require Promotions V/E alongside Projects V/E. Metadata mutation requires E for every existing Projects/Brands/Knowledge binding, so shared files cannot be changed through a weaker tab |
| Shared surfaces | New bindings participate in file access and monotonic binding history. No new public endpoint, RAG, assistant tool or export. Existing public media cannot be reclassified as Legal |
| Endpoints / SQL | Exact `/v1/admin/media/{tags,requirements}`, `/v1/admin/projects/{public_id}/media`, project media metadata/link/suggestion routes and clip routes, registered in the API, Next proxy and H1 allowlists. New tables: `media_tags`, `asset_media_tags`, `asset_links`, `media_requirements`, `media_links`, `media_link_targets`, `media_jobs`, with FORCE RLS, audit and bounded revision commands |
| Workers | Existing operator-only local connection; API role cannot forge AI/provider results. Completion rechecks revision, current authority and source eligibility |
| Verification | Real runtime denial/neighbor, stale edit, revoked authority, private bytes and Legal exclusions, vocabulary/AI bounds, coverage/expiry, provider destination allowlist, populated replay, 1280/390 px browser checks and all programme gates |

Use the existing byte upload, sanitization, thumbnails and rights workflow.
`asset_media_tags` supplies actual foreign keys for the asset's returned `tags`
array. New metadata defaults never rewrite existing metadata or bindings.
Category/rights review remain independent. Hero and thumbnail retain their
existing project binding and publication gate; floor coverage is a recommendation.
Coverage uses eligible rights, effective dates and capture dates, with unknown
context preserved. Only hero/thumbnail rules may block publication.

The media workspace reuses the current semantic palette, native controls, dirty
guards and responsive cards. Batch application is explicit; retries preserve
each uploaded asset identity. Suggestions show separately, with confidence in
details only. No animations or new dependencies are needed.

Real context initially includes project facilities, commercial types, buildings,
selling points and authorized promotions. Feature/place/disclosure/article
target kinds are reserved but reject saves until the owning phase supplies a
guarded real reference. No placeholder tables or invented records replace that
work. New targets remain internal drafts until Phase 8 publication integration.

## Phase 9 permission and record contract — 22 October 2026

Owner update: Claude Code's assignment ended after Phase 4. Articles return to
this workstream as Phase 10a, directly on main and logged in docs/42. Phase 7
continues separately on `parallel/c4-facilities-places`. The revised sequence
above supersedes the earlier parallel assignment; the remaining Phase 10 work
is still outside this authorization.

| Permission card | Decision |
|---|---|
| Feature / owner | C5 project disclosures, sales terms, programmes, construction progress and investor content; Marketing enters, an independent project approver checks |
| Tab / View | Existing `projects` V reads structured records, readiness and redacted history. Existing `promotions` V reads promotion drafts and reviews. Legal evidence IDs, references, reviewer names, dates and downloads require Projects E or A |
| Edit | Projects E saves drafts, attaches private Legal files, manually reviews English and submits a frozen revision. Promotions E changes real/synthetic draft content, audience, scopes and windows; changing banners also requires Projects E |
| Approve | Projects A approves, returns or withdraws the exact submitted revision. Every editor of that revision is excluded even after a permission change. Promotions A retains DATA + LEGAL reviews and publication; real-row authors cannot review or publish their own revision |
| Specials / templates | No new tab, special, template or account assignment. Existing E/A separation remains. Website page publication still requires Phase 8's own approval/special |
| Agency | No access; inactive/pending and service-consumer identities cannot use internal routes |
| Sensitivity | Legal evidence is restricted and never public/AI. Financial and investor text is manually translated; existing immutable history and audit apply |
| Other tabs | Promotion target pickers return only project/type or brand references permitted by Projects V / Brands V. Promotion banners use existing asset rights and project binding guards |
| Shared surfaces | Private C5 composition helper only, pending Phase 8. Existing published promotions gain public scope IDs, audience, windows and rights-filtered banners; no internal UUIDs, Legal evidence or RAG inclusion |
| API / SQL | Five exact `/v1/admin/projects/{public_id}/commercial` routes, existing promotion commands plus GET `/v1/admin/promotions/references`; migration 69 C5 records and migration 70 promotion extensions; inventories in `tests/permissions/project-commercial-routes.json` and the DB permission baseline |
| Verification | Real runtime deny/neighbor and revocation, optimistic project locks, immutable submissions, same-author denial, private Legal bytes, manual English, expiry, source mismatch, public IDs, rights revocation, populated replay and 1280/390 px UI |

`hub.project_disclosures`, `project_sales_terms`, `project_programmes` and
`project_progress` have explicit typed fields, FORCE RLS, audit and no runtime
direct writes. Each has a stable public content ID and revision. There is one
disclosure and one sales-terms identity per REM project, one programme identity
per programme key, and one construction identity per component. Submitted
payloads are frozen in `project_commercial_versions`; edits and returned drafts
advance the revision. A shared project lock makes concurrent edits stale.

Disclosures compare the explicitly entered land area, building count and unit
count against project facts and the building register. The approver sees the
building description alongside those facts; prose is never parsed into facts.
Missing source comparisons and mismatches need a recorded override reason;
the disclosure still needs its own values. Approval and later composition both
recheck the comparison. Legal approval provenance is entered from the evidence
(reviewer name and date), separate from the Hub approver's recorded account.

English is reviewed through the existing translation workflow with provider
dispatch disabled for Legal, sales, programme, promotion and investor text.
Programme `units_offered` must be NULL until IT supplies the REM contract.
Unknown money/participation values remain NULL; zero and “not participating”
are explicit values. Sales validity is mandatory. Construction progress does
not alter the existing readiness cache. Investor narrative and validated yield
reuse the existing section/fact workflow, default to `web_only`, and show
“ประมาณการ ไม่รับประกัน” with expected annual rent, price and as-of date.

Real promotions are explicitly created with `synthetic=false`; older clients
and existing synthetic records retain their provenance. Creation from the UI
defaults to a real record. Primary project identity stays fixed. Additional
project, brand and commercial-type scopes are validated references; a release
freezes the resolved public project IDs and scope identifiers. Draft changes
do not rewrite a published version. Booking and transfer dates are paired,
ordered windows. Banners use `asset_links`, expire no later than the promotion,
and disappear immediately when rights or live eligibility are withdrawn.

## Phase 6 permission and composition contract — 22 October 2026

Owner's later port turn-taking instruction: after the Phase 6 push, Phase 7 gets
priority for its full gate cycle. Write Phase 10a articles meanwhile, but run
article port-binding gates only after the Phase 7 PR is open, or three hours
after the Phase 6 push if no PR is open and all shared ports are free. Never
stop another agent's process. Finish articles before Phase 8 and retain its STOP.

Phase 4 is merged. Phase 6 builds on Phase 9 commit `7451cf4` after a fresh
pull of main. Phase 4's added files, migration and tests remain unchanged.

| Permission card | Decision |
|---|---|
| Feature / owner | K3 FAQ coverage, rule applicability, fact-slot previews and missing-fact tasks; Marketing prepares, Managers review |
| Tab / View | Existing Knowledge V plus Projects V for the new coverage, applicability, composition and gap views; actual project facts never become available through Knowledge alone |
| Edit | Knowledge E plus Projects V to claim a gap for oneself, clear its assignee or change its task state with an expected revision. Existing Knowledge E saves FAQ drafts, including bounded applicability rules |
| Approve / specials | No new approval action, special, template or account assignment. Question-bank approval is unchanged. FAQ/page publication and per-version four-eyes stay in Phase 8 |
| Agency / sensitivity | No agency, inactive or service-consumer access to these private routes. Legal evidence, finance data and account-directory details are excluded |
| Cross-tab references | Existing minimal project/brand/group/type references remain. Rule evaluation and actual fact resolution additionally require Projects V. Gap assignment offers the current actor only; it does not expose the Accounts directory |
| Shared surfaces | Private composition helper for Phase 8; no public endpoint, RAG, provider call or website publication is added in this phase |
| API / SQL | Exact `faq-coverage`, `faq-composition/{public_id}`, `faq-applicability`, and `faq-gaps` routes; additive gap metadata and guarded commands; closed private composition helpers in migration 71 |
| Verification | Runtime deny/neighbor and revocation, four scope inheritance boundaries, same-level collision, missing/expired/zero facts, price validity, rule membership changes, gap deduplication and optimistic edits; desktop/mobile workflows and all programme gates |

Rules use bounded lists of public brand IDs, product forms and project-group
IDs. Predicates are combined with AND, values within a predicate with OR.
An empty rule keeps manual applicability. Product form follows the existing
single-form commercial-type classification; unknown or mixed forms are shown
as unresolved, never inferred. The UI shows the resolved REM phase IDs before
submission. Phase 8 will re-resolve during publication preview and freeze that
explicit list with the approved page/version, rejecting a stale preview.

The private draft preview composes current FAQ versions and current facts,
clearly labelled as unpublished. The private published-mode helper selects
published FAQ versions and approved, current facts only. An expired or missing
slot hides the selected answer and records one task per project/question,
preserving assignment and incrementing occurrences. A repaired answer resolves
its derived task; a later gap reopens it. Zero and false remain real values.
Prices come from the approved, live price projection and retain their basis,
conditions and validity. Availability and installment answers hand off to Sales.

Most-specific scope wins: unit type, project, group, programme, brand, corporate.
Two applicable answers at the winning level are a publication blocker. Corporate
answers require `show_on_project_pages` to appear on a project. Coverage keeps
draft, inherited/published, waiting-for-fact, legacy candidate, hold, missing and
not-applicable states distinct. Lint and source checks report publication
blockers without deleting or rewriting existing FAQ drafts or intake evidence.

## Phase 10a permission and article contract — 22 October 2026

Phase 6 is pushed as `f3f8625`. Main was pulled again before this phase. This
implements section 3.9 only; the remaining Phase 10 expansion stays behind the
Phase 8 STOP. Phase 7 retains migration slots 72–74; articles use the next slot,
75, without editing the other worktree. The port fallback deadline is 13:07:12 UTC
(20:07:12 Bangkok) on 22 October. After that deadline, disposable article checks
may run on the available main migrations while the ports are free. On 23 October,
the owner merged Phase 7 as `bf87810`, released the shared ports and instructed
completion of articles followed by Phase 8. Migration 75 follows the merged
72–74 history; the other agent's added files remain unchanged.

| Permission card | Decision |
|---|---|
| Feature / owner | Articles written in Hub; Marketing drafts and Managers review |
| Tab / V | Existing Knowledge V; article list, own content, version history and private rendered preview. Referenced source content is separately filtered by its current source permissions |
| E | Knowledge E creates and saves drafts, edits links, reviews English and submits an immutable version; attaching source references also requires authority to read those sources |
| A / separation | Knowledge A approves, returns or withdraws content. Every editor of that version, including its English reviewers, is excluded from approval. Existing E/A exclusivity remains |
| Specials / templates | No new special, template or account grant. Article approval prepares content; Phase 8 owns page publication and its publish special |
| Agency / sensitivity | No agency, inactive or service-consumer access. Only editorial content and existing authorized media references; no Legal document, account directory, finance document or bank statement ingestion |
| Other tabs | Minimal public project/brand IDs and names for links. Actual project cards, FAQ fact previews and clips require Projects V; image choices and bytes retain existing binding/source permissions and current rights checks |
| Shared surfaces | Reuse the marketing translation worker and review flow; excluded topics require manual English. No new public API, RAG, provider invocation in tests or hosted write |
| API / SQL | Exact article list, references, detail, preview, create, save, submit and review routes. Three audited FORCE-RLS tables: articles, article_versions and article_links; closed helpers and revision-checked commands |
| Verification | Runtime deny/neighbor and revocation; immutable versions and four-eyes after permission changes; stale edits; translation source changes; unauthorized/expired media; malicious and oversized block documents; desktop/mobile keyboard workflows; all programme gates |

The editor uses the [MIT-licensed Tiptap core](https://github.com/ueberdosis/tiptap/blob/main/LICENSE.md),
following its [Next.js integration](https://tiptap.dev/docs/editor/getting-started/install/nextjs).
It permits headings, paragraphs, lists, quotes, library images, media-link videos,
tables, callouts, FAQ embeds and project cards. Server validation accepts a bounded
node schema and generates escaped HTML from allowed nodes; raw HTML, scripts,
arbitrary embeds and arbitrary image URLs are not accepted. Asset rights and
source visibility are rechecked when resolving a preview.

Thai and English content, SEO and bylines remain versioned. Marketing text uses
the existing queued translation mechanism with review and stale-source tracking;
only text leaves are sent, never reference IDs, file bytes or block JSON. Numbers
and placeholders retain the existing validation. Submission freezes the content,
links, metadata and translation evidence. An approved content version is not a
published website page. Existing Hub tokens, Thai labels, visible keyboard focus
and static transitions apply; mobile controls wrap and tables scroll within the
editor/preview, without horizontal page overflow.

The article block stores reference IDs, never a copy of source payloads. The
private preview resolves current sources; unavailable sources become a neutral
notice. Video blocks open the reviewed media-library link without executing an
external embed. Phase 8 must use `approved_version_id` and that version's frozen
metadata/links, and resolve FAQ/fact dependencies through its approved publication
path. A newer draft never changes the previously approved article snapshot.
The workspace bounds its history view to the latest 30 versions and its image
and clip pickers to the latest 200 currently eligible items; all versions remain
in the audited database.

## Phase 8 permission and publication contract — 23 October 2026

Articles were pushed as `1c19e3a`; a fresh pull confirmed main current before
this phase. Phase 7 is merged. Migration 76 follows the existing 75 migrations;
the files added by the parallel PRs remain untouched.

| Permission card | Decision |
|---|---|
| Feature / owner | Marketing prepares website pages; an independent Manager publishes an exact reviewed batch |
| Tab / V | Existing Knowledge V for page registry, publication history and previews; each source tab must also be visible before its private content is returned |
| E | Knowledge E saves page configuration and prepares an immutable server-composed batch, with all affected pages, resolved applicability and source changes shown |
| A / special | Knowledge A plus the new `knowledge.publish_web` special, labelled «เผยแพร่ขึ้นเว็บ», publishes, withdraws or rolls back. Approval for every included source tab is also required |
| Separation | Every source-version editor, English reviewer and batch preparer is excluded from publishing that version, including after a permission change. E/A separation remains unchanged |
| Templates / rollout | Add the special to the existing catalog only. No account grants, template propagation or implicit approvers. Warn account managers when fewer than two ACTIVE accounts hold the usable special |
| Agency / sensitivity | No private access for agencies, consumers or inactive accounts. Published consumers retain their existing authentication boundary. Private evidence and internal identifiers stay in Hub storage |
| Other tabs | Projects for project facts/media/types/facilities/features/places and Brands for brand content; article references retain their source permissions. Minimal public IDs/names do not grant source access |
| Shared surfaces | Public page/FAQ/change-feed/llms/robots endpoints and current authorized asset bytes only. No assistant or RAG draft access; no provider, hosted, REM or DW writes |
| SQL / API | Audited FORCE-RLS registry, prepared batches and change events; web-page snapshots extend entity_versions additively. Exact guarded commands and reviewed route inventories; private helpers have no runtime EXECUTE |
| Verification | Stale preview and rule drift, atomic affected-page publication, four-eyes after role changes, source revocation and expiry, zero/false facts, public identifier filtering, locale fallback, ETags, withdrawal/rollback, direct runtime denial and desktop/mobile workflows |

Each published page retains its exact source versions, resolved phase list and
approved fact evidence. Public output is an explicit projection with public IDs
and slugs. Read-time validity checks may hide expired, withdrawn or newly private
content, but never substitute an unreviewed draft. FAQ slots resolve current
values only when they still match the page's reviewed fact evidence; missing or
expired slots hide the answer and maintain the existing owner gap task. Derived
REM/computed facts receive page-specific approval evidence without rewriting the
original fact or source rows.

Preparation previews every changed registered page, including pages affected by
shared sources. Publication recomputes the reviewed digest and checks source and
account permissions in the same transaction before changing any pointer. A stale
source or missing permission rejects the entire batch. Immutable snapshots remain
available for reviewed rollback. The public change feed also reports read-time
visibility changes so caches cannot retain expired facts or revoked media.

Open content alone can enter JSON-LD and the AI text projection. `web_only`
content remains in website output, `internal` content never leaves Hub, and page
AI policy further limits these projections. Locale fallback is explicit. The
staff preview uses escaped, plain HTML and never executes source embed code.

The local pilot registers BNA7 and FLEXI using existing data. Back up the working
database before applying passed migrations; do not invent missing content or
silently grant publication rights. Record readiness and any account conflicts.
After the Phase 8 gates, commit, push and report, then STOP for the owner's web-team
integration decision. The remaining Phase 10 expansion stays outside this phase.

Implementation bounds: the registry holds at most 100 pages, each project page
lists at most 30 public project IDs, and the FAQ budget is 0–100 items across the
whole page. Preparation reviews all changed registered pages together. One
publication lock protects the batch; there is no background publication queue.
The private review lists the frozen REM applicability IDs separately from the
public phase IDs. Public output contains neither those REM IDs nor source UUIDs.
Required brand fields use the same reviewed-English check as project content.
Thai-only pages remain reviewable in a mixed-locale batch; their preview identifies
its actual locale and the public endpoint rejects an unconfigured locale.

The staff preview renders article blocks through the existing escaped renderer,
uses permission-checked private image bytes, and exposes no external embed code.
Page and FAQ responses carry a hash-based ETag and revalidate current validity
before returning 304. The change feed reports publication, withdrawal, rollback
and read-time visibility changes. Poll it from the website server; public browser
credential distribution and website hosting remain outside this programme.
