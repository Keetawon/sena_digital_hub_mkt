# 19 — Campaign naming registry (SENA-H) for the Digital Hub

Date: 28 September 2026; implementation update 29 September 2026. Status: **P1 registry
implemented locally; production pattern approval pending**. This ads module extends
the Phase 1 residential content scope in [REQUIREMENTS](../REQUIREMENTS.md).
It does not change any external campaign, Sheet or DW model.

**29 September 2026, P1.0 design slice (Asia/Bangkok):** SENA-H (§4.2) is the
phase-1 **ads** template issued by the Hub, subject to P'Note's pattern approval.
The existing Sheet and `tools/name_builder` stay V1. Sections 1–4.1 and 8–9 retain
the earlier SENA-7 business rationale/legacy reference; they are not instructions
to implement memo-dependent issuing or migrate the Sheet in P1. Sections 5–7 below
define the approved P1 design and current implementation contract. Doc 20's SENA-7/Sheet references are historical
for this slice; its ownership and read-only boundaries still apply. See the
[execution plan](ads/PHASE1_PRIORITIES.md), [UI design](22-hub-assistant-and-ui.md),
[scope change](ads/SCOPE_CHANGE_20260929.md) and [current questions](ads/OPEN_QUESTIONS.md).
**Owner approval, 29 September 2026:** `P1.0 approved`; implement P1.1–P1.5 only.
Corporate LABEL may be an approved per-boost content label supplied by Online.
Agencies return IDs and see only their own agency's names. Schedule option 3 (P1–P5)
is selected; later priorities still start only after the P1 report/stop.

Evidence: DW audit `sena_idea_mkt_data_warehouse/docs/audit/campaign_name_2026_review_2026-09-28.md`
(1,160 Google/Meta 2026 names, THB 24.9m). This document **supersedes the 9-field V1 grammar and the
`AC`-code V2 grammar** in [`ads/SENA_ADS_NAMING_TAXONOMY.md`](ads/SENA_ADS_NAMING_TAXONOMY.md) and
[`ads/SENA_ADS_CAMPAIGN_REGISTRY_DESIGN.md`](ads/SENA_ADS_CAMPAIGN_REGISTRY_DESIGN.md) **for new names** (moved from the DW repo on 29 September). Their controls (exact
membership, native-ID binding, frozen history, reconciliation) are kept.

## 1. Decision in one paragraph

The business already has a naming standard. The pattern owner (P'Note) defined
`ชื่อโครงการ + Objective + รหัสโครงการจาก IT + BUD + เลข memo + agency + เลข PO`, and 79% of
2026 names (88% of spend) already follow its seven-field layout. We should **formalise
that pattern instead of introducing a new one**. The Hub generates each name from an approved memo
line. The name becomes a *copy* of registry facts that machines can verify.
Identity comes from the native campaign ID. The memo number, project code and PO in the
name then join cleanly to approval, project master and finance data. Two things move out of the name:
free-text budget/KPI/CPL/month notes, and the obligation to know the PO before launch.

## 2. Business flow (as told by the business)

| Question | Answer | Design consequence |
|---|---|---|
| Who types the campaign name? | Agency | Agency must copy, never compose. The Hub generates it |
| Is naming approved? | P'Note set the pattern form | P'Note owns the grammar and vocabularies (steward) |
| Ad flow | BUD requests budget → Online team gets **memo approving budget** (approvers: คุณเชอรี่, พี่ติ่ม, พี่หนึ่ง, คุณแพร) → Online tells agency to go live | The memo exists **before** the agency builds the campaign, so the memo number can be in the name. The name is issued at memo approval |
| Template | Project name + objective + IT project code + BUD + memo no. + agency + PO no. | The seven fields below |

```mermaid
sequenceDiagram
    autonumber
    participant BUD
    participant ON as Online team (Idea)
    participant APP as Memo approvers (4)
    participant HUB as Digital Hub registry
    participant AG as Agency / in-house buyer
    participant PF as Meta / Google / TikTok / ChatGPT
    participant DW as Data warehouse
    BUD->>HUB: Media request (project, month, platform, objective, budget, KPI)
    ON->>HUB: Compile memo lines, attach memo PDF
    APP-->>ON: Sign memo (outside Hub)
    ON->>HUB: Record memo no. + approval evidence → lines APPROVED
    HUB->>HUB: Validate lines, issue SENA-7 names + UTM
    HUB->>AG: Launch pack (name, UTM, budget, KPI)
    AG->>PF: Create campaign with the exact name
    AG->>HUB: Return account ID + campaign ID
    Note over HUB,AG: PO arrives later → Hub records it; agency may rename PO-PENDING once
    PF->>DW: Daily spend (existing pipelines)
    HUB->>DW: Registry snapshot (dlt, source key hub)
    DW->>DW: Parse name, bind native ID → media line, reconcile
    DW-->>HUB: Spend vs budget, conformance and unbound campaigns (restricted)
```

### 2.1 How the work actually runs today — the two operating Sheets

Read-only review on 29 September 2026 of the two Sheets that currently run the process.
The DW does not ingest either one yet.

**A. `Media Plan-FanpageSENA 2026`** (owner senaidea; content and corporate team). Tabs:
one media-plan tab per corporate program (`Corp_PriceLimit`, `Corp_TradeIn`,
`Corp_GreenLifestyle`, `Corp_SenaEasyBuy`, `Corp_JulAlwaysOn`, `Corp_AugAlwaysOn`,
`Corp_SepOctAlwaysOn`, `ตั้งต้น Media Plan` for the THB 1.1m annual page budget), plus
`Working file_for content team` (post log), `Preview Ads` and `Performance form`.

- A program plan has a header (campaign name, period, total budget, **memo number**). Below it
  is the platform/objective plan (Media · Detail · Budget · metric · estimated price and
  volume), then **one line per boosted post** with its dates, days and budget. Example: `Corp_JulAlwaysOn`,
  THB 100,000, `Memo : M.COM033_69`, is split into 12 FB Engagement boosts of THB 3,000–10,000
  for 5–10 days each. THB 81,000 was allocated and 19,000 remained.
- **Content pillars** group the posts: `LivNex`, `StayEasy`, `LowCarbon`, `BrandAndProject`, `Lifestyle`.
- The tab writes its own name template:
  `2026__Engagement__Corp_JulAlwaysOn_LivNex_M.COM033_69-TestDrive`, i.e.
  `YEAR__OBJECTIVE__Corp_<Program>_<Pillar>_<Memo>-<ContentName>`. **Corporate memos are
  per program-period**: `M.COM033_69` July, `M.COM036_69` August, and one
  `M.COM043_69` shared by September and October (THB 150,000).
- `Working file_for content team` is the post log: post no., month, **budget pool used**
  (`ใช้เงินก้อนไหน`), campaign, content type, channel, post name, post date, boost period,
  link, budget, memo, ad status. The budget pool, the campaign and the promoted subject are
  three separate things (doc [09](09-ads-registry-integration.md) §4).
- `Performance form` is the manual monthly report: BUD, Brand, Project ID, Agency, objective,
  spend, reach, CTR, CPL, messages.

**B. `INVOICE Ads`** (owner marcom; the finance ledger). One tab per month (`APR 2026` …
`OCT 2026`), plus `แอดมิน BUD`, `draft`, `ชีต2` (FHI scorecard), `ชีต1` (BUD → ProjectID →
name map) and `Option 3 - Forecast from MTOP Unit` (budget planning).

- **Row grain = REM ProjectID (phase level, e.g. `SRKIT`, `BPSK2`, `00412`) × month ×
  agency.** Each row carries BUD, agency and a `Formatted Mapping` column holding the project
  group code (`C-SKTH-SMRIN`) — the same code agencies put in field 3. About 65 active
  project rows and 58 group codes per month (May–September). Corporate rows use BUD `SID` and
  `Corp_<Program>`.
- **Money columns, left to right, with the owner of each block:**

  | Block | Owner | Columns |
  |---|---|---|
  | Budget | Marketing | `BUDGET ONLINE การตลาดให้` (gross, fee + VAT included) |
  | Agency fee | SENA Idea | quotation `เลข QT`, agency-fee PO `เลข PO`, fee incl. VAT, invoiced fee, remainder |
  | Media | BUD admin | planned media, FB PO, FB invoice no. and amount, FB/Google/TikTok **credit-card** amounts with their own billing periods, total actual media, media remainder, FB overseas bank fee |
  | Payment | ADMIN BUD | evidence deck link, "Online checked" flag, payment status, date sent to finance (floor 11) |

- **Fee arithmetic reconciles to the DW rates.** Samrong, August: gross 100,000 → media
  88,621.05 → fee 88,621.05 × 12% × 1.07 = 11,378.95 (Media Option 12% in
  `gold.dim_agency_fee_monthly`). Planned media = gross ÷ (1 + rate × 1.07).
- **The `PO` in campaign names is the agency-fee PO** (`BK-PO2608-0260`). It is issued **per
  project per month**, and the prefix is the issuing company. Quotation formats differ by agency:
  `QT2026080040` BrandStrom, `BST2607036` Media Option, `QT6908…` KIN. Media itself is paid
  by Meta invoice or credit card, never against that PO.
- Media actuals follow **billing periods**, not calendar months (e.g. Google 21 July–21 August;
  FB card 23 July–25 August). Monthly totals: THB 4.7–5.0m media and 0.62m fee (July/August).
- **Pooled funding is a row note:** each Kith project contributes `แชร์ budget 3,000 ทำ SEM Kith
  Pool` to one shared Google campaign (`kith_sena_sem_adtext`, THB 132k in 2026). This is
  funding by several projects, not a naming problem.
- Group codes disagree with the names in six places each way, e.g. the ledger books
  Bangpu under `C-MIBF-BNGPU` while the campaigns use `C-MIGD-BNGPU`. That is the known
  00401/00412 conflict, now shown in finance as well.
- **Budgets come from sales targets.** `Option 3 - Forecast from MTOP Unit` takes monthly unit
  targets → online book target → leads per book (from walk/book ratios) → lead forecast →
  media budget = leads × target CPL → gross including fee and VAT.
- `ชีต2` is the agency scorecard (FHI score, KPI vs actual leads, lead quality classes, CPL,
  walk, book, ROAS, LINE chats). The DW already produces this as FHI.

**What this changes in the design:**

1. **The media line is the ledger row:** project (phase) × month × agency, with its group code.
   Campaign names attach to it; memo, QT, PO and the money columns hang from it. The Hub
   `ads` module is designed to replace `INVOICE Ads` row for row.
2. **The PO cannot be a reliable name field:** it changes every month, but a campaign can run for
   several months. Finance joins by `(group/project, month, agency)` from the ledger, which is
   deterministic without the name. The name keeps field 7 only as an optional reference (§4).
3. **Two name families share SENA-7:** agency project campaigns (one line per project-month),
   and in-house corporate boosts (one name per boosted post, memo per program-period, pillar
   as scope). BUD for corporate is `SID`, the code already used in the ledger.
4. **Funding contributions are first-class** (the Kith SEM pool). This is separate from `ZONE-*`, which
   is about *what is promoted*.
5. **Planning can start from MTOP unit targets:** the Hub can propose a line's budget and KPI
   from the forecast chain before BUD edits it.

## 3. What 2026 data says

| Field | Fill rate over the 921 seven-field names | What goes wrong |
|---|---|---|
| Project name | display text | Sometimes contradicts the code (`KITH BANGPU 00401` + `C-MIGD-BNGPU`) |
| Objective | 88% valid | Mixed case; 19 Google names put `SEM` here |
| IT project code | 100% valid in master (58/58 groups) | Phase is appended ad hoc (`C-FLEX-STCRN-HY2DE`); multi-project pool zones hidden in free text |
| BUD | 100% in `C1 C2 C3 H1 H2 PREMIUM` | Differs from the project's usual BUD in 2 groups. This is legitimate cross-BUD funding |
| **Memo no.** | **15% of spend** (Media Option only, `MO2604048`) | Everyone else writes `BG-234,699 AUG`, `KPI 77 CPL2900`, `JUN'26_CPA775` |
| Agency | 88.5% | `Media Option`, `BrandStrom`, `7DaysSuccess` spellings |
| **PO no.** | **24% real** | 62% of spend has `PO-xxx`, `xx`, `*`; KIN writes quotations `QT69080389` |

Read newest-first, the trend is clear (audit §"Newest-first trend"). The pattern began in
**May 2026**, and everything earlier is legacy. Since then the finance fields have been getting worse,
not better. Real PO share among new names fell from 95 (July) to 55 (August) to 24 (September) as KIN switched to
quotation numbers. Each agency fills field 5 by habit (KIN KPI/CPL; COMBAY, BrandStrom and
7DaysSuccess budget). Two findings reshape the design:

- **There are two memo series.** In-house corporate plans use `M.COM043_69` (COM series +
  BE year), shown in the plan header and the names. BUD project memos appear as
  `MO2604048` (`MO` + YYMM + sequence), but only in Media Option names. The owner confirmed on
  29 September that the memo is written into the campaign name **because no other record of it
  exists**. The name is currently the only memo register for project campaigns, and about 85% of
  2026 spend carries no memo.
- **One name ≠ one native campaign.** 69 names are shared by 413 native campaigns (up to 23 at KIN).
  The registry must allow many native campaigns per issued name.

The side-effect matters more than any field. Budget and month text in field 5 forces a **new
native campaign every month** (12.4 native campaigns per project × platform in 2026). This
fragments history, learning and attribution. Media Option writes the memo instead and keeps one
campaign from June to September.

## 4. The SENA-7 name standard

```text
LABEL__OBJECTIVE__SCOPE__BUD__MEMO__AGENCY__PO[__VARIANT]
KITH SAMRONG__LEADS__C-SKTH-SMRIN__C1__MO2604048__MEDIAOPTION__PO-PENDING
FLEXI SATHON__LEADS__C-FLEX-STCRN-HYABC.HY2DE__C2__MO2610012__BRANDSTROM__BK-PO2610-0152
FLEXI BANGNA__LEADS__C-FLEX-MGABN__C2__MO2610012__BRANDSTROM__PO-PENDING__KW-COMPETITOR
POOL ZONE RAMINDRA__LEADS__ZONE-RMINDRA-POOL__H1__MO2610021__7DAYSSUCCESS__PO-PENDING
TEST DRIVE__ENGAGEMENT__CORP-LIVNEX__SID__M.COM033_69__INHOUSE__PO-NA__JULALWAYSON
SEM KITH POOL__LEADS__BRAND-KITH__C1__MO2604038__MEDIAOPTION__PO-PENDING__KW-BRAND
```

(Project lines use the BUD `MO<YYMM><NNN>` series and corporate lines the `M.COM<NNN>_<BE yy>` series.
`MO2604048`, `MO2604038` and `M.COM033_69` are real. The others are illustrative.)

Seven mandatory fields, one optional field, delimiter `__` (two ASCII underscores), maximum 150
characters. Uppercase ASCII; no Thai, `|`, `'`, `,`, `+`, `*` or amounts. The Hub generates
the whole string.

| # | Field | Rule | Source in Hub |
|---|---|---|---|
| 1 | LABEL | Readable project name, `[A-Z0-9 .-]{1,40}`. **Informational only — never parsed for identity** | Scope code's display label |
| 2 | OBJECTIVE | `LEADS`, `TRAFFIC`, `AWARENESS`, `ENGAGEMENT`, `SALES`, `VIDEOVIEWS`, `CONVERSION`. Same list for every platform; Google tactic comes from the API channel type, not the name | Memo line |
| 3 | SCOPE | A **registered scope code** (§4.1) | Memo line target |
| 4 | BUD | `C1 C2 C3 H1 H2 PREMIUM SID` (+ steward additions; `SID` = SENA Idea, as in the ledger). Means the **funding BUD on the memo**. A mismatch with the scope's home BUD is a warning, not an error | Memo line |
| 5 | MEMO | Approved budget memo number, exactly as issued. Observed SENA form `M.COM043_69`; a single `_` is allowed, `__` is not (format to confirm, §9) | Memo |
| 6 | AGENCY | `BRANDSTROM COMBAY KIN MEDIAOPTION 7DAYSSUCCESS INHOUSE` (+ steward additions) | Memo line buyer |
| 7 | PO | Agency-fee PO of the **launch month**, `<ENTITY>-PO<YYMM>-<NNNN>` or `PO<8 digits>` when known; otherwise `PO-PENDING`; `PO-NA` for in-house. Reference only: later months' POs live on the media line, not in the name (§2.1) | Media line / PO record |
| 8 | VARIANT | Optional `[A-Z0-9-]{1,24}`: corporate program (`JULALWAYSON`) or content name for in-house boosts; keyword theme `KW-BRAND`, `KW-COMPETITOR`, `KW-GENERIC`, `KW-LOCATION`; creative/test tag `CAPI-TEST`; flight tag `M202609` only if a memo spans months *and* the buyer needs separate campaigns | Buyer, from a controlled list |

Uniqueness: `(memo, scope, objective, agency, platform account, variant)` is unique among
issued names, so **a name resolves to exactly one media line** without an extra registry
code. That keeps P'Note's layout intact. A name is *not* required to map to one native campaign. In 2026, 69 names
were reused by 413 native campaigns (KIN duplicates campaigns under the same name). Every
native campaign carrying the name binds to the same line, and spend adds up per line.

**Budget, KPI, CPL, month and CAPI notes are not in the name.** They are memo-line fields
that the DW joins by memo. Agencies can then keep one native campaign across months under
the same memo line, instead of duplicating it to change a number.

**PO rule.** The Online team or agency may make **one** rename after launch: replace
`PO-PENDING` with the real PO. A quotation number is not a PO. It goes in the registry's
quotation field. The DW accepts a rename that changes only field 7 from `PO-PENDING`. Any other
rename raises a `NAME_DRIFT` finding and never reclassifies history.

### 4.1 Scope codes — one lookup for the six scenarios

Agencies already write the IT project code, and all 58 codes seen in 2026 are valid. SENA-7
keeps that. Every non-project case also gets a code from the same registry, so field 3
always resolves through one table.

| Scenario | Scope code form | Members stored in registry | Auto / steward |
|---|---|---|---|
| A one project group | `C-COZI-LP107` (REM project group ID, unchanged) | group | Auto-imported from DW `gold.dim_project_group` |
| B one phase | `C-FLEX-STCRN-HY2DE` | group + phase `HY2DE` | Auto from REM group/member bridge |
| C several phases of one group | `C-FLEX-STCRN-HYABC.HY2DE` (sorted, dot-joined) | group + listed phases | Generated on selection |
| D several groups ("pool zone", expo, cluster) | `ZONE-<SLUG>` e.g. `ZONE-RMINDRA-POOL` | ≥2 groups, effective-dated | Steward creates per package |
| E brand | `BRAND-<SLUG>` e.g. `BRAND-COZI` | REM brand ID (text) | Steward |
| F corporate / BU | `CORP-<PILLAR>` using the content team's pillars: `CORP-LIVNEX`, `CORP-STAYEASY`, `CORP-LOWCARBON`, `CORP-BRANDPROJECT`, `CORP-LIFESTYLE`, plus programs such as `CORP-EASYBUY` and `CORP-PRICELIMIT`; `BU-SOLAR`, `BU-LIVNEX` | corporate pillar / program / business type | Steward |

Phase IDs containing characters outside `[A-Z0-9]` get a steward alias. The exact REM ID is
kept in the member row. `ZONE-*` fixes the 2026 "pool zone" pattern, where several projects
hid behind one group code. Its members are explicit, so the DW can report the spend as
shared instead of wrongly assigning all of it to one project.

### 4.2 Hub-issued template (SENA-H) — proposed for phase 1 on the Hub

Status: proposed on 29 September 2026. It needs P'Note's approval because it removes memo and PO from the name.
Once the Hub holds the memo, PO, BUD and budget on the monthly media line, the name only needs a
readable start, fields that still join if the registry lags, and a stable Hub key. Memo, PO and
line all change monthly or can be unknown at launch. The **campaign registration code** is the
only key that is stable for the campaign's life.

```text
LABEL__OBJECTIVE__SCOPE__AGENCY__CODE[__VARIANT]
```

| Field | Rule |
|---|---|
| LABEL | Generated from the scope's English display name; for CORP, Online supplies an approved per-boost content label. `[A-Z0-9 .-]{1,40}`, starts alphanumeric. Server validates and freezes it; informational only |
| OBJECTIVE | Same list as SENA-7. It stays in position 2 because the current Meta parser reads that position |
| SCOPE | Scope token chosen in the Hub (table below); never typed |
| AGENCY | `BRANDSTROM COMBAY KIN MEDIAOPTION 7DAYSSUCCESS INHOUSE` + steward additions |
| CODE | `SN` + 2-digit year + 5-digit sequence + 1 check character, e.g. `SN2600123Q`. Issued when the campaign is registered; never reused. Check character = `ALPHABET[(Σ wᵢ·dᵢ) mod 32]` over the 7 digits with weights 3,5,7,9,11,13,15 and alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0/O/1/I). Odd weights catch every single-digit error; adjacent distinct-digit swaps are caught because the weight difference is 2 and digit differences are 1–9. Swapping identical digits does not change a code |
| VARIANT | Optional, controlled list only: keyword theme `KW-BRAND`, `KW-COMPETITOR`, `KW-GENERIC`, `KW-LOCATION`; `CAPI-TEST`; offer tag such as `LIVNEX`. **Never a project or brand name** — co-promotion is scope D |

BUD, memo, PO, budget/KPI and month live on the media line. The Hub assigns each campaign to the
right month's line, so an always-on campaign keeps one name while its memo and PO change monthly.
DW match order: CODE → native ID bound in the Hub → (SCOPE, month, AGENCY) → correction table → unresolved.

**Scope choice — the three-step picker from `How_To_Use` rows 21–31, carried into the Hub.** The Hub
keeps the same three steps (scope type → group/brand/topic → phase/extra groups), and the lists
filter from the previous choice. The full target set is stored as registry rows. The name shows only
a short token, because the registry resolves the full target list from CODE:

| Scope (step 1) | Step 2 | Step 3 | Sheet V1 name token | SENA-H SCOPE token | Registry rows | Dashboard |
|---|---|---|---|---|---|---|
| A — whole group (most cases) | group, e.g. `C-COZI-BTSSM` | empty | `PG-C-COZI-BTSSM` | `C-COZI-BTSSM` | 1 GROUP | 100% to group |
| B — one phase/tower | group `C-FLEX-STCRN` | 1 phase `HY2DE` | `PH-C-FLEX-STCRN-HY2DE` | `C-FLEX-STCRN-HY2DE` | 1 PHASE | 100% to group + phase stats |
| C — several phases of one group | group | ≥2 phases (multi-select) | `MP-C-FLEX-STCRN-HY2DE.C-FLEX-STCRN-HYABC` | `C-FLEX-STCRN` (group only; phases in registry, flagged multi-phase) | ≥2 PHASE | 100% to group |
| D — several groups / Expo / location promo | first group | more groups (multi-select) | `CL-C-COZI-BTSSM.C-COZI-RITKB` | `ZONE-<slug>`, slug issued by the steward or generated by the Hub on save (e.g. `ZONE-COZI-PET4`) | ≥2 GROUP | Held as shared spend; no split unless approved weights |
| E — brand | brand `COZI`, `SENA-KITH` | empty | `BRAND-COZI-BRANDING` | `BRAND-COZI` | 1 BRAND | Brand spend |
| F — corporate or BU | topic `CORP-SENA-CSR`, `BU-SOLAR` | empty | `CORP-SENA-CSR` / `BU-SOLAR` | `CORP-<pillar or topic>` / `BU-<unit>` | 1 CORPORATE / BU | Corporate / BU spend |

Rules carried over from the Sheet: when you change step 1 or 2, the later steps clear. The system
orders phases and groups. If a group, phase or brand is missing, the user asks SENA Idea and never
picks a near match. Brands marked "proposed, pending approval" can only be used after approval. The Hub adds:
C and D need at least two distinct items; the length never depends on how many phases or groups
are chosen (the Sheet's C/D names grew with every member; `C-MIGD-BNGPU` has 14 phases).

**Situations found in the 2026 data and how SENA-H handles them:**

| Situation (evidence) | Handling |
|---|---|
| Always-on campaign across months, memo/PO change monthly (Media Option `MO2604048` June–September) | One CODE; monthly lines carry memo/PO. No rename, no new campaign per month |
| 1 name → many native campaigns (KIN up to 23) | All bind to one CODE; spend adds up on the line |
| Google keyword splits (BrandStrom Brand/Competitor/Generic/Location as separate campaigns) | Same registration, VARIANT `KW-*`; each variant is a distinct name |
| Co-promoted project hidden in free text (`- Vela`, `- Park Ville`, `VELA BANGPU - bp`) | Not allowed in VARIANT; the user registers scope D (`ZONE-*`) |
| Ad promotes one project but another BUD pays (Grand Home Rangsit named `H-SGHM-BNK29`; ledger `H-SGHM-RSTTN` 82,957) | SCOPE = what is promoted, picked from a list; the paying BUD is on the line |
| Pooled funding (each Kith project gives 3,000 to one SEM campaign) | Scope E `BRAND-SENA-KITH`; project lines contribute via `ads.funding_contribution` |
| LivNex offer on a project (`- Livnex`, `NONLivnex`) | Offer is a registration attribute; optional VARIANT `LIVNEX`; scope stays the project |
| Corporate boosted posts (12 per program, `M.COM033_69`) | One CODE per boost; LABEL = content name; scope `CORP-<pillar>`; program + memo on the line |
| Solar / BU acquisition (`SENASolar-2026_B2C_Jul-Sep`) | Scope F `BU-SOLAR`, BUD `SOLAR` on the line |
| Google puts `SEM` where the objective goes | Objective always from the business list; tactic from the platform API |
| Phase IDs with `_`, `/`, Thai (13 in REM) | Steward ASCII alias for scope B; the exact REM ID stays in the registry row |
| Code conflicts (`C-MIGD-BNGPU` vs `C-MIBF-BNGPU`) | Registry blocks the inactive code; ledger history goes through the correction table |
| Brand duplicates (`KITH` vs `SENA-KITH` in the Sheet) | Keep one active brand token (to decide); the other becomes an alias |
| TikTok / ChatGPT Ads | Platform comes from the ad account, so no name change is needed |

```regex
^[A-Z0-9][A-Z0-9 .\-]{0,39}__(LEADS|TRAFFIC|AWARENESS|ENGAGEMENT|SALES|VIDEOVIEWS|CONVERSION)__((C|H|T|S)-[A-Z0-9]{4}-[A-Z0-9]{5}(-[A-Z0-9]+)?|ZONE-[A-Z0-9-]+|BRAND-[A-Z0-9-]+|CORP-[A-Z0-9-]+|BU-[A-Z0-9-]+)__[A-Z0-9]{2,20}__SN[0-9]{7}[2-9A-HJ-NP-Z](__[A-Z0-9-]{1,24})?$
```

Examples (sequence numbers illustrative; check characters computed):

```text
COZI SAPHANMAI__LEADS__C-COZI-BTSSM__KIN__SN2600101Y
FLEXI SATHON PH2__LEADS__C-FLEX-STCRN-HY2DE__BRANDSTROM__SN2600102F
FLEXI SATHON__LEADS__C-FLEX-STCRN__BRANDSTROM__SN2600103W__KW-BRAND
COZI PET CONDOS__LEADS__ZONE-COZI-PET4__KIN__SN2600104D
SENA KITH__AWARENESS__BRAND-SENA-KITH__MEDIAOPTION__SN2600105U
TEST DRIVE__ENGAGEMENT__CORP-LIVNEX__INHOUSE__SN2600106B
```

SENA-7 (§4) stays the reference for parsing legacy and interim names.

**P1 boundary:** registration is independent of monthly media lines. P2 will attach
registrations to those lines; P1 does not attest memo approval or authorize spend.
While `ads.setting.sena_h_approved` is false (the seed default), every registry screen
shows **รออนุมัติรูปแบบชื่อ**. Local/shared test environments may issue test records;
production issuing is rejected server-side until approval is recorded. Test records
are never copied into the production registry. P'Note's approval and the developer's
P1.0 design approval are separate decisions.
Shared testing must use a separately configured test database and verified identities;
the loopback-only demo mode must not be exposed as a shared service. Any test-issue
override is server/deployment configuration, never a request field or an agency setting.

## 5. Hub system design

P1 adds a private `ads` schema beside the residential Hub, using the existing
FastAPI transaction/actor pattern and Next.js admin proxy. It implements BF-0
registry stewardship and the name/ID-return part of BF-5. BF-2, BF-7 and BF-8 remain
later work. A registered name is not evidence of an approved budget or a live campaign.

**Interim:** the existing `Name_Builder` Sheet stays V1, including its current approval
and freeze behavior. Do not re-point it to SENA-7/SENA-H or migrate its rows implicitly.
The Hub is the phase-1 SENA-H surface. Existing names are explainable as legacy input;
new Hub names use §4.2 exclusively. The older Sheet field specification's instruction
to re-point the Sheet is superseded here; that file supplies vocabulary evidence only.

### 5.1 Registry schema (SENA-H), implemented in P1

Implemented in migration `202609290014_ads_registry.sql`, following
`202609210013_project_media_collections.sql`, after the owner's P1.0 approval.
The migration and synthetic fixtures have been applied to the local Hub database;
this does not record P'Note's production approval or activate real DW scopes.
All timestamps are `timestamptz`; business year/date calculations
use `Asia/Bangkok` and Gregorian years. REM, account and campaign IDs are **text** in
SQL, JSON and the UI, preserving case, punctuation and leading zeros. UUIDs below are
Hub identities, not replacements for source IDs.

| Table | Grain / constraints | Required fields and behavior |
|---|---|---|
| `ads.vocab` | PK `(vocab_type, code)` | Types `OBJECTIVE`, `AGENCY`, `VARIANT`, `PLATFORM`, `BUD`; text `code`, `label_th`, `label_en`, `status` (`PROPOSED/ACTIVE/INACTIVE`), nullable date `active_from/active_to`, optional `alias_of` within the same type, `source_reference`, `updated_at/by`. Only active canonical values within their Bangkok validity dates issue new names. Code/type cannot be updated, including before reference. BUD is vocabulary context only in P1. |
| `ads.scope_code` | PK `scope_id UUID`; unique `(kind, member_signature)`; token unique except for `MULTI_PHASE` | `scope_code` text emitted in the name, `kind` (`GROUP/PHASE/MULTI_PHASE/ZONE/BRAND/CORP/BU`), `label_th`, approved ASCII `label_en`, nullable `parent_group_id`/`home_bud`, `member_signature` (sorted JSON text of `[member_type, member_id, parent_group_id]` tuples), `status` (`PROPOSED/ACTIVE/INACTIVE/CONFLICT`), `source_snapshot`, `source_fingerprint`, `created_at/by`. PHASE/MULTI_PHASE require a parent. Reuse an identical kind/member set; do not mutate issued scope fields except status. |
| `ads.scope_member` | PK `(scope_id, member_type, member_id)` | FK `scope_id`; type `GROUP/PHASE/BRAND/CORPORATE/BU`, exact text `member_id`, text `parent_group_id` for PHASE, nullable approved ASCII `name_alias`, `source_snapshot`, nullable source `effective_from/effective_to`. No invented historical dates or phase allocation weights. Scope membership is frozen once issued. |
| `ads.campaign_registration` | PK `code text`; unique `(sequence_year, sequence_no)` | Full Gregorian `sequence_year` (2000–2099), `sequence_no` (1–99999), FK `scope_id`, typed vocab FKs `objective`, `agency`, nullable `variant` (the initial/default variant), ASCII `label` derived from scope or Online's approved CORP content label, `status` (`REGISTERED/CANCELLED`), `created_by UUID`, `created_at`, nullable `label_approved_by/at` for CORP, `cancelled_at/by`, `cancelled_reason`. Identity, scope, agency, objective, default variant, label and approval assertion freeze at issue. Cancellation retains the code, names and bindings; no hard delete or sequence reuse. |
| `ads.campaign_name` | PK `name_id UUID`; FK `code`; unique `(code, variant)` with NULL treated as one no-variant value; unique `frozen_name` | `variant` typed FK or null, `template_version = SENA-H`, `frozen_name`, `utm_campaign = frozen_name`, `utm_id_note` (Thai instruction, not a guessed ID), `issued_at`, `issued_by`. Names and stored UTM values are immutable. A registration has one initial name and may have additional controlled variants, as §4.2 requires. |
| `ads.native_binding` | PK `(platform, account_id, campaign_id)`; many rows per registration/name | All native key parts text; platform vocab FK, FK `name_id` and `code` constrained to the same campaign_name row; `method` (`AGENCY_RETURNED/ONLINE_CONFIRMED`), `bound_by`, `bound_at`. Exact same target/key replay returns the existing row. A native key already bound to another code or variant returns 409; never overwrite or delete via the P1 API. |
| `ads.code_sequence` | PK `sequence_year` | `last_value` integer, 0–99999. Atomic insert/update with a row lock allocates the next value inside the registration transaction; no `MAX()+1`, cycle or reset. Exhaustion is a Thai error. Cancelled/committed registrations never free a number. Rollback returns no code to the caller. |
| `ads.setting` | PK `key text`; P1 accepts only `sena_h_approved` | Boolean JSON `value`, `updated_at/by`, `change_reason`, `approval_evidence`. Seed `false`. A true value requires an actor and nonblank evidence; missing values fail closed and non-boolean writes are rejected. Only guarded `ads.set_approval` permits admin changes with a reason and recorded decision evidence. No secrets or arbitrary client-controlled authorization settings. |

Generated `objective_type`, `agency_type`, `variant_type` and `platform_type` columns
enforce typed composite vocab FKs. They are internal constraint fields, omitted from
registration/name/binding API payloads and the DW views. The migration also adds private
`staging.ads_scope_import`: fingerprint PK, raw `source_record`, `provenance`, nullable
`source_snapshot_at`, ingestion `received_at`, `status` (`APPLIED/QUARANTINED`) and JSON
`issues`. No app role receives staging grants.

**Scope identity and imports.** A whole-group A scope and each C subset can all emit
`C-FLEX-STCRN`, while having different `scope_id` values and immutable member sets.
CODE → registration → scope_id resolves the exact set. Never resolve a C target by its
token alone. A/B imports use `gold.dim_project_group` plus reviewed group/member bridge
exports through Hub-only `scripts/stage-ads-scopes.py`. It follows the validate-first,
explicit-apply, raw-hash and one-transaction pattern of `scripts/stage-gold-project.py`,
without its HYABC-only whitelist. It has no DW connection and applies only to the local
Hub database. Receipt/export/source times remain distinct; exact replay is a no-op.
Unknown parents, duplicate/conflicting IDs and missing labels quarantine the whole
batch; no near-match selection or partial activation is performed.

```powershell
uv run --project apps/api python scripts/stage-ads-scopes.py --groups groups.json --members bridge.json --captured-at 2026-09-29T12:00:00+07:00
# After reviewing the dry-run result, repeat with --apply; add --aliases aliases.json when needed.
```

Both inputs are non-empty JSON arrays. Group rows require exact text
`project_group_id`, distinct text-array `project_id_set`, `project_name_th`, naming-safe
ASCII `project_name_en` (uppercased, 1–40 characters), and timezone-qualified
`source_snapshot_at`; supplied `member_count` must match the array. Bridge rows require
text `project_group_id`/`project_id`, `project_name`/`project_name_eng`,
`membership_status=CURRENT_REFERENCE`, timezone-qualified `reference_observed_at`,
and absent/null `valid_from`/`valid_to`. Deleted members are not activated. The master
and bridge member sets must match exactly. Numeric IDs, replacement characters in
Thai labels, missing English labels and naive timestamps are rejected.

Optional steward aliases are an array of `{project_group_id, project_id, name_alias}`;
`name_alias` is `[A-Z0-9]+`, while the original phase ID is retained. Colliding aliases
or aliases without an exact source pair quarantine the batch. Use `--received-at`
instead of `--captured-at` when only receipt time is known; export time remains null.
`--apply` retains original input bytes and their hashes under `.local/pilot-intake`,
and writes canonical payload fingerprint, provenance and validation issues to staging
in one transaction. Existing registry identity, label or status conflicts quarantine
the batch for steward review. A different snapshot never rewrites an issued scope.
Malformed JSON/envelopes stop before staging. This command does not issue names.

Read-only DW evidence on 29 September: `dim_project_group.sql` exposes
`project_group_id`, `project_name_th/en`, `project_id_set`, `source_snapshot_at`;
`bridge_rem_project_group_member.sql` exposes `project_group_id`, `project_id`,
`membership_status = CURRENT_REFERENCE` and null historical validity dates. The model
files do not prove deployed tables or access. Reconcile master/bridge pairs before
activation; never treat an FHI reporting allocation bridge as phase identity evidence.

Additional read-only evidence during implementation: DW
`outputs/naming_registry_simple_20260925/naming_options_snapshot.json` records all six
agency codes and six objectives (doc 19 additionally requires `VIDEOVIEWS`), 117 groups
and 13 excluded V1-incompatible phase IDs. Its source date is only `2026-09-23`, and its
group records contain no English labels or verified source timestamp. It is vocabulary
evidence, not a complete verified Gold export for activating Hub scopes. Real A/B
activation remains dependent on Q3; local fixtures are explicitly synthetic.

C requires ≥2 distinct phases of one exact group; D requires ≥2 distinct groups.
Changing picker step 1/2 clears dependent selections. Persist members in canonical
ASCII/code-unit order, never locale sort. For D, the server generates
`ZONE-<12 uppercase hex characters of SHA-256(canonical member set)>`; an existing
canonical set reuses its stored token. A hash collision with a different set returns
a conflict for steward review and never reuses the wrong target. No transliteration
of Thai source IDs. B uses a steward ASCII alias where
needed, retaining the exact source phase ID. Inactive/conflicting groups and proposed
brands cannot issue names. KITH/SENA-KITH remains quarantined pending Q6.

**Vocab evidence.** Migration 0014 seeds the seven objectives, six agencies and six
controlled variants in §4.2 as active, with source references. `Naming_Options` values
described in [the Sheet field spec](ads/SENA_REGISTRY_GOOGLE_SHEETS_FIELD_SPEC.md)
supply the vocabulary evidence; proposal status is retained. `META` and `GOOGLE` are active ID-return
vocabulary; `TIKTOK` and `CHATGPT` remain proposed. This does not deploy a platform
integration. BUD context seeds are `C1`, `C2`, `C3`, `H1`, `H2`, `PREMIUM`, `SID`;
no budget tables or real brand/CORP/BU scopes are activated. Do not carry V1 channel,
audience, tactic or month fields into SENA-H. Unknown values require steward action,
not automatic activation. CORP/BU are naming classifications only, not new BU content
catalogues, tenant workspaces or a Solar implementation.

**Variant decision confirmed by the owner, 29 September 2026 (Asia/Bangkok).**
Follow §4.2: keep one SN registration code across controlled name variants, including
`KW-BRAND` and `KW-COMPETITOR`. The owner chose to retain this grouping for later budget
matching. `registration.variant` is the initial default; each `campaign_name` carries
its own frozen variant, and native bindings select the specific `name_id`. Creating a
variant cannot change scope/objective/agency/label or edit an issued name.

The shared SN groups variants for the later media-line relationship. Budget/memo
matching still uses the applicable monthly media line (scope × calendar month × agency,
or the corporate program-period); SN alone does not identify one budget across months.
The later P1.0 approval authorizes P1 implementation; P'Note's production approval and
permission to start P2 remain separate.

**Corporate label decision confirmed (Q10), 29 September 2026.** Online supplies an
approved per-boost `content_label`, for example `TEST DRIVE`, for CORP scope. It must
satisfy the same uppercase ASCII label grammar and is frozen on issue. Record Online's
approval assertion with the authenticated actor/time; the form is not an approval
workflow. Other scope kinds retain their server-derived scope label. Clients never
submit a complete generated name. One CODE per boost remains unchanged.

**Issuing and API contract.** All endpoints are private under `/v1/admin/ads`, separate
from the residential permission dependencies. Registration/name writes accept structured
scope IDs/selections, objective, agency and optional variant, plus the approved CORP
`content_label` and its approval assertion; never `name`, `frozen_name`, UTM text, code,
sequence or creator. Non-CORP label overrides and unknown fields are rejected.
The server resolves labels/vocab, checks exact membership, computes the code/check char,
and validates the §4.2 regex, ≤150 characters and parse/generate round trip.

| Operation | Contract |
|---|---|
| `GET /scopes` and cascading lists | Active choices by kind/parent; existing scoped history remains readable. Dependent selections must be revalidated on submit. |
| `GET /settings` | Only public-to-registry status fields, including `sena_h_approved`; no private approval evidence to agencies. |
| `POST /registrations/preview` | Read-only server calculation from the same structured fields; no sequence allocation, row creation or copyable final code. Return a provisional display with `รหัสจะออกเมื่อบันทึก` and validation state. |
| `POST /registrations` | In one transaction: validate and freeze target set → allocate SN → insert registration and initial name/UTM → commit → return launch pack. Recheck approval setting and active vocab/source state; stale preview never authorizes issue. |
| `GET /registrations`, `GET /registrations/{code}` | Server-filtered pagination/search/counts; registration, names, scope members and bindings are all subject to RLS. Missing or unauthorized record returns the same 404. |
| `POST /registrations/{code}/names` | Minimal additional operation supporting the already specified same-CODE variants; structured variant only, online staff/admin only, same freeze/approval checks, replay-safe by `(code, variant)`. |
| `POST /names/validate` | Explicit read-only exception to the input rule: accepts an **observed** name for explanation, never persistence/issue. Strict SENA-H shape/check char first; malformed SENA-H is invalid, not silently reclassified. Else explain SENA-7 legacy fields; mark V1/unknown as legacy/unsupported. Do not reveal another agency's registry matches. |
| `POST /registrations/{code}/bindings` | Select an authorized name_id; platform/account/campaign IDs remain text. Same-key/same-target replay is harmless; conflicting target returns 409 with Thai guidance, without exposing another agency's code. |

`ads.cancel_registration(code, reason)` is an admin-only database operation; P1 adds
no cancellation HTTP route. Cancellation is status-only with a reason; it cannot edit
the frozen fields or erase existing bindings. The initial P1 screens need only show
cancelled status; no bulk cancellation or correction workflow is added.

The preview and additional-variant operations make the requested live preview and
§4.2 variant behavior concrete; they do not add another workstream. Disable duplicate
submits and show a saved code only after commit. A future retry/idempotency mechanism
must not allocate a second code silently after an uncertain network result; for P1,
retain form state and ask the user to check the latest list before explicitly retrying.

UTM: the persisted `utm_campaign` is the **entire unencoded frozen name**. Server-generated
launch-pack suffixes encode that value exactly once. `utm_id` is a native campaign ID,
never SN and never name_id; multiple bindings mean there is no single concrete utm_id
on the registration. Google pack uses literal `utm_id={campaignid}`. Other platforms
show a Thai instruction to enter the returned campaign ID unless a verified macro is
available. Never emit a fake ID or encode Google's braces away. Binding adds native
facts without rewriting issued name/UTM history. Copy is an explicit user action;
P1 does not send a message to the agency or launch an ad.

**Roles, RLS and write boundaries.** Migration 0014 extends the allowlisted roles with
`online_staff` (Thai label `เจ้าหน้าที่ออนไลน์`) and `agency` (`เอเจนซี`). These are
NOLOGIN/NOINHERIT group roles granted only to the trusted API runtime; no browser SQL.
Verify Supabase `app_metadata.hub_role` as today. For agency actors, require an
admin-provisioned `app_metadata.hub_agency` canonical code and bind it to Actor alongside
its UUID. Set transaction-local `app.actor_id` and `app.agency_code` only from that
verified actor, clearing agency context for other roles. Neither body/query/headers nor
editable `user_metadata` chooses agency access. Unknown/missing agency fails closed.
Demo mappings remain local synthetic fixtures and need two distinct agency actors.

| Role | Registry reads | Allowed writes |
|---|---|---|
| `admin` (registry steward) | Registry rows and approval metadata; counter accessed through issuing functions | Vocab/scope stewardship; setting with decision evidence; registration, variants and binding; audited cancellation |
| `online_staff` | Registry rows, settings and picker; no direct counter access | Register/issue, append variant, bind IDs; cannot change grammar approval, master identities or an issued name |
| `agency` | Own agency registrations/names/bindings and their scope members; approved picker vocab/scopes | Return IDs only to own active registration/name; cannot issue names, choose another agency or cancel/rebind |
| `editor`, `publisher`, `viewer` | No ads access by default | Existing residential permissions unchanged |
| `service_consumer`, anonymous/public | None | None; no ads data in `public_api` or public RAG |
| `ads_export_reader` | Only the five explicit export views in §6 | None; separate DW credential, not a browser/API actor |

All eight tables have **enabled and forced RLS**; PUBLIC has no schema/table/function
privileges. Registry table policies restrict agency SELECT/INSERT binding checks via
its parent registration, including `WITH CHECK`, and deny agency registration/name
writes. Shared active master choices are readable as picker data, not other agencies'
registration-specific C/D selections. Names/bindings/member detail joins and counts must
not bypass parent policy. Sequence and private setting metadata are inaccessible to
agencies. Reference FK checks and immutable-field triggers also protect privileged
application writes. No app role gets DELETE or arbitrary sequence/settings updates.

Guarded functions use fixed `search_path = pg_catalog, pg_temp`, qualified object
names and explicit actor/role checks. Their owner, `ads_registry_writer`, is
NOLOGIN/NOINHERIT, non-superuser and non-BYPASSRLS, with explicit operation privileges
and RLS policies; the API runtime cannot assume this role. Application roles have no
direct registration/name/binding writes, including agency binding inserts, despite
the additional agency `WITH CHECK` policy. Only `ads.bind_native` accepts ID returns.
PUBLIC EXECUTE is revoked. Triggers record setting, stewardship, issue, cancel and
bind changes through `audit.record_change`.
Bound status is derived from binding count, not a second mutable identity status.

The implemented API calls `ads.preview_scope` for C/D and `ads.preview_existing_scope`
for A/B/E/F; both validate the target without allocating a code. In the issue
transaction, `ads.create_scope` reuses/creates C/D membership,
`ads.issue_registration` rechecks scope/vocab and allocates SN, and `ads.add_variant`
appends a name to an existing registration. `ads.registration_detail` remains an
invoker function so its callers' RLS applies to every nested name/member/binding read.

Production approval is checked by both API and `ads.require_issuance`. The latter
has function-local `app.ads_test_issuing=off`; a caller's session setting cannot override
it. Only a deployment owner can change the function configuration for an isolated test
database. `scripts/sample-ads-registry.sql` does so for local synthetic fixtures;
never apply that file to production. `ads.test_issuing_enabled` reports the trusted
function configuration. API test issuing additionally requires `HUB_ENV=local`.
`sena_h_approved` remains false and its pending banner remains required during tests.

**P1 database acceptance evidence:** `supabase/tests/ads_registry.sql` and
`supabase/tests/concurrent_ads_code.mjs` passed locally: agency isolation including
C/D member privacy and cross-agency name IDs, frozen names/UTM/identity/membership,
same-SN variants, unique replay-safe binding, production-guard session forgery,
rollback, audit, export restrictions, and two simultaneous transactions receiving
distinct committed sequence values. Importer unit checks and a disposable-database
apply/replay/quarantine check passed. Naming/API/browser acceptance remains covered
by its dedicated suites and final P1 verification report; these database results
alone do not claim browser checks or DW deployment. Swapping equal digits is unchanged
input, not a failing checksum test.

**Later placeholders only:** P2 adds `ads.media_line` and `ads.memo`; P4 adds
`ads.memo_document`. Their columns, approval/revision rules, relationships, archive and
screens are to be designed in their own slices. No placeholder tables or nullable memo
FKs are created in P1. Other BF-1…BF-12 financial objects remain outside this migration.

## 6. DW integration and matching

**P1 read-only contract implemented in migration 0014**, without editing the DW repo.
The DW owner registers source key **`hub`** before ingesting; `adinv`/`mplan` are separate
later sources. Source-key approval does not block local implementation of these views.

| Hub view in private `ads_export` schema | DW bronze target | Key and exported fields |
|---|---|---|
| `campaign_registration` | `hub__campaign_registration` | `code`; sequence_year/no, scope_id, objective, agency, initial variant, label, status, created_at, cancelled_at |
| `campaign_name` | `hub__campaign_name` | `name_id`; code, variant, template_version, frozen_name, utm_campaign, utm_id_note, issued_at |
| `native_binding` | `hub__native_binding` | `(platform, account_id, campaign_id)`; code, name_id, method, bound_at |
| `scope_code` | `hub__scope_code` | `scope_id`; scope_code, kind, label_th/en, parent_group_id, home_bud, status, source_snapshot, source_fingerprint |
| `scope_member` | `hub__scope_member` | `(scope_id, member_type, member_id)`; parent_group_id, name_alias, source_snapshot, effective_from/to |

Use explicit columns; exclude actor UUIDs, approval evidence, private notes, secrets and
all future memo/budget/document fields. Include cancelled registrations and inactive
historical scopes so earlier bindings remain resolvable. Referenced scopes/members must
be present in the same export. A test deployment exports only to a separate DW test
source/dataset; no test rows are promoted as production facts.

The migration creates a separate NOLOGIN `ads_export_reader` with USAGE on `ads_export` and SELECT on
these views only. A dedicated NOLOGIN, non-BYPASSRLS `ads_export_owner` owns the views,
has SELECT on only the required base columns and explicit SELECT RLS policies covering
the contract; it has no application writes. Views use owner privileges and
`security_barrier`; reader gets no base-table/staging/audit grants and cannot assume the
owner role. A separately provisioned read-only DW login receives only the reader role,
with `default_transaction_read_only` as defense in depth. The web runtime receives no
export-role membership. No grant to `service_consumer` or PUBLIC.

The DW extracts all five views under one repeatable-read, read-only snapshot, retaining
batch ID, extraction time and row counts in its intake manifest. Full-replace into
bronze occurs only after the whole batch succeeds; no mixed-generation table snapshots.
Keep text IDs losslessly through bronze/silver. P1 documents this requirement; the DW
team owns the dlt job, source registration and any necessary silver/gold changes.

Match order is **CODE → Hub-bound native ID → (SCOPE, Asia/Bangkok month, AGENCY) → approved
correction table → unresolved**. This is a candidate discovery order: an existing
confirmed native binding always wins. If observed CODE disagrees with that binding,
raise an exception; never silently re-map. For C, CODE supplies scope_id and phase set;
a bare group token cannot reconstruct it. Scope/month matching and financial line joins
become available only with P2/P3, not from P1-only snapshots. Shared D spend has no
invented phase/group weights. Legacy SENA-7 parsing belongs to the DW; the Hub's explain
helper is read-only. `utm_campaign` is the full name; `utm_id` joins native campaign ID.

The read-only DW contract file still describes SENA-7 and memo/line ingestion first.
This implemented P1 export contract supersedes that ordering on the Hub side; Q3 requires the DW
owner to reconcile its implementation later. P1 makes no claim that a DW parser, mart,
spend reconciliation or Google form capture has been deployed.

## 7. Rollout

| Step | What | Changes for agencies |
|---|---|---|
| P1.0 | Review this schema, doc 22, scope change and open questions; stop for `P1.0 approved` | None |
| P1.1–P1.4 | Build UI foundation, registry, API and screens in local/shared test; `sena_h_approved=false` | Thai pending banner; test registration/ID-return only; Sheet stays V1 |
| P1.5 | Verify export views/role and hand the `hub` contract to the DW owner | No Sheet or DW mutation |
| Production gate | Record P'Note's SENA-H approval; confirm active vocab/brand, user provisioning, environment and DW contract; Online retains the existing external memo/launch approval process | Copy the Hub-issued frozen name/UTM; return each native account/campaign ID |
| Later, separately authorized | P2 monthly line/memo link, then other priorities per the plan | No implied P2–P6 start from P1 acceptance |

P1 success measures: new Hub-issued names conform to SENA-H and round-trip 100%; no
reused issued code; no cross-agency reads/writes; every returned native key has one
binding; issued names remain unchanged. Record ID-return coverage separately from
observed-spend coverage. Memo approval, PO ageing, pacing and financial reconciliation
are later measures and are not claimed complete by the naming registry.

## 8. Why not the earlier V1/V2 grammars

- V1 (`IDENTIFIER__OBJECTIVE__PLATFORM__TACTIC__AUDIENCE__YYYYMM__AGENCY__NNN__V1`) was
  designed before we knew the business pattern. It drops memo, PO and BUD, which the business
  wants and finance needs. It also adds platform/tactic/month, which the API already supplies.
  Agencies would have to learn a second format.
- V2's `AC000123` code is replaced by the memo + uniqueness tuple plus native-ID binding. It
  was only needed because nothing business-issued existed before launch, and the memo number
  now fills that role.
- Kept from both: exact membership, frozen names, ID-first identity, effective-dated
  corrections, and "no invented phase split".

## 9. Open questions for P'Note / management

1. **Memo series.** Confirm the BUD project memo series is `MO<YYMM><NNN>` (seen only in Media
   Option names) and corporate is `M.COM<NNN>_<BE yy>`. Does one BUD memo cover one project
   or many, and one month or several (Media Option kept `MO2604048` from June to September)?
2. **PO in the name.** The `INVOICE Ads` ledger shows the PO is the agency-fee PO, issued per
   project per month, so it can't stay true for a multi-month campaign. Can field 7 become an
   optional launch-month reference, with finance joined through the ledger/Hub instead? Real POs in
   new names already fell from 95 in July to 24 in September.
3. **BUD list.** Are `C1 C2 C3 H1 H2 PREMIUM` complete? What code should corporate (Idea) and
   Solar use?
4. **Pool zones.** Who defines `ZONE-*` packages, and should zone spend stay shared or be split by an approved weight?
5. **In-house corporate campaigns** (`2026__Sales__Corp_SenaEasyBuy__...`, 6.6% of 2026
   spend): will they adopt SENA-7 with `CORP-*` scope and `INHOUSE`?
6. **Objective vocabulary.** Should `VIDEOVIEWS` replace `VDOviews`, and should Google stop using `SEM` as the objective?
7. **Why duplicate campaigns?** KIN runs up to 23 native campaigns under one name. Are these
   budget top-ups, creative tests or ad-set workarounds? The line model accepts them, but the
   answer affects how KPI per campaign should be read.
8. **Memo register (answered 29 September).** BUD project memos are tracked nowhere except campaign
   names. A memo register is therefore a must-have flow (doc [20](20-marketing-operations-flows.md) BF-2). Until it exists, add
   a memo column to the `INVOICE Ads` ledger rows.
9. **Ledger ownership in the Hub.** Can marketing, SENA Idea and ADMIN BUD each edit only
   their own block, as the Sheet's merged headers imply?
