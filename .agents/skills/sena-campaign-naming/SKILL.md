---
name: sena-campaign-naming
description: >
  SENA ad campaign naming registry: the Hub-issued SENA-H template
  (LABEL__OBJECTIVE__SCOPE__AGENCY__CODE[__VARIANT]), the SN registration code
  and its check character, the A–F scope picker, vocabularies, UTM issue,
  native campaign-ID binding, and the legacy SENA-7 / V1 parse reference. Use
  when building, testing or reviewing anything that generates, validates,
  parses or registers campaign names or scope codes (ads.vocab,
  ads.scope_code, ads.campaign_registration, ads.campaign_name,
  ads.native_binding, name-issue API or screens). Do NOT use for residential
  content/publishing work.
---

# SENA campaign naming registry

Source of truth: `docs/19-campaign-naming-registry.md` (§4 SENA-7 = legacy/interim parse
reference, §4.2 SENA-H = what the Hub issues). Flows: `docs/20-marketing-operations-flows.md`.
Older V1/V2 docs in `docs/ads/` are superseded for new names; keep their controls only.
If this skill and doc 19 disagree, doc 19 wins. Report the conflict; don't silently pick one.

## Status guard

SENA-H is **proposed**. P'Note (pattern owner) must approve dropping memo and PO from the name.
Build and test it, but seed the registry `status` so production issuing can be switched on only
after approval. Never re-point `tools/name_builder` (the Sheet stays V1; the Hub is the phase-1
surface).

## SENA-H template

```text
LABEL__OBJECTIVE__SCOPE__AGENCY__CODE[__VARIANT]
```

| Field | Rule |
|---|---|
| LABEL | From the scope's English display name, `[A-Z0-9 .-]{1,40}`, starts alphanumeric. Informational only, never parsed for identity |
| OBJECTIVE | `LEADS TRAFFIC AWARENESS ENGAGEMENT SALES VIDEOVIEWS CONVERSION`. Position 2 is fixed (the Meta parser reads it). Tactic (SEM etc.) comes from the platform API, never the name |
| SCOPE | Token from the picker below; never typed free |
| AGENCY | `BRANDSTROM COMBAY KIN MEDIAOPTION 7DAYSSUCCESS INHOUSE` + steward additions (`ads.vocab`) |
| CODE | `SN` + YY + 5-digit sequence + check char. Issued at registration, never reused |
| VARIANT | Optional, controlled list: `KW-BRAND KW-COMPETITOR KW-GENERIC KW-LOCATION CAPI-TEST` + offer tags such as `LIVNEX`. **Never a project/brand name**; co-promotion is scope D |

Delimiter `__`; uppercase ASCII only; no Thai, `| ' , + *`, amounts, months, memo or PO.
BUD, memo, PO, budget/KPI and month live on the **monthly media line**, not the name.

Lexical regex (vocab membership, scope existence and uniqueness are checked against tables):

```regex
^[A-Z0-9][A-Z0-9 .\-]{0,39}__(LEADS|TRAFFIC|AWARENESS|ENGAGEMENT|SALES|VIDEOVIEWS|CONVERSION)__((C|H|T|S)-[A-Z0-9]{4}-[A-Z0-9]{5}(-[A-Z0-9]+)?|ZONE-[A-Z0-9-]+|BRAND-[A-Z0-9-]+|CORP-[A-Z0-9-]+|BU-[A-Z0-9-]+)__[A-Z0-9]{2,20}__SN[0-9]{7}[2-9A-HJ-NP-Z](__[A-Z0-9-]{1,24})?$
```

## Registration code

```python
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"   # 32 chars, no 0/O/1/I
WEIGHTS = (3, 5, 7, 9, 11, 13, 15)
def sn_code(yy: int, seq: int) -> str:
    digits = f"{yy:02d}{seq:05d}"
    return "SN" + digits + ALPHABET[sum(w * int(d) for w, d in zip(WEIGHTS, digits)) % 32]
```

Odd weights are units mod 32, so every single-digit error and every adjacent transposition is
detected. Sequence: one Postgres sequence/counter per year, allocated in the same transaction as
the registration insert (gaps are fine; reuse is not).

Test vectors (verified 29 Sep 2026):

| Input | Code |
|---|---|
| 26, 101 | `SN2600101Y` |
| 26, 102 | `SN2600102F` |
| 26, 103 | `SN2600103W` |
| 26, 104 | `SN2600104D` |
| 26, 105 | `SN2600105U` |
| 26, 106 | `SN2600106B` |
| 26, 123 | `SN2600123Q` (doc 19 table says `…K`, which is a typo; fix the doc) |
| 26, 1 | `SN2600001M` |

## Scope picker (A–F, three cascading steps)

Carried from the registry Sheet `How_To_Use` rows 21–31. Changing step 1 or 2 clears later
steps. The system orders members. A missing group/phase/brand means "ask SENA Idea"; never allow
a near match. Brands "proposed, pending approval" are unusable until approved.

| Step 1 | Step 2 | Step 3 | SENA-H SCOPE token | Registry rows |
|---|---|---|---|---|
| A whole group | group `C-COZI-BTSSM` | — | `C-COZI-BTSSM` | 1 GROUP |
| B one phase | group | 1 phase `HY2DE` | `C-FLEX-STCRN-HY2DE` | 1 PHASE |
| C several phases of one group | group | ≥2 phases | group only `C-FLEX-STCRN` (flag multi-phase) | ≥2 PHASE |
| D several groups / expo / zone | first group | ≥1 more group | `ZONE-<slug>` (steward or generated on save, e.g. `ZONE-COZI-PET4`) | ≥2 GROUP |
| E brand | brand | — | `BRAND-<slug>` | 1 BRAND |
| F corporate / BU | topic | — | `CORP-<pillar/program>` / `BU-<unit>` | 1 CORPORATE/BU |

C and D need ≥2 distinct members, and the name length never grows with member count. Phase IDs
outside `[A-Z0-9]` get a steward ASCII alias; the exact REM ID stays in the member row as text
(keep leading zeros). Group/phase lists are imported from DW `gold.dim_project_group` + bridges.
Inactive/conflicting codes (`C-MIBF-BNGPU` vs `C-MIGD-BNGPU`) are blocked; history goes through
the correction table. Brand token `KITH` vs `SENA-KITH` is an open question: one active token and
one alias.

## Invariants the API must enforce

1. Names are generated server-side only, from registry rows; clients never send a name string.
2. Round trip: `parse(generate(x)) == x` for every issued name (property test).
3. Issued names are immutable. A different scope/objective/agency means a new registration and a new CODE.
4. One CODE can bind **many** native campaigns (KIN reuses one name up to 23 times). Binding key
   `(platform, account_id, campaign_id)` is unique; binding a native ID to a second CODE is an exception, not an overwrite.
5. UTM: `utm_campaign` = full name, `utm_id` = platform campaign ID (`{campaignid}` for Google).
6. DW match order: CODE → Hub-bound native ID → (SCOPE, month, AGENCY) → correction table → unresolved.
   A name never overrides a confirmed binding.

## Legacy parse (SENA-7, read-only)

As-is 2026 pattern: `Project__Objective__ITGroupCode__BUD__Memo__Agency__PO`. Memo series
`MO<YYMM><NNN>` (BUD) and `M.COM<NNN>_<BE yy>` (corporate); PO = monthly agency-fee PO
`<ENTITY>-PO<YYMM>-<NNNN>`; placeholders (`PO-xxx`, `*`) → `PO-PENDING`; quotations (`QT…`,
`BST…`) → quotation field. Parsing legacy names is DW work; the Hub only needs it for the
explain-name helper and migration checks.

## Checks to leave behind

- Unit tests: check-char vectors above, every single-digit mutation and adjacent swap of a code rejected, regex accept/reject table built from doc 19's examples.
- Property test: generate → parse round trip over random valid registrations.
- SQL test: sequence never reuses a value under two concurrent registrations (pattern: `supabase/tests/concurrent_*.mjs`).
