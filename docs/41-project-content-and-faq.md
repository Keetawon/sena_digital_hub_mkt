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
- `hub.contacts` (scope project, brand or corporate): `channel` (phone, call_center_ext, line_oa, facebook, instagram, tiktok, youtube, website, email, messenger), `value`, `url` (validated per channel), `label`, `is_primary` (one per channel), `sort`. Email must be a company shared mailbox on an allowed domain list, with a confirmation that it is not a personal address. Never import `sales_email` from the DW.

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
9. **Legal, sales, investor, programmes, progress (C5)** — continue only after I reply to the Phase 8 report. Disclosures with Legal document upload, real promotions with targets/audience/banners, sales terms, investor section, programmes (REM fields pending IT), construction progress.
10. **Expansion (C6 + K5).** Articles with the block editor, corporate content and FAQ (LivNex/RentNex, SEN X, SENA 360 app, after-sales), `ai_policy` handling, generated `llms.txt` and robots rule list, location pages generated from published data, English pages, and the chatbot reading published content only. Finish with a Thai UAT pack (`docs/43-uat-project-content-th.md`) in the style of `docs/37`.

## 5. Gates for every phase

Admin typecheck; the documented offline webpack build; full `test:api`; full `test:db`; the relevant `test:ui` specs plus new ones at 1280 px and 390 px; migration replay on a disposable database; a credential scan over changed files and the browser bundle. Do not skip, quarantine or weaken existing tests.

## 6. STOP and report instead of proceeding when

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
