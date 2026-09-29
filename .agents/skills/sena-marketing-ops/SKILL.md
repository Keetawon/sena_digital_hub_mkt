---
name: sena-marketing-ops
description: >
  SENA marketing-operations domain for the Hub ads module: the media line
  (scope × calendar month × agency = one INVOICE Ads ledger row), memo register
  (BUD MO<YYMM><NNN>, corporate M.COM<NNN>_<BE yy>), ledger import, agency-fee
  QT/PO, media bills, payment package, line actuals from the DW, controls
  C1–C9, correction crosswalk, business flows BF-0…BF-12 and the Hub↔DW repo
  boundary. Use when designing or building ads.* tables other than the name
  generator, ledger/memo imports, line actuals, exception queues, or
  anything that touches spend, budgets, memos or POs.
---

# SENA marketing operations (ads module)

Read `docs/20-marketing-operations-flows.md` (flows, controls, repo boundary) and
`docs/19-campaign-naming-registry.md` §2.1 and §5 (ledger review, table list). Naming
rules are in the `sena-campaign-naming` skill.

## Established facts (don't re-derive)

- **Media line = scope × calendar month × agency** = one row of the `INVOICE Ads` ledger
  (Sheet `1MjW1VMV53sqAhZ78EFFRmIeogwMJFMtbgIX-JDwral4`, one tab per month, header positions
  differ by month, so bind columns by header text). Corporate lines: program × period, BUD `SID`.
- Spend→line on `(group code, month, agency)` matched ledger totals within +1.6% / −5.2% / −3.7%
  (May/Jul/Aug). Mismatches go to a **correction crosswalk**, approved by the steward (approver TBD).
- Memo: BUD `MO2604048`-style, corporate `M.COM033_69`-style. BUD memos exist nowhere except
  campaign names, and about 85% of 2026 spend has no memo. The memo register is P0 (BF-2).
  The Hub **mirrors** E-memo and never approves a memo itself.
- The PO in legacy names is the **monthly agency-fee PO** (`BK-PO2608-0260`), per project per
  month. Media is paid by Meta invoice or card, never against that PO.
- Fee arithmetic: fee = media × rate × 1.07; planned media = gross ÷ (1 + rate × 1.07).
  Rates from DW `gold.dim_agency_fee_monthly`.
- Bills follow **billing periods** (Google ~21st–21st, FB card ~23rd–25th), never assumed to be a
  calendar month; allocate bills to lines explicitly.
- Pooled funding (Kith SEM pool, 3,000 per project) = `ads.funding_contribution`, not a scope.
- Leads: 14,430 of 27,015 REM leads since May carry a Meta campaign ID matching DW; Google IDs are
  never captured (fix: `{campaignid}` in final URL suffix + form capture).

## Modelling rules

- Money: `numeric(14,2)` THB; never float. Month: `date` = first day of month (Asia/Bangkok).
- Revisions supersede, never add up: one applicable approved revision per line; memo amount = Σ its lines (gross).
- Ledger blocks have owners (Marketing budget / SENA Idea fee / BUD admin media / ADMIN BUD payment).
  Enforce column-block edit rights through RLS/role checks, not UI hiding.
- Agencies see only their own lines (RLS on agency code bound to the actor).
- Imports are replayable: keep the raw source row (`source_sheet`, `tab`, `row`, `hash`) in
  `staging`, then upsert typed rows; re-running an import is idempotent.
- Budget amounts are internal and never reach `public_api` or the public chatbot.
- Exclude the ledger `draft` tab's credit-card last-4 column entirely.

## Repo boundary

| Here (`sena_digital_hub_mkt`) | DW repo (`sena_idea_mkt_data_warehouse`, read-only from here) |
|---|---|
| `ads.*` registry, memo mirror, name issue, launch pack, bills, payment status, exception UI | Platform/REM/Sheet ingestion, name parser, `dim_media_line`, controls C1–C9, FHI |

Contracts only: Hub `ads.*` → (read-only role, dlt) → DW `bronze.hub__*` (source key `hub`);
DW gold (line actuals, findings) → stage script → Hub staging (pattern:
`scripts/stage-gold-project.py`). DW source keys `adinv`/`mplan`/`hub` are pending registration.
Never write to the DW, the ledger Sheet, the media-plan workbook or REM.

## Controls (DW computes; Hub displays)

C1 target vs lines vs memo · C2 fee = media × rate × 1.07 (≤1 THB) · C3 bills vs DW spend (±2%) ·
C4 pacing 90–110% · C5 name conformance + approved line (100% new spend) · C6 code consistency ·
C7 lead attribution coverage · C8 QT/PO ageing · C9 payment package by the 19th of M+1.
Findings land in `gold.fact_marketing_ops_finding`; the Hub exception queue reads them.
