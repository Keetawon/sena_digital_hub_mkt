# Expanded P2 — media lines, memos, card costs and recurring commitments

30 September 2026, Asia/Bangkok. The owner explicitly replied **`P2.0 approved —
implement expanded P2`** after reviewing docs 23–24. **Expanded P2 is implemented
and verified locally. All five required checks pass.** Engineering approval does
not approve any real memo or budget.

## Delivered behavior

- A monthly group line retains separate REM phase children, their BUD, memo,
  fee-PO reference and gross budget. Corporate programs retain their full-period
  budget once. Approved revisions supersede each other; SN assignments are explicit
  and unique per month. Scope A–F/BU validation preserves the P1 naming identity.
- Memos mirror external approval with restricted decision/evidence fields, canonical
  numbers and separately reviewed aliases. Material evidence changes suspend affected
  lines and commitments. Memo-versus-reservation differences require a recorded
  acknowledgement; the Hub never fabricates balancing rows or approves a memo.
- Correction proposals require admin evidence review and a separate explicit monthly
  application. The conflicting Bangpu codes remain blocked.
- Five cost types and four payment methods drive a versioned document-reference
  matrix. Account mappings preserve text IDs, validity and reviewed BUD splits.
  Recurring commitments have no SN/name; covered occurrences consume memo caps once.
  Annual prepayments allocate exact satang over covered months, separately from cash.
- Reviewed operator CSV exports feed ledger and Media card-sheet importers. Exact
  headers, safe projections and raw-row hashes support harmless replay and conflict
  quarantine. Identical card occurrences remain distinct. Statement controls are
  rechecked in SQL; replacement batches supersede previous costs and allocations.
- Thai staff screens share the existing Emerald & Champagne theme, typography,
  row-to-card detail, keyboard focus/deep links and reduced motion. Agencies receive
  no budgets, memos, accounts, commitments or financial counts.
- Migration 0015 uses guarded, audited operations, forced RLS and ten private `hub`
  export views. Original statements, PDF storage, OCR, LINE OA count matching and
  all statement RAG remain outside this implementation.

## Files changed by step

Paths are relative to this repository. The design documents were already modified
when implementation was approved; they are included here because this execution
records the approval and reconciles the implemented contract.

| Area | Files |
|---|---|
| Database and RLS | `supabase/migrations/202609300015_ads_media_lines_memos.sql`, `supabase/tests/ads_media_lines.sql`, `supabase/tests/concurrent_ads_line_revision.mjs` |
| API | `apps/api/sena_hub_api/finance.py`, route registration in `main.py`, `apps/api/tests/test_finance.py` |
| Read-only export importers | `apps/api/sena_hub_api/finance_imports.py`, `scripts/stage-ads-ledger.py`, `scripts/stage-ads-card-costs.py`, `apps/api/tests/test_finance_imports.py`, `apps/api/tests/test_finance_imports_db.py` |
| Thai UI | `apps/admin/app/ads/finance/page.tsx`, `apps/admin/components/ads-finance.tsx`, `ads-finance.css`, `finance-actions.tsx`, `finance-display.tsx`, `finance-fields.ts`, `finance-form.tsx`, `tests/ui/ads-finance.spec.ts` |
| Hub integration | Staff finance navigation in `hub-shell.tsx`/`hub-admin.tsx`; staff monthly financial context in `ads-registry.tsx`; explicit finance routes/filters in `apps/admin/app/api/hub/[...path]/route.ts`, covered by `tests/ui/ads-finance-proxy.spec.ts` |
| Test wiring | Root `package.json`, `scripts/test-db.mjs`; `supabase/tests/ads_registry.sql` scopes its eight-table RLS assertion to the eight P1 table names so P2 tables can coexist |
| Contracts and owner decisions | `docs/19-campaign-naming-registry.md`, `20-marketing-operations-flows.md`, `22-hub-assistant-and-ui.md`, `23-media-lines-and-memo-register.md`, `24-card-costs-and-recurring-commitments.md`, `docs/ads/PHASE1_PRIORITIES.md`, `OPEN_QUESTIONS.md`, `P2_IMPORT_FORMAT.md`, this report |

No dependency was added. Local verification databases, caches, logs and browser
artifacts are generated/ignored files. Credentials are not included here. No real
ledger, memo, card statement, Media workbook or DW data was imported or changed.

## Actual verification results

The API suite and browser suite run sequentially against local PostgreSQL and the
production Next build. `UV_CACHE_DIR` points to `.cache/uv` inside the workspace:
the first targeted importer command failed to initialize the default uv cache with
`Access denied (os error 5)`, and the workspace-cache retry succeeded.

`npm.cmd run typecheck --prefix apps/admin` — exit **0**:

```text
> sena-hub-admin@0.1.0 typecheck
> tsc --noEmit
```

`npm.cmd run build --prefix apps/admin` — exit **0**, final output excerpts:

```text
▲ Next.js 16.3.5 (Turbopack)
✓ Compiled successfully in 969ms
  Finished TypeScript in 3.6s ...
✓ Generating static pages using 10 workers (3/3) in 572ms
├ ƒ /ads/finance
Warning: Failed to find font override values for font `Google Sans`
Skipping generating a fallback font.
```

This existing warning concerns Next's automatic fallback metrics. The explicit
Noto Sans Thai configuration remains unchanged.

`uv run --project apps/api --env-file apps/api/.env pytest apps/api/tests` — exit **0**:

```text
collected 716 items
================= 716 passed, 2 warnings in 72.05s (0:01:12) ==================
```

The two existing dependency warnings concern Starlette/httpx TestClient and the
deprecated AnyIO BlockingPortal alias. This includes 289 finance API tests and 38
importer tests, including actual synthetic database transactions; none was skipped.

`npm.cmd run test:db` — exit **0**, output excerpts:

```text
PASS: ads registry agency isolation, frozen names, native binding and DW export permissions
PASS: memo mirror, no direct DML, revision supersession, monthly assignment, alias review, account intervals, annual allocation and memo invalidation
PASS: forced RLS, agency/residential/audit isolation, ten private export views, PII column denial and immutable financial history
PASS: ads finance role isolation, revisions, memos, assignments, imports and private exports
PASS: concurrent ads registrations wait on the annual counter and commit distinct sequential SN codes
PASS: two competing line revisions serialize; one wins and one receives a stale-version conflict
PASS: concurrent memo cancellation prevents confirmation against stale external approval
PASS: concurrent SN-month assignment leaves exactly one active relationship
PASS: concurrent canonical memo and alias claims cannot acquire the same identifier
PASS: competing correction approvals cannot own the same observed code, agency and month
PASS: competing commitment covers cannot reserve more than the same applicable line component
PASS: concurrent identical card imports return one batch and one harmless replay
PASS: concurrent statement interpretations cannot create two applicable batches
```

All existing residential SQL and model/asset/brand concurrency checks also passed.
The first full database run exposed an outdated P1 assertion counting exactly eight
tables across the entire `ads` schema. It now checks its eight named registry tables;
P2 tables have their own forced-RLS checks. No P1 permission rule was relaxed.

`npm.cmd run test:ui` — exit **0**:

```text
Running 71 tests using 1 worker
  71 passed (2.8m)
```

This includes the 54 existing checks, 14 finance screen checks and three real-proxy
checks. No tests were skipped. The existing `NO_COLOR`/`FORCE_COLOR` warning was emitted.

The first browser run found missing finance routes in the existing local proxy and
a client import cycle when entering the P1 registry. Both were corrected before
rebuilding. New real-proxy tests cover staff routes, typed validation, agency denial,
same-origin writes and blocked unknown routes/filters. The live finance browser
test passes through the actual proxy/API/database. All P1 registry and residential
browser regressions passed on the rebuilt application.

Targeted development failures also found SQL record/alias ambiguity, metadata
mistaken for money, duplicate budget reservations, altered BUD split weights and
indirect memo invalidation. Fixes were verified by retained regression tests.

Local deployment command, exit **0**:

```text
> dev:migrate
> node scripts/local-migrations.mjs
Applied 202609300015_ads_media_lines_memos.sql
```

Read-only verification after application returned:

```json
{"database":"sena_hub_local","sena_h_approved":false,"migration0015_checksum_matches":true,"ads_tables_without_forced_rls":0}
```

Full local logs: [typecheck](../../artifacts/p2-verification/typecheck.log),
[build](../../artifacts/p2-verification/build.log),
[API](../../artifacts/p2-verification/pytest-api.log),
[database](../../artifacts/p2-verification/test-db.log),
[browser](../../artifacts/p2-verification/test-ui.log),
[migration](../../artifacts/p2-verification/migrate.log).

Visual inspection of the running build covered the
[1440px memo register](../../artifacts/p2-verification/finance-desktop.png) and
[390px memo form](../../artifacts/p2-verification/finance-mobile.png), including a
settled reduced-motion dialog. The theme, Thai labels and form width render correctly.
This engineering check does not replace the named Thai business-user review in Q12.

## Implementation refinements and limits

- The importer is a shared standard-library module with two CLI entry points. Its
  tests live under `apps/api/tests`, ensuring the required API pytest command runs
  both validation and real transactional import tests. The handoff is documented in
  [P2 import format](P2_IMPORT_FORMAT.md): UTF-8 CSV plus an explicit JSON manifest,
  maximum 10 MiB/5,000 rows, local runtime-role application only. Real source-profile
  and deployment acceptance remain open; no remote migration/import was performed.
- A single transaction advisory lock serializes financial writes. This deliberately
  favors correctness for the current low-volume, one-developer workflow. Readers
  remain concurrent; measured write contention would justify narrower locks later.
- Account versioning includes an explicit audited close date separate from the
  immutable mapping payload. It makes open-ended mappings replaceable while
  preventing a close across confirmed charges or active commitments. Effective
  validity and the original declaration are both available in exports; see doc 24.
- Editing a draft line revision preserves that draft as SUPERSEDED and creates a
  new DRAFT snapshot with a new revision ID. No component DELETE is needed, and the
  returned detail identifies the current draft for the next confirmation.
- Finance screens use one `/ads/finance` workspace with URL `view`, `record` and
  filter parameters. Native disclosure sections replace the proposed detail tabs
  so reviewers can compare several financial revisions/children simultaneously.
  Existing motion, focus restoration and reduced-motion primitives are retained.
- The API uses typed routes over two private SQL dispatch functions. Clients cannot
  choose arbitrary SQL operations, roles or actors. Import application is a trusted
  local operator CLI, not a browser upload. No file/archive workflow was added.
- The Finance document matrix remains proposed, and cash classification does not
  claim document completeness. Missing account/coverage attribution stays visible;
  no OA account is inferred from a shared descriptor or row order.

## Remaining go-live gates

The authoritative questions and defaults remain in [OPEN_QUESTIONS](OPEN_QUESTIONS.md).
Q1/Q4/Q5 require accepted manual memo evidence, a reviewed ledger profile and named
correction authority. Q14–Q17 govern memo formats, funding/mappings and phase grain.
Q18–Q24 govern LINE OA ownership, memo coverage policy, per-account evidence, Media
role provisioning, card-sheet/control profiles, alias identity and Finance's
document/BUD split/allocation policy. Q3 remains the DW source-key/export acceptance
gate. Q7 requires hosting/processing decisions before real personal data is used.
Production sign-in/role provisioning and human Thai readability review remain open.

`sena_h_approved` remains false; P'Note's Q2 pattern approval is separate and production
name issuing remains blocked. P1 grammar, issued names and native bindings are
unchanged. No P3/P4 construction, source-system writes, Git staging, commit or push
was performed. The local application is available at
`http://127.0.0.1:3000/ads/finance` using the local Online/admin test persona.
No remote Supabase migration or production deployment is claimed. This execution
stops after P2.
