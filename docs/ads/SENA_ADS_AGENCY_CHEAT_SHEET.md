# SENA agency campaign naming — copy-ready V1 reference

> Moved from `sena_idea_mkt_data_warehouse/docs/` on 29 September 2026; this is now the only maintained copy. **Outdated: V1 examples.** Rewrite for SENA-7 ([19](../19-campaign-naming-registry.md)) before sending to agencies.


**24 September design update:** this is the V1 compatibility reference. The [paid campaign registry design](SENA_ADS_CAMPAIGN_REGISTRY_DESIGN.md) contains the proposed V2 examples and release workflow. Do not mix versions or launch V2 until the registry-aware resolver is enabled and verified.

Use [the formal specification](SENA_ADS_NAMING_TAXONOMY.md) with the warehouse audit (DW audit `campaign_naming_audit_2026-09-23.md`, cited by the original study but not committed to either repo). These are **proposed October 2026 examples**, not historical campaign names. Agencies shown are illustrative assignments, not buying instructions. Reserve each sequence/name before launch.

```text
IDENTIFIER__OBJECTIVE__PLATFORM__TACTIC__AUDIENCE__YYYYMM__AGENCY__NNN__V1
```

Uppercase; exactly nine fields; double underscores; maximum 150 characters. `YYYYMM` is launch month. Use a dot between complete members in a joint identifier. Keep the name unchanged after launch. Objective is deliberately second for current Meta parser compatibility.

| Scenario | Platform | Exact campaign name |
|---|---|---|
| A — COZI BTS Saphanmai group | Meta | `PG-C-COZI-BTSSM__LEADS__META__SOCIAL__PROSPECTING__202610__COMBAY__001__V1` |
| A — COZI BTS Saphanmai group | Google Ads | `PG-C-COZI-BTSSM__LEADS__GOOGLE__SEM__KWBRAND__202610__COMBAY__001__V1` |
| A — COZI BTS Saphanmai group | TikTok | `PG-C-COZI-BTSSM__LEADS__TIKTOK__VIDEO__PROSPECTING__202610__COMBAY__001__V1` |
| B — Flexi Sathon Phase 2 | Meta | `PH-C-FLEX-STCRN-HY2DE__LEADS__META__SOCIAL__RETARGETING__202610__BRANDSTROM__001__V1` |
| B — Flexi Sathon Phase 2 | Google Ads | `PH-C-FLEX-STCRN-HY2DE__LEADS__GOOGLE__SEM__KWLOCATION__202610__BRANDSTROM__001__V1` |
| B — Flexi Sathon Phase 2 | TikTok | `PH-C-FLEX-STCRN-HY2DE__LEADS__TIKTOK__VIDEO__RETARGETING__202610__BRANDSTROM__001__V1` |
| C — Flexi Sathon Phase 1 + 2 | Meta | `MP-C-FLEX-STCRN-HY2DE.C-FLEX-STCRN-HYABC__LEADS__META__SOCIAL__MIXED__202610__BRANDSTROM__001__V1` |
| C — Flexi Sathon Phase 1 + 2 | Google Ads | `MP-C-FLEX-STCRN-HY2DE.C-FLEX-STCRN-HYABC__LEADS__GOOGLE__SEM__KWGENERIC__202610__BRANDSTROM__001__V1` |
| C — Flexi Sathon Phase 1 + 2 | TikTok | `MP-C-FLEX-STCRN-HY2DE.C-FLEX-STCRN-HYABC__LEADS__TIKTOK__VIDEO__MIXED__202610__BRANDSTROM__001__V1` |
| D — COZI Saphanmai + Khubon seasonal promotion | Meta | `CL-C-COZI-BTSSM.C-COZI-RITKB__LEADS__META__SOCIAL__PROSPECTING__202610__KIN__001__V1` |
| D — COZI Saphanmai + Khubon seasonal promotion | Google Ads | `CL-C-COZI-BTSSM.C-COZI-RITKB__LEADS__GOOGLE__PMAX__MIXED__202610__KIN__001__V1` |
| D — COZI Saphanmai + Khubon seasonal promotion | TikTok | `CL-C-COZI-BTSSM.C-COZI-RITKB__LEADS__TIKTOK__VIDEO__PROSPECTING__202610__KIN__001__V1` |
| E — COZI brand awareness | Meta | `BRAND-COZI-BRANDING__AWARENESS__META__SOCIAL__BROAD__202610__MEDIAOPTION__001__V1` |
| E — COZI brand awareness | Google Ads | `BRAND-COZI-BRANDING__AWARENESS__GOOGLE__VIDEO__BROAD__202610__MEDIAOPTION__001__V1` |
| E — COZI brand awareness | TikTok | `BRAND-COZI-BRANDING__AWARENESS__TIKTOK__VIDEO__BROAD__202610__MEDIAOPTION__001__V1` |
| F — SENA CSR | Meta | `CORP-SENA-CSR__AWARENESS__META__SOCIAL__BROAD__202610__INHOUSE__001__V1` |
| F — SENA CSR | Google Ads | `CORP-SENA-CSR__AWARENESS__GOOGLE__VIDEO__BROAD__202610__INHOUSE__001__V1` |
| F — SENA CSR | TikTok | `CORP-SENA-CSR__AWARENESS__TIKTOK__VIDEO__BROAD__202610__INHOUSE__001__V1` |

For A/B/C, current Meta/Google rules allocate 100% to one project group. B/C retain phase signals but do not split spend between phases. D intentionally remains `MULTI_GROUP`; use separate group campaigns if group-level CPL is required. E/F are approved nonproject identities and currently remain FHI `UNMAPPED`. COZI's exact brand slug requires the proposed brand mapping extension. **All TikTok examples await DW ingestion and allocation support.**

Additional brand and business examples:

| Purpose | Exact campaign name |
|---|---|
| SENA Kith image campaign | `BRAND-SENA-KITH-BRANDING__AWARENESS__META__SOCIAL__BROAD__202610__MEDIAOPTION__001__V1` |
| Corporate Solar sustainability story | `CORP-SENA-SOLAR__ENGAGEMENT__META__SOCIAL__BROAD__202610__INHOUSE__001__V1` |
| Solar product leads | `BU-SOLAR__LEADS__GOOGLE__SEM__KWGENERIC__202610__INHOUSE__001__V1` |
| LivNex product leads, no specific property | `BU-LIVNEX__LEADS__META__SOCIAL__PROSPECTING__202610__KIN__001__V1` |
| Corporate LivNex explainer | `CORP-SENA-LIVNEX__ENGAGEMENT__TIKTOK__VIDEO__BROAD__202610__INHOUSE__001__V1` |
| Investor relations | `CORP-SENA-IR__TRAFFIC__GOOGLE__SEM__KWBRAND__202610__INHOUSE__001__V1` |

MOMCozi/BestKith are observed campaign labels without dedicated current mapping rules. Confirm whether the actual brief is brand awareness (E), corporate communication (F), or project acquisition (A/B/C), then register the appropriate target and keep optional creative titles in ad metadata.

| Do | Don't | Why |
|---|---|---|
| Copy `C-COZI-BTSSM` from the master | Type `cozi saphanmai` or `c-cozi-btssm` | Current group matching requires the exact case-sensitive ID. |
| Use `PH-C-FLEX-STCRN-HY2DE` | Use only `PH2`, `HY2DE`, or `C2` | A phase needs a real REM ID paired with its group. |
| Use `MP-C-FLEX-STCRN-HY2DE.C-FLEX-STCRN-HYABC` | Use `C-FLEX-STCRN-HY2DE.HYABC` | Repeat the full compound so both phases are detected. |
| Validate the phase against the named group | Assume `GROUP-BOGUS` will fail allocation | The existing parser may ignore BOGUS and allocate the group anyway. |
| Use a CL identifier for multiple groups | Insert one convenient group ID into a portfolio campaign | That would misstate project-level spend. |
| Use `BRAND-COZI-BRANDING` for E | Expect `MOMCozi`, `BestKith`, or `BRAND` alone to identify a brand | Those strings have no dedicated current rule. |
| Use CORP/BU for nonproject spend | Add a fake property to make it “allocated” | Nonproject spend belongs in its own reporting category. |
| Use `MEDIAOPTION`, `BRANDSTROM` | Alternate `Media Option`, `MO`, `BrandStrom` in new names | One agency code prevents reporting fragmentation. |
| Keep objective second and use `__` | Put platform second or mix `_` and `__` | Meta currently reads objective from field 2. |
| Keep budget, CPL, PO and creative title in metadata | Append `BG-100000`, `PO-xxx`, month edits or extra project names | Names stay stable; extra literals can change parsed targets. |
| Register native campaign/account IDs and freeze the name | Join spend to leads using name alone | Names are labels; account-scoped native IDs identify the campaign. |
| Resolve `00401` versus `00401C` from master evidence | Remove/add the suffix to bypass a conflict | They are different project IDs. |

**UTM quick reference**

| Platform | Source | Medium | Campaign |
|---|---|---|---|
| Meta, including Instagram placements | `facebook` | `paid_social` | Copy the full canonical campaign name exactly. |
| Google Ads | `google` | `cpc` | Copy the full canonical campaign name exactly. |
| TikTok | `tiktok` | `paid_social` | Copy the full canonical campaign name exactly. |
| ChatGPT Ads | `chatgpt` | `cpc` | Copy the full canonical campaign name exactly. Platform/tactic `CHATGPT__CONVERSATIONAL`. |

Also send `utm_id` as native campaign ID and `sena_account_id` as native buying-account ID. Use lowercase source/medium; keep the campaign uppercase. Google can substitute `{campaignid}`; TikTok can substitute `__CAMPAIGN_ID__`; ChatGPT Ads can substitute `{campaign_id}` and `{ad_account_id}` (set them at campaign level only). Copy the [URL templates and capture requirements](SENA_ADS_NAMING_TAXONOMY.md#4-utm-and-native-identity-contract); the dynamic syntax belongs in URL settings, not in the campaign name.

Before launch: validate master membership and expected allocation status, reserve the name, then test a real click through form submission. Successful naming alone does not establish 100% lead capture or campaign attribution.
