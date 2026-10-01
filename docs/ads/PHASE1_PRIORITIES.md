# Ads workstream: phase-1 priorities (updated 1 October 2026)

Status: **P1/P2 and all demo-first Tasks 0–6 implemented and verified locally,
1 October 2026**. The demo pack is seeded and its replay is READY.
**Owner decisions, 1 October 2026: P3.0 approved; P4.0 approved; DEMO-FIRST.**
The execution order below supersedes the earlier design-only gates and schedule
assumptions. Build working demos on synthetic/TEST data; record unresolved decisions
with a documented default and a Thai `รอคำตอบ` remark rather than waiting for answers.
These are engineering approvals, not production, privacy or financial approvals.
See the [per-task verification report](DEMO_IMPLEMENTATION_20261001.md) and the
[Thai demo walkthrough](DEMO_SCRIPT_TH.md). The demo pack is Task 6 below, not the
historical priority P6 for later financial workflows.

## Current authorized execution order — 1 October 2026

| Task | Delivery | Boundary and acceptance |
|---|---|---|
| 0 | Record these decisions, P5.0 design in doc 22 §6, assistant skill and questions | Docs only; one commit |
| 1 | Shared question badge/popover and staff `คำถามที่รอคำตอบ` page | One registry synchronized with OPEN_QUESTIONS; group by answer owner and link affected screens |
| 2 | P3 line actuals, C5/C6 workflow and document tracking | Doc 25; read verified DW TEST output when available, otherwise frozen synthetic fixtures; Q24–Q28 visible |
| 3 | Residential demo gaps: promotions, atomic multi-entity publication, HYABC | Docs 04/08 snapshot rules; missing content explicitly `ข้อมูลตัวอย่าง`; no synthetic facts represented as real |
| 4 | P4 local document pipeline and restricted memo search | Doc 21; synthetic memos/statements only; no real uploads or external OCR/LLM calls; statements never indexed |
| 5 | One internal Hub assistant: residential, ads and documents | Doc 22 §6; Agents SDK, SSE, caller permissions; staff only; v1 read-only, then confirmed draft-text proposals; fake model in CI |
| 6 | Coherent HYABC + FLEXI demo seed and Thai 15–20 minute presentation | One seed command; every stop names the question/default for the owner to present |

Before each new area, write a short design note, then implement without another
approval pause. After each task run admin typecheck/build, database tests, API tests
and Edge UI tests; report real output, commit explicit paths and push `origin/main`.
Stop only for an unfixable failure or an action touching an external system.
Keep REM, DW, ledger, media sheets, E-memo and Sheet V1 read-only. No deployment.

**P5 scope replaces the ads-only assistant.** SENA staff use one assistant for
projects, brands, models, promotions, ads and documents; agencies have no assistant.
v2 saves proposed text to draft fields only after an explicit confirmation and never
publishes, approves asset rights or confirms memos. The future public chatbot may
reuse the tool/retrieval layer only through published-only data and a separate public
index. Hosting remains Supabase + Vercel (admin) + Hostinger VPS (API, assistant,
workers). The OpenAI key is supplied only in ignored `apps/api/.env`; never output it.
Q36 governs real internal data sent to the API; Q37 governs VPS location.

**Owner addendum, 1 October:** LINE OA account attribution is parked. Keep its card
rows as `CHANNEL` costs in one unattributed `LINE OA (ยังไม่แยกบัญชี)` bucket so
statement totals still reconcile. No LINE OA matching/review screen in the demo.
Q18 and Q20 are deferred by owner and excluded from the questions presentation page.
`sena_h_approved` stays false; production name issuing stays blocked.

## Historical plan and approvals

The instructions in this section and the dated P1/P2 breakdowns below describe
earlier execution gates. The 1 October demo-first order above supersedes their
stop/design-only/no-commit instructions; they do not withdraw the current approvals.

The owner replied `P2.0 approved — implement expanded P2`.
Schedule option 3 (P1–P5), selected on 29 September, remains the delivery direction.
The owner set the **campaign naming registry
(SENA-H) as priority 1**. Everything else in the 29 September brief (E-memo archive, assistant, full UI
refresh, memo/ledger, actuals) follows it. Allowances are planning allowances for one developer
plus agents, not measured estimates.

The [P1 implementation report](P1_IMPLEMENTATION_20260929.md) records changed files,
actual verification output, deviations and remaining go-live gates. The owner now
authorizes implementation of [P2.0](../23-media-lines-and-memo-register.md), with the
latest [card-paid costs and recurring commitments addendum](../24-card-costs-and-recurring-commitments.md)
replacing the earlier card-paid addendum. The
[P2 implementation report](P2_IMPLEMENTATION_20260930.md) records all five passing
checks, refinements and outstanding go-live gates. At that checkpoint execution
stopped after P2 and P3–P6 implementation had not started. Continue building on SENA-H and demo it to
P'Note; no pattern approval is recorded. `sena_h_approved` remains false and production
issuing remains blocked.

**Owner authorization, 1 October 2026:** integrate the motion branch, verify it on
Edge, and provide the local read-only DW TEST login plus frozen 15-view fixtures.
Then complete **P3.0 design** in [doc 25](../25-line-actuals-and-exceptions.md) and
**P4.0 design** in [doc 21](../21-ememo-archive-and-search.md), in that order. The owner
also authorizes explicit-path commits and a normal push to `origin/main` after the
required checks pass. The follow-up addendum requires **Task 0 and Task A to be
pushed separately before docs 25 and 21**: motion `4886981` and DW handoff `30972d0`
are now pushed. The fixture manifest records source commit `4886981`, not its own
future commit. That handoff instruction alone did not authorize P3/P4 implementation;
the subsequent approvals and Tasks 0–6 now govern the synthetic demo. Historical
priority P6 remains later work. The local handoff does not authorize
hosted/production credentials, real document uploads or changes to external sources.

Inputs: [19](../19-campaign-naming-registry.md) §4.2 SENA-H, [20](../20-marketing-operations-flows.md)
BF-0/BF-2/BF-5/BF-12, owner decisions of 29–30 September. Skills: `.agents/skills/sena-*`.

## Order

| # | Priority | Delivers | Deliverable letters from the brief | Allowance | Blocked by (for go-live, not for coding) |
|---|---|---|---|---|---|
| **P1** | **Naming registry (SENA-H)** | Design slice → schema → code/name/UTM API → registration + agency ID-return screens → DW snapshot contract | C (registry tables), D, E, B (tokens/fonts/motion + registry screens only) | ~2 weeks | P'Note approves SENA-H; brand token KITH vs SENA-KITH; DW source key `hub` |
| P2 | Media lines, memo register, card costs and recurring commitments | P2.0 design → ledger and Media card-sheet imports; group lines/phase children and revisions; memo mirror/aliases; monthly SN assignments; corrections; cost/payment classification and document matrix; account registries; commitments/caps and prepaid recognition | C (line/memo tables), expanded by the 30 Sep addendum | **Re-estimate required**; original ~1.5 weeks does not cover the expanded scope | Q1 manual evidence/access; Q4 ledger headers; Q5 correction authority; Q18–Q24 card/channel/Finance acceptance; affected-path gates in docs 23/24 |
| P3 | Line actuals, C5/C6 exceptions and document tracking | P3.0 design → DW gold → Hub staging/read-back; monthly document-reference matrix and copy-follow-up log | B (line actuals screen), expanded 1 Oct | Original ~1 week predates document tracking; re-estimate | Q25/Q26 DW contract, metrics and cutover; Q24/Q27 document matrix/due rules; optional Q28 agency projection. DW builds current media lines from `hub__media_line`, not a second ledger ingestion |
| P4 | E-memo archive/search and restricted statement pipeline | Implemented synthetic local versions, text/OCR, reviewed handoff and restricted memo search. Private R2, real E-memo ingestion and production Thai OCR acceptance remain later gates. Statements never enter RAG. LINE OA matching/review is owner-deferred under Q18/Q20; CHANNEL costs remain unattributed | A, C (`ads.memo_document`), statement pipeline added 30 Sep | Original ~2 weeks predates the statement addition; re-estimate with P2 | E-memo access; Q7 before real uploads/external processing; Q21 Media roles; Q22 statement controls; Q29 retention; Q30 engine/reviewer acceptance |
| P5 | One internal Hub assistant (scope revised 1 Oct) | Agents SDK in FastAPI, 13 permission-preserving tools across residential/ads/documents, streaming panel, Thai golden set; confirmed draft-text proposals follow read-only v1 | B (assistant), expanded residential scope | Re-estimate; no unchanged delivery date claimed | Q36 real-data API consent; Q37 hosting region; Q38 model/key; synthetic demo proceeds |
| P6 | UI refresh and later flows | Motion spec on remaining screens, Thai readability result applied; later: QT/PO, bills, payment package, budget forecast (BF-3/8/9/1) | B (remaining) | Later | Business priority after P5 |

## P1 breakdown (implemented; historical execution scope)

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

## P2 authorization and design gate — 30 September 2026

Historical authorization; the later demo-first order supersedes the stopping rules.

The owner first authorized Task 0 decision updates and P2.0 docs only, then explicitly
approved the expanded design with `P2.0 approved — implement expanded P2`. Implement
[doc 23](../23-media-lines-and-memo-register.md),
[doc 24](../24-card-costs-and-recurring-commitments.md), doc 22's P2 screen contract and
[OPEN_QUESTIONS](OPEN_QUESTIONS.md). Keep P1 behavior, scope grammar, issued names and
`sena_h_approved` unchanged. Source systems and the DW repo remain read-only.

P2.0 proposes group lines with phase financial children, immutable superseding
revisions, manual E-memo mirroring, explicit monthly assignments, evidence-backed
corrections and sanitized replayable ledger staging. The latest owner addendum adds:

- Every cost record carries `MEDIA`, `AGENCY_FEE`, `CHANNEL`, `TOOL` or `BANK_FEE`,
  plus `CORPORATE_CARD`, `AGENCY_PO_INVOICE`, `PLATFORM_INVOICE` or `BANK_TRANSFER`.
  Document requirements use the `(cost type, payment method)` pair.
- Ad-account and channel-account registries with validity dates and reviewed
  scope/BUD mappings; explicit BUD split rules for applicable ad accounts.
- Recurring commitments without a campaign name or SN, memo period/cap coverage,
  and exact monthly recognition of annual prepaid amounts.
- Canonical memo numbers plus evidenced aliases, without merging different serials
  based on similar notation.
- Read-only import of the Media team's existing monthly card sheet: exact-header
  validation, sanitized raw-row hashes, harmless replays, conflict quarantine and
  statement-total checks. The Media team's working process remains unchanged.
- Staff-only screens and four doc 23 plus six doc 24 private `hub` export views.

Cash paid, monthly recognized cost and approved line/commitment budget are distinct
measures. P2 records payment method and references; it does not execute a payment or
build the later QT/PO, bill-approval or payment-package workflows. No P3 actuals
read-back, BF-1 targets or broader project `funding_contribution` implementation is
included. Ad-account BUD splitting is explicitly included by the latest addendum.

The statement PDF/storage/OCR pipeline was designed in P2 and is now implemented
as a synthetic local P4 demo. The owner subsequently deferred LINE OA account
matching and its review screen (Q18/Q20); preserve its unattributed CHANNEL costs.
Statements are restricted to marketing-ops roles and never indexed in RAG. Real
uploads, external processing and evidence imports remain outside the demo;
external OCR/LLM processing awaits the Q7 DPO decision.

**The implementation gate is satisfied.** Complete P2 schema → API → UI → tests
against the expanded approved design. Use synthetic fixtures, run all five required checks and
write a P2 implementation report before stopping again. Q1/Q4/Q5 are go-live gates,
not reasons to block synthetic coding after that approval. This authorization does
not start P3–P6 implementation or authorize a commit/push; schedule option 3 alone is not a design
approval for every later priority.

## Impact on the residential milestones

Doc 15 forecasts 9 Oct (one-project pilot), 6 Nov (seven-project core) and 27 Nov (AI pilot) with the
one developer working **full time on residential**. The original P1.0 planning
scenario allowed about 2 weeks for P1 and 8.5 weeks for P1–P5. Its four options were:

1. **P1 now, then back to residential; P2–P5 after 27 Nov.** Each residential forecast moves about 2 weeks.
2. **P1–P3 now, P4–P5 after the core.** The pilot and core forecasts move about 4.5 weeks, and the AI pilot moves further.
3. **Everything now.** Residential moves about 8.5 weeks. Only viable if the residential deadlines are formally re-baselined.
4. **Add capacity** (a second developer on ads). The dates hold only if onboarding fits.

No option changes acceptance gates. The owner selected option 3 with P1.0 approval.
The scope-change note records the original ~8.5-week displacement scenario. The
expanded P2 scope and future P4 statement pipeline invalidate using those original
allowances as a current delivery forecast. Re-estimate the approved design for one
developer, including integration/testing and unresolved acceptance gates, before
proposing dates. No replacement dates or unchanged residential deadlines are claimed.
A measured formal re-baseline of doc 15 and REQUIREMENTS §1.3 remains a separate
change; neither is edited by this P2.0 documentation slice.
