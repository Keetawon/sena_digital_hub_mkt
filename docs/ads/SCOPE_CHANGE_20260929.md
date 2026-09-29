# Ads scope change — 29 September 2026

Status: **owner selected option 3 (P1–P5), 29 September 2026**, Asia/Bangkok. This note does not amend
[REQUIREMENTS §1.3](../../REQUIREMENTS.md#13-delivery-milestones) or
[doc 15](../15-status-kpi-plan-20260918.md). Those files retain their existing content.
The owner supplied `P1.0 approved`, authorizing P1.1–P1.5. The selected schedule covers
P1–P5; this implementation run still stops after P1 and does not start P2–P6.

## What changes against the residential baseline

REQUIREMENTS §1.3 retains two-developer baseline dates of 30 September (one-project
pilot), 16 October (seven-project core) and 30 October (residential AI pilot). It already
records that capacity changed to one full-time developer. Doc 15 proposes **9 October,
6 November and 27 November 2026**, respectively, assuming that developer can focus on
residential work while business owners supply content and approvals. These are forecasts,
not accepted milestones. No new completion percentage or outcome of the 25 September
review is inferred here.

| Area | Existing residential commitment | Added ads work / consequence |
|---|---|---|
| Ads relationship | Read-only ads mapping to residential content, snapshot classification/resolution and active-ad/expired-promotion alert | P1 creates a Hub-owned operational registry, controlled vocab/scopes, immutable SN/name/UTM issuing, native-ID return and private DW exports. It does not itself pass the existing residential ads-mapping gate. |
| UI/access | Thai content authoring, rights, publication, consumer APIs and data handoff | P1 adds online_staff and agency isolation plus registry-only Tailwind/Flip7/font/motion foundation and three screens; regression checks protect existing workflows. |
| Marketing operations | No full spend/memo/ledger back office in the residential forecast | P2 adds media-line/memo work; P3 actuals/exceptions; P4 E-memo archive; these compete for the same developer but are not started by this note. |
| AI | Separate residential chatbot pilot based on approved public content | P5's internal Hub assistant is a distinct product/integration; it does not replace residential AI acceptance or share its public corpus by default. |
| Data/storage | Existing DW intake and managed content storage/authentication work | Private ads export contract and, later, E-memo/R2 access, hosting and operational ownership add dependencies. No DW/REM/Sheet writes from this task. |
| BU boundary | Residential-only; no generic BU/product/tenant framework | CORP/BU naming tokens classify ads only. P1 does not build Solar content, a BU catalogue or additional workspaces. |

The new **ads priorities P1–P6** are ordering labels in
[PHASE1_PRIORITIES.md](PHASE1_PRIORITIES.md), not REQUIREMENTS' P0/P1/P2 requirement
levels, and not the same as residential Phase 1/Phase 2. Doc 20's BF priority labels
likewise do not authorize starting a later ads priority early.

## Capacity and forecast impact

Planning allowances from the priority plan: P1 ~2 weeks; P2 ~1.5; P3 ~1; P4 ~2; P5 ~2.
Therefore P1–P3 totals **4.5 weeks**, P1–P5 **8.5 weeks**. P6 is unestimated and excluded.
These are one-developer allowances including integration and verification, not measured
estimates or a multiplier for agent assistance. External approvals can add elapsed time.
P1.0 review waiting, rework, onboarding, holidays and leave must be reconciled against
actual capacity before approving calendar dates; overtime is not assumed.

The sensitivity table below shifts the existing forecast by those approximate week
allowances, holding other assumptions constant. Half-week outputs are shown as a
**week commencing Monday**, not a false exact acceptance date. The arithmetic is
illustrative calendar displacement, not a Thai working-day or holiday-adjusted plan.

| Option | Developer allocation | 9 Oct pilot forecast | 6 Nov core forecast | 27 Nov AI forecast |
|---|---|---|---|---|
| 1. P1 now, then residential | ~2 weeks ads; P2–P5 after 27 Nov and outside residential critical work | ~23 Oct 2026 | ~20 Nov 2026 | ~11 Dec 2026 |
| 2. P1–P3 now; P4–P5 after core | ~4.5 weeks before residential resumes | Week of 9 Nov 2026 | Week of 7 Dec 2026 | Earliest week of 28 Dec 2026 if AI goes next; week of 25 Jan 2027 if P4–P5's 4 weeks are inserted before AI |
| 3. Everything now (P1–P5) | ~8.5 weeks before residential resumes | Week of 7 Dec 2026 | Week of 4 Jan 2027 | Week of 25 Jan 2027 |
| 4. Add capacity | Second developer owns ads; primary developer retains residential | 9 Oct remains conditional | 6 Nov remains conditional | 27 Nov remains conditional |

Option 1's “after 27 Nov” is an earliest calendar boundary, not permission to interrupt
the shifted residential AI stage on 28 Nov. To retain the ~11 Dec illustration, keep
P2–P5 off that developer's critical path until residential AI acceptance. If the owner
instead starts ads again immediately after 27 Nov, reforecast AI further. Similarly,
option 2 needs an explicit order between P4/P5 and residential AI after core acceptance.
Adding a second developer does not automatically restore the original September/October
two-developer baseline, recover past delays, or create content/approval capacity.

## Four options for the owner

| Option from PHASE1_PRIORITIES | Pros | Cons / required decision |
|---|---|---|
| **1. P1 now, then back to residential; P2–P5 after 27 Nov** | Delivers the selected naming priority with the smallest diversion; preserves one complete workstream at a time. | Residential forecasts move ~2 weeks. Memo coverage and financial joins remain manual/external; approve that interim operating boundary. Confirm the shifted AI stage is protected as described above. |
| **2. P1–P3 now, P4–P5 after the core** | Gets naming, monthly memo/line linkage and actuals/exception read-back together. | Pilot/core move ~4.5 weeks; depends on DW marts/access and ledger decisions. AI delay depends on the post-core order; it cannot keep the old 27 Nov forecast. |
| **3. Everything now** | Concentrates ads delivery through archive and assistant without switching back to residential between priorities. | ~8.5-week residential displacement before holidays/external waits; only viable with formal re-baselining. “Everything” means estimated P1–P5, not unestimated P6. |
| **4. Add capacity (second developer on ads)** | Best chance to preserve doc 15's forecasts and deliver ads in parallel. | Requires a funded, available developer, onboarding, isolated ownership and primary-developer review time. Dates hold only if these fit and existing external gates are met. |

**Owner decision: option 3, P1–P5**, supplied with P1.0 approval on 29 September 2026.
Use the ~8.5-week displacement scenario above as the selected planning direction;
measured dates, holidays and dependencies still require formal re-baselining. The
earlier option-1 recommendation is superseded. No later ads priority starts in this run.

Owner decision fields: chosen option; date/decision owner; accepted displaced forecast
or added capacity; post-core AI-versus-ads order where applicable; interim Online owner
for external budget/launch approval. The owner/developer updates REQUIREMENTS §1.3 and
doc 15 only in a separately authorized change after this decision.

Acceptance gates remain intact: one real project pilot, seven-project core content and
publication/API handoff, then residential AI quality and scope-boundary acceptance.
A demo, local test count or completed ads registry cannot substitute for those gates.
