# SENA Campaign Naming Taxonomy — V1 specification

> Moved from `sena_idea_mkt_data_warehouse/docs/` on 29 September 2026; this is now the only maintained copy. **Superseded for new names by [19 — SENA-7](../19-campaign-naming-registry.md).** Kept as the V1 reference for names already issued.


**24 September design update:** see the [paid campaign registry design](SENA_ADS_CAMPAIGN_REGISTRY_DESIGN.md) for SENA Idea budget approval, target validation, release and reconciliation. This document remains the V1 compatibility reference. The new registry-backed V2 is proposed and requires a tested resolver before use; it moves long target lists into the registry instead of requiring campaign splits solely for name length.

Design date: 23 September 2026. Basis: live warehouse audit (DW audit `campaign_naming_audit_2026-09-23.md`, cited by the original study but not committed to either repo). Agency reference: [copy-ready examples](SENA_ADS_AGENCY_CHEAT_SHEET.md).

**Status: proposed operating standard, checked against the current parser; no production models or campaigns were changed.** Project names are compatible with the existing Meta/Google group allocation rules. Exact brand identity, explicit nonproject reporting, full lead attribution and TikTok ingestion require the implementation work listed below.

## 1. Canonical structure

```text
IDENTIFIER__OBJECTIVE__PLATFORM__TACTIC__AUDIENCE__YYYYMM__AGENCY__NNN__V1
```

Exactly nine nonempty fields, separated by two ASCII underscores (`__`). All values are uppercase ASCII. Hyphens belong inside tokens; a dot (`.`) separates identifier list members. Single underscores, spaces, Thai text, `+`, `/`, `&`, budget amounts, KPI values and free-text suffixes are prohibited in new canonical names. The SENA V1 length cap is **150 characters**; this is an internal standard, not a statement of platform limits.

Objective stays in position 2 because the existing Meta identity model reads that position. Platform in position 2 would break `marketing_type_from_name`. The group parser scans the entire name, so position alone does not prevent accidental matches.

| Position | Field | Required values and validation |
|---|---|---|
| 1 | IDENTIFIER | One of the exact identifier forms in section 2; validate against master data, not just a regex. |
| 2 | OBJECTIVE | `LEADS`, `TRAFFIC`, `SALES`, `AWARENESS`, `ENGAGEMENT`, `CONVERSION`. A cross-platform business objective; retain the actual platform objective separately. Use `LEADS` for lead acquisition, including website leads; `CONVERSION` only for another specified conversion event. |
| 3 | PLATFORM | `META`, `GOOGLE`, `TIKTOK`, `CHATGPT`; must match the native advertising account. DW source systems are `META_ADS`, `GOOGLE_ADS`, proposed `TIKTOK_ADS` and `CHATGPT_ADS`. `CHATGPT` (OpenAI ChatGPT Ads) was added on 25 September 2026 for planned buying; it is a naming contract only until ingestion exists. Claude has no advertising product (Anthropic has committed to keeping Claude ad-free), so no Claude token is reserved. |
| 4 | TACTIC | Meta: `SOCIAL`. Google: `SEM`, `SEMMAXCLICK`, `PMAX`, `DISPLAY`, `VIDEO`, `DEMANDGEN`. TikTok: `VIDEO`. ChatGPT: `CONVERSATIONAL`. `SEMMAXCLICK` means search using Maximize Clicks; current Google tactic extraction recognizes SEM/SEMmaxclick only. Other values need V1 metadata parsing. |
| 5 | AUDIENCE | `PROSPECTING`, `RETARGETING`, `MIXED`, `BROAD`, `KWBRAND`, `KWGENERIC`, `KWLOCATION`. `KW*` describes a search keyword family and is allowed only for Google SEM/SEMMAXCLICK. Use `MIXED` if a campaign spans audience families. |
| 6 | YYYYMM | Gregorian launch/flight-start month, e.g. `202610`. Validate a real month (`01`–`12`). Never substitute Buddhist year or roll the name forward monthly. Reporting date comes from the fact table. |
| 7 | AGENCY | Initial controlled registry: `BRANDSTROM`, `COMBAY`, `MEDIAOPTION`, `KIN`, `7DAYSSUCCESS`, `INHOUSE`. Map legacy `BrandStrom`, `Media Option`, etc. to these values in reporting. Add another agency once to the registry before use. |
| 8 | NNN | `001`–`999`; mandatory sequence distinguishing campaigns with the same first seven fields. Allocate centrally; never reuse a full canonical name for another native campaign. |
| 9 | Version | Literal `V1`. Future incompatible grammar changes use another version and a version-aware parser. |

Structure-only PostgreSQL regex (follow with the semantic checks in section 5):

```regex
^[A-Z0-9]+(-[A-Z0-9]+)*(\.[A-Z0-9]+(-[A-Z0-9]+)*)*__(LEADS|TRAFFIC|SALES|AWARENESS|ENGAGEMENT|CONVERSION)__(META|GOOGLE|TIKTOK|CHATGPT)__(SOCIAL|SEM|SEMMAXCLICK|PMAX|DISPLAY|VIDEO|DEMANDGEN|CONVERSATIONAL)__(PROSPECTING|RETARGETING|MIXED|BROAD|KWBRAND|KWGENERIC|KWLOCATION)__20[0-9]{2}(0[1-9]|1[0-2])__(BRANDSTROM|COMBAY|MEDIAOPTION|KIN|7DAYSSUCCESS|INHOUSE)__[0-9]{3}__V1$
```

This lexical regex deliberately cannot prove membership, valid platform/tactic combinations, nonzero sequence or uniqueness. Do not treat a match as launch approval.

## 2. Deterministic identifiers and the six scenarios

`G` means the exact `project_group_id`. `P` means the exact REM `project_id`, including leading zeroes and suffix letters. Do not use website slugs, display names, budget codes, legacy `C1/C2/H1/H2` segments, or an invented `PH1/PH2` as master identifiers. Resolve compound tokens using the master dictionary; group IDs themselves contain hyphens, so fixed hyphen-position splitting is unsafe.

| Scenario | Identifier form | Business meaning | Current Meta/Google FHI result |
|---|---|---|---|
| A — one project group | `PG-G` | Leads for one marketing group, without a narrower phase restriction. Works for a group with one or several members. | `ALLOCATED_SINGLE_GROUP`, weight 1. |
| B — one phase/project | `PH-G-P` | Only the named REM member/phase is promoted. | Group and explicit project signals; group receives 100%. No separate phase spend allocation exists. |
| C — multiple phases in one group | `MP-G-P1.G-P2` | Joint promotion of the listed members of the same group. Repeat the complete group–project compound for every member. | One distinct resolved group; 100% to that group. No implied equal split between phases. |
| D — multiple different groups | `CL-G1.G2` | An explicit cluster, Expo or seasonal offer targeting at least two distinct groups. | `MULTI_GROUP`; project allocation withheld. Intentional shared spend needs a separate reporting bucket or approved weights. |
| E — brand awareness | `BRAND-B-BRANDING` | Brand image without a specific project booking objective. Initial proposed brand slugs: `COZI`, `SENA-KITH`. | `BRANDING` scope is detected; generic V1 brand slug is not yet mapped to a brand entity. FHI `UNMAPPED` is expected. |
| F — corporate/CSR or independent BU | `CORP-SENA-T` or `BU-U` | Corporate topic `T`: `CSR`, `IR`, `SUSTAINABILITY`, `SOLAR`, `LIVNEX`; independent business `U`: `SOLAR`, `LIVNEX`, `RENTNEX`, `EV`, `INTERSALE`. | Corp scope and/or controlled business signal; FHI `UNMAPPED` without a project target. |

For C and D, sort full list members lexicographically and remove duplicates. C requires at least two distinct REM members sharing the same G in both masters; D requires at least two distinct G values. A dot is URL-safe and also a nonalphanumeric boundary for the existing parser. Do not abbreviate the second member (`G-P1.P2`), which loses its explicit project signal. If an identifier list would exceed the length cap, split buying into group-specific campaigns; a short cluster registry ID requires a later parser/registry extension before use.

Verified current examples:

| Group | Members verified in REM and marketing master | Use |
|---|---|---|
| `C-COZI-BTSSM` | `SNHP2` | COZI BTS Saphanmai; A normally needs only the group. |
| `C-FLEX-STCRN` | `HYABC` (Phase 1), `HY2DE` (Phase 2) | B uses `PH-C-FLEX-STCRN-HY2DE`; C uses `MP-C-FLEX-STCRN-HY2DE.C-FLEX-STCRN-HYABC`. |
| `C-COZI-RITKB` | `KUBON` | Can combine with `C-COZI-BTSSM` for an intentional D cluster. |

For E, register brand slug → native brand ID explicitly. The audit observes `SNHP2.rem_brand_id = '36'` as COZI context and an existing Google `kith_sena` rule targeting `'000006'`; retain these as text and validate against the brand master before activating the new slug mapping. `BRAND` alone, `MOMCozi` and `BestKith` are not current brand mapping rules. The retained `BRANDING` token supplies a compatible generic scope signal.

Distinguish corporate discussion of Solar (`CORP-SENA-SOLAR`) from Solar product acquisition (`BU-SOLAR`). Likewise, LivNex financing for one actual project remains scenario A/B/C; record its financing offer in campaign metadata. A corporate LivNex campaign with no property target is F. Do not add an arbitrary project ID to make E/F spend appear allocated.

## 3. Allocation and history policy

The current allocator accepts only one fully resolved, approved group. Its status precedence is:

1. Unapproved identity/reference conflict → `UNAPPROVED_OR_CONFLICT`.
2. Any approved project/group signal missing from the marketing master → `UNMAPPED_SIGNAL`.
3. More than one resolved group → `MULTI_GROUP`.
4. Exactly one resolved group → `ALLOCATED_SINGLE_GROUP`.
5. Approved identity with no project/group candidate → `UNMAPPED`.

Keep that raw status. Add a separate proposed reporting classification: `PROJECT_SINGLE`, `SHARED_MULTI_GROUP`, `BRAND_NONPROJECT`, `CORPORATE_NONPROJECT`, `BUSINESS_NONPROJECT`, `MAPPING_EXCEPTION`. These labels are not deployed statuses. With valid V1 membership, A/B/C map to PROJECT_SINGLE; D to SHARED_MULTI_GROUP; E to BRAND_NONPROJECT; CORP to CORPORATE_NONPROJECT; BU to BUSINESS_NONPROJECT. Invalid or conflicting metadata overrides those expectations and becomes MAPPING_EXCEPTION. This separates intentional nonproject spending from errors while preserving total spend reconciliation.

For D, a name cannot establish a defensible financial split. Preferred buying setup when group-level CPL is required: separate native campaigns per group. If shared buying is necessary, hold spend centrally unless an explicit effective-dated weight table is introduced, keyed by native campaign identity and group, with weights summing to 1. Do not duplicate spend across group rows or infer equal weights from the number of tokens. A lead's selected project is a separate fact, not proof of the spend split.

Freeze the canonical name and native identity after launch. The current DW selects the latest campaign name and applies its identity to historical daily facts. Changing a target token can therefore reclassify old spend. Material scope changes need a new native campaign. Correct historical mistakes through reviewed, effective-dated mappings/aliases and reconciliation, rather than bulk renaming. Budget, CPL targets, PO numbers, creative topics and daily changes belong in metadata, not the identity string.

## 4. UTM and native identity contract

The target is **100% deterministic resolution of valid, captured, registered campaign keys**. A naming convention cannot guarantee capture or attribution of every lead. The current FHI lead models aggregate REM leads by group; they do not join all leads to campaign identities. Attribution implementation and coverage measurement are separate work.

| Platform | `utm_source` | `utm_medium` | `utm_campaign` | `utm_id` |
|---|---|---|---|---|
| Meta | `facebook` | `paid_social` | Exact immutable canonical campaign name | Native Meta campaign ID as text |
| Google Ads | `google` | `cpc` | Exact immutable canonical campaign name | Native Google campaign ID as text |
| TikTok | `tiktok` | `paid_social` | Exact immutable canonical campaign name | Native TikTok campaign ID as text |
| ChatGPT Ads | `chatgpt` | `cpc` | Exact immutable canonical campaign name | Native OpenAI Ads campaign ID as text |

`facebook` represents the Meta buying platform, including Instagram delivery; retain placement separately. This aligns with current Solar `fb` → `facebook` normalization. `cpc` is the SENA paid-Google medium convention for all Google tactics, not a claim that every campaign is billed by click. Source and medium are lowercase. Preserve campaign casing, punctuation and leading zeroes exactly after URL decoding. Never use an agency name as the UTM source.

Also require `sena_account_id=<native account/customer/advertiser ID>`, with Meta `act_` removed and Google customer-ID hyphens removed to match DW account values. Capture the IDs from the actual buying account, not the manager account. Store IDs as strings, not floating-point numbers.

```text
(normalized source_system, source_account_id, utm_id/native campaign ID)
  -> gold.dim_marketing_campaign_identity.source_campaign_key
  -> approved project/brand/business relationships
```

Campaign name is a validation label and audited fallback, not the primary join key. Register canonical name, platform, account ID, campaign ID, identifier scope, target IDs, agency, launch date and version before spend starts. Do not manufacture a warehouse key solely from an unverified URL value. If IDs disagree with the canonical name, preserve the observed data and flag the mismatch; do not silently overwrite either. Keep unmatched leads visible. Any name-only fallback must resolve to exactly one registered campaign within known source/account and be labelled as fallback.

Use these URL parameter patterns. Angle-bracket values must be replaced; do not publish the angle brackets:

```text
Meta (literal native ID; universally explicit):
utm_source=facebook&utm_medium=paid_social&utm_campaign=<CANONICAL_NAME>&utm_id=<CAMPAIGN_ID>&sena_account_id=<ACCOUNT_ID>

Google final URL suffix (campaign custom parameter _sena = CANONICAL_NAME):
utm_source=google&utm_medium=cpc&utm_campaign={_sena}&utm_id={campaignid}&sena_account_id=<CUSTOMER_ID>

TikTok:
utm_source=tiktok&utm_medium=paid_social&utm_campaign=<CANONICAL_NAME>&utm_id=__CAMPAIGN_ID__&sena_account_id=<ADVERTISER_ID>

ChatGPT Ads (campaign-level landing page query parameters):
utm_source=chatgpt&utm_medium=cpc&utm_campaign=<CANONICAL_NAME>&utm_id={campaign_id}&sena_account_id={ad_account_id}
```

OpenAI Ads supports `{campaign_id}`, `{ad_group_id}`, `{ad_id}` and `{ad_account_id}`. Parameters set at ad group, ad or ad URL level override the campaign template, so set them once at campaign level. OpenAI appends `oppref` itself; do not add it. Verify substitution with a real click before relying on it, as for the other platforms. ChatGPT account and campaign IDs are copied exactly as shown and are not assumed to be numeric.

Google documents `{campaignid}` and configurable custom parameters; do not invent `{campaignname}`. Check lower-level overrides and test the final destination URL. [Google ValueTrack](https://support.google.com/google-ads/answer/6305348?hl=en), [Google custom parameters](https://support.google.com/google-ads/answer/6325879?hl=en).

Keep Google auto-tagging enabled and preserve `gclid`. GA4 can prioritize auto-tagged campaign metadata, so its displayed campaign name need not equal the manual UTM value; compare captured IDs and raw UTM fields separately. [Google auto-tagging](https://support.google.com/google-ads/answer/3095550?hl=en).

TikTok documents `__CAMPAIGN_ID__` and `__CAMPAIGN_NAME__`; a static canonical name avoids dependence on rename propagation. Override auto-attach defaults to the exact SENA source/medium values and preserve UTMs through redirects. [TikTok UTM macros](https://ads.tiktok.com/resources/help/article/track-offsite-web-events-with-utm-parameters?lang=en), [TikTok URL parameters](https://ads.tiktok.com/resources/help/article/how-to-add-url-parameters-to-your-website-url-in-tiktok-ads-manager?lang=en).

Meta dynamic `{{campaign.id}}` may be used only after an actual click verifies substitution in the relevant account. Its official help content could not be retrieved during this audit, so the literal-ID form above is the explicit design fallback, not a claim of freshly verified Meta macro behavior. [Meta help location](https://www.facebook.com/business/help/2360940870872492).

When duplicating a native campaign, replace literal campaign/account IDs and reserve a new canonical sequence before launch.

Landing pages must preserve original UTMs, account/campaign IDs and available click IDs through redirects and form submission, then persist them to the CRM and DW. Define separate first-touch and converting-touch fields; do not overwrite original attribution with a later direct visit. Native instant-form leads need campaign/ad IDs from platform API payloads because no landing-page UTM capture occurs. Measure capture coverage and resolved-key coverage separately from conversion attribution windows and platform-reported conversions.

## 5. Validation and implementation requirements

Prelaunch validation must check all of the following:

1. Nine fields, permitted characters, length ≤150, valid date/sequence, correct platform/tactic/audience pairing, and registered agency/brand/topic/business slug.
2. Exact group casing and existence in both current `dim_project.rem_project_group_id` and `gold.dim_project_group`. Preserve REM project IDs, including leading zeros and suffix letters.
3. Each compound's project belongs to its immediately named group in both REM and `bridge_fhi_project_group_member`. Every intended phase must be detected. Do not accept `GROUP-BOGUS` merely because the group matches.
4. C has one distinct group; D has at least two. E/F have zero project targets. Full-name parser output must equal intended group/project/business/scope sets; reject unexpected signals outside the identifier.
5. Expected raw allocation status matches the scenario. A/B/C require `ALLOCATED_SINGLE_GROUP`; D requires intentional `MULTI_GROUP`; E/F require approved nonproject identity, not an unresolved name.
6. Canonical name and native identity are unique in the campaign registry. Complete an actual ad-click/form-submission trace to captured URL → CRM fields → DW identity, including account ID. Verify redirects and parameter overrides.

Required production follow-up, **not implemented by this audit**:

| Work | Reason / acceptance evidence |
|---|---|
| Add a V1 validator and version-aware field parser; retain legacy rules | Current regex detects signals but accepts malformed names and ignores unsupported tokens. Add objective/tactic/agency/period metadata consistently across platforms. |
| Map BRAND slugs; add explicit scope reporting | Generic BRANDING is currently detected; exact COZI/Kith brand identity and nonproject reporting buckets are not inferred from V1 automatically. |
| Add ChatGPT Ads ingestion (source key, native identity, spend union) before relying on `CHATGPT` names for allocation | Register a source key first, and record the cross-border purpose/scope in `docs/CROSS_BORDER_DATA_REGISTER.md`; the current owner decision covers only Meta/Google campaign-day metrics. Until then ChatGPT spend is outside DW/FHI totals. |
| Add TikTok ingestion, native identity and spend union | The audited path currently includes only Meta and Google; TikTok sample names are a future contract. Reconcile native spend before enabling allocation. |
| Capture/ingest account ID and campaign ID alongside UTMs | REM staging has campaign IDs and UTMs but lacks the inspected account-ID field. GA4 raw staging currently extracts event parameter `campaign_id`, not automatically `utm_id`; map it explicitly. |
| Scope attribution joins by source and account | The existing GA4→Google campaign-ID fallback is unscoped. Correct it before feeding Meta/TikTok IDs into the same field, then build a dedicated campaign attribution bridge. |
| Preserve historical mappings when corrections are required | Latest-name and current-membership semantics can change past classification. Store effective dates and reconcile affected periods. |
| Resolve Bangpu master/name conflicts | `00401` has no current mapped group; `00412` belongs to `C-MIBF-BNGPU`, not `C-MIGD-BNGPU`. Correct from business evidence; do not change `00401` to `00401C` automatically. |

Acceptance should distinguish naming conformance, project allocation coverage, intentional shared/nonproject spend, tracking capture coverage and deterministic identity resolution. They are separate metrics with separate denominators.
