# Ads workstream: phase-1 priorities (re-ordered 29 September 2026)

Status: **P1.0 approved; P1.1–P1.5 implemented and verified locally; schedule option 3 (P1–P5) selected on 29 September 2026**.
This execution implements only P1.1–P1.5 and stops for its report. The owner set the **campaign naming registry
(SENA-H) as priority 1**. Everything else in the 29 September brief (E-memo archive, assistant, full UI
refresh, memo/ledger, actuals) follows it. Allowances are planning allowances for one developer
plus agents, not measured estimates.

The [P1 implementation report](P1_IMPLEMENTATION_20260929.md) records changed files,
actual verification output, deviations and remaining go-live gates. This execution
stops at P1; P2–P6 have not started. `sena_h_approved` remains false.

Inputs: [19](../19-campaign-naming-registry.md) §4.2 SENA-H, [20](../20-marketing-operations-flows.md)
BF-0/BF-2/BF-5, owner decisions 1–5 of 29 September. Skills: `.agents/skills/sena-*`.

## Order

| # | Priority | Delivers | Deliverable letters from the brief | Allowance | Blocked by (for go-live, not for coding) |
|---|---|---|---|---|---|
| **P1** | **Naming registry (SENA-H)** | Design slice → schema → code/name/UTM API → registration + agency ID-return screens → DW snapshot contract | C (registry tables), D, E, B (tokens/fonts/motion + registry screens only) | ~2 weeks | P'Note approves SENA-H; brand token KITH vs SENA-KITH; DW source key `hub` |
| P2 | Media lines + memo register (BF-2 minimum) | Ledger import (read-only) → `ads.media_line`; manual memo register; assign each registration to its monthly line; correction table | C (line/memo tables) | ~1.5 weeks | Frozen ledger template + `เลข Memo` column; correction-table approver |
| P3 | Line actuals and exceptions read-back | DW gold → Hub staging (line actuals, C5/C6 findings) → line-actuals screen | B (line actuals screen) | ~1 week | DW marts `dim_media_line`, `fact_media_line_*` (other repo); source keys `adinv`/`mplan` |
| P4 | E-memo archive and search | R2 upload/versions, text + Thai OCR, DRAFT extraction → confirm, restricted RAG, memo search | A, C (`ads.memo_document`) | ~2 weeks | E-memo API/export answer from IT; R2/Supabase region (PDPA cross-border) |
| P5 | Hub assistant (read-only) | Agents SDK in FastAPI, 5 read-only tools, streaming side panel, Thai golden set | B (assistant) | ~2 weeks | OpenAI API access (not only seats); P2–P4 data for tools |
| P6 | UI refresh and later flows | Motion spec on remaining screens, Thai readability result applied; later: QT/PO, bills, payment package, budget forecast (BF-3/8/9/1) | B (remaining) | Later | Business priority after P5 |

## P1 breakdown (the only priority to start now)

| Step | Output | Done when |
|---|---|---|
| P1.0 Design | Fix doc 19 (`SN2600123K` → `SN2600123Q`; SENA-H is the phase-1 template; Sheet stays V1). Write the **registry part of the ads.\* schema** (vocab, scope_code, scope_member, campaign_registration, campaign_name, native_binding, code sequence, roles/RLS). Add a **scope-change note** (vs REQUIREMENTS §1.3 and doc 15) and the **open-questions list**. Start doc 22 with tokens/contrast table, font plan, motion spec and the registry screens | Owner approves the design slice |
| P1.1 UI foundation (minimum) | Tailwind v4 over `tokens.css` (Flip7 tokens), Google Sans (Thai subset) + Noto Sans Thai fallback, `MotionConfig reducedMotion="user"`, two primitives: dropdown pop and row→card morph | Existing Playwright suite still passes; contrast table verified |
| P1.2 Schema | Migration `…0014_ads_registry.sql` + seeds (vocab from Name_Builder `Naming_Options`; scopes A/B from DW `gold.dim_project_group` via a staging script) + SQL/RLS/concurrency tests | `npm run test:db` green; sequence never reuses under concurrency |
| P1.3 API | Pure `naming` module (code, check char, generate, parse, validate) + endpoints: scope picker lists, register → code + name + UTM, validate/explain name, bind native IDs, list/get | pytest: check-char vectors, mutation/swap rejection, round trip, permissions |
| P1.4 Screens | Registry list (row → card), 3-step registration wizard with live name preview and copy (name + UTM launch pack), agency ID-return inbox | Playwright specs; Thai labels; agency sees only own rows |
| P1.5 DW contract | Read-only role + export views for `hub__campaign_registration`, `hub__campaign_name`, `hub__native_binding`, `hub__scope_*` (spec for the DW repo; no DW changes here) | Views documented in doc 19 §6 |

Go-live gate for P1: P'Note's approval of SENA-H recorded. Until then, issue codes in the local and shared
test environments only.

## Impact on the residential milestones

Doc 15 forecasts 9 Oct (one-project pilot), 6 Nov (seven-project core) and 27 Nov (AI pilot) with the
one developer working **full time on residential**. P1 alone takes about 2 weeks of that same developer,
and P1–P5 about 8.5 weeks. The scope-change note (P1.0) must offer options, for example:

1. **P1 now, then back to residential; P2–P5 after 27 Nov.** Each residential forecast moves about 2 weeks.
2. **P1–P3 now, P4–P5 after the core.** The pilot and core forecasts move about 4.5 weeks, and the AI pilot moves further.
3. **Everything now.** Residential moves about 8.5 weeks. Only viable if the residential deadlines are formally re-baselined.
4. **Add capacity** (a second developer on ads). The dates hold only if onboarding fits.

No option changes acceptance gates. The owner selected option 3 with P1.0 approval.
The scope-change note records the ~8.5-week displacement scenario. A measured formal
re-baseline of doc 15 and REQUIREMENTS §1.3 remains a separate change; neither is edited
by this P1 implementation.
